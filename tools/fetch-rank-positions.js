#!/usr/bin/env node
/**
 * Роли героев по рангам — для раздела «Статистика и аналитика».
 *
 * Источник: Stratz heroStats.stats(bracketBasicIds, groupByPosition) — те же
 * данные, что в fetch-hero-positions.js, но по группам рангов нашей базы
 * По ним на /stats/ показывается роль,
 * на которой герой чаще всего играется на выбранном ранге, и роли, где он
 * играет лучше всего.
 *
 * Результат: data/rank-positions.json
 *   pairs[12|34|56][heroId] = [[матчей, побед] × 5 позиций]
 *   groupToPair — группа ранга stats.json (1…6) → пара Stratz
 *   all[heroId]      = сумма по трём парам (0–4500 MMR+)
 *
 * Запуск: node tools/fetch-rank-positions.js   (3 запроса к Stratz)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'rank-positions.json');
const ENDPOINT = 'https://api.stratz.com/graphql';
// Stratz отдаёт статистику позиций только по парам рангов (RankBracketBasicEnum):
// HERALD_GUARDIAN, CRUSADER_ARCHON, LEGEND_ANCIENT. Отдельного «только Рекрут»
// нет (bracketIds у heroStats.stats не принимается — проверено 25.09.2026),
// поэтому группа ранга g берёт данные своей пары.
const BRACKETS = { 12: 'HERALD_GUARDIAN', 34: 'CRUSADER_ARCHON', 56: 'LEGEND_ANCIENT' };
const GROUP_TO_PAIR = { 1: 12, 2: 12, 3: 34, 4: 34, 5: 56, 6: 56 };
const POS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const raw = fs.readFileSync(path.join(ROOT, 'stratz.capi.txt'), 'utf8').trim();
  const t = (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
  if (t.split('.').length !== 3) throw new Error('Токен Stratz не похож на JWT');
  return t;
}

async function gql(token, query) {
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API' },
      body: JSON.stringify({ query })
    });
    if (res.status === 429) { await sleep(5000 * i); continue; }
    if (!res.ok) throw new Error('Stratz HTTP ' + res.status);
    const j = await res.json();
    if (j.errors) throw new Error('Stratz: ' + JSON.stringify(j.errors).slice(0, 300));
    return j.data;
  }
  throw new Error('Stratz не отвечает');
}

async function main() {
  const token = readToken();
  const ranks = {}, all = {};
  for (const [g, br] of Object.entries(BRACKETS)) {
    const d = await gql(token, `{ heroStats { stats(bracketBasicIds:[${br}], groupByPosition:true) { heroId position matchCount winCount } } }`);
    const rows = d.heroStats.stats || [];
    if (!rows.length) throw new Error(`Пустой ответ для ${br} — снимок не трогаю`);
    const m = {};
    for (const r of rows) {
      const i = POS.indexOf(r.position);
      if (i < 0) continue;
      const h = m[r.heroId] || (m[r.heroId] = POS.map(() => [0, 0]));
      h[i] = [r.matchCount, r.winCount];
      const a = all[r.heroId] || (all[r.heroId] = POS.map(() => [0, 0]));
      a[i][0] += r.matchCount; a[i][1] += r.winCount;
    }
    ranks[g] = m;
    console.log(`${br}: ${Object.keys(m).length} героев, ${rows.reduce((s, r) => s + r.matchCount, 0)} героематчей`);
    await sleep(500);
  }
  const out = { source: 'Stratz heroStats, groupByPosition', brackets: BRACKETS, groupToPair: GROUP_TO_PAIR, fetchedAt: new Date().toISOString(), pairs: ranks, all };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('OK ->', path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1024).toFixed(0), 'КБ');
}

main().catch(e => { console.error('ОШИБКА:', e.message.replace(/ey[\w.-]{20,}/g, '[JWT]')); process.exit(1); });
