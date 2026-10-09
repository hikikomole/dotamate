#!/usr/bin/env node
// Про-матчи: результаты, драфты и ключевые моменты из OpenDota → ~/dotamate-data/pro.
// Страницы /pro/ рисует deploy/api/index.php (handlePro) только из этих файлов: сеть в момент
// запроса посетителя не нужна, недоступный источник оставляет на сайте последние данные.
// Запуск: cron на сервере раз в 30 мин (см. claude/pro-matchi.md). Без зависимостей.
//   node tools/pro/sync.js            обычный проход
//   PRO_DIR=/tmp/pro node tools/pro/sync.js   другой каталог данных (стенд)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { slugForHero } = require('../hero-common.js');

const ROOT = path.join(__dirname, '..', '..');
const DIR = process.env.PRO_DIR || path.join(os.homedir(), 'dotamate-data', 'pro');
const MATCHES = path.join(DIR, 'matches');
const API = 'https://api.opendota.com/api';
const UA = 'dotamate.ru pro-sync (+https://dotamate.ru/pro/)';
const DAY_CAP = Number(process.env.PRO_DAY_CAP) || 300;     // своих запросов в сутки (UTC)
const RESERVE = 800;               // остаток суточного лимита OpenDota (общий IP со сборщиком эфира и базой), ниже — стоп
const MAX_DETAILS = Number(process.env.PRO_MAX_DETAILS) || 25;   // подробностей матча за проход
const MAX_PAGES = 4;               // страниц ленты назад за проход (догрузка истории)
const BACKFILL_DAYS = 30;          // глубина истории при первом запуске
const KEEP_DAYS = 120;             // матчи старше — вне индекса (файлы остаются)
const PAUSE_MS = 1100;             // бесплатный OpenDota: 60 запросов/мин
const REFETCH_S = 2 * 3600;        // неразобранный матч перечитать через 2 ч (моменты появляются после разбора реплея)
const MAX_TRIES = 4;
const REFETCH_MAX_AGE_S = 3 * 86400;

const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJson(f, v) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); }
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

// --- запросы с учётом лимитов ---
let state, stopReason = null, remainingDay = null;
async function od(pathq) {
  if (stopReason) return null;
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) { state.day = day; state.calls = 0; }
  if (state.calls >= DAY_CAP) { stopReason = 'суточный потолок ' + DAY_CAP; return null; }
  if (remainingDay !== null && remainingDay < RESERVE) { stopReason = 'у OpenDota осталось ' + remainingDay + ' запросов на сутки'; return null; }
  state.calls++;
  await sleep(PAUSE_MS);
  let r;
  try { r = await fetch(API + pathq, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw new Error('сеть: ' + (e.cause && e.cause.code || e.name || e.message)); }
  const rd = r.headers.get('x-rate-limit-remaining-day');
  if (rd !== null && rd !== '') remainingDay = Number(rd);
  if (r.status === 429) { stopReason = 'OpenDota 429'; return null; }
  if (r.status === 404) return { notFound: true };
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + pathq);
  const j = await r.json().catch(() => { throw new Error('не JSON ' + pathq); });
  return j;
}

// --- справочник для PHP: герой → slug/имя/есть ли страница, предмет → ключ/имя ---
function buildRef() {
  const heroes = readJson(path.join(ROOT, 'data', 'heroes.json'), {}).heroes || [];
  const heroPages = new Set(readJson(path.join(ROOT, 'hero-urls.json'), []).map((u) => u.loc));
  const guidePages = new Set(readJson(path.join(ROOT, 'hero-guide-urls.json'), []).map((u) => u.loc));
  const itemPages = new Set(readJson(path.join(ROOT, 'item-urls.json'), []).map((u) => u.loc));
  const items = (readJson(path.join(ROOT, 'data', 'items-ru.json'), {}).items) || {};
  const ref = { heroes: {}, items: {} };
  for (const h of heroes) {
    const slug = slugForHero(h);
    if (!slug || !h.id) continue;
    ref.heroes[h.id] = [slug, str(h.localized_name, 40),
      (heroPages.has(`https://dotamate.ru/hero/${slug}/`) ? 1 : 0) | (guidePages.has(`https://dotamate.ru/hero/${slug}/guide/`) ? 2 : 0)];
  }
  for (const [key, it] of Object.entries(items)) {
    if (!it || !it.id) continue;
    ref.items[it.id] = [key, str(it.dname, 60), itemPages.has(`https://dotamate.ru/item/${key}/`) ? 1 : 0];
  }
  return ref;
}

