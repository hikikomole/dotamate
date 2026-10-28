#!/usr/bin/env node
// Сборщик архива разобранных матчей. Запускается cron'ом на сервере раз в час.
//   node tools/replay/collect.js [--limit 3] [--keep-days N]   (--backfill-purchases, --prune-only — разовые)
// Цепочка на матч: salt (tools/replay-poc.js) -> скачать (download-replay-poc.js) -> распаковать ->
// разобрать (odota/parser) -> нормализовать (normalize.js) -> архив -> удалить временные файлы.
//
// Откуда матчи: из нашей же базы data/public-matches (ranked All Pick/All Draft, 0–4500 MMR,
// длиннее 15 минут, не старше 7 дней — у Valve реплей живёт ограниченное время).
// Поэтому каждый разобранный матч уже учтён в статистике сайта (build-our-stats), а архив
// добавляет к нему то, чего в ленте OpenDota нет: K/D/A, золото, предметы, позиции, варды, чат.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { normalize, creepFrames } = require('./normalize');
const { cellToUV } = require('./minimap');
const gcAccounts = require('./gc-accounts');

const ROOT = path.join(__dirname, '..', '..');
const HOME = process.env.DOTAMATE_COLLECTOR || path.join(require('os').homedir(), 'dotamate-collector');
const PUBLIC = path.join(ROOT, 'data', 'public-matches');
const REPLAYS = path.join(ROOT, 'secrets', 'replays');
const WORK = path.join(HOME, 'work');
const TMP = path.join(HOME, 'tmp');
const ARCHIVE = path.join(HOME, 'archive');
const MATCHES = path.join(ARCHIVE, 'matches');
const STATE = path.join(ARCHIVE, '_state.json');
const INDEX = path.join(ARCHIVE, 'index.json');
// Разбор по запросу со страницы матча (/match/): задания <id>.job кладёт PHP API в REQUESTS,
// результат — REQUESTED/<id>.json, отдельно от архива: такие матчи (любой режим и лобби) НЕ попадают
// в index.json, purchases.jsonl и тепловую карту, то есть не влияют на статистику сайта.
const REQUESTS = path.join(HOME, 'requests');
const REQUESTED = path.join(ARCHIVE, 'requested');
const REQUESTED_KEEP_S = 14 * 86400;
// Короткая запись матча для статистики покупок (время каждой покупки) — одна строка JSON на матч, ~13 КБ (замер 09.10: 664 матча — 8,8 МБ).
// Полный файл матча (~1,8 МБ) нужен эфиру и хранится KEEP_DAYS дней (про-матчи — без срока), запись покупок — всегда.
const PURCHASES = path.join(ARCHIVE, 'purchases.jsonl');
const SCHEDULE = path.join(require('os').homedir(), 'dotamate-data', 'live-schedule.json');
const JAVA = path.join(HOME, 'jre21', 'bin', 'java');
const JAR = path.join(HOME, 'dotamate-parser.jar');
const JAVA_FLAGS = ['-Xmx1500m', '-Xlog:disable', '-Xlog:all=warning:stderr', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=2',
  '-Djava.io.tmpdir=' + TMP, '-Dorg.xerial.snappy.tempdir=' + TMP, '-cp', JAR, 'ParseCli'];
// Второй проход по реплею: позиции крипов (tools/replay-parser/MapProbe.class поверх того же jar). Необязательный:
// при ошибке матч сохраняется без поля creeps, а причина пишется в журнал.
const PROBE_CP = JAR + path.delimiter + path.join(ROOT, 'tools', 'replay-parser');
const PROBE_FLAGS = JAVA_FLAGS.slice(0, -3).concat(['-cp', PROBE_CP, 'MapProbe']);

