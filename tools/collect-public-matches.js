#!/usr/bin/env node
/**
 * Свой сбор публичных матчей нашего диапазона рангов (примерно 0-4500 MMR).
 *
 * Источник: OpenDota /publicMatches — лента публичных матчей с фильтром по рангу.
 * В каждой строке все десять героев, исход и средний ранг. Ни игроков, ни личных
 * данных в ленте нет, и мы их не храним.
 *
 * Почему с компьютера, а не из воркера: OpenDota режет по адресу источника и
 * отдаёт Cloudflare Worker 429 (проверено на живом сайте). Лимит без ключа —
 * около 2000 запросов в сутки с одного адреса, поэтому сборщик должен ходить
 * с одной машины и считать свои запросы.
 *
 * Пропуски не страшны: лента листается назад по less_than_match_id, поэтому
 * всё, что не собрали вчера, добирается сегодня.
 *
 * Хранилище: data/public-matches/YYYY-MM-DD.jsonl, по строке на матч.
 * Формат строки: [match_id, start_time, duration, avg_rank, lobby_type, game_mode,
 *                 radiant_win, r1..r5, d1..d5]
 *
 * Запуск:
 *   node tools/collect-public-matches.js              — хвост: свежее до уже известного
 *   node tools/collect-public-matches.js --back 600   — докачка истории, 600 запросов
 *   node tools/collect-public-matches.js --stats      — что уже собрано
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'public-matches');
const STATE = path.join(DIR, '_state.json');
const API = 'https://api.opendota.com/api/publicMatches';
const RANK_MIN = 10;          // Herald
const RANK_MAX = 65;          // Ancient 5
const DAY_BUDGET = 1800;      // с запасом от лимита OpenDota в 2000 запросов в сутки
const PAUSE_MS = 1100;        // не чаще 60 запросов в минуту

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch { return { newestSeen: 0, oldestSeen: 0, spentDate: '', spent: 0, matches: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); }

function today() { return new Date().toISOString().slice(0, 10); }

function budgetLeft(s) {
  if (s.spentDate !== today()) { s.spentDate = today(); s.spent = 0; }
  return DAY_BUDGET - s.spent;
}

async function page(lessThan) {
  const url = API + '?min_rank=' + RANK_MIN + '&max_rank=' + RANK_MAX +
    (lessThan ? '&less_than_match_id=' + lessThan : '');
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 429) throw new Error('RATE');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('не массив');
  return j;
}

// Строка годится, если известны все десять героев и они разные.
// Режим и длительность НЕ фильтруем: пишем всё, что попало в окно рангов,
// включая турбо. Резать по режиму будем при сборке матриц — иначе, передумав,
// пришлось бы собирать заново.
function valid(m) {
  if (!m || typeof m.match_id !== 'number' || typeof m.radiant_win !== 'boolean') return false;
  const h = [].concat(m.radiant_team || [], m.dire_team || []);
  return h.length === 10 && h.every(Boolean) && new Set(h).size === 10;
}
function row(m) {
  return [m.match_id, m.start_time, m.duration || 0, m.avg_rank_tier || 0,
    m.lobby_type == null ? -1 : m.lobby_type, m.game_mode == null ? -1 : m.game_mode,
    m.radiant_win ? 1 : 0,
    ...m.radiant_team, ...m.dire_team];
}

// Пишем по дню старта матча, чтобы файлы не росли бесконечно и чтобы
// дубли при повторном проходе было легко отсечь.
const handles = {};
const known = {};
function appendRows(rows) {
  let written = 0;
  for (const m of rows) {
    const day = new Date(m.start_time * 1000).toISOString().slice(0, 10);
    if (!known[day]) {
      known[day] = new Set();
      const f = path.join(DIR, day + '.jsonl');
      if (fs.existsSync(f)) {
        for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
          if (line) { try { known[day].add(JSON.parse(line)[0]); } catch {} }
        }
      }
    }
    if (known[day].has(m.match_id)) continue;
    known[day].add(m.match_id);
    if (!handles[day]) handles[day] = fs.openSync(path.join(DIR, day + '.jsonl'), 'a');
    fs.writeSync(handles[day], JSON.stringify(row(m)) + '\n');
    written++;
  }
  return written;
}
function closeAll() { for (const d of Object.keys(handles)) fs.closeSync(handles[d]); }

function stats() {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort() : [];
  let total = 0, usable = 0, turbo = 0;
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      total++;
      if (r[5] === 23) turbo++;
      else if (r[5] === 22 && (r[4] === 0 || r[4] === 7) && r[2] >= 900) usable++;
    }
  }
  const s = loadState();
  console.log('Дней в базе:', files.length, files.length ? '(' + files[0].slice(0, 10) + ' … ' + files[files.length - 1].slice(0, 10) + ')' : '');
  console.log('Матчей всего:', total, '| ranked All Draft длиннее 15 мин:', usable, '| турбо:', turbo);
  console.log('Запросов потрачено сегодня:', s.spentDate === today() ? s.spent : 0, 'из', DAY_BUDGET);
  const pairs = 127 * 126 / 2;
  console.log('Наблюдений на пару «против»:', (usable * 25 / pairs).toFixed(1),
    '| на пару «вместе»:', (usable * 20 / pairs).toFixed(1), '(цель — от 200)');
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (process.argv.includes('--stats')) return stats();

  const s = loadState();
  const backArg = process.argv.indexOf('--back');
  const back = backArg > -1 ? Number(process.argv[backArg + 1]) : 0;
  let budget = Math.min(budgetLeft(s), back || DAY_BUDGET);
  if (budget <= 0) { console.log('Дневной лимит запросов исчерпан, приходи завтра.'); return; }

  let lessThan = back ? (s.oldestSeen || 0) : 0;
  let requests = 0, written = 0, stop = false;

  while (requests < budget && !stop) {
    let rows;
    try { rows = await page(lessThan); }
    catch (e) {
      if (e.message === 'RATE') { console.log('OpenDota просит подождать, останавливаюсь.'); break; }
      console.log('  сбой запроса:', e.message); await sleep(3000); continue;
    }
    requests++; s.spent++;
    if (!rows.length) { console.log('Лента кончилась.'); break; }

    const good = rows.filter(valid);
    written += appendRows(good);

    const ids = rows.map(m => m.match_id);
    const minId = Math.min(...ids), maxId = Math.max(...ids);
    if (!s.newestSeen || maxId > s.newestSeen) s.newestSeen = maxId;
    if (back) { s.oldestSeen = minId; lessThan = minId; }
    else {
      // хвост: идём назад, пока не упрёмся в уже собранное
      lessThan = minId;
      if (s.oldestSeen && minId <= s.newestSeen && requests > 1 && written === 0) stop = true;
      if (!s.oldestSeen) s.oldestSeen = minId;
    }
    if (requests % 25 === 0) { console.log(`  запросов ${requests}/${budget}, новых матчей ${written}`); saveState(s); }
    await sleep(PAUSE_MS);
  }

  closeAll();
  s.matches = (s.matches || 0) + written;
  saveState(s);
  console.log('Заход закончен: запросов', requests, '| новых матчей', written);
  stats();
}

main().catch(e => { closeAll(); console.error('ОШИБКА:', e.message); process.exit(1); });
