/**
 * Разметка позиций игроков Steam-матча (U2 перехода на Steam Web API).
 *
 * Модель — data/position-model.json (tools/train-position-model.js): softmax-регрессия по итоговой
 * статистике игрока относительно своей команды + итоговые предметы + априорные позиции героя + слот,
 * затем назначение позиций в команде перебором 120 перестановок (каждая позиция ровно один раз).
 *
 * Выход для игрока: { h, pos, p, src }
 *   pos — 1, 2, 3 или 'sup' (4 и 5 по итоговой статистике различаются плохо, см. claude/steam-T3-itog.md);
 *         4/5 — только если матч есть в data/meta-matches (Stratz) с полной расстановкой, тогда src 'stratz'
 *         и позиции всех пятерых берутся из Stratz (эталон), p = 1.
 *   p   — вероятность модели для назначенной позиции (для 'sup' — сумма p4 + p5).
 * В каждой команде всегда ровно 3 кор (1, 2, 3) + 2 саппорта.
 *
 * Чтение базы — только через tools/match-source.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const MS = require('./match-source.js');

const MODEL_FILE = path.join(__dirname, '..', 'data', 'position-model.json');
const NUM = ['gpm', 'xpm', 'nw', 'lh', 'dn', 'hd', 'td', 'hh', 'k', 'd', 'a', 'lvl'];
const NF_DENSE = NUM.length * 2 + 5 + 5 + 1; // ранг в команде, доля от суммы, априорная позиция героя, слот, bias

/** Признаки из словаря предметов и счётчиков позиций героев (только train). */
function makeFeaturizer({ items, heroPos }) {
  const itemIdx = new Map(items.map((id, k) => [id, k]));
  const hp = heroPos instanceof Map ? heroPos : new Map(Object.entries(heroPos).map(([h, c]) => [+h, c]));
  const prior = (h, loo) => {
    const c = (hp.get(h) || [0, 0, 0, 0, 0]).slice();
    if (loo != null) c[loo]--;
    const s = c.reduce((a, b) => a + b, 0);
    return c.map(x => Math.log((x + 1) / (s + 5)));
  };
  /** team — 5 игроков формата meta-matches в порядке слотов; loo — исключить свою метку (строки train). */
  return function featTeam(team, loo = false) {
    const sums = NUM.map(k => team.reduce((a, q) => a + q[k], 0));
    return team.map((p, slot) => {
      const x = new Float64Array(NF_DENSE); let j = 0;
      NUM.forEach((k, ki) => {
        const v = p[k];
        let gt = 0; for (const q of team) if (q[k] > v) gt++;
        x[j++] = gt / 4;
        x[j++] = sums[ki] ? v / sums[ki] * 5 - 1 : 0;
      });
      const pr = prior(p.h, loo ? p.pos - 1 : null);
      for (let i = 0; i < 5; i++) x[j++] = pr[i] / 3;
      x[j + slot] = 1; j += 5;
      x[j++] = 1;
      const sp = [];
      for (const it of new Set(p.it)) if (itemIdx.has(it)) sp.push(NF_DENSE + itemIdx.get(it));
      return { x, sp, y: p.pos ? p.pos - 1 : -1 };
    });
  };
}

function probs(W, r) {
  const z = W.map(w => { let s = 0; for (let j = 0; j < NF_DENSE; j++) s += w[j] * r.x[j]; for (const j of r.sp) s += w[j]; return s; });
  const mx = Math.max(...z), e = z.map(v => Math.exp(v - mx)), S = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / S);
}

const PERMS = (() => {
  const out = [];
  const go = (a, rest) => rest.length ? rest.forEach((v, i) => go([...a, v], rest.filter((_, k) => k !== i))) : out.push(a);
  go([], [0, 1, 2, 3, 4]);
  return out;
})();

/** P[i][c] → перестановка (позиция 0–4 для каждого игрока) с максимальной суммой log p. */
function assign(P) {
  const L = P.map(r => r.map(v => Math.log(v + 1e-12)));
  let best = null, bs = -Infinity;
  for (const pm of PERMS) {
    const s = L[0][pm[0]] + L[1][pm[1]] + L[2][pm[2]] + L[3][pm[3]] + L[4][pm[4]];
    if (s > bs) { bs = s; best = pm; }
  }
  return best;
}

const teams = m => [1, 0].map(r => m.p.filter(p => p.r === r));

/** Полная расстановка 1–5 в обеих командах (эталон Stratz). */
const fullPositions = m => m.p && m.p.length === 10 &&
  [1, 0].every(r => m.p.filter(p => p.r === r).map(p => p.pos).sort().join() === '1,2,3,4,5');

function loadModel(file = MODEL_FILE) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.features.nfDense !== NF_DENSE || j.features.num.join() !== NUM.join()) throw new Error('position-model.json: другой набор признаков');
  return { meta: j, W: j.weights.map(w => Float64Array.from(w)), featTeam: makeFeaturizer({ items: j.features.items, heroPos: j.features.heroPos }) };
}

/** Позиции команды по модели: [{ pos: 1|2|3|'sup', p, p5: [p1..p5] }]. */
function labelTeamModel(team, model) {
  const P = model.featTeam(team).map(r => probs(model.W, r));
  const pm = assign(P);
  return team.map((_, i) => {
    const c = pm[i];
    return c < 3 ? { pos: c + 1, p: P[i][c] } : { pos: 'sup', p: P[i][3] + P[i][4] };
  });
}

/** Индекс эталонных матчей Stratz с полной расстановкой: match_id → матч. */
function stratzIndex() {
  const idx = new Map();
  for (const m of MS.metaMatches()) if (fullPositions(m)) idx.set(m.id, m);
  return idx;
}

/**
 * Разметка одного Steam-матча (строка collect-steam-matches.js).
 * → { id, src: 'model'|'stratz', p: [{ h, pos, p }] × 10 в порядке слотов }
 */
function labelSteamRow(row, model, stratz) {
  const m = MS.steamToMeta(row);
  const ref = stratz && stratz.get(m.id);
  if (ref) {
    const pos = new Map(ref.p.map(q => [q.r + ':' + q.h, q.pos]));
    if (m.p.every(q => pos.has(q.r + ':' + q.h))) {
      return { id: m.id, src: 'stratz', p: m.p.map(q => ({ h: q.h, pos: pos.get(q.r + ':' + q.h), p: 1 })) };
    }
  }
  const out = new Array(10);
  for (const r of [1, 0]) {
    const idx = []; m.p.forEach((q, i) => { if (q.r === r) idx.push(i); });
    if (idx.length !== 5) throw new Error('матч ' + m.id + ': в команде ' + idx.length + ' игроков');
    const lab = labelTeamModel(idx.map(i => m.p[i]), model);
    idx.forEach((i, k) => { out[i] = { h: m.p[i].h, pos: lab[k].pos, p: +lab[k].p.toFixed(4) }; });
  }
  return { id: m.id, src: 'model', p: out };
}

/** Разметка набора Steam-строк. Модель и индекс Stratz можно передать, чтобы не читать повторно. */
function labelSteamMatches(rows, { model = loadModel(), stratz = stratzIndex() } = {}) {
  return rows.map(r => labelSteamRow(r, model, stratz));
}

module.exports = { NUM, NF_DENSE, makeFeaturizer, probs, assign, teams, fullPositions, loadModel, labelTeamModel, stratzIndex, labelSteamRow, labelSteamMatches, MODEL_FILE };
