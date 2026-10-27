#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { steamRows, atomicJson } = require('./build-patch-snapshots');
const { createRowFilter, newCoverage, count } = require('./stats-cohort');

const BOUNDS = [900, 1500, 2100, 2700, Infinity];
const KEYS = ['15–25', '25–35', '35–45', '45+'];
const pct = (w, n) => Math.round(w / n * 1000) / 10;
async function build(rows, { heroIds, patch, patchFrom, patchTo = Infinity, now = new Date() }) {
  const known = new Set(heroIds);
  if (!known.size || !patch || !Number.isInteger(patchFrom) || patchFrom <= 0) throw new Error('Invalid patch or heroes');
  const filter = createRowFilter({ known, patchFrom, patchTo }), coverage = newCoverage();
  const duration = KEYS.map(key => ({ key, n: 0, radiantWins: 0, radiantWr: null }));
  const heroes = new Map(heroIds.map(id => [id, { radiant: { n: 0, w: 0 }, dire: { n: 0, w: 0 } }]));
  let from = Infinity, to = 0;
  for await (const row of rows) {
    const reason = filter(row); count(coverage, reason);
    if (reason) continue;
    from = Math.min(from, row[2]); to = Math.max(to, row[2]);
    const bucket = duration.findIndex((_, i) => row[3] >= BOUNDS[i] && row[3] < BOUNDS[i + 1]);
    duration[bucket].n++; duration[bucket].radiantWins += row[5];
    row.slice(9, 19).forEach((player, i) => {
      const side = i < 5 ? 'radiant' : 'dire', h = heroes.get(player[0])[side];
      h.n++; h.w += Number(i < 5 ? row[5] === 1 : row[5] === 0);
    });
  }
  for (const d of duration) d.radiantWr = d.n >= 300 ? pct(d.radiantWins, d.n) : null;
  const heroRows = [...heroes].sort(([a], [b]) => a - b).map(([id, h]) => ({ id,
    radiant: { ...h.radiant, wr: h.radiant.n >= 100 ? pct(h.radiant.w, h.radiant.n) : null },
    dire: { ...h.dire, wr: h.dire.n >= 100 ? pct(h.dire.w, h.dire.n) : null },
    delta: h.radiant.n >= 100 && h.dire.n >= 100 ? Math.round((h.radiant.w / h.radiant.n - h.dire.w / h.dire.n) * 1000) / 10 : null }));
  const matches = coverage.accepted;
  return { schemaVersion: 1, builtAt: now.toISOString(), status: matches ? 'ok' : 'insufficient',
    meta: { source: 'steam', cohort: 'ranked-all-ranks', patch, patchFrom, patchTo: Number.isFinite(patchTo) ? patchTo : null,
      from: matches ? new Date(from * 1000).toISOString() : null, to: matches ? new Date(to * 1000).toISOString() : null,
      matches, players: matches * 10, methodVersion: 1, exclusions: coverage.excluded, coverage: { seen: coverage.seen } },
    duration, heroes: heroRows, lanes: { status: 'unavailable', reason: 'Requires independently labeled replay economy at 10 minutes' } };
}
async function main() {
  const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const root = path.join(__dirname, '..'), fixture = args.includes('--fixture');
  const input = path.resolve(flag('--input-dir', path.join(root, fixture ? 'tools/fixtures/patch-snapshots' : 'data')));
  const output = path.resolve(flag('--out-dir', path.join(root, fixture ? 'outputs/d2pt-check/F' : 'data')));
  const notes = fixture ? JSON.parse(fs.readFileSync(path.join(input, 'patch-catalog.json'), 'utf8')).patches.at(-1)
    : JSON.parse(fs.readFileSync(path.join(input, 'patch-notes.json'), 'utf8'));
  const ids = JSON.parse(fs.readFileSync(path.join(input, 'heroes.json'), 'utf8')).heroes.map(h => Number(h.id));
  const rows = fixture ? (async function* () { yield* JSON.parse(fs.readFileSync(path.join(input, 'rows.json'), 'utf8')); })()
    : steamRows(path.join(input, 'steam-matches'));
  const result = await build(rows, { heroIds: ids, patch: notes.version, patchFrom: notes.timestamp });
  if (result.duration.reduce((n, d) => n + d.n, 0) !== result.meta.matches) throw new Error('Duration count mismatch');
  atomicJson(path.join(output, 'side-stats.json'), result);
  console.log(`${result.meta.matches} ranked matches`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { build };
