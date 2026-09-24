#!/usr/bin/env node
/**
 * Превращает «перевес драфта» в настоящую вероятность победы.
 *
 * Как: перевес S — это сумма парных отклонений от 50% в процентных пунктах.
 * Сама по себе она не вероятность: модель считает пары независимыми и на
 * резких драфтах выдаёт ±90 и больше. Поэтому подгоняем один коэффициент a
 * логистической регрессией по исходам настоящих матчей:
 *
 *     P(победа Света) = 1 / (1 + exp(-a * S))
 *
 * Это стандартный способ калибровки (Platt scaling): одна свободная величина,
 * подобранная по данным, без подгонки формы.
 *
 * Честность измерения: матчи делятся на три непересекающиеся части.
 *   - 70% — по ним строится матрица пар (иначе модель знала бы ответы);
 *   - 15% — по ним подбирается a;
 *   - 15% — по ним измеряется качество, эти матчи не видели ни матрица, ни a.
 * Качество считаем log loss и Brier score против честной константы 50%.
 *
 * Линии в формулу не входят: в ленте публичных матчей нет позиций, а значит
 * лейновый вклад по истории не восстановить. Он остаётся отдельным показателем.
 *
 * Запуск:  node tools/build-draft-calibration.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'public-matches');
const OUT = path.join(ROOT, 'data', 'draft-calibration.json');
const K = 50;                 // то же сглаживание, что в инструменте
const MIN_DURATION = 900;
const MODES = [22], LOBBIES = [0, 7];

// Воспроизводимое перемешивание: один и тот же файл даёт одно и то же деление.
function rng(seed) {
  let x = seed >>> 0;
  return function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function loadMatches() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!MODES.includes(r[5]) || !LOBBIES.includes(r[4]) || r[2] < MIN_DURATION) continue;
      out.push(r);
    }
  }
  return out;
}

function main() {
  const heroIds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8'))
    .heroes.map(h => h.id).sort((a, b) => a - b);
  const N = heroIds.length, pos = new Map(heroIds.map((id, i) => [id, i]));
  const idx = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
  const PAIRS = (N * (N - 1)) / 2;

  const all = loadMatches();
  if (all.length < 5000) throw new Error('Мало матчей для калибровки: ' + all.length + ', нужно хотя бы 5000');

  // детерминированное перемешивание и деление 70/15/15
  const rnd = rng(20260924);
  const order = all.map((m, i) => [rnd(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const nTrain = Math.floor(order.length * 0.70), nFit = Math.floor(order.length * 0.15);
  const train = order.slice(0, nTrain).map(i => all[i]);
  const fit = order.slice(nTrain, nTrain + nFit).map(i => all[i]);
  const test = order.slice(nTrain + nFit).map(i => all[i]);
  console.log('Матчей:', all.length, '| матрица:', train.length, '| подбор:', fit.length, '| проверка:', test.length);

  // матрица пар только по обучающей части
  const wN = new Float64Array(PAIRS), wW = new Float64Array(PAIRS);
  const vN = new Float64Array(PAIRS), vW = new Float64Array(PAIRS);
  const teamIdx = m => [m.slice(7, 12).map(h => pos.get(h)), m.slice(12, 17).map(h => pos.get(h))];
  for (const m of train) {
    const [ri, di] = teamIdx(m);
    if (ri.some(x => x === undefined) || di.some(x => x === undefined)) continue;
    const radWin = m[6] === 1;
    const same = (t, won) => {
      for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
        const x = t[a], y = t[b], k = x < y ? idx(x, y) : idx(y, x);
        wN[k]++; if (won) wW[k]++;
      }
    };
    same(ri, radWin); same(di, !radWin);
    for (const x of ri) for (const y of di) {
      const low = x < y, k = low ? idx(x, y) : idx(y, x);
      vN[k]++;
      if (low ? radWin : !radWin) vW[k]++;
    }
  }

  const adv = (n, w) => n ? 100 * ((w + K / 2) / (n + K)) - 50 : 0;
  const withAdv = (x, y) => { const k = x < y ? idx(x, y) : idx(y, x); return adv(wN[k], wW[k]); };
  const vsAdv = (x, y) => { const k = x < y ? idx(x, y) : idx(y, x); return x < y ? adv(vN[k], vW[k]) : adv(vN[k], vN[k] - vW[k]); };

  // перевес драфта ровно по той же формуле, что на сайте (без линий)
  function score(m) {
    const [ri, di] = teamIdx(m);
    if (ri.some(x => x === undefined) || di.some(x => x === undefined)) return null;
    let s = 0;
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) s += withAdv(ri[a], ri[b]) - withAdv(di[a], di[b]);
    for (const x of ri) for (const y of di) s += vsAdv(x, y);
    return s;
  }
  const prep = set => set.map(m => ({ s: score(m), y: m[6] })).filter(x => x.s !== null);
  const F = prep(fit), T = prep(test);

  const logloss = (rows, a) => {
    let sum = 0;
    for (const r of rows) {
      const p = 1 / (1 + Math.exp(-a * r.s));
      const q = Math.min(Math.max(r.y ? p : 1 - p, 1e-12), 1 - 1e-12);
      sum -= Math.log(q);
    }
    return sum / rows.length;
  };
  // тернарный поиск по выпуклой функции потерь
  let lo = 0, hi = 0.2;
  for (let i = 0; i < 200; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (logloss(F, m1) < logloss(F, m2)) hi = m2; else lo = m1;
  }
  const alpha = (lo + hi) / 2;

  const brier = (rows, a) => {
    let s = 0;
    for (const r of rows) { const p = 1 / (1 + Math.exp(-a * r.s)); s += (p - r.y) ** 2; }
    return s / rows.length;
  };
  const acc = (rows, a) => {
    let ok = 0;
    for (const r of rows) { const p = 1 / (1 + Math.exp(-a * r.s)); if ((p >= 0.5 ? 1 : 0) === r.y) ok++; }
    return ok / rows.length;
  };

  const res = {
    alpha: Number(alpha.toFixed(6)),
    testLogLoss: Number(logloss(T, alpha).toFixed(5)),
    baselineLogLoss: Number(Math.log(2).toFixed(5)),
    testBrier: Number(brier(T, alpha).toFixed(5)),
    baselineBrier: 0.25,
    testAccuracy: Number((100 * acc(T, alpha)).toFixed(2)),
    absScoreP50: Number(percentile(T.map(r => Math.abs(r.s)), 50).toFixed(1)),
    absScoreP95: Number(percentile(T.map(r => Math.abs(r.s)), 95).toFixed(1))
  };

  console.log('\nКоэффициент a =', res.alpha);
  console.log('log loss на проверке:', res.testLogLoss, 'против', res.baselineLogLoss, 'у константы 50%');
  console.log('Brier score       :', res.testBrier, 'против', res.baselineBrier);
  console.log('Угадано исходов   :', res.testAccuracy + '%');
  console.log('Перевес по модулю : медиана', res.absScoreP50, '| 95-й процентиль', res.absScoreP95, 'п.п.');
  console.log('Это значит: перевес', res.absScoreP95, 'п.п. превращается в',
    (100 / (1 + Math.exp(-res.alpha * res.absScoreP95))).toFixed(1) + '% победы');

  const better = res.testLogLoss < res.baselineLogLoss && res.testBrier < res.baselineBrier;
  if (!better) {
    console.log('\nМодель НЕ лучше константы 50%. Калибровку не сохраняю — на сайте останется перевес в п.п.');
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'Логистическая калибровка по своей базе матчей',
    method: 'P = 1 / (1 + exp(-a * S)), a подобран по отложенной части базы',
    builtAt: new Date().toISOString(),
    matchesTotal: all.length,
    matchesTrain: train.length, matchesFit: F.length, matchesTest: T.length,
    smoothingK: K,
    laneIncluded: false,
    ...res
  }, null, 1));
  console.log('\nЗаписано', OUT);
}

function percentile(arr, p) {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p / 100))];
}

main();
