#!/usr/bin/env node
// Позиционные сборки и связи покупок: Stratz + свои реплеи (источники размечены).
const fs = require('fs');
const path = require('path');
const { rankedMetaStream, writeJsonAtomic } = require('./match-source.js');

const { replayMatches } = require('./overlay-replays');

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
async function main(useReplays = true, options = {}) {
const builds = {};
const baseline = new Map();
const facing = new Map();
let players = 0, matches = 0;
const sources = { stratz: 0, replays: 0 };

function bucket(hero, pos, group) {
  const role = builds[hero] ||= {};
  const slice = role[pos] ||= {};
  return slice[group] ||= { n: 0, src: { s: 0, r: 0 }, items: new Map() };
}
function add(map, ids) {
  for (const id of ids) map.set(id, (map.get(id) || 0) + 1);
}
function consume(match, source) {
  if (!Number.isFinite(match.t) || match.t < since || !Array.isArray(match.p)) return;
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
    for (const enemy of match.enemies || match.p) {
      if (enemy.r === player.r || !Number.isInteger(enemy.h)) continue;
      const row = facing.get(enemy.h) || { n: 0, items: new Map() };
      row.n++;
      add(row.items, ids);
      facing.set(enemy.h, row);
    }
    if (!Number.isInteger(player.h)) continue;
    for (const [group, includes] of Object.entries(groups)) {
      if (!includes(match.rank)) continue;
      for (const pos of [0, ...(player.pos >= 1 && player.pos <= 5 ? [player.pos] : [])]) {
        const row = bucket(player.h, pos, group);
        row.n++;
        row.src[source]++;
        for (const [id, seconds] of first) {
          const times = row.items.get(id) || { length: 0, chunks: [], extra: null };
          const at = times.length++;
          if (at % 256 === 0) times.chunks.push(new Uint16Array(256));
          if (Number.isInteger(seconds) && seconds >= 0 && seconds <= 65535) {
            times.chunks[at >>> 8][at % 256] = seconds;
          } else {
            (times.extra ||= new Map()).set(at, seconds);
          }
          row.items.set(id, times);
        }
      }
    }
  }
  if (used) { matches++; sources[source === 's' ? 'stratz' : 'replays']++; }
}
const seen = new Set();
for await (const match of rankedMetaStream(options)) {
  seen.add(String(match.id));
  consume(match, 's');
}
if (useReplays) {
  try {
    const itemIds = new Map([...items].map(([id, key]) => [key, id]));
    for await (const match of replayMatches({ since, seen, itemIds, ...options.replay })) consume(match, 'r');
  } catch (error) {
    console.log(`Ошибка чтения реплеев (${error.code || error.message}); пересборка только Stratz.`);
    for (const hero of Object.keys(builds)) delete builds[hero];
    baseline.clear(); facing.clear(); seen.clear();
    return main(false, options); // Отбрасываем даже уже прочитанную часть архива.
  }
}
seen.clear();
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
          // Preserve division before interpolation and the original 0.001 minute rounding.
          const sorted = new Float64Array(times.length);
          for (let i = 0; i < sorted.length; i++) sorted[i] =
            (times.extra?.get(i) ?? times.chunks[i >>> 8][i % 256]) / 60;
          sorted.sort();
          times.chunks = null;
          times.extra = null;
          return { id, key: items.get(id), share: round(times.length / row.n),
            t: [percentile(sorted, 0.25), percentile(sorted, 0.5), percentile(sorted, 0.75)] };
        }).sort((a, b) => a.t[1] - b.t[1] || b.share - a.share || a.id - b.id).slice(0, 8);
      slices[group] = { n: row.n, src: row.src, core };
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
  source: sources.replays ? 'Stratz + свои реплеи' : 'Stratz', sources, matches,
  method: sources.replays ? 'Stratz + свои реплеи; позиции в реплеях определены по карте — приблизительно' :
    'Покупки от 20% игроков; порядок по медиане первой покупки; против врага — связь, не причина.' },
builds, vsEnemy };
try {
  const chains = read('skill-chains.json').heroes;
  const index = read('ability-index.json').abilities;
  out.skills = {};
  for (const [hero, positions] of Object.entries(chains)) {
    for (const [pos, row] of Object.entries(positions)) {
      const seq = row.popular?.seq;
      if (!Array.isArray(seq) || !seq.length || !seq.every(id => index[id]?.name)) continue;
      (out.skills[hero] ||= {})[pos.replace('POSITION_', '')] = {
        source: 'Steam', n: row.popular.matches,
        levels: seq.map(id => ({ key: index[id].name, talent: !!index[id].isTalent }))
      };
    }
  }
} catch (e) { console.warn('Прокачка Steam недоступна: ' + e.message); }
if (options.write !== false) {
  if (!Object.keys(builds).length) throw new Error('No eligible ranked builds; previous file preserved');
  writeJsonAtomic(options.out || path.join(ROOT, 'data', 'overlay-builds.json'), out);
}
console.log(`overlay-builds.json: ${matches} матчей, ${Object.keys(builds).length} героев, ${Object.keys(vsEnemy).length} врагов`);

return out;
}
if (require.main === module) {
  const outAt = process.argv.indexOf('--out');
  if (outAt >= 0 && (!process.argv[outAt + 1] || process.argv[outAt + 1].startsWith('--'))) {
    console.error('--out requires a path'); process.exit(2);
  }
  main(true, { out: outAt >= 0 ? process.argv[outAt + 1] : undefined })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { main };
