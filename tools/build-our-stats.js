#!/usr/bin/env node
/**
 * Считает статистику нашего ранга по собственной базе матчей
 * (data/public-matches/*.jsonl, собирается tools/collect-public-matches.js).
 *
 * Что умеет посчитать этот источник: винрейт и популярность каждого героя,
 * пары «вместе» (синергия) и «против» (контрпик).
 * Чего в нём нет и посчитать нельзя: баны, предметы, позиции, линии, способности.
 *
 * На выходе:
 *   data/our-meta.json   — герои: матчей, побед, винрейт, доля пиков
 *   data/our-matrix.json — матрица пар в том же формате, что draft-matrix.json,
 *                          чтобы инструмент пика мог переключаться между срезами
 *
 * Источник: --source opendota (по умолчанию) | steam — см. tools/match-source.js.
 *
 * Запуск:  node tools/build-our-stats.js [--tier top|all] [--turbo] [--source steam] [--main]
 */
const fs = require('fs');
const path = require('path');
const MS = require('./match-source.js');
const SRC = MS.source();

const ROOT = path.join(__dirname, '..');
// Срез: base — наша база 0–4500 MMR, top — «Divine 5 и Immortal» (tools/collect-public-matches.js --tier top).
const TIER = process.argv.includes('--tier') ? process.argv[process.argv.indexOf('--tier') + 1] : 'base';
const TIERS = { base: { dir: 'public-matches', min: 0, max: 65, suffix: '' }, top: { dir: 'public-matches-top', min: 75, max: 85, suffix: '-top' },
  all: { dir: null, min: -Infinity, max: Infinity, suffix: '-all' } }; // all — только --source steam: все рейтинговые матчи всех рангов
if (!TIERS[TIER]) { console.error('Неизвестный срез: ' + TIER); process.exit(2); }
if (TIER === 'all' && SRC !== 'steam') { console.error('Срез all — только для --source steam'); process.exit(2); }
// --main: срез all пишется в основные файлы сайта (our-meta.json/our-matrix.json) — с U5 (09.10.2026) это матрица DraftMate «Все ранги»
if (process.argv.includes('--main')) { if (TIER !== 'all') { console.error('--main — только для --tier all'); process.exit(2); } TIERS.all.suffix = ''; }
const OUT_DIR = MS.outDir(); // --out-dir (по умолчанию data/)
const MIN_DURATION = 900;   // 15 минут: отсекаем брошенные игры

function args() {
  const a = process.argv;
  const turbo = a.includes('--turbo');
  return {
    turbo,
    modes: turbo ? [23] : [22],
    lobbies: turbo ? [0] : [0, 7],
    metaOut: path.join(OUT_DIR, 'our-meta' + TIERS[TIER].suffix + (turbo ? '-turbo' : '') + '.json'),
    matrixOut: path.join(OUT_DIR, 'our-matrix' + TIERS[TIER].suffix + (turbo ? '-turbo' : '') + '.json')
  };
}