// Домашний ПК-помощник (27.10.2026): DOTAMATE_WORKER=1 — берёт только нечётные match_id и не берёт про-матчи.
// Сервер, пока помощник жив (свежий heartbeat в архиве, < 20 мин), берёт только чётные. Результаты помощника
// переносит на сервер tools/replay/import-remote.js.
const WORKER = process.env.DOTAMATE_WORKER === '1';
const REMOTE_HB = path.join(ARCHIVE, 'remote-worker.heartbeat');
const remoteAlive = () => { try { return Date.now() - fs.statSync(REMOTE_HB).mtimeMs < 20 * 60e3; } catch { return false; } };
const SKIP_CLUSTERS = new Set([413, 415, 417]); // Китай: из РФ скачивание не укладывается в таймаут
const MAX_AGE_S = 7 * 86400;
const MIN_AGE_S = 15 * 60;   // реплей появляется у Valve не сразу после матча
const MAX_TRIES = 3;
// Потолок пачки 10 (тариф RuBig с 10.10.2026: 115 процессов, 3 ГБ). Ограничивают также salt — до 90 запросов
// на аккаунт в сутки (pickAccount) — и время: запуск каждые 10 мин должен успеть до следующего.
const LIMIT = Math.min(10, Math.max(1, Number(process.argv[process.argv.indexOf('--limit') + 1]) || 3));
const KEEP_DAYS = process.argv.includes('--keep-days') ? Number(process.argv[process.argv.indexOf('--keep-days') + 1]) : 0; // 0 — не удалять

