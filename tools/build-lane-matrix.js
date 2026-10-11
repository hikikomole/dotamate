#!/usr/bin/env node
/**
 * Матрица исходов линий для DraftMate — свой расчёт вместо снимка Stratz heroStats.laneOutcome
 * (решение владельца 11.10.2026, план исправлений п. 3.2).
 *
 * Источник: data/meta-matches (детальные матчи Stratz из своей базы, tools/collect-meta-matches.js),
 * только текущий патч (tools/match-source.js patchSince), повторы id отсеивает metaMatches().
 * По каждому игроку с позицией 1–5 и линией: исход его линии по оценке Stratz (topLaneOutcome и т.п.,
 * сторона учитывается так же, как в tools/build-stats.js) против каждого соперника на той же линии.
 *
 * Формат тот же, что у прежнего снимка (его читает js/draft-tool.js, ensureLane/laneAdv):
 *   heroes[heroId][POSITION_N] = [[heroId соперника, матчей на линии, выиграно линий, проиграно линий], …]
 *   ничьи = матчей − побед − поражений. Пары, сыгранные меньше MIN_PAIR раз, не пишутся.
 * Выборка заметно меньше, чем у Stratz (тысячи, а не сотни тысяч матчей), зато все ранги нашей базы и свежая.
 *
 * Запуск: node tools/build-lane-matrix.js   (шаг tools/daily-update.js после деталей Stratz)
 */
'use strict';
const path = require('path');
const MS = require('./match-source.js');

const OUT = path.join(MS.outDir(), 'lane-matrix.json');
const MIN_PAIR = 5;
const POS = p => 'POSITION_' + p;
// индекс в m.lanes [top, mid, bottom] для линии игрока: s — лёгкая, o — сложная, m — центр
const laneOf = (r, ln) => ln === 'm' ? 1 : ln === 's' ? (r ? 2 : 0) : ln === 'o' ? (r ? 0 : 2) : -1;

const since = MS.patchSince();
const acc = {};            // hero -> pos -> enemy -> [n, win, loss]
let matches = 0, rows = 0;
for (const m of MS.metaMatches()) {
  if (!(m.t >= since) || !Array.isArray(m.lanes) || !Array.isArray(m.p) || m.p.length !== 10) continue;
  let used = false;
  for (const p of m.p) {
    if (!(p.pos >= 1 && p.pos <= 5)) continue;
    const li = laneOf(p.r, p.ln);
    const out = li >= 0 ? m.lanes[li] : null;
    if (!out) continue;
    const win = (out.startsWith('RADIANT') && p.r) || (out.startsWith('DIRE') && !p.r);
    const loss = out !== 'TIE' && !win;
    for (const e of m.p) {
      if (e.r === p.r || laneOf(e.r, e.ln) !== li) continue;
      const a = ((acc[p.h] = acc[p.h] || {})[POS(p.pos)] = acc[p.h][POS(p.pos)] || {});
      const x = a[e.h] || (a[e.h] = [0, 0, 0]);
      x[0]++; if (win) x[1]++; if (loss) x[2]++;
      used = true; rows++;
    }
  }
  if (used) matches++;
}

const heroes = {};
let pairCount = 0;
for (const [h, byPos] of Object.entries(acc)) {
  for (const [pos, enemies] of Object.entries(byPos)) {
    const list = Object.entries(enemies).filter(([, x]) => x[0] >= MIN_PAIR)
      .map(([e, x]) => [Number(e), x[0], x[1], x[2]]).sort((a, b) => b[1] - a[1]);
    if (!list.length) continue;
    (heroes[h] = heroes[h] || {})[pos] = list;
    pairCount += list.length;
  }
}
if (!matches) throw new Error('нет детальных матчей Stratz с исходами линий в текущем патче — прежний файл оставлен');

MS.writeJsonAtomic(OUT, {
  source: 'Свой расчёт: детальные матчи Stratz из базы DotaMate (исход линии по оценке Stratz), текущий патч',
  bracket: 'ALL',
  fetchedAt: new Date().toISOString(),
  matches,
  minPairMatches: MIN_PAIR,
  rowCount: pairCount,
  note: 'heroes[heroId][POSITION_N] = [[heroId2, матчей на линии, выиграно линий, проиграно линий], ...]; ничьи = матчи - победы - поражения',
  heroes
});
console.log(`lane-matrix.json: ${matches} матчей, ${rows} столкновений на линиях, пар от ${MIN_PAIR} матчей: ${pairCount}, героев ${Object.keys(heroes).length}`);
