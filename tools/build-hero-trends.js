#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./match-source');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing ' + name);
  return path.resolve(args[i + 1]);
}
const input = option('--input-dir', path.join(root, 'private-archive', 'patch-stats'));
const output = option('--out-dir', path.join(root, 'data'));
const patchFile = option('--patch-file', path.join(root, 'data', 'patch-notes.json'));
const patchData = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
const patch = patchData.version;
const patchFrom = Number(patchData.timestamp);
if (!Number.isSafeInteger(patchFrom) || patchFrom <= 0) throw new Error('Invalid patch boundary');
if (!/^[\w.-]+$/.test(patch)) throw new Error('Invalid current patch');
const snapshot = JSON.parse(fs.readFileSync(path.join(input, patch + '.json'), 'utf8'));
if (snapshot.schemaVersion !== 1 || snapshot.meta?.source !== 'steam' ||
    snapshot.meta?.cohort !== 'ranked-all-ranks' || snapshot.meta?.patch !== patch ||
    snapshot.meta?.patchFrom !== patchFrom ||
    !snapshot.days || typeof snapshot.days !== 'object') throw new Error('Invalid snapshot provenance');

const today = new Date().toISOString().slice(0, 10);
const dayAt = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
const windows = [
  { from: dayAt(6), to: dayAt(4), matches: 0 },
  { from: dayAt(3), to: dayAt(1), matches: 0 }
];
const counts = [new Map(), new Map()];
for (let i = 0; i < 2; i++) {
  for (let offset = i ? 3 : 6; offset >= (i ? 1 : 4); offset--) {
    const day = snapshot.days[dayAt(offset)];
    if (!day) continue;
    if (!Number.isSafeInteger(day.matches) || day.matches < 0 || !day.heroes || typeof day.heroes !== 'object') throw new Error('Invalid day');
    windows[i].matches += day.matches;
    let picks = 0;
    for (const [id, value] of Object.entries(day.heroes)) {
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(value.n) || value.n < 0 ||
          !Number.isSafeInteger(value.w) || value.w < 0 || value.w > value.n) throw new Error('Invalid hero count');
      counts[i].set(id, (counts[i].get(id) || 0) + value.n);
      picks += value.n;
    }
    if (picks !== day.matches * 10) throw new Error('Day hero totals mismatch');
  }
}
const heroes = [...new Set([...counts[0].keys(), ...counts[1].keys()])].map(id => {
  const picksBefore = counts[0].get(id) || 0, picksAfter = counts[1].get(id) || 0;
  const rateBefore = windows[0].matches ? 100 * picksBefore / windows[0].matches : null;
  const rateAfter = windows[1].matches ? 100 * picksAfter / windows[1].matches : null;
  return { id: Number(id), picksBefore, picksAfter, rateBefore, rateAfter,
    deltaPp: rateBefore === null || rateAfter === null ? null : rateAfter - rateBefore };
}).filter(h => h.picksBefore >= 30 && h.picksAfter >= 30)
  .sort((a, b) => b.deltaPp - a.deltaPp || a.id - b.id);
const result = { schemaVersion: 1,
  status: windows.every(w => w.matches >= 300) && heroes.length ? 'ok' : 'insufficient',
  builtAt: new Date().toISOString(),
  meta: { source: 'steam', cohort: 'ranked-all-ranks', patch, patchFrom, from: windows[0].from, to: windows[1].to },
  windows, heroes };
fs.mkdirSync(output, { recursive: true });
writeJsonAtomic(path.join(output, 'hero-trends.json'), JSON.stringify(result, null, 2) + '\n');
console.log('hero-trends.json: ' + result.status);
