#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { createRowFilter, newCoverage, count } = require('./stats-cohort');

function boundaries(catalog) {
  const patches = Array.isArray(catalog.patches) ? catalog.patches : [];
  if (!patches.length) throw new Error('No verified patch boundaries');
  const ordered = patches.map(p => ({ version: String(p.version || ''), timestamp: Number(p.timestamp) }))
    .sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    if (!/^[\w.-]+$/.test(p.version) || !Number.isInteger(p.timestamp) || p.timestamp <= 0 ||
        (i && p.timestamp <= ordered[i - 1].timestamp)) throw new Error('Invalid patch catalog');
  }
  return ordered;
}

async function buildSnapshot(rows, patch, next, known, now = new Date()) {
  const filter = createRowFilter({ known, patchFrom: patch.timestamp, patchTo: next ? next.timestamp : Infinity });
  const coverage = newCoverage(), days = new Map();
  let from = Infinity, to = 0;
  for await (const row of rows) {
    const reason = filter(row);
    count(coverage, reason);
    if (reason) continue;
    const day = new Date(row[2] * 1000).toISOString().slice(0, 10);
    const bucket = days.get(day) || { matches: 0, radiantWins: 0, heroes: {} };
    bucket.matches++; bucket.radiantWins += row[5];
    row.slice(9, 19).forEach((player, index) => {
      const id = player[0];
      const h = bucket.heroes[id] || { n: 0, w: 0 };
      h.n++; h.w += (index < 5) === (row[5] === 1) ? 1 : 0;
      bucket.heroes[id] = h;
    });
    days.set(day, bucket);
    from = Math.min(from, row[2]); to = Math.max(to, row[2]);
  }
  const matches = coverage.accepted;
  return { schemaVersion: 1, builtAt: now.toISOString(), status: matches ? 'ok' : 'insufficient',
    meta: { source: 'steam', cohort: 'ranked-all-ranks', patch: patch.version, patchFrom: patch.timestamp,
      patchTo: next ? next.timestamp : null, from: matches ? new Date(from * 1000).toISOString() : null,
      to: matches ? new Date(to * 1000).toISOString() : null, matches, players: matches * 10,
      methodVersion: 1, exclusions: coverage.excluded, coverage: { seen: coverage.seen } },
    days: Object.fromEntries([...days].sort(([a], [b]) => a.localeCompare(b))) };
}

async function* steamRows(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter(n => /^\d{4}-\d\d-\d\d\.jsonl\.gz$/.test(n)).sort()) {
    const stream = fs.createReadStream(path.join(dir, name)).pipe(zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH }));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try { yield JSON.parse(line); } catch { throw new Error('Invalid Steam row in ' + name); }
    }
  }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

async function main() {
  const args = process.argv.slice(2), arg = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
  const root = path.join(__dirname, '..');
  const fixture = args.includes('--fixture');
  const input = path.resolve(arg('--input-dir', fixture ? path.join(root, 'tools', 'fixtures', 'patch-snapshots') : path.join(root, 'data')));
  const output = path.resolve(arg('--out-dir', fixture ? path.join(root, 'outputs', 'd2pt-check', 'C') : arg('--archive-dir', path.join(root, 'private-archive'))));
  if (!fixture && (output === path.join(root, 'data') || output.startsWith(path.join(root, 'data') + path.sep) ||
      output === path.join(root, 'deploy') || output.startsWith(path.join(root, 'deploy') + path.sep))) throw new Error('Private snapshots cannot be written to public data');
  const catalog = boundaries(JSON.parse(fs.readFileSync(path.join(input, 'patch-catalog.json'), 'utf8')));
  const heroData = JSON.parse(fs.readFileSync(path.join(input, 'heroes.json'), 'utf8'));
  const known = new Set((heroData.heroes || heroData).map(h => Number(h.id)));
  if (!known.size) throw new Error('Empty hero catalog');
  const patchDir = path.join(output, 'patch-stats');
  const steamDir = path.join(input, 'steam-matches');
  if (!fixture && !fs.existsSync(steamDir)) throw new Error('Steam input directory missing');
  if (!fixture && !fs.readdirSync(steamDir).some(n => /^\d{4}-\d\d-\d\d\.jsonl\.gz$/.test(n))) throw new Error('No Steam input files');
  const signature = () => fixture ? '' : fs.readdirSync(steamDir).filter(n => n.endsWith('.jsonl.gz')).sort()
    .map(n => { const s = fs.statSync(path.join(steamDir, n)); return `${n}:${s.size}:${s.mtimeMs}`; }).join('|');
  for (let i = 0; i < catalog.length; i++) {
    const patch = catalog[i], next = catalog[i + 1] || null;
    const file = path.join(patchDir, patch.version + '.json');
    // Closed snapshots are immutable; a new reader cannot silently revise history.
    if (next && fs.existsSync(file)) {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (previous.meta && previous.meta.patchTo === next.timestamp) continue;
    }
    const before = signature();
    const sourceRows = fixture
      ? (async function* () { for (const row of JSON.parse(fs.readFileSync(path.join(input, 'rows.json'), 'utf8'))) yield row; })()
      : steamRows(path.join(input, 'steam-matches'));
    const result = await buildSnapshot(sourceRows, patch, next, known);
    if (signature() !== before) throw new Error('Steam input changed during snapshot read');
    if (result.meta.matches !== Object.values(result.days).reduce((n, d) => n + d.matches, 0)) throw new Error('Snapshot count mismatch');
    atomicJson(file, result);
    console.log(patch.version + ': ' + result.meta.matches + ' matches');
  }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { boundaries, buildSnapshot, atomicJson, steamRows };
