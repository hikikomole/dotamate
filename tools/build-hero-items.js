#!/usr/bin/env node
/**
 * Реальные покупки предметов по фазам игры — из своей базы матчей.
 *
 * Источник: data/meta-matches/*.jsonl (tools/collect-meta-matches.js, Stratz),
 * поле игрока b = [[секунда матча, itemId], …]. Берутся матчи текущего патча
 * (timestamp из data/patch-notes.json). Результат, data/hero-items.json, читает
 * js/app.js: карточка героя «Реальные покупки предметов» и быстрая подготовка.
 *
 * Фазы (время покупки): старт — до 0:00, ранняя — 0–10 мин, середина — 10–25,
 * поздняя — 25–40, очень поздняя — после 40.
 *
 * Метод. n — матчи героя, в которых Stratz отдал покупки. g — в скольких из них
 * предмет куплен в этой фазе (повторная покупка в той же фазе не считается).
 * Порог показа — доля, а не число матчей: g ≥ max(MIN_ABS, ⌈n × MIN_SHARE⌉).
 * С ростом базы порог растёт вместе с n, поэтому доли остаются сравнимыми и
 * случайные одиночные покупки не пролезают в список, сколько бы матчей ни было.
 * В фазе — до TOP предметов с наибольшей долей.
 *
 * Исключены: рецепты (сама покупка рецепта — не предмет), свиток телепорта
 * (покупается десятки раз за игру и вытеснил бы всё остальное), id, которых нет
 * в каталоге data/items-ru.json.
 *
 * Формат: heroes[id] = { n, start|early|mid|late|vlate: [{ i: itemId, g }] }.
 * Поменял формат — проверь js/app.js (loadHeroItemPopularity, fillQuickPrepBuild).
 *
 * Запуск: node tools/build-hero-items.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const OUT = path.join(ROOT, 'data', 'hero-items.json');
const TOP = 6;
const MIN_SHARE = 0.02;
const MIN_ABS = 2;
const PHASES = [['start', -Infinity, 0], ['early', 0, 600], ['mid', 600, 1500], ['late', 1500, 2400], ['vlate', 2400, Infinity]];
const SKIP = new Set(['tpscroll']);

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const catalog = read('items-ru.json').items;
const known = new Map();
for (const [key, v] of Object.entries(catalog)) {
  if (key.startsWith('recipe_') || SKIP.has(key)) continue;
  known.set(v.id, key);
}
const patch = read('patch-notes.json');
const since = Number(patch.timestamp) || 0;
const heroIds = read('heroes.json').heroes.map(h => Number(h.id));

const phaseOf = t => PHASES.find(([, a, b]) => t >= a && t < b)[0];
const acc = new Map(heroIds.map(id => [id, { n: 0, c: Object.fromEntries(PHASES.map(([k]) => [k, new Map()])) }]));
let matches = 0;
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.t < since) continue;
    let used = false;
    for (const p of m.p) {
      const h = acc.get(p.h);
      if (!h || !Array.isArray(p.b) || !p.b.length) continue;
      used = true;
      h.n++;
      const seen = new Set();
      for (const [t, id] of p.b) {
        if (!known.has(id)) continue;
        const ph = phaseOf(t);
        const k = ph + ':' + id;
        if (seen.has(k)) continue;
        seen.add(k);
        h.c[ph].set(id, (h.c[ph].get(id) || 0) + 1);
      }
    }
    if (used) matches++;
  }
}

const heroes = {};
for (const [id, h] of acc) {
  if (!h.n) continue;
  const min = Math.max(MIN_ABS, Math.ceil(h.n * MIN_SHARE));
  const rec = { n: h.n };
  for (const [ph] of PHASES) {
    rec[ph] = [...h.c[ph]].filter(([, g]) => g >= min).sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, TOP).map(([i, g]) => ({ i, g }));
  }
  heroes[id] = rec;
}

const missing = heroIds.filter(id => !heroes[id]);
const out = {
  source: 'Своя база матчей (Stratz, покупки по времени), патч ' + (patch.version || '?'),
  method: `фазы 0/10/25/40 мин; предмет показан, если куплен в ≥ max(${MIN_ABS}, ${MIN_SHARE * 100}% матчей героя); до ${TOP} на фазу`,
  since, matchesUsed: matches, builtAt: new Date().toISOString(), heroes
};
fs.writeFileSync(OUT, JSON.stringify(out));
const ns = Object.values(heroes).map(h => h.n).sort((a, b) => a - b);
console.log(`hero-items.json: ${Object.keys(heroes).length} героев из ${heroIds.length}, матчей ${matches}, выборка на героя min ${ns[0]} / медиана ${ns[ns.length >> 1]} / max ${ns[ns.length - 1]}`);
if (missing.length) { console.error('Нет покупок у героев:', missing.join(', ')); process.exit(1); }
