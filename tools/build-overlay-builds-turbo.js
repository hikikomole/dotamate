#!/usr/bin/env node
// Separate process: Steam final inventories, never purchase times or inferred roles.
const fs = require('fs');
const path = require('path');
const { steamStream, writeJsonAtomic } = require('./match-source');
const DATA = path.join(__dirname, '..', 'data');
const read = name => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const round = n => Math.round(n * 1000) / 1000;
const add = (map, id) => map.set(id, (map.get(id) || 0) + 1);

async function main(options = {}) {
  const patch = read('patch-notes.json'), since = Number(patch.timestamp) || 0;
  const index = options.index || read('ability-index.json').abilities;
  const items = new Map(Object.entries(read('items-ru.json').items)
    .filter(([key, item]) => item.cat === 'item' && item.cost >= 1400 && !key.startsWith('recipe_'))
    .map(([key, item]) => [item.id, key]));
  const heroes = new Map(), baseline = new Map(), facing = new Map();
  let matches = 0, players = 0, first = Infinity, last = 0;
  for await (const r of options.rows || steamStream({ turbo: true })) {
    if (r[6] !== 23 || !Number.isFinite(r[2]) || r[2] < since) continue;
    const roster = r.slice(9, 19).filter(p => Array.isArray(p) && Number.isInteger(p[0]) && p[0] > 0);
    if (!roster.length) continue;
    matches++; first = Math.min(first, r[2]); last = Math.max(last, r[2]);
    for (const p of roster) {
      const hero = heroes.get(p[0]) || { n: 0, items: new Map(), seq: new Map() };
      heroes.set(p[0], hero);
      const up = p[22];
      if (Array.isArray(up) && up.length >= 20) {
        const seq = Array.from({ length: 10 }, (_, i) => up[i * 2]);
        if (seq.every(id => index[id]?.name)) add(hero.seq, seq.join(','));
      }
      // Old/missing inventories are not evidence that a player owned no items.
      if (!Array.isArray(p[14])) continue;
      const ids = new Set([...p[14], ...(Array.isArray(p[15]) ? p[15] : [])].filter(id => items.has(id)));
      hero.n++; players++;
      for (const id of ids) { add(hero.items, id); add(baseline, id); }
      for (const enemy of roster) {
        if ((enemy[1] < 128) === (p[1] < 128)) continue;
        const row = facing.get(enemy[0]) || { n: 0, items: new Map() };
        facing.set(enemy[0], row); row.n++;
        for (const id of ids) add(row.items, id);
      }
    }
  }
  const builds = {}, skills = {}, vsEnemy = {};
  for (const [id, hero] of heroes) {
    if (hero.n >= 100) builds[id] = { 0: { all: { n: hero.n,
      core: [...hero.items].filter(([, n]) => n / hero.n >= 0.2)
        .map(([id, n]) => ({ id, key: items.get(id), share: round(n / hero.n), t: null }))
        .sort((a, b) => b.share - a.share || a.id - b.id).slice(0, 8) } } };
    const popular = [...hero.seq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (popular && popular[1] >= 30) skills[id] = { 0: { source: 'Steam', n: popular[1],
      levels: popular[0].split(',').map(id => ({ key: index[id].name, talent: !!index[id].isTalent })) } };
  }
  for (const [hero, row] of facing) {
    if (row.n < 300) continue;
    const list = [...row.items].map(([id, n]) => {
      const share = n / row.n, base = (baseline.get(id) || 0) / players;
      return { id, key: items.get(id), share: round(share), base: round(base), uplift: round(share - base), raw: share - base };
    }).filter(x => x.raw >= 0.03).sort((a, b) => b.raw - a.raw || a.id - b.id).slice(0, 6);
    if (list.length) vsEnemy[hero] = list.map(({ raw, ...item }) => item);
  }
  const out = { meta: { mode: 'turbo', source: 'Steam Web API: final inventories + ability_upgrades',
    patch: patch.version || '?', builtAt: new Date().toISOString(), timings: false, matches,
    firstMatchAt: matches ? new Date(first * 1000).toISOString() : null,
    lastMatchAt: matches ? new Date(last * 1000).toISOString() : null,
    method: 'Final inventory (including backpack); share of players, not purchase order; pos=0; association, not causation.' },
  builds, vsEnemy, skills };
  if (options.write !== false) {
    if (!Object.keys(builds).length) throw new Error('No eligible Turbo builds; previous file preserved');
    writeJsonAtomic(options.out || path.join(DATA, 'overlay-builds-turbo.json'), out);
  }
  console.log(`overlay-builds-turbo.json: ${matches} matches, ${Object.keys(builds).length} heroes`);
  return out;
}
if (require.main === module) {
  const at = process.argv.indexOf('--out');
  if (at >= 0 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
    console.error('--out requires a path'); process.exit(2);
  }
  main({ out: at >= 0 ? process.argv[at + 1] : undefined }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { main };
