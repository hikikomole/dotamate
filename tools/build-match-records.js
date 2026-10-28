#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { writeJsonAtomic } = require('./match-source');
const { inspectSteamRow } = require('./stats-cohort');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing ' + name);
  return path.resolve(args[i + 1]);
}
const input = option('--input-dir', path.join(root, 'data', 'steam-matches'));
const output = option('--out-dir', path.join(root, 'data'));
const known = new Set(JSON.parse(fs.readFileSync(path.join(root, 'data', 'heroes.json'), 'utf8')).heroes.map(h => Number(h.id)));
const patchData = JSON.parse(fs.readFileSync(option('--patch-file', path.join(root, 'data', 'patch-notes.json')), 'utf8'));
if (!/^[\w.-]+$/.test(patchData.version) || !Number.isSafeInteger(patchData.timestamp) || patchData.timestamp <= 0)
  throw new Error('Invalid current patch');
const today = new Date().toISOString().slice(0, 10);
const day = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
const metrics = [['kills', 2], ['gpm', 7], ['lastHits', 5], ['heroDamage', 11]];
const periods = [
  { id: 'day', from: day(1), to: day(1), matches: 0, excludedFeedMatches: 0, eligiblePlayers: {}, records: [] },
  { id: 'week', from: day(7), to: day(1), matches: 0, excludedFeedMatches: 0, eligiblePlayers: {}, records: [] }
];
function hasFeedTeam(row) {
  const counts = [0, 0];
  const kills = [0, 0];
  const deaths = [0, 0];
  // collect-steam-matches.js writes [hero_id, player_slot, kills, deaths, assists, ...].
  for (const player of row.slice(9, 19)) {
    if (!Array.isArray(player) || !Number.isInteger(player[1])) continue;
    const team = player[1] < 128 ? 0 : 1;
    kills[team] += player[2];
    deaths[team] += player[3];
    if (player[2] === 0 && player[4] === 0 && player[3] >= 15 && ++counts[team] >= 3) return true;
  }
  return kills.some((total, team) => total <= 5 && deaths[team] >= 50);
}
const best = periods.map(() => new Map());
for (const period of periods) for (const [metric] of metrics) period.eligiblePlayers[metric] = 0;
const seen = new Set();
async function read(file) {
  const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[2]) ||
          !Number.isSafeInteger(row[3]) || row[3] < 0 || !Array.isArray(row[9])) throw new Error('Invalid Steam row');
      if (inspectSteamRow(row, { known, patchFrom: patchData.timestamp }) || seen.has(row[0])) continue;
      const date = new Date(row[2] * 1000).toISOString().slice(0, 10);
      if (date < day(7) || date > day(1)) continue;
      seen.add(row[0]);
      const feedMatch = hasFeedTeam(row);
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        if (date < period.from || date > period.to) continue;
        if (feedMatch) { period.excludedFeedMatches++; continue; }
        period.matches++;
        for (const player of row.slice(9, 19)) {
          if (!Array.isArray(player) || !Number.isSafeInteger(player[0]) || player[0] <= 0) continue;
          for (const [metric, index] of metrics) {
            const value = player[index];
            if (!Number.isSafeInteger(value) || value < 0) continue;
            period.eligiblePlayers[metric]++;
            const previous = best[i].get(metric);
            if (!previous || value > previous.value || (value === previous.value && row[0] < previous.matchId))
              best[i].set(metric, { metric, value, matchId: row[0], heroId: player[0], start: row[2], duration: row[3] });
          }
        }
      }
    }
  } finally { lines.close(); }
}
(async () => {
  if (fs.existsSync(input)) {
    for (const name of fs.readdirSync(input).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl\.gz$/.test(n) && n.slice(0, 10) >= day(7) && n.slice(0, 10) <= day(1)).sort())
      await read(path.join(input, name));
  }
  for (let i = 0; i < periods.length; i++) periods[i].records = metrics.map(([metric]) => best[i].get(metric)).filter(Boolean);
  const result = { schemaVersion: 1, status: periods.some(p => p.matches) ? 'ok' : 'insufficient',
    builtAt: new Date().toISOString(), meta: { source: 'steam', cohort: 'ranked-all-ranks', patch: patchData.version, patchFrom: patchData.timestamp }, periods };
  fs.mkdirSync(output, { recursive: true });
  writeJsonAtomic(path.join(output, 'match-records.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('match-records.json: ' + result.status);
})().catch(error => { console.error(error); process.exitCode = 1; });
