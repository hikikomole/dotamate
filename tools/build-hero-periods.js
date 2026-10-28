#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./match-source');
const { currentPatch } = require('./stats-cohort');

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
const { version: patch, timestamp: patchFrom } = currentPatch(
  JSON.parse(fs.readFileSync(option('--catalog-file', path.join(root, 'data', 'patch-catalog.json')), 'utf8')),
  patchData.version);
const snapshot = JSON.parse(fs.readFileSync(path.join(input, patch + '.json'), 'utf8'));
if (snapshot.schemaVersion !== 1 || snapshot.meta?.source !== 'steam' ||
    snapshot.meta?.cohort !== 'ranked-all-ranks' || snapshot.meta?.patch !== patch ||
    snapshot.meta?.patchFrom !== patchFrom || !snapshot.days || typeof snapshot.days !== 'object' ||
    Array.isArray(snapshot.days)) throw new Error('Invalid snapshot provenance');

const dayMs = 86400000;
const today = new Date().toISOString().slice(0, 10);
const to = new Date(Date.parse(today + 'T00:00:00Z') - dayMs);
const patchStart = new Date(patchFrom * 1000).toISOString().slice(0, 10);
const key = date => date.toISOString().slice(0, 10);
const fromDays = days => key(new Date(to.getTime() - (days - 1) * dayMs));
function wilson(n, w) {
  if (!n) return { low: null, high: null };
  const z = 1.959963984540054, p = w / n, z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return { low: 100 * (center - half), high: 100 * (center + half) };
}
function period(name, start) {
  const from = start > patchStart ? start : patchStart;
  const expectedDays = Math.max(0, Math.round((to - new Date(from + 'T00:00:00Z')) / dayMs) + 1);
  const previousEnd = new Date(Date.parse(from + 'T00:00:00Z') - dayMs);
  const previousFrom = key(new Date(previousEnd.getTime() - (expectedDays - 1) * dayMs));
  const previousValid = expectedDays > 0 && previousFrom >= patchStart &&
    Array.from({ length: expectedDays }, (_, i) => key(new Date(Date.parse(previousFrom + 'T00:00:00Z') + i * dayMs)))
      .every(d => snapshot.days[d]);
  let prevMatches = 0;
  const previous = new Map();
  if (previousValid) for (let t = Date.parse(previousFrom + 'T00:00:00Z'); t <= previousEnd.getTime(); t += dayMs) {
    const day = snapshot.days[key(new Date(t))];
    prevMatches += day.matches;
    for (const [id, h] of Object.entries(day.heroes)) {
      const sum = previous.get(id) || { n: 0, w: 0 };
      sum.n += h.n; sum.w += h.w; previous.set(id, sum);
    }
  }
  let observedDays = 0, matches = 0;
  const days = [];
  const heroes = new Map();
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= to.getTime(); t += dayMs) {
    const day = snapshot.days[key(new Date(t))];
    if (!day) continue;
    if (!Number.isSafeInteger(day.matches) || day.matches < 0 || !day.heroes ||
        typeof day.heroes !== 'object' || Array.isArray(day.heroes)) throw new Error('Invalid day');
    observedDays++; matches += day.matches; days.push(key(new Date(t)));
    let picks = 0;
    for (const [id, h] of Object.entries(day.heroes)) {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(h.n) || h.n < 0 ||
          !Number.isSafeInteger(h.w) || h.w < 0 || h.w > h.n) throw new Error('Invalid hero count');
      const sum = heroes.get(id) || { id: Number(id), n: 0, w: 0, series: { n: [], w: [] } };
      sum.n += h.n; sum.w += h.w; heroes.set(id, sum); picks += h.n;
    }
    if (picks !== day.matches * 10) throw new Error('Day hero totals mismatch');
  }
  for (const h of heroes.values()) {
    h.series.n = days.map(d => snapshot.days[d].heroes[h.id]?.n || 0);
    h.series.w = days.map(d => snapshot.days[d].heroes[h.id]?.w || 0);
  }
  const coverage = expectedDays ? observedDays / expectedDays : 0;
  return { from, to: key(to), days, observedDays, matches, coverage,
    available: coverage >= .7 && matches >= 1000,
    heroes: [...heroes.values()].map(h => ({ ...h, pickRate: matches ? Math.round(10000 * h.n / matches) / 100 : null,
      wr: h.n ? Math.round(10000 * h.w / h.n) / 100 : null,
      ...Object.fromEntries(Object.entries(wilson(h.n, h.w)).map(([k, v]) => [k, v == null ? null : Math.round(v * 100) / 100])),
      prevN: previousValid ? (previous.get(String(h.id))?.n || 0) : null,
      prevW: previousValid ? (previous.get(String(h.id))?.w || 0) : null,
      prevMatches: previousValid ? prevMatches : null })).sort((a, b) => a.id - b.id) };
}
const result = { schemaVersion: 3, builtAt: new Date().toISOString(),
  meta: { source: 'steam', cohort: 'ranked-all-ranks', patch, patchFrom },
  periods: { '7d': period('7d', fromDays(7)), '30d': period('30d', fromDays(30)), patch: period('patch', patchStart) } };
fs.mkdirSync(output, { recursive: true });
writeJsonAtomic(path.join(output, 'hero-periods.json'), JSON.stringify(result) + '\n');
console.log('hero-periods.json: ' + Object.entries(result.periods).map(([name, p]) => name + '=' + (p.available ? 'ok' : 'insufficient')).join(', '));