// --- лента /proMatches ---
function feedRow(m) {
  return {
    id: int(m.match_id), start: int(m.start_time), dur: int(m.duration),
    lg: int(m.leagueid), ln: str(m.league_name, 120), ser: int(m.series_id), st: int(m.series_type),
    r: [int(m.radiant_team_id), str(m.radiant_name, 60)], d: [int(m.dire_team_id), str(m.dire_name, 60)],
    rs: int(m.radiant_score), ds: int(m.dire_score), rw: m.radiant_win === true ? 1 : m.radiant_win === false ? 0 : null,
  };
}
async function syncFeed() {
  const page = await od('/proMatches');
  if (!page) return false;
  if (!Array.isArray(page)) throw new Error('лента не массив');
  let added = 0;
  const take = (rows) => { for (const m of rows) { const f = feedRow(m); if (f.id && f.start && !state.feed[f.id]) { state.feed[f.id] = f; added++; } } };
  take(page);
  // Догрузка истории назад, пока не набрали BACKFILL_DAYS (один раз, по MAX_PAGES за проход).
  const cutoff = now() - BACKFILL_DAYS * 86400;
  for (let p = 0; p < MAX_PAGES && !state.backfillDone; p++) {
    const ids = Object.values(state.feed);
    const oldest = ids.reduce((a, b) => (a && a.id < b.id ? a : b), null);
    if (!oldest || oldest.start < cutoff) { state.backfillDone = true; break; }
    const older = await od('/proMatches?less_than_match_id=' + oldest.id);
    if (!older) break;
    if (!Array.isArray(older) || !older.length) { state.backfillDone = true; break; }
    take(older);
  }
  log('лента: +' + added + ', всего ' + Object.keys(state.feed).length);
  return true;
}

