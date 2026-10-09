#!/usr/bin/env node
/**
 * Шанс победы по ходу игры для эфира /live и страницы итогов матча.
 *
 * Обучение — на архиве разобранных реплеев сервера (~/dotamate-collector/archive/matches, tools/replay/normalize.js).
 * Признаки — js/live-winprob.js (одна формула с сайтом). Логистическая регрессия методом Ньютона, L2 = 1e-3.
 *
 * Честность измерения — как в tools/build-draft-calibration.js: матчи (не минуты — минуты одного матча связаны)
 * перемешиваются воспроизводимо и делятся 70/15/15. На 15% «подбор» выбран набор признаков (09.10.2026, отчёт
 * в claude/plan-efir-10-zadach.md); коэффициенты учатся на 85%, качество меряется на отложенных 15%,
 * которых модель не видела. Сравнение — с честной константой 50% (log loss 0,69315).
 *
 * Файл data/live-winprob.json пишется, только если на отложенных матчах log loss ниже 0,69315 и точность выше 50%.
 * Иначе код 3 и прежний файл не трогается.
 *
 * Запуск (на сервере, под heavy.lock): node tools/build-live-winprob.js [--archive <папка>] [--out <файл>]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const WP = require('../js/live-winprob.js');

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const ARCH = arg('--archive', path.join(os.homedir(), 'dotamate-collector', 'archive'));
const OUT = arg('--out', path.join(__dirname, '..', 'data', 'live-winprob.json'));
const SEED = 20261009, LAMBDA = 1e-3, BASE = Math.log(2);

function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

// Из каждого файла — только признаки по минутам и исход: весь архив (~1 ГБ) в памяти не держим.
const dir = path.join(ARCH, 'matches');
if (!fs.existsSync(dir)) { console.error('Нет архива матчей: ' + dir); process.exit(2); }
const L = []; let bad = 0;
for (const f of fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { bad++; continue; }
  if (!m.adv || !m.adv.t || !m.buildings || typeof m.radiantWin !== 'boolean') { bad++; continue; }
  const X = []; for (let i = 0; i < m.adv.t.length; i++) if (m.adv.t[i] >= 60) X.push(WP.features(m, i));
  if (X.length) L.push({ id: String(m.matchId), y: m.radiantWin ? 1 : 0, X });
}
L.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const r = rng(SEED); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; }
const nTr = Math.round(L.length * 0.7), nVa = Math.round(L.length * 0.15);
const fitSet = L.slice(0, nTr + nVa), test = L.slice(nTr + nVa);
if (test.length < 50) { console.error('Мало матчей для проверки: ' + L.length); process.exit(2); }

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j; [M[i], M[p]] = [M[p], M[i]];
    for (let j = i + 1; j < n; j++) { const f = M[j][i] / M[i][i]; for (let k = i; k <= n; k++) M[j][k] -= f * M[i][k]; } }
  const x = new Array(n); for (let i = n - 1; i >= 0; i--) { x[i] = M[i][n]; for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j]; x[i] /= M[i][i]; } return x;
}
function fit(ms) {
  const k = ms[0].X[0].length; let w = new Array(k).fill(0), N = 0;
  for (const m of ms) N += m.X.length;
  for (let it = 0; it < 50; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const m of ms) for (const x of m.X) { const p = WP.logit(w, x); for (let a = 0; a < k; a++) { g[a] += (p - m.y) * x[a]; for (let b = 0; b < k; b++) H[a][b] += p * (1 - p) * x[a] * x[b]; } }
    for (let a = 1; a < k; a++) { g[a] += LAMBDA * N * w[a]; H[a][a] += LAMBDA * N; } // свободный член не штрафуем
    const d = solve(H, g); w = w.map((v, j) => v - d[j]);
    if (Math.max(...d.map(Math.abs)) < 1e-9) break;
  }
  return w;
}
function evaluate(ms, w) {
  let n = 0, ll = 0, acc = 0, br = 0, llM = 0, accM = 0;
  for (const m of ms) { let l1 = 0, a1 = 0;
    for (const x of m.X) { const p = Math.min(1 - 1e-9, Math.max(1e-9, w ? WP.logit(w, x) : 0.5)), l = -(m.y ? Math.log(p) : Math.log(1 - p)), c = (p >= 0.5) === (m.y === 1) ? 1 : 0;
      ll += l; acc += c; br += (p - m.y) ** 2; n++; l1 += l; a1 += c; }
    llM += l1 / m.X.length; accM += a1 / m.X.length; }
  const r5 = v => Math.round(v * 1e5) / 1e5;
  return { matches: ms.length, rows: n, logLoss: r5(ll / n), accuracy: r5(acc / n), brier: r5(br / n), logLossPerMatch: r5(llM / ms.length), accuracyPerMatch: r5(accM / ms.length) };
}

const w = fit(fitSet), q = evaluate(test, w), base = evaluate(test, null);
console.log('Матчей: ' + L.length + ' (пропущено ' + bad + '), обучение ' + fitSet.length + ', проверка ' + test.length);
console.log('Отложенные: log loss ' + q.logLoss + ' (константа ' + base.logLoss + '), точность ' + (q.accuracy * 100).toFixed(2) + '%, Brier ' + q.brier);
console.log('Коэффициенты: ' + w.map(v => v.toFixed(5)).join(', '));
if (!(q.logLoss < BASE && q.accuracy > 0.5)) { console.error('Модель не лучше константы 50% — файл не записан.'); process.exit(3); }
fs.writeFileSync(OUT, JSON.stringify({
  method: 'logistic regression, features js/live-winprob.js', built: new Date().toISOString(),
  w: w.map(v => Math.round(v * 1e6) / 1e6), matches: L.length, train: fitSet.length, test: q, baseline: base,
}, null, 1));
console.log('Записан ' + OUT);
