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
 * Запуск:  node tools/build-our-stats.js [--mode 22] [--turbo]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'public-matches');
const MIN_DURATION = 900;   // 15 минут: отсекаем брошенные игры

function args() {
  const a = process.argv;
  const turbo = a.includes('--turbo');
  return {
    turbo,
    modes: turbo ? [23] : [22],
    lobbies: turbo ? [0] : [0, 7],
    metaOut: path.join(ROOT, 'data', turbo ? 'our-meta-turbo.json' : 'our-meta.json'),
    matrixOut: path.join(ROOT, 'data', turbo ? 'our-matrix-turbo.json' : 'our-matrix.json')
  };
}

function main() {
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

  let files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort() : [];
  if (!files.length) throw new Error('База пуста — сначала запусти «Собрать матчи.cmd»');

  let total = 0, used = 0, minTime = Infinity, maxTime = 0;
  const rankHist = {};

  for (const f of files) {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      total++;
      const [, start, dur, rank, lobby, mode, radWin] = r;
      if (!A.modes.includes(mode) || !A.lobbies.includes(lobby) || dur < MIN_DURATION) continue;
      const rad = r.slice(7, 12), dire = r.slice(12, 17);
      const ri = rad.map(h => pos.get(h)), di = dire.map(h => pos.get(h));
      if (ri.some(x => x === undefined) || di.some(x => x === undefined)) continue;

      used++;
      if (start < minTime) minTime = start;
      if (start > maxTime) maxTime = start;
      rankHist[Math.floor(rank / 10)] = (rankHist[Math.floor(rank / 10)] || 0) + 1;

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

  if (!used) throw new Error('Под фильтр не попало ни одного матча');

  const meta = {
    source: 'Своя база публичных матчей (OpenDota /publicMatches)',
    slice: A.turbo ? 'Турбо, 0-4500 MMR' : 'Ranked All Pick, 0-4500 MMR',
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
  fs.writeFileSync(A.metaOut, JSON.stringify(meta));

  const matrix = {
    source: 'Своя база публичных матчей (OpenDota /publicMatches)',
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
  fs.writeFileSync(A.matrixOut, JSON.stringify(matrix));

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

main();
