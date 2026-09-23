#!/usr/bin/env node
/**
 * Выгружает исходы линий по парам героев из Stratz (heroStats.laneOutcome)
 * и сохраняет снимок в data/lane-matrix.json.
 *
 * Почему снимок, а не запрос из воркера: Stratz разрешает токену не больше
 * двух IP-адресов за 15 минут, а Cloudflare Worker ходит наружу с разных
 * адресов — живые запросы оттуда упираются в 403. Поэтому данные собираются
 * с одной машины и выкатываются как обычный статический файл.
 *
 * Берём только те позиции, на которых героя реально играют (доля >= MIN_SHARE),
 * и только пары с выборкой >= MIN_PAIR матчей — иначе снимок раздувается
 * строками, которые всё равно отсекаются сглаживанием.
 *
 * Запуск:  node fetch-lane-matrix.js [--dry] [--limit N]
 * Скрипт докачиваемый: уже собранное лежит в data/lane-matrix.json, повторный
 * запуск добирает только недостающие пары. --limit ограничивает порцию за раз.
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.stratz.com/graphql';
const BRACKET = 'DIVINE_IMMORTAL';
const OUT = path.join(__dirname, 'data', 'lane-matrix.json');
const POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
const MIN_SHARE = 2;     // % матчей героя на этой позиции
const MIN_PAIR = 5;      // матчей у пары на линии
const PAUSE_MS = 900;    // лимит Stratz — около 8 запросов в секунду

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const raw = fs.readFileSync(path.join(__dirname, 'stratz.capi.txt'), 'utf8').trim();
  const t = (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
  if (t.split('.').length !== 3) throw new Error('Токен не похож на JWT');
  return t;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(token, query, tries = 4) {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API' },
        body: JSON.stringify({ query })
      });
      if (res.status === 429 || res.status === 403) { await sleep(6000 * a); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
      return j.data;
    } catch (e) {
      if (a === tries) throw e;
      await sleep(2000 * a);
    }
  }
}

function save(heroes, rowsTotal) {
  const out = {
    source: 'Stratz GraphQL heroStats.laneOutcome',
    bracket: BRACKET,
    fetchedAt: new Date().toISOString(),
    minShare: MIN_SHARE,
    minPairMatches: MIN_PAIR,
    comboCount: Object.values(heroes).reduce((s, h) => s + Object.keys(h).length, 0),
    rowCount: rowsTotal,
    note: 'heroes[heroId][POSITION_N] = [[heroId2, матчей на линии, выиграно линий, проиграно линий], ...]; ничьи = матчи - победы - поражения',
    heroes
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
}

async function main() {
  const dry = process.argv.includes('--dry');
  const token = readToken();
  const pos = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hero-positions.json'), 'utf8'));

  const jobs = [];
  for (const [id, h] of Object.entries(pos.heroes || {})) {
    for (const p of POSITIONS) {
      const cell = h.positions && h.positions[p];
      if (cell && (cell.share || 0) >= MIN_SHARE) jobs.push([Number(id), p]);
    }
  }
  jobs.sort((a, b) => a[0] - b[0] || POSITIONS.indexOf(a[1]) - POSITIONS.indexOf(b[1]));
  console.log('Пар «герой + позиция»:', jobs.length, '| примерное время:', Math.round(jobs.length * (PAUSE_MS + 600) / 60000), 'мин');
  if (dry) return;

  // докачка: подхватываем уже собранное
  let heroes = {};
  if (fs.existsSync(OUT)) {
    try { heroes = JSON.parse(fs.readFileSync(OUT, 'utf8')).heroes || {}; } catch { heroes = {}; }
  }
  const pending = jobs.filter(([id, p]) => !(heroes[id] && heroes[id][p]));
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : pending.length;
  const slice = pending.slice(0, limit);
  console.log('Осталось собрать:', pending.length, '| в этот заход:', slice.length);

  let rowsTotal = Object.values(heroes).reduce((s, h) => s + Object.values(h).reduce((x, r) => x + r.length, 0), 0);
  let done = 0;
  for (const [heroId, position] of slice) {
    const data = await gql(token, `{heroStats{laneOutcome(heroId:${heroId},isWith:false,bracketBasicIds:[${BRACKET}],positionIds:[${position}]){heroId2 matchCount winCount lossCount}}}`);
    const rows = (data.heroStats.laneOutcome || [])
      .filter(r => r.matchCount >= MIN_PAIR)
      .map(r => [r.heroId2, r.matchCount, r.winCount, r.lossCount]);
    if (!heroes[heroId]) heroes[heroId] = {};
    heroes[heroId][position] = rows;
    rowsTotal += rows.length;
    done++;
    if (done % 20 === 0) { console.log(`  ${done}/${slice.length}, строк ${rowsTotal}`); save(heroes, rowsTotal); }
    await sleep(PAUSE_MS);
  }
  save(heroes, rowsTotal);
  console.log('Готово за заход:', done, '| всего строк', rowsTotal, '| осталось', pending.length - done);
  return;

}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
