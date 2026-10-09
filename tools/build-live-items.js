// Ключевые покупки для ленты событий эфира /live: собранные предметы (cat "item", есть компоненты) от 2000 золота;
// базовые компоненты из магазина (Demon Edge, Hyperstone…) ключевыми не считаются.
// names — названия всех предметов магазина от 1000 золота, включая компоненты и рецепты (карточка игрока: предметы из data/item-impact.json).
// Источник — data/items-ru.json (datafeed Valve). Пишет data/live-items.json {items: {ключ: название}},
// ~3 КБ вместо 280 КБ items-ru.json на телефоне. Вызывается из build-pages.js при каждой сборке.
'use strict';
const fs = require('fs');
const path = require('path');
const MIN_COST = 2000;
function build() {
  const root = path.join(__dirname, '..');
  const src = JSON.parse(fs.readFileSync(path.join(root, 'data', 'items-ru.json'), 'utf8')).items;
  const items = {};
  for (const [k, x] of Object.entries(src)) if (x.cat === 'item' && x.cost >= MIN_COST && (x.comp || []).length && !/^recipe_/.test(k)) items[k] = x.dname;
  const names = {};
  for (const [k, x] of Object.entries(src)) if (x.cost >= 1000 && x.dname) names[k] = x.dname; // все категории: в item-impact бывают компоненты (Blink Dagger) и рецепты
  if (Object.keys(items).length < 50) throw new Error('live-items: подозрительно мало предметов (' + Object.keys(items).length + ')');
  const out = path.join(root, 'data', 'live-items.json');
  fs.writeFileSync(out + '.part', JSON.stringify({ minCost: MIN_COST, items, names }));
  fs.renameSync(out + '.part', out);
  return Object.keys(items).length;
}
module.exports = { build };
if (require.main === module) console.log('live-items.json:', build(), 'предметов');
