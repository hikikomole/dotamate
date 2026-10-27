'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildSummary } = require('./build-home-summary');
const known = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
const patch = { version: '7.41f', timestamp: 900 };
const row = (id, bans = []) => [id, 0, 1000 + id, 1200, null, 1, 22, 7, bans,
  ...Array.from({ length: 10 }, (_, i) => [i + 1]), true];

test('home summary counts ranked matches and ban presence', async () => {
  const out = await buildSummary([row(1, [11, 11]), row(2, [12])], patch, new Set([...known, 11, 12]), new Date('2026-10-26T00:00:00Z'));
  assert.equal(out.meta.matches, 2);
  assert.equal(out.summary.radiantWins, 2);
  assert.equal(out.summary.banCoverage.recorded, 2);
  assert.equal(out.heroes.find(h => h.id === 11).bans, 1);
  assert.equal(out.heroes.reduce((n, h) => n + h.picks, 0), 20);
  assert.equal(out.summary.contested.id, 1);
  const missing = await buildSummary([row(1).map((v, i) => i === 19 ? undefined : v)], patch, known);
  assert.equal(missing.summary.contested, null);
  assert.equal(missing.summary.banCoverage.known, false);
});
test('patch rollover, future timestamp and empty cohort', async () => {
  const empty = await buildSummary([], patch, known);
  assert.equal(empty.status, 'insufficient');
  assert.equal(empty.summary.radiantWr, null);
  const future = await buildSummary([row(1)], { version: 'future', timestamp: 950 }, known, new Date(900 * 1000));
  assert.equal(future.summary.patchDays, null);
  const rollover = await buildSummary([row(1)], { version: 'next', timestamp: 1002 }, known);
  assert.equal(rollover.meta.matches, 0);
  await assert.rejects(() => buildSummary([row(1, [1])], patch, known), /overlap/);
});
test('home-meta builder preserves the legacy lists with an isolated ranked fixture', () => {
  const base = path.join(__dirname, '..', 'outputs', 'd2pt-check', 'B');
  const input = path.join(base, 'input'), output = path.join(base, 'output');
  fs.mkdirSync(input, { recursive: true });
  const heroes = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: 'npc_dota_hero_test_' + (i + 1), localized_name: 'Hero ' + (i + 1) }));
  const rankedSummary = { source: 'steam', cohort: 'ranked-all-ranks', patch: '7.41f', patchFrom: 900,
    matches: 1, radiantWins: 1, from: '1970-01-01T00:16:41.000Z', to: '1970-01-01T00:16:41.000Z',
    banRecorded: 0, seen: 1, exclusions: {}, heroes: heroes.map(h => ({ id: h.id, picks: 1, wins: h.id <= 5 ? 1 : 0, bans: 0 })) };
  fs.writeFileSync(path.join(input, 'stats.json'), JSON.stringify({ builtAt: new Date().toISOString(), rankedSummary }));
  fs.writeFileSync(path.join(input, 'patch-notes.json'), JSON.stringify(patch));
  fs.writeFileSync(path.join(input, 'heroes.json'), JSON.stringify({ heroes }));
  const cmd = spawnSync(process.execPath, [path.join(__dirname, 'build-home-meta.js'), '--fixture', '--input-dir', input, '--out-dir', output], { encoding: 'utf8' });
  assert.equal(cmd.status, 0, cmd.stderr);
  const built = JSON.parse(fs.readFileSync(path.join(output, 'home-meta.json'), 'utf8'));
  assert.equal(built.summary.matches, 1);
  assert.deepEqual(built.banned, []);
  assert.equal(built.summary.contested, null);
  rankedSummary.source = 'opendota';
  fs.writeFileSync(path.join(input, 'stats.json'), JSON.stringify({ rankedSummary }));
  const fail = spawnSync(process.execPath, [path.join(__dirname, 'build-home-meta.js'), '--fixture', '--input-dir', input, '--out-dir', output], { encoding: 'utf8' });
  assert.notEqual(fail.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'home-meta.json'), 'utf8')).summary.matches, 1);
  rankedSummary.source = 'steam';
  fs.writeFileSync(path.join(input, 'stats.json'), JSON.stringify({ builtAt: new Date().toISOString(), rankedSummary }));
});
