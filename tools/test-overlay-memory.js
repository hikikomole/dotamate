const assert = require('node:assert/strict');
(async () => {
  const { metaMatches, metaStream } = require('./match-source');
  assert.equal(typeof metaStream, 'function', 'metaStream must stream Stratz input');
  const fs = require('node:fs'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'overlay-meta-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"id":1,"p":[]}\n{"id":2,"p":[]}\n{"broken":');
  fs.writeFileSync(path.join(dir, 'b.jsonl'), '{"id":1,"p":[{"h":3}]}\n');
  const deduped = [];
  for await (const match of metaStream({ dir })) deduped.push(match);
  assert.deepEqual(new Map(deduped.map(m => [m.id,m])), new Map([
    [1, { id: 1, p: [{ h: 3 }] }], [2, { id: 2, p: [] }]
  ]));
  const feeds = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'overlay-public-'));
  fs.writeFileSync(path.join(feeds, 'a.jsonl'), '[1,10000000000,1800,30,7,22]\ninvalid\n[2,10000000000,1800,80,0,22]\n');
  const publicRows = [];
  for await (const row of require('./match-source').publicFeedStream({ dir: feeds })) publicRows.push(row);
  assert.deepEqual(publicRows, [[1,1e10,1800,30,7,22], [2,1e10,1800,80,0,22]]);
  const actual = [];
  for await (const match of metaStream()) actual.push(match);
  const byId = rows => new Map(rows.map(row => [row.id, row]));
  assert.deepEqual(byId(actual), byId(metaMatches()));
  // Fractional, negative and >Uint16 times must retain the old exact quantiles.
  const { main } = require('./build-overlay-builds');
  const seconds = Array.from({ length: 301 }, (_, i) => [-45, 600.125, 65536, 7201, i * 17][i % 5]);
  const stratz = seconds.map((t, i) => ({ id: i, t: 1e10, mode: 22, lobby_type: 7, rank: 30,
    p: [{ h: 1, r: 1, pos: 1, b: [[t, 116], [t + 60, 116]] }] }));
  const out = await main(false, { stratz, write: false });
  const sorted = seconds.map(t => t / 60).sort((a,b) => a-b);
  const expected = [0.25, 0.5, 0.75].map(p => {
    const at = (sorted.length - 1) * p, lo = Math.floor(at);
    return Math.round((sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo)) * 1000) / 1000;
  });
  assert.deepEqual(out.builds[1][1].all.core.find(item => item.id === 116).t, expected);
  console.log('overlay streaming and exact timing: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
