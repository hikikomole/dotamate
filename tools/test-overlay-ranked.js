const assert = require('node:assert/strict');
const { main } = require('./build-overlay-builds');
(async () => {
  const p = [{ h: 1, r: 1, pos: 1, b: [[600, 116]] }];
  const stratz = Array.from({ length: 100 }, (_, id) => ({ id, t: 1e10, mode: 22, lobby_type: 0, p }));
  const out = await main(false, { stratz, write: false });
  assert.equal(out.meta.matches, 0, 'unranked All Pick must be excluded');
  const { pack } = require('./collect-meta-matches');
  assert.equal(pack({ players: [], gameMode: 22, lobby_type: 0 }).lobby_type, 0);
  const packed = pack({ players: [], gameMode: 22 }, [1, 0, 1000, null, 7, 22]);
  assert.equal(packed.lobby_type, 7); assert.equal(packed.mode, 22);
  const mixed = [
    { id: 1, lobby_type: 7, mode: 22 }, { id: 2, lobby_type: 7, mode: 23 },
    { id: 3, lobby_type: 0, mode: 22 }, { id: 4 }, { id: 5 }, { id: 6 },
    { id: 7, lobby_type: 0 }, { id: 8, lobby_type: 7, mode: 22 }
  ].map(m => ({ t: 1e10, p, ...m }));
  const filtered = await main(false, { stratz: mixed, write: false, publicRows: [
    [4, 1e10, 1000, null, 7, 22], [5, 1e10, 1000, null, 0, 22], [7, 1e10, 1000, null, 7, 22]
  ] });
  assert.equal(filtered.meta.matches, 3, 'explicit metadata wins; missing proof is excluded');
  const fs = require('fs'), path = require('path');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ranked-empty-'));
  const file = path.join(dir, 'overlay.json');
  fs.writeFileSync(file, '{"previous":true}');
  await assert.rejects(main(false, { stratz: [], write: true, out: file }), /previous file preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"previous":true}');
  const accepted = [];
  for await (const m of require('./match-source').rankedMetaStream({ stratz: mixed,
    publicRows: [[4, 1e10, 1000, null, 7, 22], [5, 1e10, 1000, null, 0, 22], [7, 1e10, 1000, null, 7, 22]] })) accepted.push(m.id);
  assert.deepEqual(accepted, [1, 4, 8], 'purchase and overlay builders share ranked proof');
  console.log('overlay ranked fixtures: PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
