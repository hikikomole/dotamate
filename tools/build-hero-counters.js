#!/usr/bin/env node
/**
 * Компактный срез контрпиков для блока быстрой подготовки.
 *
 * Зачем: в js/app.js контрпики считались формулой из тегов OpenDota и
 * атрибутов, со случайным слагаемым в качестве тай-брейка. То есть это был
 * не факт, а выдумка, причём разная при каждом открытии страницы.
 *
 * Настоящие матчапы уже посчитаны для страниц героев и лежат в
 * seo/hero-guide-data.json, но он весит 831 КБ — грузить его в браузер ради
 * одного блока незачем. Здесь из него берём только нужное:
 *   against — герои, против которых этот герой играет ХУЖЕ всего
 *             (то есть кем его контрят),
 *   good    — против кого он играет лучше всего.
 *
 * Запуск: node tools/build-hero-counters.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'seo', 'hero-guide-data.json');
const OUT = path.join(ROOT, 'data', 'hero-counters.json');
const TOP = 8;
const MIN_GAMES = 20; // ниже этого винрейт — шум, а не сигнал

const store = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
const known = new Set(heroes.map(h => Number(h.id)));

const pick = list => (list || [])
  .filter(r => known.has(Number(r.id)) && Number(r.games) >= MIN_GAMES)
  .slice(0, TOP)
  .map(r => ({ id: Number(r.id), g: Number(r.games), w: Number((r.wr * 100).toFixed(1)) }));

const out = {};
let withAgainst = 0, thin = [];
for (const h of heroes) {
  const src = store.heroes?.[String(h.id)];
  if (!src) { thin.push(h.localized_name); continue; }
  const against = pick(src.weakAgainst);
  const good = pick(src.strongAgainst);
  if (!against.length && !good.length) { thin.push(h.localized_name); continue; }
  if (against.length) withAgainst++;
  out[h.id] = { against, good };
}

fs.writeFileSync(OUT, JSON.stringify({
  source: 'OpenDota matchups (тот же срез, что на страницах героев)',
  builtAt: new Date().toISOString(),
  minGames: MIN_GAMES,
  heroCount: Object.keys(out).length,
  heroes: out
}));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Контрпики: ${Object.keys(out).length} героев (${withAgainst} с контрпиками), ${kb} КБ.`);
if (thin.length) console.log('Без данных:', thin.join(', '));
