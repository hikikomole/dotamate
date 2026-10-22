const assert = require('node:assert/strict');
(async () => {
  const { main } = require('./build-overlay-builds-turbo');
  function row(id, mode = 23) {
    const p = Array(23).fill(0);
    p[0] = 1; p[14] = [116, 116]; p[15] = [116];
    p[22] = Array.from({ length: 10 }, () => [1, 10]).flat();
    return [id, id, 1e10, 1000, null, 1, mode, 0, [], p];
  }
  async function* rows(n) { for (let i = 0; i < n; i++) yield row(i); yield row(n, 22); }
  const options = { rows: rows(100), write: false, index: { 1: { name: 'test', isTalent: false } } };
  const out = await main(options);
  assert.equal(out.meta.matches, 100);
  assert.equal(out.meta.timings, false);
  assert.equal(out.meta.mode, 'turbo');
  assert.deepEqual(Object.keys(out.builds[1]), ['0']);
  assert.equal(out.builds[1][0].all.n, 100);
  assert.deepEqual(out.builds[1][0].all.core, [{ id: 116, key: 'black_king_bar', share: 1, t: null }]);
  assert.equal(out.skills[1][0].n, 100);
  assert.equal(out.skills[1][0].levels.length, 10);
  assert.deepEqual(out.vsEnemy, {});
  const small = await main({ ...options, rows: rows(29) });
  assert.deepEqual(small.builds, {}); assert.deepEqual(small.skills, {});
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-turbo-'));
  const file = path.join(dir, 'out.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const before = fs.readFileSync(file, 'utf8');
  await assert.rejects(main({ ...options, rows: rows(29), write: true, out: file }), /previous file preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  async function* broken() { yield row(1); throw new Error('input failed'); }
  await assert.rejects(main({ ...options, rows: broken(), write: true, out: file }), /input failed/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  async function* facing(n) {
    for (let i = 0; i < n; i++) {
      const r = row(i), enemy = [...r[9]];
      enemy[0] = 2; enemy[1] = 128; enemy[14] = []; enemy[15] = [];
      r.push(enemy); yield r;
    }
  }
  const under = await main({ ...options, rows: facing(299) });
  assert.deepEqual(under.vsEnemy, {});
  const enough = await main({ ...options, rows: facing(300) });
  assert.equal(enough.vsEnemy[2][0].uplift, 0.5);
  assert.equal(enough.vsEnemy[2][0].share, 1);
  console.log('overlay turbo fixtures: PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
