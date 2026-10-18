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
 * Формат: heroes[id] = { n, start|early|mid|late|vlate: [{ i: itemId, g }],
 *   posN: {1…5: матчей на роли}, pos: {1…5: { n, start…vlate }} — роли с ≥ MIN_ROLE }.
 * Поменял формат — проверь js/app.js (loadHeroItemPopularity, fillQuickPrepBuild).
 *
 * Запуск: node tools/build-hero-items.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const OUT = path.join(ROOT, 'data', 'hero-items.json');
const RANKED_OUT = path.join(ROOT, 'data', 'hero-items-ranked.json');
const TOP = 6;
const MIN_SHARE = 0.02;
const MIN_ABS = 2;
const PHASES = [['start', -Infinity, 0], ['early', 0, 600], ['mid', 600, 1500], ['late', 1500, 2400], ['vlate', 2400, Infinity]];
const SKIP = new Set(['tpscroll']);
// Разрез по ролям (позиция игрока по Stratz, 1–5). Роль получает свой список
// покупок, когда у героя на ней набралось MIN_ROLE матчей — тот же порог,
// что выбран для героя в целом. Порог показа предмета — та же доля.
const MIN_ROLE = 80;
const rankGroups = [
  { id: 1, key: 'low', ranks: [10, 49], label: 'Рекрут–Архонт' },
  { id: 2, key: 'high', ranks: [50, 89], label: 'Легенда и выше' }
];

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
const newAcc = () => ({ n: 0, c: Object.fromEntries(PHASES.map(([k]) => [k, new Map()])) });
const newHeroAcc = () => new Map(heroIds.map(id => [id, Object.assign(newAcc(), { pos: {} })]));
const acc = newHeroAcc();
const rankedAcc = Object.fromEntries(rankGroups.map(group => [group.key, newHeroAcc()]));
let matches = 0;
// Повтор id после оборванного сбора отсеивается, битая строка пропускается — tools/match-source.js metaMatches()
for (const m of require('./match-source.js').metaMatches()) {
  {
    if (m.t < since) continue;
    let used = false;
    for (const p of m.p) {
      const h = acc.get(p.h);
      if (!h || !Array.isArray(p.b) || !p.b.length) continue;
      used = true;
      const group = rankGroups.find(({ ranks }) => Number.isInteger(m.rank) && m.rank >= ranks[0] && m.rank <= ranks[1]);
      const rankedHero = group && rankedAcc[group.key].get(p.h);
      const targets = [h];
      if (rankedHero) targets.push(rankedHero);
      if (p.pos >= 1 && p.pos <= 5) {
        targets.push(h.pos[p.pos] || (h.pos[p.pos] = newAcc()));
        if (rankedHero) targets.push(rankedHero.pos[p.pos] || (rankedHero.pos[p.pos] = newAcc()));
      }
      for (const a of targets) a.n++;
      const seen = new Set();
      for (const [t, id] of p.b) {
        if (!known.has(id)) continue;
        const ph = phaseOf(t);
        const k = ph + ':' + id;
        if (seen.has(k)) continue;
        seen.add(k);
        for (const a of targets) a.c[ph].set(id, (a.c[ph].get(id) || 0) + 1);
      }
    }
    if (used) matches++;
  }
}

function phases(a) {
  const min = Math.max(MIN_ABS, Math.ceil(a.n * MIN_SHARE));
  const rec = { n: a.n };
  for (const [ph] of PHASES) {
    rec[ph] = [...a.c[ph]].filter(([, g]) => g >= min).sort((x, y) => y[1] - x[1] || x[0] - y[0])
      .slice(0, TOP).map(([i, g]) => ({ i, g }));
  }
  return rec;
}
function serializeHeroes(source) {
  const heroes = {};
  let roleBlocks = 0;
  for (const [id, h] of source) {
    if (!h.n) continue;
    const rec = phases(h);
    rec.posN = {};
    rec.pos = {};
    for (const [k, a] of Object.entries(h.pos)) {
      rec.posN[k] = a.n;
      if (a.n >= MIN_ROLE) { rec.pos[k] = phases(a); roleBlocks++; }
    }
    heroes[id] = rec;
  }
  return { heroes, roleBlocks };
}
const { heroes, roleBlocks } = serializeHeroes(acc);
const ranked = Object.fromEntries(rankGroups.map(group =>
  [group.key, { heroes: serializeHeroes(rankedAcc[group.key]).heroes }]));