const log = (...a) => console.log(new Date().toISOString(), ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.part', JSON.stringify(v)); fs.renameSync(f + '.part', f); };
const rm = f => { try { fs.unlinkSync(f); } catch {} };

function candidates(state) {
  const now = Date.now() / 1000;
  const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.jsonl')).sort().slice(-3);
  const out = [], shardEven = !WORKER && remoteAlive();
  // Помощник не берёт то, что сервер уже разобрал или отбросил (копия _state.json сервера, её скачивает run.sh).
  const srv = WORKER ? readJson(path.join(HOME, 'server-state.json'), {}) : {};
  for (const f of files) for (const line of fs.readFileSync(path.join(PUBLIC, f), 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const [id, start, dur, rank, lobby, mode] = r;
    const end = start + dur;
    if (mode !== 22 || ![0, 7].includes(lobby) || dur < 900) continue;
    if (now - end > MAX_AGE_S || now - end < MIN_AGE_S) continue;
    if (WORKER ? id % 2 === 0 : (shardEven && id % 2 === 1)) continue;
    const s = state[id];
    if (s && (s.done || s.skip || s.tries >= MAX_TRIES)) continue;
    const v = srv[id];
    if (v && (v.done || v.skip || v.tries >= MAX_TRIES)) continue;
    out.push({ id: String(id), rank, end, lobby });
  }
  // Свежие первыми: у них больше шансов, что реплей ещё лежит у Valve; при равенстве — ранг выше.
  return out.sort((a, b) => b.end - a.end || b.rank - a.rank).slice(0, LIMIT);
}

// Про-матчи: лента OpenDota /proMatches (один запрос за запуск, ~24 в сутки — в общий лимит
// OpenDota в 2000 запросов укладывается вместе со сбором базы, 1800). Про-матчи идут первыми:
// их ~10–15 в сутки, публичных матчей это почти не вытесняет.
async function proCandidates(state) {
  let rows;
  try {
    const quota = require('../lib/api-quota');
    if (!await quota.take('opendota', { priority: 'normal' })) return [];
    const r = await fetch('https://api.opendota.com/api/proMatches', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    await quota.observe('opendota', r.headers);
    if (r.status === 429) await quota.pause('opendota', r.headers.get('retry-after'));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('не массив');
  } catch (e) { log('про-матчи недоступны:', e.message); return []; }
  const now = Date.now() / 1000;
  return rows.filter(m => {
    const end = m.start_time + m.duration, s = state[m.match_id];
    return m.duration >= 600 && now - end <= MAX_AGE_S && now - end >= MIN_AGE_S && !(s && (s.done || s.skip || s.tries >= MAX_TRIES));
  }).map(m => ({ id: String(m.match_id), rank: null, end: m.start_time + m.duration,
    pro: { league: String(m.league_name || '').slice(0, 120), leagueId: m.leagueid || null,
      radiant: String(m.radiant_name || '').slice(0, 80), dire: String(m.dire_name || '').slice(0, 80) } }))
    .sort((a, b) => b.end - a.end);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000, ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

async function decompress(id) {
  const zst = path.join(REPLAYS, id + '.dem.zst'), bz2 = path.join(REPLAYS, id + '.dem.bz2'), dem = path.join(WORK, id + '.dem');
  if (fs.existsSync(zst)) await pipeline(fs.createReadStream(zst), zlib.createZstdDecompress(), fs.createWriteStream(dem));
  else if (fs.existsSync(bz2)) { const r = spawnSync('bzip2', ['-dc', bz2], { stdio: ['ignore', fs.openSync(dem, 'w'), 'pipe'] }); if (r.status !== 0) throw new Error('bzip2'); }
  else throw new Error('нет скачанного файла');
  const head = Buffer.alloc(4); const fd = fs.openSync(dem, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (head.toString('ascii') !== 'PBDE') throw new Error('распакованный файл не демо Dota');
  return dem;
}

function cleanup(id) {
  for (const f of [id + '.dem.zst', id + '.dem.bz2', id + '.json', id + '.download.part']) rm(path.join(REPLAYS, f));
  for (const f of [id + '.dem', id + '.jsonl', id + '.probe.jsonl']) rm(path.join(WORK, f));
}

async function processMatch(id, state, requested = false) {
  const meta = readJson(path.join(REPLAYS, id + '.json'), null);
  if (!meta) { state[id].lastError = 'нет salt'; return false; }
  if (SKIP_CLUSTERS.has(Number(meta.cluster))) { state[id].skip = 'cluster ' + meta.cluster; return false; }
  const dl = run(process.execPath, ['tools/download-replay-poc.js', id]);
  if (dl.code !== 0) { state[id].lastError = 'download: ' + dl.out.trim().slice(-120); return false; }
  const t = Date.now();
  const dem = await decompress(id);
  const jsonl = path.join(WORK, id + '.jsonl');
  const p = spawnSync(JAVA, JAVA_FLAGS, { stdio: [fs.openSync(dem, 'r'), fs.openSync(jsonl, 'w'), 'pipe'], timeout: 5 * 60 * 1000 });
  if (p.status !== 0) {
    // Текст ошибки — в журнал (раньше писался только код, причину нельзя было найти). Ссылки и длинные hex вырезаются.
    const err = String(p.stderr || '').replace(/https?:\/\/\S+/g, 'URL').replace(/[0-9a-f]{24,}/gi, '***');
    const exc = (err.match(/^.*(?:Exception|Error)\b.*$/m) || [''])[0].trim().slice(0, 160);
    // Исключение разборщика (exit 1 + Exception) повторяется на том же файле — повтор только занимает место в пачке:
    // такой матч больше не берём (skip). Снятие по таймауту/памяти (status null, сигнал) — случайное, его повторяем.
    if (p.status === 1 && exc) { state[id].skip = 'parser: ' + exc; return false; }
    state[id].lastError = 'parser exit ' + p.status + (p.signal ? ' ' + p.signal : '') + (exc ? ': ' + exc : '');
    return false;
  }
  const match = await normalize(jsonl);
  match.lobbyType = meta.lobbyType ?? match.lobbyType ?? state[id].lobby ?? null;
  if (match.matchId !== id) throw new Error('в реплее другой match_id: ' + match.matchId);
  const probe = path.join(WORK, id + '.probe.jsonl');
  const q = spawnSync(JAVA, PROBE_FLAGS.concat([dem, '1']), { stdio: ['ignore', fs.openSync(probe, 'w'), 'pipe'], timeout: 5 * 60 * 1000 });
  if (q.status === 0) {
    try { const cw = await creepFrames(probe); if (cw) match.creeps = cw; else log(id, 'крипы: пустой вывод MapProbe'); }
    catch (e) { log(id, 'крипы: ' + e.message); }
  } else log(id, 'крипы: MapProbe exit ' + q.status + ' ' + String(q.stderr || '').trim().slice(-120));
  if (state[id].pro) match.pro = state[id].pro;
  if (requested) {
    match.requested = true;
    writeJson(path.join(REQUESTED, id + '.json'), match);
    log(id, 'по запросу готов за', Date.now() - t, 'мс');
    return true;
  }
  writeJson(path.join(MATCHES, id + '.json'), match);
  fs.appendFileSync(PURCHASES, JSON.stringify(compact(match, state[id].rank, state[id].lobby)) + '\n');
  const index = readJson(INDEX, { matches: [] });
  index.matches = index.matches.filter(m => m.matchId !== id);
  index.matches.push({ matchId: id, schema: match.schema, creeps: !!match.creeps, endTime: match.endTime, duration: match.duration, radiantWin: match.radiantWin,
    lobbyType: match.lobbyType, score: match.score, heroes: match.players.map(pl => pl.heroId), rank: state[id].rank, pro: state[id].pro || null });
  index.matches.sort((a, b) => b.endTime - a.endTime);
  index.updated = new Date().toISOString();
  writeJson(INDEX, index);
  log(id, 'готов за', Date.now() - t, 'мс; счёт', match.score.radiant + ':' + match.score.dire);
  return true;
}

// Запись для статистики: исход, ранг, по слотам — герой, сторона, итоги и все покупки [секунда, предмет].
function compact(m, rank, lobby) {
  return { id: m.matchId, end: m.endTime, dur: m.duration, mode: m.gameMode, lobby: m.lobbyType ?? lobby ?? null, rw: m.radiantWin ? 1 : 0, rank: rank == null ? null : rank, pro: m.pro ? 1 : 0,
    p: m.players.map(pl => [pl.heroId, pl.slot < 5 ? 0 : 1, pl.k, pl.d, pl.a, pl.lh, pl.nw, pl.lvl, pl.obs, pl.sen, pl.items, pl.purchaseLogComplete === true]) };
}
function purchasesIds() {
  const ids = new Set();
  try { for (const l of fs.readFileSync(PURCHASES, 'utf8').split('\n')) { const m = l.match(/^\{"id":"(\d+)"/); if (m) ids.add(m[1]); } } catch {}
  return ids;
}
// --backfill-purchases: записи покупок для матчей, разобранных до появления purchases.jsonl.
function backfillPurchases() {
  const have = purchasesIds(), idx = readJson(INDEX, { matches: [] }), rank = new Map(idx.matches.map(m => [m.matchId, m.rank]));
  let n = 0;
  for (const f of fs.readdirSync(MATCHES).filter(f => f.endsWith('.json')).sort()) {
    const id = f.slice(0, -5); if (have.has(id)) continue;
    const m = readJson(path.join(MATCHES, f), null); if (!m || !m.players) continue;
    fs.appendFileSync(PURCHASES, JSON.stringify(compact(m, rank.get(id))) + '\n'); n++;
  }
  log('записей покупок добавлено:', n, '| всего:', have.size + n);
}
// Срок хранения полных файлов: не про-матчи старше KEEP_DAYS дней удаляются из архива и index.json,
// кроме стоящих в расписании эфира. Запись покупок остаётся. Тепловая карта накоплена в heat-counts.json.
function pruneArchive() {
  if (!KEEP_DAYS) return;
  const keep = new Set(); try { for (const i of (readJson(SCHEDULE, {}).items || [])) keep.add(String(i.id)); } catch {}
  const have = purchasesIds(), border = Date.now() / 1000 - KEEP_DAYS * 86400, index = readJson(INDEX, { matches: [] });
  let n = 0;
  index.matches = index.matches.filter(m => {
    if (m.pro || keep.has(m.matchId) || !(m.endTime < border) || !have.has(m.matchId)) return true;
    rm(path.join(MATCHES, m.matchId + '.json')); n++; return false;
  });
  if (n) { index.updated = new Date().toISOString(); writeJson(INDEX, index); log('удалено старых полных файлов:', n, '(срок ' + KEEP_DAYS + ' дн.)'); }
}

// Фон миникарты эфира: тепловая карта всех позиций героев из архива (своя, без чужого арта).
// Счётчики копятся в heat-counts.json; для страницы — heat.json: 256×256, лог-шкала 0..255 в base64.
const HEAT_SIZE = 256;
function updateHeat() {
  const countsFile = path.join(ARCHIVE, 'heat-counts.json');
  const prev = readJson(countsFile, null);
  const counts = prev && prev.size === HEAT_SIZE ? prev.c : new Array(HEAT_SIZE * HEAT_SIZE).fill(0);
  const seen = new Set(prev && prev.size === HEAT_SIZE ? prev.ids : []);
  let added = 0;
  for (const f of fs.readdirSync(MATCHES)) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || seen.has(id)) continue;
    const m = readJson(path.join(MATCHES, f), null); if (!m) continue;
    for (const p of m.players) for (let i = 0; i < p.x.length; i++) {
      const [u, v] = cellToUV(p.x[i], p.y[i]);
      const cx = Math.floor(u * HEAT_SIZE), cy = Math.floor(v * HEAT_SIZE);
      if (cx >= 0 && cy >= 0 && cx < HEAT_SIZE && cy < HEAT_SIZE) counts[cy * HEAT_SIZE + cx]++;
    }
    seen.add(id); added++;
  }
  if (!added && fs.existsSync(path.join(ARCHIVE, 'heat.json'))) return;
  writeJson(countsFile, { size: HEAT_SIZE, ids: [...seen], c: counts });
  const max = counts.reduce((a, b) => (b > a ? b : a), 1), lmax = Math.log1p(max);
  const bytes = Buffer.from(counts.map(c => Math.round(255 * Math.log1p(c) / lmax)));
  writeJson(path.join(ARCHIVE, 'heat.json'), { size: HEAT_SIZE, matches: seen.size, data: bytes.toString('base64') });
}

const ACC_DAY_MAX = 90;
function accountCount() {
  try { return Math.floor(fs.readFileSync(path.join(ROOT, 'secrets', 'Steam.txt'), 'utf8').split(/\r?\n/).filter(l => l.trim()).length / 2); }
  catch { return 0; }
}
function pickAccount(state, n) {
  const day = new Date().toISOString().slice(0, 10), total = accountCount();
  if (!total) return null;
  const a = state._acc && state._acc.day === day ? state._acc : { day, used: [] };
  let best = null;
  const off = state._accOff || {};
  for (let i = 0; i < total; i++) if (!(off[i] && Date.now() - off[i] < 86400e3) && (a.used[i] || 0) + n <= ACC_DAY_MAX && (best === null || (a.used[i] || 0) < (a.used[best] || 0))) best = i;
  if (best !== null) { a.used[best] = (a.used[best] || 0) + n; state._acc = a; log('аккаунт Steam №' + best + ', сегодня запросов: ' + a.used[best]); }
  return best;
}

function requestJobs() {
  try { fs.mkdirSync(REQUESTS, { recursive: true }); } catch {}
  // .taken — задание забрал домашний помощник (req.sh). Если он пропал (выключен посреди работы) — через 15 мин
  // возвращаем задание в общую очередь. ctime меняется при переименовании .job -> .taken.
  for (const n of fs.readdirSync(REQUESTS).filter(n => /^\d+\.taken$/.test(n))) {
    const f = path.join(REQUESTS, n);
    try { if (Date.now() - fs.statSync(f).ctimeMs > 15 * 60e3) fs.renameSync(f, f.replace(/\.taken$/, '.job')); } catch {}
  }
  return fs.readdirSync(REQUESTS).filter(n => /^\d+\.job$/.test(n))
    .map(n => ({ id: n.slice(0, -4), t: fs.statSync(path.join(REQUESTS, n)).mtimeMs })).sort((a, b) => a.t - b.t);
}
function requestFinish(id, reason) {
  if (reason) writeJson(path.join(REQUESTS, id + '.fail'), { reason: String(reason).slice(0, 80), at: new Date().toISOString() });
  rm(path.join(REQUESTS, id + '.job'));
}
function pruneRequested() {
  const border = Date.now() - REQUESTED_KEEP_S * 1000;
  for (const dir of [REQUESTED, REQUESTS]) {
    let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (/\.(json|fail)$/.test(n)) { const f = path.join(dir, n); try { if (fs.statSync(f).mtimeMs < border) rm(f); } catch {} }
  }
}
// --requests: только задания со страницы матча, по LIMIT за запуск, самые старые первыми.
async function runRequests(state, limit = LIMIT) {
  pruneRequested();
  const list = [];
  for (const { id, t } of requestJobs()) {
    if (fs.existsSync(path.join(MATCHES, id + '.json')) || fs.existsSync(path.join(REQUESTED, id + '.json'))) { requestFinish(id, null); continue; }
    const s = state[id];
    // Повторный запрос после отказа (PHP разрешает его через час): попытки скачать начинаются заново.
    // Отказ разборщика (skip) постоянный — реплей тот же, повтор бесполезен.
    if (s && s.reqFailAt && t > s.reqFailAt && !s.skip) { s.tries = 0; delete s.reqFailAt; delete s.lastError; }
    if (s && (s.skip || s.tries >= MAX_TRIES)) { requestFinish(id, s.skip || s.lastError || 'нет реплея'); continue; }
    list.push(id);
    if (list.length >= limit) break;
  }
  if (!list.length) { log('заданий по запросу нет'); return; }
  for (const id of list) { state[id] = state[id] || { tries: 0 }; state[id].tries++; }
  // Salt/URL реплея обычно уже сохранил GC-воркер страницы матча (secrets/replays/<id>.json); у кого нет — спрашиваем GC.
  const need = list.filter(id => !fs.existsSync(path.join(REPLAYS, id + '.json')));
  if (need.length) {
    const acc = gcAccounts.reserve(need.length);
    if (acc === null) { log('все аккаунты Steam исчерпали суточный запас'); for (const id of list) state[id].tries--; return; }
    const r = run(process.execPath, ['tools/replay-poc.js', ...need.slice(0, 5).flatMap(id => ['--match', id])], { timeout: 2 * 60 * 1000, env: { ...process.env, STEAM_ACCOUNT: String(acc) } });
    if (/Steam Guard/.test(r.out)) { gcAccounts.guard(acc); for (const id of list) state[id].tries--; log('аккаунт Steam №' + acc + ' просит Steam Guard'); return; }
  }
  for (const id of list) {
    try { if (await processMatch(id, state, true)) { state[id].done = new Date().toISOString(); delete state[id].lastError; } }
    catch (e) { state[id].lastError = String(e.message).slice(0, 160); }
    finally {
      cleanup(id);
      if (state[id].done) requestFinish(id, null);
      else if (state[id].skip || state[id].tries >= MAX_TRIES) { state[id].reqFailAt = Date.now(); requestFinish(id, state[id].skip || state[id].lastError || 'нет реплея'); }
      if (!state[id].done) log(id, 'по запросу не готов:', state[id].skip || state[id].lastError, '(попытка ' + state[id].tries + ')');
    }
  }
}

async function main() {
  for (const d of [WORK, TMP, MATCHES, REPLAYS, REQUESTS, REQUESTED]) fs.mkdirSync(d, { recursive: true });
  for (const f of [JAVA, JAR]) if (!fs.existsSync(f)) throw new Error('нет ' + f);
  const lock = path.join(HOME, 'collect.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch { const age = Date.now() - fs.statSync(lock).mtimeMs; if (age < 3600e3) { log('уже идёт другой запуск'); return; } fs.writeFileSync(lock, String(process.pid)); }
  const state = readJson(STATE, {});
  if (process.argv.includes('--backfill-purchases')) { try { backfillPurchases(); } finally { rm(lock); } return; }
  if (process.argv.includes('--prune-only')) { try { pruneArchive(); } finally { rm(lock); } return; }
  if (process.argv.includes('--requests')) { try { await runRequests(state); } finally { writeJson(STATE, state); rm(lock); } return; }
  try {
    // Задания посетителей со страницы матча — первыми (до 3): плановый запуск и так держит heavy.lock,
    // отдельное расписание --requests часто не может её получить.
    if (!WORKER) { try { await runRequests(state, 3); } catch (e) { log('по запросу: сбой', e.message); } }
    const pros = WORKER ? [] : await proCandidates(state);
    const pub = candidates(state).filter(c => !pros.some(p => p.id === c.id));
    const list = pros.concat(pub).slice(0, LIMIT);
    if (!fs.existsSync(path.join(ARCHIVE, 'heat.json'))) updateHeat();
    if (!list.length) { log('кандидатов нет'); return; }
    for (const c of list) { state[c.id] = state[c.id] || { tries: 0 }; state[c.id].rank = c.rank; state[c.id].lobby = c.lobby ?? null; if (c.pro) state[c.id].pro = c.pro; state[c.id].tries++; }
    // Аккаунты Steam — пары строк в secrets/Steam.txt. Берём наименее загруженный сегодня;
    // у Valve около 100 запросов salt на аккаунт в сутки, держим запас — не больше 90.
    const acc = gcAccounts.reserve(list.length);
    if (acc === null) { log('все аккаунты Steam исчерпали суточный запас'); for (const c of list) state[c.id].tries--; return; }
    // tools/replay-poc.js принимает не больше 5 match_id за вызов (10.10.2026 при --limit 6 весь запуск остался без salt) —
    // пачку делим на части по 5, аккаунт тот же.
    const salt = { code: 0, out: '' };
    for (let i = 0; i < list.length; i += 5) {
      const r = run(process.execPath, ['tools/replay-poc.js', ...list.slice(i, i + 5).flatMap(c => ['--match', c.id])], { timeout: 2 * 60 * 1000, env: { ...process.env, STEAM_ACCOUNT: String(acc) } });
      if (r.code !== 0) salt.code = r.code;
      salt.out += r.out + '\n';
      if (/Steam Guard/.test(r.out)) break;
    }
    if (salt.code !== 0) log('salt:', salt.out.trim().slice(-200));
    // Аккаунт требует код Steam Guard (новый вход с сервера) — выключаем его на сутки,
    // попытки матчей не тратим: в следующий запуск их возьмёт другой аккаунт.
    if (/Steam Guard/.test(salt.out)) {
      state._accOff = { ...(state._accOff || {}), [acc]: Date.now() };
      gcAccounts.guard(acc);
      log('аккаунт Steam №' + acc + ' просит код Steam Guard — отключён на сутки');
      for (const c of list) state[c.id].tries--;
      return;
    }
    let ok = 0;
    for (const c of list) {
      try { if (await processMatch(c.id, state)) { state[c.id].done = new Date().toISOString(); delete state[c.id].lastError; ok++; } }
      catch (e) { state[c.id].lastError = String(e.message).slice(0, 160); }
      finally { cleanup(c.id); if (!state[c.id].done) log(c.id, 'не готов:', state[c.id].skip || state[c.id].lastError, '(попытка ' + state[c.id].tries + ')'); }
    }
    log('итог:', ok + '/' + list.length);
    if (ok) updateHeat();
    pruneArchive();
  } finally { writeJson(STATE, state); rm(lock); }
}

main().catch(e => { log('сбой:', e.message); process.exitCode = 1; });
