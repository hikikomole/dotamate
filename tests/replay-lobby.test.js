const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { inspectReplay } = require('../tools/replay-cohort');

const options = { patchFrom: 100, rankedIds: new Set(['1']) };
const replay = { matchId: '1', gameMode: 22, players: Array(10).fill({}) };
test('missing lobby resolved via Steam ranked IDs reaches duration validation', () => {
  assert.equal(inspectReplay(replay, options), 'short');
  assert.equal(replay.lobbyType, undefined);
});
test('unresolved missing lobby has a distinct exclusion', () => {
  assert.equal(inspectReplay({ ...replay, matchId: '2' }, options), 'lobbyUnknown');
});
test('explicit unranked lobby cannot be overridden by Steam IDs', () => {
  assert.equal(inspectReplay({ ...replay, lobbyType: 0 }, options), 'notRanked');
});
test('Steam scan keeps only requested ranked All Pick IDs inside patch', async () => {
  const { rankedReplayIds } = require('../tools/replay-lobby');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-lobby-'));
  const rows = [[1, 0, 100, 900, null, 1, 22, 7], [2, 0, 100, 900, null, 1, 22, 0], [3, 0, 99, 900, null, 1, 22, 7], [4, 0, 100, 900, null, 1, 23, 7], [5, 0, 200, 900, null, 1, 22, 7], [6, 0, 100, 900, null, 1, 22, 7]];
  fs.writeFileSync(path.join(dir, '1970-01-01.jsonl.gz'), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n')));
  assert.deepEqual(await rankedReplayIds(dir, new Set(['1', '2', '3', '4', '5']), 100, 200), new Set(['1']));
  assert.deepEqual(await rankedReplayIds(path.join(dir, 'absent'), new Set(['1']), 100), new Set());
});

test('role builder CLI enriches old replays without changing archive files', () => {
  const cp = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-lobby-cli-'));
  const archive = path.join(dir, 'archive'), matches = path.join(archive, 'matches');
  fs.mkdirSync(matches, { recursive: true });
  fs.mkdirSync(path.join(dir, 'steam-matches'));
  const players = Array.from({ length: 10 }, (_, i) => {
    const role = i % 5, dire = i >= 5;
    const lane = [dire ? 20 : -20, 0, dire ? -20 : 20, dire ? -20 : 20, dire ? 20 : -20][role];
    return { heroId: i + 1, slot: dire ? 128 + role : role, team: dire ? 'dire' : 'radiant',
      x: Array(481).fill(128), y: Array(481).fill(128 + lane), dead: [], econ: { lh: [role < 3 ? 50 : 5] } };
  });
  const match = { ...replay, duration: 1800, startTime: 100, radiantWin: true, t0: 0, econFrom: 600, econStep: 60, players };
  const original = JSON.stringify(match);
  fs.writeFileSync(path.join(matches, '1.json'), original);
  fs.writeFileSync(path.join(matches, '2.json'), JSON.stringify({ ...match, matchId: '2' }));
  fs.writeFileSync(path.join(archive, 'index.json'), JSON.stringify({ matches: [{ matchId: '1' }, { matchId: '2' }] }));
  fs.writeFileSync(path.join(dir, 'patch-notes.json'), JSON.stringify({ version: 'test', timestamp: 100 }));
  fs.writeFileSync(path.join(dir, 'heroes.json'), JSON.stringify({ heroes: players.map(p => ({ id: p.heroId })) }));
  fs.writeFileSync(path.join(dir, 'steam-matches', '1970-01-01.jsonl.gz'), zlib.gzipSync(JSON.stringify([1, 0, 100, 1800, null, 1, 22, 7]) + '\n'));
  const run = cp.spawnSync(process.execPath, ['tools/build-role-meta.js', '--fixture', '--input-dir', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'role-meta.json'), 'utf8'));
  assert.equal(result.meta.matches, 1);
  assert.equal(result.meta.coverage.labeledSlots, 10);
  assert.deepEqual(result.meta.exclusions, { lobbyUnknown: 1 });
  assert.equal(result.status, 'insufficient'); // Lobby recovery cannot bypass manual audit.
  assert.equal(fs.readFileSync(path.join(matches, '1.json'), 'utf8'), original);
});
