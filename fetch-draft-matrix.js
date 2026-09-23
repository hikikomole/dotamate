#!/usr/bin/env node
/**
 * Выгружает полную матрицу парных показателей героев из Stratz GraphQL API
 * и сохраняет компактный снимок в data/draft-matrix.json для драфт-инструмента.
 *
 * Что берём:
 *   heroStats.matchUp(bracketBasicIds:[DIVINE_IMMORTAL])
 *     with{heroId2 matchCount winCount} — пара в одной команде (синергия)
 *     vs  {heroId2 matchCount winCount} — пара в разных командах (контрпик)
 *
 * Важно: Stratz отдаёт пару несимметрично — строка героя A про пару (A,B)
 * и строка героя B про ту же пару дают разные matchCount (у каждого героя своё
 * окно выборки). Проверено повторными запросами: расхождение стабильное, не гонка.
 * Поэтому по каждой паре берём оба направления: итоговая доля побед — взвешенная
 * по выборке средняя двух оценок, а размер выборки — больший из двух (складывать
 * нельзя, выборки пересекаются).
 *
 * Формат файла: верхний треугольник без дублей.
 *   pairs.with[i] = [matchCount, winCount]  — winCount для пары (a,b), a<b
 *   pairs.vs[i]   = [matchCount, winCount]  — winCount героя a против героя b
 *   индекс i = idx(a,b) считается по порядку героев в массиве heroIds.
 *
 * Запуск:  node fetch-draft-matrix.js
 * Токен:   stratz.capi.txt (строка вида https://stratz.com/api=<JWT>) или STRATZ_TOKEN
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.stratz.com/graphql';
const BRACKET = 'DIVINE_IMMORTAL';
const OUT = path.join(__dirname, 'data', 'draft-matrix.json');
const CHUNK = 10;          // героев за один запрос
const PAUSE_MS = 1200;     // Stratz: ~8 запросов в секунду, идём с запасом

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const f = path.join(__dirname, 'stratz.capi.txt');
  if (!fs.existsSync(f)) throw new Error('Нет токена: ни STRATZ_TOKEN, ни stratz.capi.txt');
  const raw = fs.readFileSync(f, 'utf8').trim();
  const token = (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
  if (token.split('.').length !== 3) throw new Error('Токен не похож на JWT');
  return token;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(token, query, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API' },
        body: JSON.stringify({ query })
      });
      if (res.status === 429) { await sleep(5000 * attempt); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
      return j.data;
    } catch (e) {
      if (attempt === tries) throw e;
      await sleep(2000 * attempt);
    }
  }
}

async function main() {
  const token = readToken();

  const heroesFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'heroes.json'), 'utf8'));
  const heroIds = heroesFile.heroes.map(h => h.id).sort((a, b) => a - b);
  const N = heroIds.length;
  const pos = new Map(heroIds.map((id, i) => [id, i]));
  console.log('Героев:', N);

  // индекс пары (i<j) в плоском массиве верхнего треугольника
  const idx = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
  const PAIRS = (N * (N - 1)) / 2;

  // на пару копим обе оценки: [n1,w1,n2,w2]
  const withAcc = Array.from({ length: PAIRS }, () => [0, 0, 0, 0]);
  const vsAcc = Array.from({ length: PAIRS }, () => [0, 0, 0, 0]);
  const heroTotals = {};

  for (let s = 0; s < N; s += CHUNK) {
    const batch = heroIds.slice(s, s + CHUNK);
    const data = await gql(token, `{heroStats{matchUp(heroIds:[${batch.join(',')}],bracketBasicIds:[${BRACKET}],take:${N + 10},matchLimit:0){
      heroId matchCountWith matchCountVs
      with{heroId2 matchCount winCount}
      vs{heroId2 matchCount winCount}
    }}}`);
    const rows = data.heroStats.matchUp || [];
    if (!rows.length) throw new Error('Пустой ответ на батче ' + batch.join(','));

    for (const row of rows) {
      const i = pos.get(row.heroId);
      if (i === undefined) continue;
      heroTotals[row.heroId] = { with: row.matchCountWith || 0, vs: row.matchCountVs || 0 };

      for (const w of row.with || []) {
        const j = pos.get(w.heroId2);
        if (j === undefined || j === i) continue;
        const k = i < j ? idx(i, j) : idx(j, i);
        const off = i < j ? 0 : 2;           // 0 — оценка «младшего» героя, 2 — «старшего»
        withAcc[k][off] = w.matchCount;
        withAcc[k][off + 1] = w.winCount;
      }
      for (const v of row.vs || []) {
        const j = pos.get(v.heroId2);
        if (j === undefined || j === i) continue;
        const k = i < j ? idx(i, j) : idx(j, i);
        const off = i < j ? 0 : 2;
        // всегда приводим к «победам героя с меньшим индексом»
        vsAcc[k][off] = v.matchCount;
        vsAcc[k][off + 1] = i < j ? v.winCount : v.matchCount - v.winCount;
      }
    }
    console.log(`батч ${s / CHUNK + 1}: герои ${batch[0]}–${batch[batch.length - 1]}, строк ${rows.length}`);
    if (s + CHUNK < N) await sleep(PAUSE_MS);
  }

  // сведение двух направлений: доля побед — взвешенная средняя, выборка — большая из двух
  const merge = acc => acc.map(([n1, w1, n2, w2]) => {
    const n = Math.max(n1, n2);
    if (!n) return [0, 0];
    const tot = n1 + n2;
    return [n, Math.round(n * ((w1 + w2) / tot))];
  });
  const withM = merge(withAcc);
  const vsM = merge(vsAcc);

  const missWith = withM.filter(x => x[0] === 0).length;
  const missVs = vsM.filter(x => x[0] === 0).length;
  console.log('Пар всего:', PAIRS, '| без данных with:', missWith, '| без данных vs:', missVs);

  const out = {
    source: 'Stratz GraphQL heroStats.matchUp',
    bracket: BRACKET,
    fetchedAt: new Date().toISOString(),
    heroCount: N,
    pairCount: PAIRS,
    note: 'pairs.with/vs — верхний треугольник [matchCount, winCount]; winCount у vs относится к герою с меньшим индексом в heroIds. Stratz отдаёт пару несимметрично, поэтому доля побед сведена как взвешенная средняя двух направлений, а matchCount — большее из двух значений',
    heroIds,
    heroTotals,
    pairs: {
      with: withM,
      vs: vsM
    }
  };

  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('Записано', OUT, kb + ' КБ');
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
