#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { steamRows, atomicJson } = require('./build-patch-snapshots');
const { createRowFilter, newCoverage, count } = require('./stats-cohort');

const clamp = p => Math.max(0.0001, Math.min(0.9999, p));
const logit = p => Math.log(clamp(p) / (1 - clamp(p)));
const logistic = x => 1 / (1 + Math.exp(-x));
const percent = p => Math.round(p * 1000) / 10;
const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

async function build(rows, { heroIds, patch, patchFrom, patchTo = Infinity, now = new Date() }) {
  const known = new Set(heroIds);
  if (!known.size || !Number.isInteger(patchFrom) || patchFrom <= 0 || !patch) throw new Error('Invalid patch or heroes');
  const filter = createRowFilter({ known, patchFrom, patchTo });
  const coverage = newCoverage(), heroes = new Map(heroIds.map(id => [id, { n: 0, w: 0 }]));
  const withPairs = new Map(), vsPairs = new Map();
  let from = Infinity, to = 0;
  for await (const row of rows) {
    const reason = filter(row); count(coverage, reason);
    if (reason) continue;
    from = Math.min(from, row[2]); to = Math.max(to, row[2]);
    const radiant = row.slice(9, 14).map(p => p[0]), dire = row.slice(14, 19).map(p => p[0]);
    for (const [team, won] of [[radiant, row[5] === 1], [dire, row[5] === 0]]) {
      for (const id of team) { const h = heroes.get(id); h.n++; h.w += Number(won); }
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
        const key = pairKey(team[i], team[j]), p = withPairs.get(key) || { n: 0, w: 0 };
        p.n++; p.w += Number(won); withPairs.set(key, p);
      }
    }
    for (const a of radiant) for (const b of dire) {
      const key = pairKey(a, b), p = vsPairs.get(key) || { n: 0, w: 0 };
      p.n++; p.w += Number(a < b ? row[5] === 1 : row[5] === 0); vsPairs.set(key, p);
    }
  }
  const sorted = [...known].sort((a, b) => a - b);
  const base = id => { const h = heroes.get(id); return h.n ? h.w / h.n : null; };
  const pairs = (map, kind) => [...map].map(([key, { n, w }]) => {
    const [a, b] = key.split(':').map(Number), pa = base(a), pb = base(b);
    const expected = pa === null || pb === null ? null : logistic(kind === 'with' ? logit(pa) + logit(pb) : logit(pa) - logit(pb));
    return { a, b, n, w, observed: n >= 300 ? percent(w / n) : null,
      expected: n >= 300 && expected !== null ? percent(expected) : null,
      delta: n >= 300 && expected !== null ? percent(w / n - expected) : null };
  }).sort((x, y) => x.a - y.a || x.b - y.b);
  const matches = coverage.accepted;
  return { schemaVersion: 1, builtAt: now.toISOString(), status: matches ? 'ok' : 'insufficient',
    meta: { source: 'steam', cohort: 'ranked-all-ranks', patch, patchFrom, patchTo: Number.isFinite(patchTo) ? patchTo : null,
      from: matches ? new Date(from * 1000).toISOString() : null, to: matches ? new Date(to * 1000).toISOString() : null,
      matches, players: matches * 10, methodVersion: 1, exclusions: coverage.excluded,
      coverage: { seen: coverage.seen }, minPairMatches: 300 },
    heroIds: sorted, orientation: 'a < b; vs.w is wins by a; with.w is joint wins',
    heroes: Object.fromEntries(sorted.map(id => [id, heroes.get(id)])),
    with: pairs(withPairs, 'with'), vs: pairs(vsPairs, 'vs') };
}

async function main() {
  const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const root = path.join(__dirname, '..'), fixture = args.includes('--fixture');
  const input = path.resolve(flag('--input-dir', path.join(root, fixture ? 'tools/fixtures/patch-snapshots' : 'data')));
  const output = path.resolve(flag('--out-dir', path.join(root, fixture ? 'outputs/d2pt-check/D' : 'data')));
  const notes = fixture ? JSON.parse(fs.readFileSync(path.join(input, 'patch-catalog.json'), 'utf8')).patches.at(-1)
    : JSON.parse(fs.readFileSync(path.join(input, 'patch-notes.json'), 'utf8'));
  const ids = JSON.parse(fs.readFileSync(path.join(input, 'heroes.json'), 'utf8')).heroes.map(h => Number(h.id));
  const rows = fixture ? (async function* () { yield* JSON.parse(fs.readFileSync(path.join(input, 'rows.json'), 'utf8')); })()
    : steamRows(path.join(input, 'steam-matches'));
  const result = await build(rows, { heroIds: ids, patch: notes.version, patchFrom: notes.timestamp });
  if (result.with.some(p => p.w > p.n) || result.vs.some(p => p.w > p.n)) throw new Error('Invalid pair counts');
  atomicJson(path.join(output, 'matchup-search.json'), result);
  console.log(`${result.meta.matches} ranked matches; ${result.with.length} with / ${result.vs.length} versus pairs`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { build };
