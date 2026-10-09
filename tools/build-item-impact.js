#!/usr/bin/env node
/**
 * Вариант Б помощника DraftMate: как связана покупка предмета героем с победой.
 *
 * Источник: data/meta-matches/*.jsonl — детальные матчи Stratz из своей базы (покупки с временем, исход),
 * ранги — какие есть в выборке (распределение пишется в файл). Ники и аккаунты не читаются.
 *
 * Метод для пары «герой + предмет» (предметы дороже MIN_COST, без расходников):
 *   T — медиана времени первой покупки предмета этим героем;
 *   «купил» — матчи, где предмет куплен не позже T; «не купил» — матчи длиннее T, где предмета не было вовсе
 *   (поздние покупки не входят ни туда, ни туда, чтобы не путать «купил, потому что выигрывал»);
 *   эффект = доля побед «купил» − доля побед «не купил», обе сглажены к доле побед героя (K = 50), в п.п.
 * Пара попадает в файл, только если в обеих группах не меньше MIN_N матчей и T ≤ MAX_T (20 мин).
 * Это наблюдение, а не эксперимент: у любого купленного вовремя предмета доля побед выше — купивший просто
 * лучше фармит (по данным 02.10.2026 медиана «эффекта» по всем парам +5…+7 п.п.). Поэтому на сайт идёт
 * относительный эффект: эффект предмета минус медиана эффектов всех предметов этого героя (нужно ≥ MIN_ITEMS
 * предметов). Он отвечает на вопрос «какой из предметов героя сильнее связан с победой», а не «сколько даёт
 * предмет». На сайте поправка показывается отдельно от откалиброванного прогноза по драфту.
 *
 * Выход: data/item-impact.json. Запуск: node tools/build-item-impact.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = f => path.join(ROOT, 'data', f);
const MIN_COST = 1000, MIN_N = 100, K = 50, MAX_T = 1200, MIN_ITEMS = 3;

const ITEMS = JSON.parse(fs.readFileSync(D('items-ru.json'), 'utf8')).items;
const byId = new Map(Object.entries(ITEMS).map(([key, v]) => [Number(v.id), { key, cost: v.cost || 0 }]));

const H = new Map(); // hero -> { n, w, items: Map(itemId -> [[t, win, dur]]) , games: [[win, dur, Set(items)]] }
let matches = 0; const ranks = {};
for (const f of fs.readdirSync(D('meta-matches')).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(D('meta-matches'), f), 'utf8').split('\n')) {
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (!m.p || m.p.length !== 10 || !m.dur) continue;
    matches++; const g = Math.floor((m.rank || 0) / 10); ranks[g] = (ranks[g] || 0) + 1;
    for (const p of m.p) {
      const win = (p.r === 1) === (m.rw === 1) ? 1 : 0;
      const h = H.get(p.h) || { n: 0, w: 0, games: [] }; H.set(p.h, h);
      h.n++; h.w += win;
      const first = new Map();
      for (const [t, id] of p.b || []) { const it = byId.get(id); if (it && it.cost >= MIN_COST && !first.has(id)) first.set(id, t); }
      h.games.push([win, m.dur, first]);
    }
  }
}
const out = {};
let pairs = 0;
for (const [hero, h] of H) {
  const base = h.w / h.n;
  const sm = (w, n) => (w + K * base) / (n + K);
  const times = new Map();
  for (const [, , first] of h.games) for (const [id, t] of first) (times.get(id) || times.set(id, []).get(id)).push(t);
  for (const [id, ts] of times) {
    if (ts.length < MIN_N) continue;
    ts.sort((a, b) => a - b); const T = ts[Math.floor(ts.length / 2)];
    let bn = 0, bw = 0, nn = 0, nw = 0;
    for (const [win, dur, first] of h.games) {
      if (first.has(id)) { if (first.get(id) <= T) { bn++; bw += win; } }
      else if (dur >= T) { nn++; nw += win; }
    }
    if (T > MAX_T || bn < MIN_N || nn < MIN_N) continue;
    (out[hero] || (out[hero] = {}))[byId.get(id).key] = [(sm(bw, bn) - sm(nw, nn)) * 100, bn, nn, T];
  }
}
for (const hero of Object.keys(out)) {
  const keys = Object.keys(out[hero]);
  if (keys.length < MIN_ITEMS) { delete out[hero]; continue; }
  const e = keys.map(k => out[hero][k][0]).sort((a, b) => a - b);
  const med = e.length % 2 ? e[e.length >> 1] : (e[e.length / 2 - 1] + e[e.length / 2]) / 2;
  for (const k of keys) { const v = out[hero][k]; out[hero][k] = [Math.round((v[0] - med) * 10) / 10, v[1], v[2], v[3], Math.round(v[0] * 10) / 10]; pairs++; }
}
fs.writeFileSync(D('item-impact.json'), JSON.stringify({
  builtAt: new Date().toISOString(),
  source: 'Детальные матчи Stratz из своей базы (data/meta-matches)',
  method: 'эффект = доля побед «купил до медианы времени покупки T» − «не покупал», сглажено к доле побед героя (K=' + K + '), п.п.; относительный = эффект − медиана эффектов предметов героя; не меньше ' + MIN_N + ' матчей в каждой группе; предметы от ' + MIN_COST + ' золота, T ≤ ' + MAX_T + ' с',
  format: 'heroes[heroId][item] = [относительный эффект п.п., матчей «купил», матчей «не покупал», T сек, сырой эффект п.п.]',
  matches, ranks, minN: MIN_N, heroes: out
}));
console.log('item-impact.json:', matches, 'матчей, пар герой+предмет:', pairs, ', героев:', Object.keys(out).length, ', ранги:', JSON.stringify(ranks));
