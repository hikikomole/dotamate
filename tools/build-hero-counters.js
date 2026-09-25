#!/usr/bin/env node
/**
 * Контрпики героев — один расчёт на весь сайт.
 *
 * Источник: data/our-matrix.json и data/our-meta.json (своя база рейтинговых
 * матчей, tools/build-our-stats.js). Результат, data/hero-counters.json, читают:
 *   - build-hero-pages.js   — блоки «Кто контрит / Кого контрит» на /hero/<slug>/;
 *   - build-hero-guides.js  — таблицы матчапов на /hero/<slug>/guide/;
 *   - build-guide-pages.js  — таблица в статье /guide/counter-picks/;
 *   - js/app.js             — блок быстрой подготовки.
 * Поля пары: id соперника, g матчей, w доля побед героя %, e ожидаемая %, d = w − e.
 * Поменял формат — проверь всех четверых.
 *
 * Метод. Простой винрейт пары путает контрпик с общей силой героя: сильные в
 * патче герои выигрывают почти у всех. Поэтому ожидаемая доля побед A против B
 * считается по общим винрейтам обоих героев (log5: разность логитов), а
 * d = фактическая доля − ожидаемая, в процентных пунктах.
 *   against — соперники с самым низким d (кто контрит героя);
 *   good    — соперники с самым высоким d (кого контрит герой).
 * Пары, сыгранные меньше MIN_GAMES раз, не учитываются.
 *
 * Запуск: node tools/build-hero-counters.js (после tools/build-our-stats.js)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'hero-counters.json');
const TOP = 8;
const MIN_GAMES = 300;

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const M = read('our-matrix.json');
const meta = read('our-meta.json');
const heroes = read('heroes.json').heroes;

const ids = M.heroIds.map(Number);
const N = ids.length;
if (!N || !M.pairs || !Array.isArray(M.pairs.vs)) throw new Error('our-matrix.json: нет pairs.vs — сначала tools/build-our-stats.js');
const idx = new Map(ids.map((id, i) => [id, i]));
const key = (i, j) => i < j ? (i * (2 * N - i - 1)) / 2 + (j - i - 1) : (j * (2 * N - j - 1)) / 2 + (i - j - 1);
const logit = p => Math.log(p / (1 - p));
const wr = id => { const h = meta.heroes && meta.heroes[String(id)]; return h && h.matches ? h.wins / h.matches : null; };
const r1 = x => Math.round(x * 10) / 10;

const out = {};
const thin = [];
for (const h of heroes) {
  const a = Number(h.id), i = idx.get(a), pa = wr(a);
  if (i === undefined || !pa) { thin.push(h.localized_name); continue; }
  const rows = [];
  for (const b of ids) {
    const pb = wr(b);
    if (b === a || !pb) continue;
    const j = idx.get(b), cell = M.pairs.vs[key(i, j)];
    if (!cell) continue;
    const n = cell[0], w = i < j ? cell[1] : cell[0] - cell[1];
    if (n < MIN_GAMES) continue;
    const exp = 1 / (1 + Math.exp(-(logit(pa) - logit(pb))));
    // w и e округляются для показа, d считается из них же — чтобы на странице
    // «51,1 % вместо 54,8 %» и «−3,7» всегда сходились. Сортировка — по точному x.
    const wp = r1(w / n * 100), ep = r1(exp * 100);
    rows.push({ id: b, g: n, w: wp, e: ep, d: r1(wp - ep), x: w / n - exp });
  }
  const strip = ({ x, ...r }) => r;
  const against = rows.filter(r => r.x < 0).sort((p, q) => p.x - q.x).slice(0, TOP).map(strip);
  const good = rows.filter(r => r.x > 0).sort((p, q) => q.x - p.x).slice(0, TOP).map(strip);
  if (!against.length && !good.length) { thin.push(h.localized_name); continue; }
  out[a] = { against, good };
}

fs.writeFileSync(OUT, JSON.stringify({
  source: M.source,
  slice: M.slice,
  matchesUsed: M.matchesUsed,
  builtAt: new Date().toISOString(),
  dataAt: M.fetchedAt,
  method: 'log5: d = фактическая доля побед пары − ожидаемая по общим винрейтам, п.п.',
  minGames: MIN_GAMES,
  heroCount: Object.keys(out).length,
  heroes: out
}));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Контрпики: ${Object.keys(out).length} героев, ${M.matchesUsed} матчей, ${kb} КБ.`);
if (thin.length) console.log('Без данных:', thin.join(', '));
