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

const SKIP_CLUSTERS = new Set([413, 415, 417]); // Китай: из РФ скачивание не укладывается в таймаут
const MAX_AGE_S = 7 * 86400;
const MIN_AGE_S = 15 * 60;   // реплей появляется у Valve не сразу после матча
const MAX_TRIES = 3;
const LIMIT = Math.min(5, Math.max(1, Number(process.argv[process.argv.indexOf('--limit') + 1]) || 3));
const KEEP_DAYS = process.argv.includes('--keep-days') ? Number(process.argv[process.argv.indexOf('--keep-days') + 1]) : 0; // 0 — не удалять

const log = (...a) => console.log(new Date().toISOString(), ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.part', JSON.stringify(v)); fs.renameSync(f + '.part', f); };
const rm = f => { try { fs.unlinkSync(f); } catch {} };

function candidates(state) {
  const now = Date.now() / 1000;
  const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.jsonl')).sort().slice(-3);
  const out = [];
  for (const f of files) for (const line of fs.readFileSync(path.join(PUBLIC, f), 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const [id, start, dur, rank, lobby, mode] = r;
    const end = start + dur;
    if (mode !== 22 || ![0, 7].includes(lobby) || dur < 900) continue;
    if (now - end > MAX_AGE_S || now - end < MIN_AGE_S) continue;
    const s = state[id];
    if (s && (s.done || s.skip || s.tries >= MAX_TRIES)) continue;
    out.push({ id: String(id), rank, end });
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
    const r = await fetch('https://api.opendota.com/api/proMatches', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
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

async function processMatch(id, state) {
  const meta = readJson(path.join(REPLAYS, id + '.json'), null);
  if (!meta) { state[id].lastError = 'нет salt'; return false; }
  if (SKIP_CLUSTERS.has(Number(meta.cluster))) { state[id].skip = 'cluster ' + meta.cluster; return false; }
  const dl = run(process.execPath, ['tools/download-replay-poc.js', id]);
  if (dl.code !== 0) { state[id].lastError = 'download: ' + dl.out.trim().slice(-120); return false; }
  const t = Date.now();
  const dem = await decompress(id);
  const jsonl = path.join(WORK, id + '.jsonl');
  const p = spawnSync(JAVA, JAVA_FLAGS, { stdio: [fs.openSync(dem, 'r'), fs.openSync(jsonl, 'w'), 'pipe'], timeout: 5 * 60 * 1000 });
  if (p.status !== 0) { state[id].lastError = 'parser exit ' + p.status; return false; }
  const match = await normalize(jsonl);
  if (match.matchId !== id) throw new Error('в реплее другой match_id: ' + match.matchId);
  const probe = path.join(WORK, id + '.probe.jsonl');
  const q = spawnSync(JAVA, PROBE_FLAGS.concat([dem, '1']), { stdio: ['ignore', fs.openSync(probe, 'w'), 'pipe'], timeout: 5 * 60 * 1000 });
  if (q.status === 0) {
    try { const cw = await creepFrames(probe); if (cw) match.creeps = cw; else log(id, 'крипы: пустой вывод MapProbe'); }
    catch (e) { log(id, 'крипы: ' + e.message); }
  } else log(id, 'крипы: MapProbe exit ' + q.status + ' ' + String(q.stderr || '').trim().slice(-120));
  if (state[id].pro) match.pro = state[id].pro;
  writeJson(path.join(MATCHES, id + '.json'), match);
  fs.appendFileSync(PURCHASES, JSON.stringify(compact(match, state[id].rank)) + '\n');
  const index = readJson(INDEX, { matches: [] });
  index.matches = index.matches.filter(m => m.matchId !== id);
  index.matches.push({ matchId: id, schema: match.schema, creeps: !!match.creeps, endTime: match.endTime, duration: match.duration, radiantWin: match.radiantWin,
    score: match.score, heroes: match.players.map(pl => pl.heroId), rank: state[id].rank, pro: state[id].pro || null });
  index.matches.sort((a, b) => b.endTime - a.endTime);
  index.updated = new Date().toISOString();
  writeJson(INDEX, index);
  log(id, 'готов за', Date.now() - t, 'мс; счёт', match.score.radiant + ':' + match.score.dire);
  return true;
}

// Запись для статистики: исход, ранг, по слотам — герой, сторона, итоги и все покупки [секунда, предмет].
function compact(m, rank) {
  return { id: m.matchId, end: m.endTime, dur: m.duration, mode: m.gameMode, rw: m.radiantWin ? 1 : 0, rank: rank == null ? null : rank, pro: m.pro ? 1 : 0,
    p: m.players.map(pl => [pl.heroId, pl.slot < 5 ? 0 : 1, pl.k, pl.d, pl.a, pl.lh, pl.nw, pl.lvl, pl.obs, pl.sen, pl.items]) };
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

async function main() {
  for (const d of [WORK, TMP, MATCHES, REPLAYS]) fs.mkdirSync(d, { recursive: true });
  for (const f of [JAVA, JAR]) if (!fs.existsSync(f)) throw new Error('нет ' + f);
  const lock = path.join(HOME, 'collect.lock');
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch { const age = Date.now() - fs.statSync(lock).mtimeMs; if (age < 3600e3) { log('уже идёт другой запуск'); return; } fs.writeFileSync(lock, String(process.pid)); }
  const state = readJson(STATE, {});
  if (process.argv.includes('--backfill-purchases')) { try { backfillPurchases(); } finally { rm(lock); } return; }
  if (process.argv.includes('--prune-only')) { try { pruneArchive(); } finally { rm(lock); } return; }
  try {
    const pros = await proCandidates(state);
    const pub = candidates(state).filter(c => !pros.some(p => p.id === c.id));
    const list = pros.concat(pub).slice(0, LIMIT);
    if (!fs.existsSync(path.join(ARCHIVE, 'heat.json'))) updateHeat();
    if (!list.length) { log('кандидатов нет'); return; }
    for (const c of list) { state[c.id] = state[c.id] || { tries: 0 }; state[c.id].rank = c.rank; if (c.pro) state[c.id].pro = c.pro; state[c.id].tries++; }
    // Аккаунты Steam — пары строк в secrets/Steam.txt. Берём наименее загруженный сегодня;
    // у Valve около 100 запросов salt на аккаунт в сутки, держим запас — не больше 90.
    const acc = pickAccount(state, list.length);
    if (acc === null) { log('все аккаунты Steam исчерпали суточный запас'); for (const c of list) state[c.id].tries--; return; }
    const salt = run(process.execPath, ['tools/replay-poc.js', ...list.flatMap(c => ['--match', c.id])], { timeout: 2 * 60 * 1000, env: { ...process.env, STEAM_ACCOUNT: String(acc) } });
    if (salt.code !== 0) log('salt:', salt.out.trim().slice(-200));
    // Аккаунт требует код Steam Guard (новый вход с сервера) — выключаем его на сутки,
    // попытки матчей не тратим: в следующий запуск их возьмёт другой аккаунт.
    if (/Steam Guard/.test(salt.out)) {
      state._accOff = { ...(state._accOff || {}), [acc]: Date.now() };
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
