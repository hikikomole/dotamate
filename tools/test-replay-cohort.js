'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { labelReplay, inspectReplay } = require('./replay-cohort');

function match() {
  const lane = ['bot', 'mid', 'top', 'top', 'bot'];
  const players = [];
  for (const [side, team] of ['radiant', 'dire'].entries()) for (let i = 0; i < 5; i++) {
    const ln = side ? ({ bot: 'top', top: 'bot', mid: 'mid' })[lane[i]] : lane[i];
    const coord = ln === 'bot' ? [160, 130] : ln === 'top' ? [130, 160] : [140, 140];
    players.push({ slot: side ? 128 + i : i, team, heroId: side * 5 + i + 1,
      x: Array(500).fill(coord[0]), y: Array(500).fill(coord[1]), dead: [], econ: { lh: [i === 0 || i === 2 ? 50 : i === 1 ? 40 : 5] } });
  }
  return { matchId: 1, startTime: 1000, duration: 1200, radiantWin: true,
    gameMode: 22, lobbyType: 7, t0: 0, econFrom: 600, econStep: 60, players };
}
test('replay cohort requires independent ranked evidence', () => {
  const m = match(), options = { patchFrom: 900, known: new Set(Array.from({ length: 10 }, (_, i) => i + 1)) };
  assert.equal(inspectReplay(m, options), null);
  const labels = labelReplay(m, options).labels;
  assert.deepEqual(labels.filter(x => x.s < 128).map(x => x.pos), [1, 2, 3, 4, 5]);
  assert.deepEqual(labels.filter(x => x.s >= 128).map(x => x.pos), [1, 2, 3, 4, 5]);
  m.pro = true; assert.equal(inspectReplay(m, options), 'pro'); m.pro = false;
  m.players[0].econ.lh = []; assert.equal(inspectReplay(m, options), 'missingEconomy');
  m.players[0].econ.lh = [50]; m.startTime = 899; assert.equal(inspectReplay(m, options), 'outsidePatch');
});
test('incomplete coordinate windows and malformed teams are excluded', () => {
  const m = match(), options = { patchFrom: 900 };
  m.players[0].x = Array(100).fill(140);
  assert.equal(inspectReplay(m, options), 'missingEvidence');
  m.players[0].x = Array(500).fill(140);
  m.players[0].team = 'dire';
  assert.equal(labelReplay(m, options).reason, 'invalidTeams');
});
module.exports = { match };
