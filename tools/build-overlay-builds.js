#!/usr/bin/env node
// Позиционные сборки и связи покупок с героями противника из деталей Stratz.
const fs = require('fs');
const path = require('path');
const { metaMatches, writeJsonAtomic } = require('./match-source.js');

const ROOT = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
const patch = read('patch-notes.json');
const since = Number(patch.timestamp) || 0;
const excludedItems = new Set(['aghanims_shard', 'ultimate_scepter_2']);
const items = new Map(Object.entries(read('items-ru.json').items)
  .filter(([key, item]) => item.cost >= 1400 && item.cat === 'item' &&
    !excludedItems.has(key) && !key.startsWith('recipe_') && !key.includes('boots') && !item.recipeFor &&
    (!item.into?.length || item.comp?.length))
  .map(([key, item]) => [item.id, key]));
const groups = { all: () => true, low: rank => rank >= 10 && rank <= 49,
  high: rank => rank >= 50 && rank <= 89 };
const builds = {};
const baseline = new Map();
const facing = new Map();
let players = 0, matches = 0;

function bucket(hero, pos, group) {
  const role = builds[hero] ||= {};
  const slice = role[pos] ||= {};
  return slice[group] ||= { n: 0, items: new Map() };
}
function add(map, ids) {
  for (const id of ids) map.set(id, (map.get(id) || 0) + 1);
}
for (const match of metaMatches()) {
  if (match.t < since || !Array.isArray(match.p)) continue;
  let used = false;
  for (const player of match.p) {
    if (!Array.isArray(player.b) || !player.b.length) continue;
    used = true;
    const first = new Map();
    for (const [seconds, id] of player.b) {
      if (!items.has(id) || !Number.isFinite(seconds)) continue;
      if (!first.has(id) || seconds < first.get(id)) first.set(id, seconds);
    }
    const ids = [...first.keys()];
    players++;
    add(baseline, ids);
    for (const enemy of match.p) {
      if (enemy.r === player.r || !Number.isInteger(enemy.h)) continue;
      const row = facing.get(enemy.h) || { n: 0, items: new Map() };
      row.n++;
      add(row.items, ids);
      facing.set(enemy.h, row);
    }
    if (!Number.isInteger(player.h) || !(player.pos >= 1 && player.pos <= 5)) continue;
    for (const [group, includes] of Object.entries(groups)) {
      if (!includes(match.rank)) continue;
      const row = bucket(player.h, player.pos, group);
      row.n++;
      for (const [id, seconds] of first) {
        const times = row.items.get(id) || [];
        times.push(seconds / 60);
        row.items.set(id, times);
      }
    }
  }
  if (used) matches++;
}
const round = x => Math.round(x * 1000) / 1000;
const percentile = (sorted, p) => {
  const at = (sorted.length - 1) * p, lo = Math.floor(at);
  return round(sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo));
};
for (const [hero, roles] of Object.entries(builds)) {
  for (const [pos, slices] of Object.entries(roles)) {
    if (!slices.all || slices.all.n < 100) { delete roles[pos]; continue; }
    for (const [group, row] of Object.entries(slices)) {
      if (row.n < 100) { delete slices[group]; continue; }
      const core = [...row.items].filter(([, times]) => times.length / row.n >= 0.2)
        .map(([id, times]) => {
          times.sort((a, b) => a - b);
          return { id, key: items.get(id), share: round(times.length / row.n),
            t: [percentile(times, 0.25), percentile(times, 0.5), percentile(times, 0.75)] };
        }).sort((a, b) => a.t[1] - b.t[1] || b.share - a.share || a.id - b.id).slice(0, 8);
      slices[group] = { n: row.n, core };
    }
  }
  if (!Object.keys(roles).length) delete builds[hero];
}
const vsEnemy = {};
for (const [hero, row] of facing) {
  if (row.n < 300) continue;
  const recommendations = [...row.items].map(([id, count]) => {
    const share = count / row.n, base = (baseline.get(id) || 0) / players;
    return { id, key: items.get(id), share: round(share), base: round(base), uplift: round(share - base), raw: share - base };
  }).filter(item => item.raw >= 0.03)
    .sort((a, b) => b.uplift - a.uplift || a.id - b.id).slice(0, 6);
  if (recommendations.length) vsEnemy[hero] = recommendations.map(({ raw, ...item }) => item);
}
const out = { meta: { patch: patch.version || '?', builtAt: new Date().toISOString(),
  source: 'Stratz', matches, method: 'Покупки от 20% игроков; порядок по медиане первой покупки; против врага — связь, не причина.' },
builds, vsEnemy };
writeJsonAtomic(path.join(ROOT, 'data', 'overlay-builds.json'), out);
console.log(`overlay-builds.json: ${matches} матчей, ${Object.keys(builds).length} героев, ${Object.keys(vsEnemy).length} врагов`);
