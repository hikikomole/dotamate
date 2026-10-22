const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replayMatches } = require('./overlay-replays');
const fixture = require('./fixtures/overlay-replays.json');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-replays-'));
  const file = path.join(dir, 'purchases.jsonl');
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ matches: [] }));
  fs.writeFileSync(file, fixture.rows.map(row => JSON.stringify({ ...row, p: [fixture.player] })).join('\n'));
  const positions = Object.fromEntries(fixture.rows.map(row => [row.id, { p: [{ h: 1, s: 0, pos: 1 }] }]));
  positions.unknown.p[0].pos = null;
  positions['low-confidence'].p[0].confidence = 'low';
  const options = { archive: dir, file, since: 1000, seen: new Set(['duplicate']),
    positions, blocked: new Set(['scheduled']), itemIds: new Map([['black_king_bar', 116]]),
    rankedIds: new Set(fixture.rows.map(row => row.id)) };
  const rows = [];
  for await (const row of replayMatches(options)) rows.push(row);
  assert.deepEqual(rows.map(row => row.id), ['null-rank', 'low', 'high', 'unknown', 'low-confidence']);
  assert.deepEqual(rows.map(row => row.p[0].pos), [1, 1, 1, 0, 0]);
  assert.deepEqual(rows[0].p[0].b.filter(([, id]) => id != null), [[600, 116]]);
  assert.equal(rows[0].rank, null);
  // w21 diagnostic omitted itemIds: this used to throw at the first purchase.
  const withoutItems = [];
  for await (const row of replayMatches({ ...options, itemIds: undefined })) withoutItems.push(row);
  assert.deepEqual(withoutItems, []);
  for (const index of [null, { matches: {} }]) {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    const invalid = [];
    for await (const row of replayMatches(options)) invalid.push(row);
    assert.deepEqual(invalid, []);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ matches: [] }));
  const noRankedProof = [];
  for await (const row of replayMatches({ ...options, rankedIds: new Set() })) noRankedProof.push(row);
  assert.deepEqual(noRankedProof, []);
  const missing = [];
  for await (const row of replayMatches({ ...options, file: path.join(dir, 'missing.jsonl') })) missing.push(row);
  assert.deepEqual(missing, []);
  // Проверяем настоящую агрегацию и пороги отображения (100 игроков в срезе).
  const { main } = require('./build-overlay-builds');
  const repeated = fixture.rows.flatMap(row => Array.from({ length: 100 }, (_, i) =>
    ({ ...row, id: row.id + i, end: 1e10, p: [fixture.player] })));
  fs.writeFileSync(file, repeated.map(row => JSON.stringify(row)).join('\n'));
  const replay = { ...options, since: 1000,
    positions: Object.fromEntries(repeated.map(row => [row.id, positions[row.id.replace(/\d+$/, '')]])),
    rankedIds: new Set(repeated.map(row => row.id)),
    blocked: new Set(repeated.filter(row => row.id.startsWith('scheduled')).map(row => row.id)) };
  delete replay.seen;
  delete replay.itemIds;
  const stratz = repeated.filter(row => row.id.startsWith('duplicate')).map(row =>
    ({ id: row.id, t: 1e10, mode: 22, lobby_type: 7, rank: 30, p: [{ h: 1, r: 1, pos: 1, b: [[600, 116]] }] }));
  const result = await main(true, { stratz, replay, write: false });
  // old теперь тоже новый патч в этом прогоне: null-rank + old + low + high.
  assert.equal(result.builds[1][1].all.n, 500);
  assert.equal(result.builds[1][1].low.n, 200);
  assert.equal(result.builds[1][1].high.n, 100);
  assert.deepEqual(result.builds[1][1].all.src, { s: 100, r: 400 });
  assert.equal(result.builds[1][0].all.n, 700);
  assert.deepEqual(result.builds[1][0].all.src, { s: 100, r: 600 });
  assert.equal(result.builds[1][0].low.n, 200);
  assert.equal(result.builds[1][0].high.n, 100);
  assert.deepEqual(result.meta.sources, { stratz: 100, replays: 600 });
  assert.deepEqual(result.builds[1][1].all.core.map(item => item.key), ['black_king_bar']);
  const fallback = await main(true, { stratz, replay: { ...replay, file: path.join(dir, 'missing.jsonl') }, write: false });
  const onlyStratz = await main(false, { stratz, write: false });
  delete fallback.meta.builtAt; delete onlyStratz.meta.builtAt;
  assert.deepEqual(fallback, onlyStratz);
  const indexFile = path.join(dir, 'index.json');
  fs.renameSync(indexFile, indexFile + '.saved');
  const missingIndex = await main(true, { stratz, replay, write: false });
  delete missingIndex.meta.builtAt;
  assert.deepEqual(missingIndex, onlyStratz);
  fs.mkdirSync(indexFile);
  const directoryIndex = await main(true, { stratz, replay, write: false });
  delete directoryIndex.meta.builtAt;
  assert.deepEqual(directoryIndex, onlyStratz);
  fs.renameSync(indexFile, indexFile + '.directory');
  fs.renameSync(indexFile + '.saved', indexFile);
  // Чтение каталога вместо файла вызывает ошибку потока (или open на Windows).
  const unreadable = await main(true, { stratz, replay: { ...replay, file: dir }, write: false });
  delete unreadable.meta.builtAt;
  assert.deepEqual(unreadable, onlyStratz);
  console.log('overlay replay fixtures: PASS (dedupe, pro/league/schedule, patch, position, item keys, missing file)');
})().catch(error => { console.error(error); process.exitCode = 1; });
