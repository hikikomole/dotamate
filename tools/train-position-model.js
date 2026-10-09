/**
 * Обучение модели позиций 1–5 по полям, которые есть в Steam Web API (U2; метод — claude/steam-T3-itog.md).
 *
 * Эталон: data/meta-matches (Stratz pos), только матчи с полной расстановкой 1–5 в обеих командах.
 * Деление по матчам: sha256(SEED + ':' + match_id) → 70/15/15 (train/val/test), игроки матча в одной части.
 * Признаки — tools/match-positions.js. pos/линии/время покупок/account_id в признаки не входят.
 * Параметры (l2, эпохи) выбираются на val; точность в файле — у сохранённых (округлённых) весов на test.
 *
 * Запуск: node tools/train-position-model.js            → data/position-model.json
 *         node tools/train-position-model.js --dry      — без записи файла
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MS = require('./match-source.js');
const MP = require('./match-positions.js');

const SEED = 't3-2026-10-03';
const DRY = process.argv.includes('--dry');
const MIN_ITEM = 30;   // предмет входит в словарь, если встречается в train не меньше стольких раз
const t0 = Date.now();

const all = MS.metaMatches();
const matches = all.filter(MP.fullPositions);
const bucket = id => crypto.createHash('sha256').update(SEED + ':' + id).digest().readUInt32BE(0) / 4294967296;
const split = { train: [], val: [], test: [] };
for (const m of matches) { const u = bucket(m.id); (u < 0.70 ? split.train : u < 0.85 ? split.val : split.test).push(m); }
if (split.train.length < 1000) { console.error('Мало эталонных матчей для обучения: ' + split.train.length); process.exit(1); }

// словарь предметов и счётчики позиций героев — только из train
const itemCnt = new Map(), heroPos = new Map();
for (const m of split.train) for (const p of m.p) {
  for (const it of p.it) if (it) itemCnt.set(it, (itemCnt.get(it) || 0) + 1);
  if (!heroPos.has(p.h)) heroPos.set(p.h, [0, 0, 0, 0, 0]);
  heroPos.get(p.h)[p.pos - 1]++;
}
const items = [...itemCnt].filter(([, c]) => c >= MIN_ITEM).map(([i]) => i).sort((a, b) => a - b);
const featTeam = MP.makeFeaturizer({ items, heroPos });
const NF = MP.NF_DENSE + items.length;

function train(rows, { epochs, lr, l2 }) {
  const W = Array.from({ length: 5 }, () => new Float64Array(NF));
  const flat = rows.slice();
  let rng = 12345; const rnd = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let e = 0; e < epochs; e++) {
    for (let i = flat.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [flat[i], flat[k]] = [flat[k], flat[i]]; }
    const a = lr / (1 + e * 0.3);
    for (const r of flat) {
      const p = MP.probs(W, r);
      for (let c = 0; c < 5; c++) {
        const g = p[c] - (c === r.y ? 1 : 0), w = W[c];
        for (let j = 0; j < MP.NF_DENSE; j++) w[j] -= a * (g * r.x[j] + l2 * w[j]);
        for (const j of r.sp) w[j] -= a * (g + l2 * w[j]);
      }
    }
  }
  return W;
}

function evaluate(ms, W, ft = featTeam) {
  const cm = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  let n = 0, ok = 0, cs = 0, cs4 = 0, tAll = 0, tOk = 0;
  for (const m of ms) for (const t of MP.teams(m)) {
    const R = ft(t), P = R.map(r => MP.probs(W, r)), pm = MP.assign(P);
    let all5 = true;
    R.forEach((r, i) => {
      const y = r.y, q = pm[i]; cm[y][q]++; n++;
      if (y === q) ok++; else all5 = false;
      if ((y < 3) === (q < 3)) cs++;
      if (y === q || (y > 2 && q > 2)) cs4++;
    });
    tAll++; if (all5) tOk++;
  }
  const pct = (a, b) => +(a / b * 100).toFixed(2);
  return { players: n, acc: pct(ok, n), coreSup: pct(cs, n), core3sup: pct(cs4, n), teamExact: pct(tOk, tAll),
    perPos: cm.map((r, i) => pct(r[i], r.reduce((a, b) => a + b, 0))), cm };
}

const trRows = split.train.flatMap(m => MP.teams(m).flatMap(t => featTeam(t, true)));
const grid = [];
for (const l2 of [1e-5, 1e-4, 1e-3]) for (const epochs of [8, 16]) {
  grid.push({ l2, epochs, val: evaluate(split.val, train(trRows, { epochs, lr: 0.05, l2 })).acc });
}
grid.sort((a, b) => b.val - a.val);
const best = grid[0];
const W = train(trRows, { epochs: best.epochs, lr: 0.05, l2: best.l2 });
const round = w => Array.from(w, v => +v.toPrecision(7));

const model = {
  version: 1,
  created: new Date().toISOString(),
  method: 'softmax-регрессия (SGD, L2) + назначение позиций в команде перебором 120 перестановок; см. claude/steam-T3-itog.md',
  source: 'Эталон позиций — Stratz (data/meta-matches), признаки — только поля Steam Web API',
  split: { seed: SEED, rule: 'sha256(seed:match_id) → 70/15/15', train: split.train.length, val: split.val.length, test: split.test.length,
    metaMatches: all.length, droppedNoFullPositions: all.length - matches.length,
    dates: [Math.min(...matches.map(m => m.t)), Math.max(...matches.map(m => m.t))].map(t => new Date(t * 1000).toISOString().slice(0, 10)) },
  params: { lr: 0.05, l2: best.l2, epochs: best.epochs, grid },
  features: { num: MP.NUM, nfDense: MP.NF_DENSE, minItem: MIN_ITEM, items,
    heroPos: Object.fromEntries([...heroPos].sort((a, b) => a[0] - b[0])),
    layout: 'для каждого num: ранг в команде (0 = максимум, /4) и доля от суммы команды (×5 − 1); log-априорная позиция героя ×1/3 (5); слот 0–4 one-hot (5); bias; затем предметы (1, если есть в итоговых 6)' },
  weights: W.map(round),
  metrics: null,
};
// точность считается на сохранённых (округлённых) весах
const Wr = model.weights.map(w => Float64Array.from(w));
const ft2 = MP.makeFeaturizer({ items, heroPos: model.features.heroPos });
model.metrics = { val: evaluate(split.val, Wr, ft2), test: evaluate(split.test, Wr, ft2) };

// проверка на физических Steam-строках матчей вне train (пересечение с data/steam-matches)
const byId = new Map(matches.map(m => [m.id, m]));
const steamTest = [];
for (const r of MS.steamMatches()) {
  const ref = byId.get(r[0]); if (!ref || bucket(r[0]) < 0.70) continue;
  const s = MS.steamToMeta(r), pos = new Map(ref.p.map(q => [q.r + ':' + q.h, q.pos]));
  if (!s.p.every(q => pos.has(q.r + ':' + q.h))) continue;
  s.p.forEach(q => { q.pos = pos.get(q.r + ':' + q.h); });
  steamTest.push(s);
}
model.metrics.steamNativeNotTrain = steamTest.length ? Object.assign({ matches: steamTest.length }, evaluate(steamTest, Wr, ft2)) : null;
model.trainSeconds = Math.round((Date.now() - t0) / 1000);

const T = model.metrics.test;
console.log('Эталон: ' + matches.length + ' матчей (отброшено ' + model.split.droppedNoFullPositions + '), train/val/test ' +
  [split.train.length, split.val.length, split.test.length].join('/') + ', предметов ' + items.length);
console.log('Параметры (val): l2 ' + best.l2 + ', эпох ' + best.epochs + '; val ' + model.metrics.val.acc + ' %');
console.log('TEST: всего ' + T.acc + ' %, кор/саппорт ' + T.coreSup + ' %, 1/2/3+саппорт ' + T.core3sup + ' %, по позициям ' + T.perPos.join(' / '));
if (model.metrics.steamNativeNotTrain) console.log('Steam-строки вне train: ' + model.metrics.steamNativeNotTrain.matches + ' матчей, ' + model.metrics.steamNativeNotTrain.acc + ' % / ' + model.metrics.steamNativeNotTrain.coreSup + ' %');
console.log('Время: ' + model.trainSeconds + ' с');
if (!DRY) { fs.writeFileSync(MP.MODEL_FILE, JSON.stringify(model) + '\n'); console.log('Записано: data/position-model.json'); }
