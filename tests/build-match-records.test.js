'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cp = require('child_process');
const assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-records-'));
const input = path.join(dir, 'in'), out = path.join(dir, 'out'), patch = path.join(dir, 'patch.json');
fs.mkdirSync(input); fs.mkdirSync(out);
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const start = Math.floor(Date.parse(day + 'T12:00:00Z') / 1000);
fs.writeFileSync(patch, JSON.stringify({ version: 'test', timestamp: start - 100 }));
const run = () => cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-match-records.js'),
  '--input-dir', input, '--out-dir', out, '--patch-file', patch], { encoding: 'utf8' });
const result = () => JSON.parse(fs.readFileSync(path.join(out, 'match-records.json')));
const row = [123, 1, start, 1800, 50, 1, 22, 7, [], ...Array.from({ length: 10 }, (_, i) =>
  [i + 1, i < 5 ? i : 128 + i - 5, i ? 0 : 15, 0, 0, i ? 0 : 200, 0, i ? 0 : 800, 0, 0, 0, i ? 0 : 30000,
    0, 0, [0, 0, 0, 0, 0, 0], [0, 0, 0], 0, 0, 0, 0, 0, 0, []])];
const file = path.join(input, day + '.jsonl.gz');
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(row) + '\n' + JSON.stringify(row) + '\n'));
assert.strictEqual(run().status, 0);
assert.strictEqual(result().periods[0].matches, 1);
assert.strictEqual(result().periods[0].eligiblePlayers.kills, 10);
assert.strictEqual(result().periods[0].records.find(r => r.metric === 'heroDamage').value, 30000);
const feed = JSON.parse(JSON.stringify(row));
feed[0] = 9054030306;
feed[3] = 907;
// Collector writer: [hero_id, player_slot, kills, deaths, assists, ...].
for (let i = 0; i < 5; i++) { feed[9 + i][2] = 0; feed[9 + i][3] = [25, 26, 27, 25, 26][i]; feed[9 + i][4] = 0; }
feed[14][2] = 122;
const direFeed = JSON.parse(JSON.stringify(row));
direFeed[0] = 9062625716;
for (let i = 0; i < 5; i++) { direFeed[14 + i][2] = 0; direFeed[14 + i][3] = [11, 21, 25, 24, 27][i]; direFeed[14 + i][4] = 0; }
direFeed[9][2] = 100;
const split = JSON.parse(JSON.stringify(row));
split[0] = 401;
for (const i of [9, 10, 14]) { split[i][2] = 0; split[i][3] = 15; split[i][4] = 0; }
const teamTotalsRow = (id, kills, deaths, assists) => {
  const match = JSON.parse(JSON.stringify(row));
  match[0] = id;
  for (let i = 0; i < 5; i++) {
    match[9 + i][2] = kills[i];
    match[9 + i][3] = deaths[i];
    match[9 + i][4] = assists[i];
  }
  return match;
};
const missedFeedA = teamTotalsRow(9053962894, [0, 0, 1, 0, 0], [26, 27, 25, 34, 28], [1, 1, 1, 2, 1]);
const missedFeedB = teamTotalsRow(9062782508, [0, 0, 1, 0, 1], [28, 12, 21, 19, 28], [0, 0, 0, 0, 0]);
const normalStomp = teamTotalsRow(402, [2, 2, 2, 1, 1], [9, 9, 9, 9, 9], [1, 1, 1, 1, 1]);
// Row positions must not substitute for the encoded player slots.
const shuffledDireFeed = [...direFeed.slice(0, 9), ...[14, 9, 15, 10, 16, 11, 17, 12, 18, 13].map(i => direFeed[i])];
fs.writeFileSync(file, zlib.gzipSync([row, feed, feed, shuffledDireFeed, split, missedFeedA, missedFeedB, normalStomp].map(r => JSON.stringify(r)).join('\n') + '\n'));
assert.strictEqual(run().status, 0);
for (const period of result().periods) {
  assert.strictEqual(period.matches, 3, 'normal 8-kill, 45-death stomp remains eligible');
  assert.strictEqual(period.excludedFeedMatches, 4, 'exclude both existing and both missed feed matches once per period');
  assert.strictEqual(period.eligiblePlayers.kills, 30, 'feed players never enter records');
  assert.strictEqual(period.records.find(r => r.metric === 'kills').value, 15);
}
const invalidRows = [
  Object.assign([...row], { 0: 124, 7: 0 }),
  Object.assign([...row], { 0: 125, 6: 23 }),
  Object.assign([...row], { 0: 126, 3: 100 }),
  Object.assign([...row], { 0: 127, 5: null }),
  Object.assign([...row], { 0: 128, 10: row[9] })
];
for (const mode of [1, 2, 18, 19, 23]) {
  const excluded = JSON.parse(JSON.stringify(row));
  excluded[0] = 200 + mode;
  excluded[6] = mode;
  excluded[9][2] = 122;
  excluded[9][5] = 2782;
  excluded[9][7] = 2603;
  invalidRows.push(excluded);
}
const unknownHero = JSON.parse(JSON.stringify(row));
unknownHero[0] = 300;
unknownHero[9][0] = 999999;
invalidRows.push(unknownHero);
fs.writeFileSync(file, zlib.gzipSync([row, ...invalidRows].map(r => JSON.stringify(r)).join('\n') + '\n'));
assert.strictEqual(run().status, 0);
assert.strictEqual(result().periods[0].matches, 1, 'exclude matches outside ranked cohort');
assert.strictEqual(result().periods[1].matches, 1);
assert.strictEqual(result().periods[1].records.find(r => r.metric === 'kills').value, 15);
assert.strictEqual(result().periods[1].records.find(r => r.metric === 'gpm').value, 800);
assert.strictEqual(result().periods[1].records.find(r => r.metric === 'lastHits').value, 200);
fs.renameSync(file, path.join(input, 'hidden.gz'));
assert.strictEqual(run().status, 0);
assert.strictEqual(result().status, 'insufficient');
const before = fs.readFileSync(path.join(out, 'match-records.json'));
fs.writeFileSync(file, Buffer.from('bad gzip'));
assert.notStrictEqual(run().status, 0);
assert(before.equals(fs.readFileSync(path.join(out, 'match-records.json'))));
console.log('match records: ok, empty, failure keeps last valid');
