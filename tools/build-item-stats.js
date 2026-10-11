#!/usr/bin/env node
/**
 * Статистика покупок для страниц предметов (build-item-pages.js).
 *
 * Источник: data/meta-matches/*.jsonl — детальные матчи Stratz из своей базы, поле игрока
 * b:[[сек, itemId]]. Берутся матчи текущего патча (patch-notes.json timestamp) и только игроки,
 * у которых Stratz отдал покупки. Считается ПЕРВАЯ покупка предмета игроком.
 *
 * Для предмета: n — сколько игроков купили; share — доля от всех игроков с покупками;
 * t — квартили времени первой покупки [q1, медиана, q3], сек; hist — первые покупки по отрезкам
 * BINS; pos — покупки по позициям 1–5; w — побед у купивших; heroes — до TOP_HEROES героев
 * с не меньше MIN_HERO покупок: [heroId, покупок, побед].
 * Доля побед у купивших — наблюдение, а не эффект предмета: поздние предметы чаще покупает
 * выигрывающая сторона. На странице это подписано.
 *
 * Выход: data/item-stats.json. Запуск: node tools/build-item-stats.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const MIN_ITEM = 30, MIN_HERO = 10, TOP_HEROES = 6;
// Границы отрезков, сек: до 0 — стартовая закупка, дальше по 5 минут до 45, дальше 45+.
const BINS = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700];
const binOf = t => { let i = 0; while (i < BINS.length && t >= BINS[i]) i++; return i; };

const catalog = read('items-ru.json').items;
const keyById = new Map();
for (const [key, v] of Object.entries(catalog)) if (!key.startsWith('recipe_') && v.id != null) keyById.set(Number(v.id), key);
const since = Number(read('patch-notes.json').timestamp) || 0;

const acc = new Map();
let matches = 0, players = 0;
// Повтор id после оборванного сбора отсеивается, битая строка пропускается — tools/match-source.js metaMatches()
for (const m of require('./match-source.js').metaMatches()) {
  {
    if (!m.p || m.p.length !== 10 || (m.t || 0) < since) continue;
    let used = false;
    for (const p of m.p) {
      if (!Array.isArray(p.b) || !p.b.length) continue;
      used = true; players++;
      const win = (p.r === 1) === (m.rw === 1) ? 1 : 0;
      const seen = new Set();
      for (const [t, id] of p.b) {
        const key = keyById.get(id);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const a = acc.get(key) || { n: 0, w: 0, ts: [], hist: new Array(BINS.length + 1).fill(0), pos: [0, 0, 0, 0, 0], h: new Map() };
        acc.set(key, a);
        a.n++; a.w += win; a.ts.push(t); a.hist[binOf(t)]++;
        if (p.pos >= 1 && p.pos <= 5) a.pos[p.pos - 1]++;
        const h = a.h.get(p.h) || [0, 0]; h[0]++; h[1] += win; a.h.set(p.h, h);
      }
    }
    if (used) matches++;
  }
}
const q = (s, f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
const items = {};
for (const [key, a] of acc) {
  if (a.n < MIN_ITEM) continue;
  a.ts.sort((x, y) => x - y);
  items[key] = {
    n: a.n, share: Math.round(a.n / players * 1000) / 10, w: a.w,
    t: [q(a.ts, 0.25), q(a.ts, 0.5), q(a.ts, 0.75)],
    hist: a.hist, pos: a.pos,
    heroes: [...a.h].filter(([, v]) => v[0] >= MIN_HERO).sort((x, y) => y[1][0] - x[1][0]).slice(0, TOP_HEROES).map(([h, v]) => [h, v[0], v[1]])
  };
}
fs.writeFileSync(path.join(ROOT, 'data', 'item-stats.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  source: 'Детальные матчи Stratz из своей базы (data/meta-matches), текущий патч',
  matches, players, bins: BINS, minItem: MIN_ITEM, minHero: MIN_HERO, items
}));
console.log(`item-stats: ${matches} матчей, ${players} игроков, ${Object.keys(items).length} предметов`);