const missing = heroIds.filter(id => !heroes[id]);
const out = {
  source: 'Своя база матчей (Stratz, покупки по времени), патч ' + (patch.version || '?'),
  method: `фазы 0/10/25/40 мин; предмет показан, если куплен в ≥ max(${MIN_ABS}, ${MIN_SHARE * 100}% матчей героя); до ${TOP} на фазу; по роли — от ${MIN_ROLE} матчей`,
  minRole: MIN_ROLE,
  since, matchesUsed: matches, builtAt: new Date().toISOString(), heroes
};
require('./match-source.js').writeJsonAtomic(OUT, out);
require('./match-source.js').writeJsonAtomic(RANKED_OUT, { rankGroups, ranked });
const ns = Object.values(heroes).map(h => h.n).sort((a, b) => a - b);
console.log(`hero-items.json: ролей с покупками ${roleBlocks}, ${Object.keys(heroes).length} героев из ${heroIds.length}, матчей ${matches}, выборка на героя min ${ns[0]} / медиана ${ns[ns.length >> 1]} / max ${ns[ns.length - 1]}`);

// data/item-heroes.json — «предмет → герои, которые его покупают» (модалка предмета js/app.js, /item/, статьи о
// предметах) из этих же покупок вместо снимка OpenDota itemPopularity (решение владельца 11.10.2026, п. 3.2).
// g — сумма по фазам числа матчей героя с покупкой (как в прежнем формате), p — фаза, где покупают чаще всего.
{
  const PHASE_RU = { start: 'Старт', early: 'Ранняя', mid: 'Середина', late: 'Поздняя', vlate: 'Поздняя' };
  const names = new Map(read('heroes.json').heroes.map(h => [Number(h.id), h.localized_name]));
  const byItem = new Map();   // itemId -> heroId -> { g, ph: {Старт: n, …} }
  for (const [hid, h] of acc) {
    if (!h.n) continue;
    for (const [ph] of PHASES) for (const [iid, g] of h.c[ph]) {
      const per = byItem.get(iid) || byItem.set(iid, new Map()).get(iid);
      const r = per.get(hid) || per.set(hid, { g: 0, ph: {} }).get(hid);
      r.g += g; r.ph[PHASE_RU[ph]] = (r.ph[PHASE_RU[ph]] || 0) + g;
    }
  }
  const items = {};
  for (const [iid, per] of byItem) {
    const rows = [...per].map(([hid, r]) => ({ h: hid, n: names.get(hid) || String(hid), g: r.g,
      p: Object.entries(r.ph).sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.g - a.g);
    const totals = {};
    for (const r of per.values()) for (const [p, g] of Object.entries(r.ph)) totals[p] = (totals[p] || 0) + g;
    items[iid] = { heroes: rows.slice(0, 8), totals, games: rows.reduce((s, r) => s + r.g, 0), heroCount: rows.length };
  }
  if (Object.keys(items).length >= 50) require('./match-source.js').writeJsonAtomic(path.join(ROOT, 'data', 'item-heroes.json'), {
    source: 'Своя база матчей (Stratz, покупки по времени), патч ' + (patch.version || '?') + ', матчей ' + matches, builtAt: out.builtAt, items });
  else console.warn('item-heroes.json не обновлён: предметов мало (' + Object.keys(items).length + ')');
  console.log('item-heroes.json: предметов ' + Object.keys(items).length);
}
if (missing.length) { console.error('Нет покупок у героев:', missing.join(', ')); process.exit(1); }