async function main() {
  const A = args();
  const heroesFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8'));
  const heroIds = heroesFile.heroes.map(h => h.id).sort((a, b) => a - b);
  const N = heroIds.length;
  const pos = new Map(heroIds.map((id, i) => [id, i]));
  const idx = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
  const PAIRS = (N * (N - 1)) / 2;

  const heroMatches = new Array(N).fill(0), heroWins = new Array(N).fill(0);
  const withN = new Array(PAIRS).fill(0), withW = new Array(PAIRS).fill(0);
  const vsN = new Array(PAIRS).fill(0), vsW = new Array(PAIRS).fill(0);


  let total = 0, used = 0, minTime = Infinity, maxTime = 0;
  const rankHist = {};

  {
    for await (const r of MS.publicStream({ src: SRC, tier: TIER, turbo: A.turbo })) {
      total++;
      const [, start, dur, rank, lobby, mode, radWin] = r;
      if (!A.modes.includes(mode) || !A.lobbies.includes(lobby) || dur < MIN_DURATION) continue;
      // ранг вне среза не берём: срезы не смешиваются, даже если строка попала не в ту папку
      // у Steam ранг известен не всегда (null); срез по рангу уже сделан в match-source.js
      if (rank != null && (rank < TIERS[TIER].min || rank > TIERS[TIER].max)) continue;
      const rad = r.slice(7, 12), dire = r.slice(12, 17);
      const ri = rad.map(h => pos.get(h)), di = dire.map(h => pos.get(h));
      if (ri.some(x => x === undefined) || di.some(x => x === undefined)) continue;

      used++;
      if (start < minTime) minTime = start;
      if (start > maxTime) maxTime = start;
      const rg = rank == null ? 'null' : Math.floor(rank / 10);
      rankHist[rg] = (rankHist[rg] || 0) + 1;

      for (const i of ri) { heroMatches[i]++; if (radWin) heroWins[i]++; }
      for (const i of di) { heroMatches[i]++; if (!radWin) heroWins[i]++; }

      // пары внутри команды
      const sameTeam = (team, won) => {
        for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
          const x = team[a], y = team[b];
          const k = x < y ? idx(x, y) : idx(y, x);
          withN[k]++; if (won) withW[k]++;
        }
      };
      sameTeam(ri, radWin === 1);
      sameTeam(di, radWin === 0);

      // пары между командами: победы считаем за героя с меньшим индексом
      for (const x of ri) for (const y of di) {
        if (x === y) continue;
        const low = x < y, k = low ? idx(x, y) : idx(y, x);
        vsN[k]++;
        const lowWon = low ? radWin === 1 : radWin === 0;
        if (lowWon) vsW[k]++;
      }
    }
  }

  if (!total) throw new Error(SRC === 'steam' ? 'База Steam пуста — сначала tools/collect-steam-matches.js' : 'База пуста — сначала запусти «Обновить всё.cmd»');
  if (!used) throw new Error('Под фильтр не попало ни одного матча');

  const meta = {
    source: MS.sourceLabel(SRC),
    slice: TIER === 'all' && !A.turbo ? 'Ranked All Pick, все ранги' : TIER === 'top' ? 'Ranked All Pick, Divine 5 и Immortal (средний ранг матча 75–85 по ленте OpenDota)'
      : SRC === 'steam' ? (A.turbo ? 'Турбо, все ранги' : 'Ranked All Pick, ранг неизвестен или до Властелина') : A.turbo ? 'Турбо, ранги Рекрут–Властелин' : 'Ranked All Pick, ранги Рекрут–Властелин',
    builtAt: new Date().toISOString(),
    matchesInBase: total,
    matchesUsed: used,
    firstMatchAt: new Date(minTime * 1000).toISOString(),
    lastMatchAt: new Date(maxTime * 1000).toISOString(),
    rankGroups: rankHist,
    heroes: {}
  };
  const totalPicks = used * 10;
  heroIds.forEach((id, i) => {
    meta.heroes[id] = {
      matches: heroMatches[i],
      wins: heroWins[i],
      winrate: heroMatches[i] ? Number((heroWins[i] / heroMatches[i] * 100).toFixed(2)) : null,
      pickrate: Number((heroMatches[i] / totalPicks * 100).toFixed(2))
    };
  });
  MS.writeJsonAtomic(A.metaOut, meta);

  const matrix = {
    source: MS.sourceLabel(SRC),
    slice: meta.slice,
    fetchedAt: meta.builtAt,
    heroCount: N,
    pairCount: PAIRS,
    matchesUsed: used,
    note: 'pairs.with/vs — верхний треугольник [матчей, побед]; победы у vs относятся к герою с меньшим индексом в heroIds',
    heroIds,
    pairs: {
      with: withN.map((n, k) => [n, withW[k]]),
      vs: vsN.map((n, k) => [n, vsW[k]])
    }
  };
  MS.writeJsonAtomic(A.matrixOut, matrix);

  const obsVs = vsN.reduce((s, x) => s + x, 0) / PAIRS;
  const obsWith = withN.reduce((s, x) => s + x, 0) / PAIRS;
  const thin = vsN.filter(x => x < 50).length;
  console.log('Срез:', meta.slice);
  console.log('Матчей в базе:', total, '| под фильтр попало:', used);
  console.log('Период:', meta.firstMatchAt.slice(0, 16), '…', meta.lastMatchAt.slice(0, 16));
  console.log('Наблюдений на пару: против', obsVs.toFixed(1), '| вместе', obsWith.toFixed(1));
  console.log('Пар с выборкой меньше 50:', thin, 'из', PAIRS);
  console.log('Матчей на героя в среднем:', (totalPicks / N).toFixed(0));
  console.log('Записано:', path.basename(A.metaOut), (fs.statSync(A.metaOut).size / 1024).toFixed(0) + ' КБ,',
    path.basename(A.matrixOut), (fs.statSync(A.matrixOut).size / 1024).toFixed(0) + ' КБ');
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