// --- подробности матча ---
const SIDE = (slot) => (Number(slot) >= 128 ? 1 : 0);
function compactMatch(m) {
  const team = (t, id, name) => ({ id: int(id), name: str(name || (t && t.name), 60), tag: str(t && t.tag, 20),
    logo: /^https:\/\/[a-z0-9.-]+\.(steamusercontent|steamstatic|akamaihd)\.(com|net)\//i.test(String(t && t.logo_url || '')) ? String(t.logo_url).slice(0, 300) : '' });
  const obj = [];
  for (const o of m.objectives || []) {
    const t = int(o.time);
    if (t === null) continue;
    if (o.type === 'CHAT_MESSAGE_FIRSTBLOOD') obj.push([t, 'fb', SIDE(o.player_slot), int(o.player_slot)]);
    else if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') obj.push([t, 'rosh', Number(o.team) === 3 ? 1 : 0]);
    else if (o.type === 'building_kill') {
      const k = /npc_dota_(goodguys|badguys)_(tower[1-4]|melee_rax|fort)(?:_(top|mid|bot))?/.exec(String(o.key || ''));
      if (!k) continue;                              // дальние казармы дублируют ближние — не берём
      // side — кто потерял строение (goodguys = Radiant)
      obj.push([t, k[2] === 'melee_rax' ? 'rax' : k[2] === 'fort' ? 'fort' : 'tower', k[1] === 'goodguys' ? 0 : 1, (k[2].replace('_rax', '') + (k[3] ? '_' + k[3] : ''))]);
    }
  }
  obj.sort((a, b) => a[0] - b[0]);
  const tf = (m.teamfights || []).map((f) => [int(f.start), int(f.end), int(f.deaths)])
    .filter((f) => f[2] >= 3).sort((a, b) => b[2] - a[2] || a[0] - b[0]).slice(0, 5).sort((a, b) => a[0] - b[0]);
  const players = (m.players || []).map((p) => ({
    s: SIDE(p.player_slot), slot: int(p.player_slot), h: int(p.hero_id), n: str(p.name || p.personaname, 40),
    k: int(p.kills), d: int(p.deaths), a: int(p.assists), lh: int(p.last_hits), dn: int(p.denies),
    nw: int(p.net_worth), gpm: int(p.gold_per_min), xpm: int(p.xp_per_min), lvl: int(p.level),
    it: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].map(int).filter((x) => x > 0), nt: int(p.item_neutral) || 0,
  })).sort((a, b) => a.slot - b.slot);
  const adv = Array.isArray(m.radiant_gold_adv) ? m.radiant_gold_adv.slice(0, 200).map(int) : [];
  return {
    v: 1, id: int(m.match_id), start: int(m.start_time), dur: int(m.duration), patch: int(m.patch),
    league: { id: int(m.leagueid), name: str(m.league && m.league.name, 120), tier: str(m.league && m.league.tier, 20) },
    ser: int(m.series_id), st: int(m.series_type),
    radiant: team(m.radiant_team, m.radiant_team_id, m.radiant_name), dire: team(m.dire_team, m.dire_team_id, m.dire_name),
    rs: int(m.radiant_score), ds: int(m.dire_score), rw: m.radiant_win ? 1 : 0,
    parsed: (m.od_data && m.od_data.has_parsed) || obj.length > 0 ? 1 : 0,
    pb: (m.picks_bans || []).map((x) => [int(x.hero_id), x.is_pick ? 1 : 0, int(x.team), int(x.order)]).filter((x) => x[0] > 0).sort((a, b) => a[3] - b[3]),
    players, obj, tf, adv, fetched: now(),
  };
}
async function syncDetails() {
  const t = now();
  const queue = Object.values(state.feed).filter((f) => {
    const s = state.det[f.id];
    if (!s) return true;
    if (s.parsed || s.tries >= MAX_TRIES || s.gone) return false;
    return t - s.last >= REFETCH_S && t - (f.start + f.dur) <= REFETCH_MAX_AGE_S;
  }).sort((a, b) => b.start - a.start).slice(0, MAX_DETAILS);
  let ok = 0;
  for (const f of queue) {
    const m = await od('/matches/' + f.id);
    if (!m) break;
    const s = state.det[f.id] || (state.det[f.id] = { tries: 0 });
    s.tries++; s.last = now();
    if (m.notFound || !m.match_id) { s.gone = 1; continue; }
    const c = compactMatch(m);
    if (!c.players.length || c.players.length !== 10) { log('матч ' + f.id + ': игроков ' + c.players.length + ', пропуск'); continue; }
    writeJson(path.join(MATCHES, f.id + '.json'), c);
    s.parsed = c.parsed; s.has = 1;
    // Лента иногда отстаёт в названии лиги/команд — подробности точнее.
    Object.assign(f, { ln: c.league.name || f.ln, tier: c.league.tier, r: [c.radiant.id, c.radiant.name || f.r[1]], d: [c.dire.id, c.dire.name || f.d[1]], rs: c.rs, ds: c.ds, rw: c.rw,
      rp: c.pb.filter((x) => x[1] && x[2] === 0).map((x) => x[0]), dp: c.pb.filter((x) => x[1] && x[2] === 1).map((x) => x[0]) });
    if (!f.rp.length) { f.rp = c.players.filter((p) => p.s === 0).map((p) => p.h); f.dp = c.players.filter((p) => p.s === 1).map((p) => p.h); }
    ok++;
  }
  log('подробности: ' + ok + ' из ' + queue.length + ' в очереди');
}

function writeIndex() {
  const cutoff = now() - KEEP_DAYS * 86400;
  for (const id of Object.keys(state.feed)) if (state.feed[id].start < cutoff) { delete state.feed[id]; delete state.det[id]; }
  const list = Object.values(state.feed).sort((a, b) => b.start - a.start || b.id - a.id)
    .map((f) => ({ ...f, has: state.det[f.id] && state.det[f.id].has ? 1 : 0 }));
  writeJson(path.join(DIR, 'index.json'), { generated: now(), source: 'OpenDota', matches: list });
  return list.length;
}

async function main() {
  fs.mkdirSync(MATCHES, { recursive: true });
  const lock = path.join(DIR, '.lock');
  try { if (Date.now() - fs.statSync(lock).mtimeMs > 30 * 60000) fs.unlinkSync(lock); } catch {}
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { log('уже идёт другой проход — выход'); return; }
  state = readJson(path.join(DIR, 'state.json'), {});
  state.feed = state.feed || {}; state.det = state.det || {};
  const status = readJson(path.join(DIR, 'status.json'), {});
  status.lastRun = now();
  try {
    writeJson(path.join(DIR, 'ref.json'), buildRef());
    const fed = await syncFeed();
    await syncDetails();
    if (fed) { status.lastOk = now(); status.lastError = null; }
    else status.lastError = stopReason || 'лента не получена';
  } catch (e) {
    status.lastError = String(e.message || e).slice(0, 200);
    log('ошибка:', status.lastError);
  } finally {
    const n = writeIndex();
    status.matches = n; status.callsToday = state.calls; status.remainingDay = remainingDay; status.stop = stopReason;
    writeJson(path.join(DIR, 'state.json'), state);
    writeJson(path.join(DIR, 'status.json'), status);
    fs.closeSync(fd); fs.unlinkSync(lock);
    log('итог: матчей в индексе ' + n + ', запросов сегодня ' + state.calls + (remainingDay !== null ? ', у OpenDota осталось ' + remainingDay : '') + (stopReason ? ', стоп: ' + stopReason : ''));
  }
  if (status.lastError) process.exitCode = 1;
}
if (require.main === module) main();
module.exports = { compactMatch };   // tools/pro/check.js — сверка с архивом эфира
