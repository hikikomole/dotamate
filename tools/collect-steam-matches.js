#!/usr/bin/env node
/**
 * Сбор матчей из ленты Steam Web API (GetMatchHistoryBySequenceNum).
 *
 * Отличие от tools/collect-public-matches.js (OpenDota): там только герои, исход и
 * средний ранг; здесь — полные строки игроков (K/D/A, GPM/XPM, предметы, прокачка).
 * Ранга в Steam нет — он берётся из уже собранной базы OpenDota (data/public-matches,
 * data/public-matches-top) по match_id; не нашли — rank = null.
 *
 * Хранилище (по дню start_time, UTC; gzip, в файл дописываются gzip-члены):
 *   data/steam-matches/YYYY-MM-DD.jsonl.gz        — lobby_type 7 + game_mode 22 (Ranked All Pick)
 *   data/steam-matches-turbo/YYYY-MM-DD.jsonl.gz  — game_mode 23 (турбо)
 *   data/steam-matches/_state.json                — курсор и счётчики (запись .tmp → rename)
 *   data/steam-matches/.lock                      — замок от двойного запуска
 * Фильтр: duration > 900 с, human_players = 10, ни у кого leaver_status > 1
 * (0 — не выходил, 1 — отключался и вернулся; 2+ — покинул/AFK).
 * Аккаунты игроков не храним.
 *
 * Формат строки (JSON-массив):
 *   [match_id, match_seq_num, start_time, duration, rank, radiant_win(0/1),
 *    game_mode, lobby_type, bans[hero_id...], p0, ..., p9]
 *   rank — avg_rank_tier OpenDota (11..85) или null.
 *   p (по возрастанию player_slot; 0–4 Свет, 128–132 Тьма):
 *   [hero_id, player_slot, kills, deaths, assists, last_hits, denies, gpm, xpm, level,
 *    net_worth, hero_damage, tower_damage, hero_healing,
 *    [item_0..item_5], [backpack_0..backpack_2], item_neutral, item_neutral2,
 *    aghanims_scepter, aghanims_shard, moonshard, leaver_status,
 *    [ability, time, ability, time, ...]]   — ability_upgrades по порядку уровней
 *
 * Запуск (на сервере, ключ ~/dotamate-data/secrets/steam-api-key.txt или STEAM_API_KEY):
 *   node tools/collect-steam-matches.js                    — до 2000 запросов или до «сейчас»
 *   node tools/collect-steam-matches.js --budget 500
 *   node tools/collect-steam-matches.js --start-seq N      — только если курсора ещё нет
 *   node tools/collect-steam-matches.js --fill-ranks       — дозаполнить rank=null из OpenDota
 *                                     (--days N: последние N дневных файлов, по умолчанию 3)
 *   node tools/collect-steam-matches.js --stats            — что собрано (+ проверка дублей)
 * Параметры сбора:
 *   --max-lag S    — если на старте курсор отстал от «сейчас» больше S секунд (по умолчанию 900),
 *                    прыжок к текущему seq: при бюджете меньше полной ленты сбор идёт выборкой
 *                    (подряд идущие куски каждые 10 мин), а не копит отставание.
 *   --keep-days N  — удалять дневные файлы старше N дней (по умолчанию 30; 0 — не удалять).
 * Файлы читаются потоком: дневной файл при боевом бюджете ~0,9 ГБ без сжатия — больше
 * предельной длины строки V8, целиком в память не читается.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'steam-matches');
const DIR_TURBO = path.join(ROOT, 'data', 'steam-matches-turbo');
const OD_DIRS = ['public-matches', 'public-matches-top'].map(d => path.join(ROOT, 'data', d));
const STATE = path.join(DIR, '_state.json');
const LOCK = path.join(DIR, '.lock');
const API = 'https://api.steampowered.com/IDOTA2Match_570/';

const DAY_MAX = 90000;          // ключ даёт 100 000/сутки; 10 000 оставлено /api/dota/player (/me)
const RUN_BUDGET_DEFAULT = 2000;
const PAUSE_MIN = 1500, PAUSE_MAX = 6000, PAUSE_START = 2000;
const WAIT_429 = 30000;          // T0: Retry-After в ответах 429 не приходит
const TRIES = 6;                 // подряд неудач 5xx/сети — сдаёмся, курсор не двигаем
const LOCK_STALE_MS = 6 * 3600 * 1000;
const MAX_LAG_DEFAULT = 900;
const KEEP_DAYS_DEFAULT = 30;

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

function readKey() {
  if (process.env.STEAM_API_KEY) return process.env.STEAM_API_KEY.trim();
  for (const f of [path.join(os.homedir(), 'dotamate-data', 'secrets', 'steam-api-key.txt'),
                   path.join(ROOT, 'secrets', 'steam-api-key.txt')]) {
    try { const k = fs.readFileSync(f, 'utf8').trim(); if (k) return k; } catch {}
  }
  throw new Error('нет ключа Steam (STEAM_API_KEY или secrets/steam-api-key.txt)');
}
let KEY = '';
const mask = s => (KEY ? String(s).split(KEY).join('***') : String(s));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), mask(a.join(' ')));

// ---------- состояние и замок ----------
function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch { return { nextSeq: 0, day: '', dayCalls: 0, calls: 0, seen: 0, ranked: 0, turbo: 0 }; }
}
const saveState = s => writeAtomic(STATE, JSON.stringify(s, null, 1));

function takeLock() {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let l = {};
      try { l = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch {}
      let alive = false;
      try { process.kill(l.pid, 0); alive = true; } catch (er) { alive = er.code === 'EPERM'; }
      if (alive && Date.now() - (l.at || 0) < LOCK_STALE_MS) return false;
      log('снимаю брошенный замок pid=' + l.pid);
      try { fs.unlinkSync(LOCK); } catch {}
    }
  }
  return false;
}
const dropLock = () => { try { fs.unlinkSync(LOCK); } catch {} };
async function takeLockWait(ms) {
  const until = Date.now() + ms;
  while (!takeLock()) { if (Date.now() > until) return false; await sleep(10000); }
  return true;
}

// ---------- HTTP ----------
function get(method, params) {
  const q = new URLSearchParams({ ...params, key: KEY });
  return new Promise(res => {
    const r = https.get(API + method + '/v1/?' + q, { timeout: 30000 }, resp => {
      const chunks = [];
      resp.on('data', d => chunks.push(d));
      resp.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        res({ code: resp.statusCode, j });
      });
      resp.on('error', e => res({ code: 'ERR', err: e.message }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', e => res({ code: 'ERR', err: e.message }));
  });
}

// ---------- ранг из базы OpenDota ----------
const rankCache = {};
function odDay(day) {
  if (rankCache[day]) return rankCache[day];
  const m = new Map();
  for (const d of OD_DIRS) {
    const f = path.join(d, day + '.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (r[3] > 0) m.set(r[0], r[3]); } catch {}
    }
  }
  return (rankCache[day] = m);
}
function rankOf(matchId, startTime) {
  // OpenDota раскладывает по своему дню — смотрим соседние дни (матч на стыке суток)
  for (const off of [0, -86400, 86400]) {
    const r = odDay(dayOf(startTime + off)).get(matchId);
    if (r) return r;
  }
  return null;
}

// ---------- преобразование ----------
function player(p) {
  const up = [];
  for (const a of p.ability_upgrades || []) up.push(a.ability, a.time);
  return [p.hero_id, p.player_slot, p.kills, p.deaths, p.assists, p.last_hits, p.denies,
    p.gold_per_min, p.xp_per_min, p.level, p.net_worth, p.hero_damage, p.tower_damage, p.hero_healing,
    [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5],
    [p.backpack_0, p.backpack_1, p.backpack_2], p.item_neutral || 0, p.item_neutral2 || 0,
    p.aghanims_scepter || 0, p.aghanims_shard || 0, p.moonshard || 0, p.leaver_status || 0, up];
}
function row(m) {
  const ps = m.players.slice().sort((a, b) => a.player_slot - b.player_slot).map(player);
  const bans = (m.picks_bans || []).filter(x => !x.is_pick).map(x => x.hero_id);
  return [m.match_id, m.match_seq_num, m.start_time, m.duration, rankOf(m.match_id, m.start_time),
    m.radiant_win ? 1 : 0, m.game_mode, m.lobby_type, bans, ...ps];
}
// куда класть матч: 'ranked' | 'turbo' | причина отсева
function classify(m) {
  const kind = m.lobby_type === 7 && m.game_mode === 22 ? 'ranked' : m.game_mode === 23 ? 'turbo' : null;
  if (!kind) return 'other';
  if (!(m.duration > 900)) return 'short';
  const ps = m.players || [];
  if (ps.length !== 10 || m.human_players !== 10 || ps.some(p => !p.hero_id)) return 'bad';
  if (ps.some(p => (p.leaver_status || 0) > 1)) return 'leaver';
  return kind;
}

// ---------- хранилище ----------
// строки дневного файла потоком (склеенные gzip-члены поток Gunzip читает подряд)
async function* dayLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
}
// Повторов нет по построению: лента идёт по возрастанию match_seq_num. Перед записью пачки в _state.json пишется
// pendingTo; если процесс упал между записью данных и курсора, следующий запуск сдвигает курсор за эту пачку —
// без повтора, ценой возможной потери недописанной пачки (выборка и так неполная).
function appendRows(dir, rows) {
  const byDay = {};
  for (const r of rows) {
    const f = path.join(dir, dayOf(r[2]) + '.jsonl.gz');
    (byDay[f] = byDay[f] || []).push(JSON.stringify(r));
  }
  for (const f of Object.keys(byDay)) fs.appendFileSync(f, zlib.gzipSync(byDay[f].join('\n') + '\n'));
  return rows.length;
}
function pruneOld(keepDays) {
  if (!(keepDays > 0)) return 0;
  const cut = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  let n = 0;
  for (const dir of [DIR, DIR_TURBO]) {
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl\.gz$/.exec(f);
      if (m && m[1] < cut) { fs.unlinkSync(path.join(dir, f)); n++; log('удалён по сроку хранения: ' + path.basename(dir) + '/' + f); }
    }
  }
  return n;
}
async function currentSeq() {
  const r = await get('GetMatchHistory', { matches_requested: 1 });
  const m = r.j && r.j.result && r.j.result.matches && r.j.result.matches[0];
  if (!m) throw new Error('не удалось узнать текущий match_seq_num: HTTP ' + r.code);
  return m.match_seq_num;
}

// ---------- режимы ----------
async function collect() {
  const st = loadState();
  const budget = Math.max(1, parseInt(opt('--budget') || RUN_BUDGET_DEFAULT, 10));
  const today = new Date().toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.dayCalls = 0; st.day429 = 0; st.day5xx = 0; }

  const maxLag = parseInt(opt('--max-lag') || MAX_LAG_DEFAULT, 10);
  if (st.pendingTo && st.pendingTo >= st.nextSeq) {
    // прошлый запуск упал между записью данных и курсора — пачку не повторяем (без дублей)
    log('незавершённая пачка до seq ' + st.pendingTo + ', курсор сдвинут за неё');
    st.nextSeq = st.pendingTo + 1;
  }
  delete st.pendingTo;
  if (!st.nextSeq) {
    if (opt('--start-seq')) st.nextSeq = parseInt(opt('--start-seq'), 10);
    else { st.nextSeq = await currentSeq(); st.dayCalls++; st.calls++; }
    log('курсор не задан, старт с match_seq_num ' + st.nextSeq);
  } else if (maxLag > 0 && st.lastEnd && Date.now() / 1000 - st.lastEnd > maxLag) {
    const cur = await currentSeq(); st.dayCalls++; st.calls++;
    if (cur > st.nextSeq) {
      const lag = Math.round(Date.now() / 1000 - st.lastEnd);
      st.skippedSeq = (st.skippedSeq || 0) + (cur - st.nextSeq); st.jumps = (st.jumps || 0) + 1;
      log('отставание ' + lag + ' с > ' + maxLag + ' с — прыжок с seq ' + st.nextSeq + ' на ' + cur + ' (пропущено номеров ' + (cur - st.nextSeq) + ')');
      st.nextSeq = cur;
    } else log('отставание больше ' + maxLag + ' с, но голова ленты (' + cur + ') не впереди курсора ' + st.nextSeq + ' — без прыжка');
  } else log('продолжаю с курсора match_seq_num ' + st.nextSeq);

  // пауза переносится между запусками: иначе каждый запуск заново упирается в 429
  let pause = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, st.pause || PAUSE_START)), okRun = 0, fails = 0, calls = 0;
  const run = { req: 0, r429: 0, r5xx: 0, err: 0, seen: 0, ranked: 0, turbo: 0, rankedWithRank: 0,
    other: 0, short: 0, bad: 0, leaver: 0, lagSec: null };
  const t0 = Date.now();

  while (calls < budget) {
    if (st.dayCalls >= DAY_MAX) { log('дневной лимит ' + DAY_MAX + ' исчерпан'); break; }
    const r = await get('GetMatchHistoryBySequenceNum', { start_at_match_seq_num: st.nextSeq, matches_requested: 100 });
    calls++; run.req++; st.dayCalls++; st.calls++;
    const res = r.j && r.j.result;
    if (r.code === 429) {
      run.r429++; st.day429 = (st.day429 || 0) + 1; pause = Math.min(PAUSE_MAX, pause + 500); okRun = 0;
      log('429, жду ' + WAIT_429 / 1000 + ' с, пауза теперь ' + pause + ' мс');
      await sleep(WAIT_429); continue;
    }
    if (r.code !== 200 || !res || res.status !== 1 || !Array.isArray(res.matches)) {
      if (r.code >= 500) { run.r5xx++; st.day5xx = (st.day5xx || 0) + 1; } else run.err++;
      fails++;
      log('ошибка ' + r.code + ' ' + (r.err || (res && res.statusDetail) || '') + ', попытка ' + fails + '/' + TRIES);
      if (fails >= TRIES) { log('сдаюсь, курсор не сдвинут'); break; }
      await sleep(10000 * fails); continue;
    }
    fails = 0;
    const ms = res.matches;
    if (!ms.length) { log('новых матчей нет — догнали ленту'); break; }
    const ranked = [], turbo = [];
    for (const m of ms) {
      const c = classify(m);
      if (c === 'ranked') ranked.push(row(m));
      else if (c === 'turbo') turbo.push(row(m));
      else run[c]++;
    }
    const last = ms[ms.length - 1];
    st.pendingTo = last.match_seq_num; saveState(st);
    const wr = appendRows(DIR, ranked), wt = appendRows(DIR_TURBO, turbo);
    run.seen += ms.length; run.ranked += wr; run.turbo += wt;
    for (const x of ranked) if (x[4] != null) run.rankedWithRank++;
    st.seen += ms.length; st.ranked += wr; st.turbo += wt;
    st.nextSeq = last.match_seq_num + 1; delete st.pendingTo;
    st.lastStart = last.start_time; st.lastEnd = last.start_time + last.duration; st.updatedAt = new Date().toISOString();
    saveState(st); // курсор после данных; сбой между ними закрыт pendingTo (пачка не повторяется)
    run.lagSec = Math.round(Date.now() / 1000 - (last.start_time + last.duration));
    if (run.req % 25 === 0) log('запросов ' + run.req + ', ranked ' + run.ranked + ', турбо ' + run.turbo + ', отставание ' + run.lagSec + ' с, пауза ' + pause);
    // неполная пачка бывает и в глубине ленты (99 из 100) — «догнали» только вблизи текущего времени
    if (ms.length < 100 && run.lagSec < 3600) { log('пришло ' + ms.length + ' < 100 — лента догнана'); break; }
    if (++okRun >= 100) { pause = Math.max(PAUSE_MIN, pause - 250); okRun = 0; }
    await sleep(pause);
  }
  run.minutes = +((Date.now() - t0) / 60000).toFixed(1);
  run.nextSeq = st.nextSeq; run.pause = pause; run.dayCalls = st.dayCalls;
  st.pause = pause; saveState(st);
  run.pruned = pruneOld(parseInt(opt('--keep-days') || KEEP_DAYS_DEFAULT, 10));
  log('ИТОГ ' + JSON.stringify(run));
}

// Перезапись потоком во временный файл → rename. Только последние N файлов: у OpenDota ранг есть
// лишь за свежие дни, старые файлы перечитывать незачем.
async function fillRanks() {
  const days = Math.max(1, parseInt(opt('--days') || 3, 10));
  let filled = 0, still = 0, total = 0;
  for (const dir of [DIR, DIR_TURBO]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl.gz')).sort().slice(-days)) {
      const file = path.join(dir, f), tmp = file + '.tmp';
      const gz = zlib.createGzip();
      const done = new Promise((ok, bad) => { const w = fs.createWriteStream(tmp); w.on('finish', ok); w.on('error', bad); gz.pipe(w); });
      let ch = 0, n = 0, buf = [];
      for await (const l of dayLines(file)) {
        n++;
        if (l.indexOf(',null,') > 0) {
          const r = JSON.parse(l);
          if (r[4] == null) {
            const k = rankOf(r[0], r[2]);
            if (k) { r[4] = k; ch++; buf.push(JSON.stringify(r)); } else { still++; buf.push(l); }
          } else buf.push(l);
        } else buf.push(l);
        if (buf.length >= 5000) { if (!gz.write(buf.join('\n') + '\n')) await new Promise(r => gz.once('drain', r)); buf = []; }
      }
      if (buf.length) gz.write(buf.join('\n') + '\n');
      gz.end(); await done;
      total += n;
      if (ch) { fs.renameSync(tmp, file); filled += ch; } else fs.unlinkSync(tmp);
      log(path.basename(dir) + '/' + f + ': строк ' + n + ', ранг дозаполнен ' + ch);
    }
  }
  log('ранг дозаполнен: ' + filled + ', без ранга осталось: ' + still + ' (просмотрено ' + total + ')');
}

async function stats() {
  for (const dir of [DIR, DIR_TURBO]) {
    if (!fs.existsSync(dir)) continue;
    const ids = new Set();
    let n = 0, withRank = 0, dup = 0, bytes = 0;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
      bytes += fs.statSync(path.join(dir, f)).size;
      for await (const l of dayLines(path.join(dir, f))) {
        // match_id и rank — 1-е и 5-е поля, без полного разбора строки
        const a = l.indexOf(','), id = l.slice(1, a);
        n++; if (l.split(',', 5)[4] !== 'null') withRank++;
        if (ids.has(id)) dup++; else ids.add(id);
      }
    }
    console.log(JSON.stringify({ dir: path.basename(dir), matches: n, withRank,
      rankShare: n ? +(withRank / n * 100).toFixed(2) : 0, duplicates: dup, bytes,
      bytesPerMatch: n ? Math.round(bytes / n) : 0 }));
  }
  try { console.log(fs.readFileSync(STATE, 'utf8')); } catch {}
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(DIR_TURBO, { recursive: true });
  if (argv.includes('--stats')) return stats();
  // --fill-ranks ждёт окончания текущего сбора (запуски каждые 10 мин, сбор ~5–8 мин)
  if (!(argv.includes('--fill-ranks') ? await takeLockWait(20 * 60000) : takeLock())) { log('уже запущен другой сбор (' + LOCK + '), выхожу'); process.exitCode = 3; return; }
  const stop = () => { dropLock(); process.exit(130); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (argv.includes('--fill-ranks')) return await fillRanks();
    KEY = readKey();
    await collect();
  } finally { dropLock(); }
}
main().catch(e => { log('ОШИБКА ' + (e && e.stack || e)); dropLock(); process.exit(1); });
