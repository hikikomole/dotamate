'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { rankedMetaStream } = require('./match-source');
const code = fs.readFileSync(path.join(__dirname, 'build-hero-items.js'), 'utf8');
async function run(rows) {
  const writes = new Map(), errors = [], proc = { exitCode: 0 };
  const fixtures = {
    'items-ru.json': { items: { blink: { id: 1 } } },
    'patch-notes.json': { timestamp: 1, version: 'fixture' },
    'heroes.json': { heroes: [{ id: 1, localized_name: 'Fixture' }] }
  };
  await vm.runInNewContext(code, {
    __dirname, process: proc, console: { log() {}, warn() {}, error(e) { errors.push(e); } },
    require(name) {
      if (name === 'fs') return { readFileSync(file) { return JSON.stringify(fixtures[path.basename(file)]); } };
      if (name === 'path') return path;
      if (name === './match-source.js') return {
        rankedMetaStream: () => rankedMetaStream({ stratz: rows, publicRows: [[4, 2, 1000, null, 7, 22]] }),
        writeJsonAtomic(file, value) { writes.set(path.basename(file), value); }
      };
      throw Error('Unexpected dependency ' + name);
    }
  });
  return { writes, errors, proc };
}
(async () => {
  const base = { t: 2, rank: 30, p: [{ h: 1, pos: 1, b: [[60, 1]] }] };
  const result = await run([
    { ...base, id: 1, lobby_type: 7, mode: 22 },
    { ...base, id: 2, lobby_type: 0, mode: 22 },
    { ...base, id: 3, lobby_type: 7, mode: 23 },
    { ...base, id: 4 }, { ...base, id: 5 }
  ]);
  assert.equal(result.proc.exitCode, 0);
  assert.equal(result.writes.get('hero-items.json').matchesUsed, 2);
  assert.equal(result.writes.get('hero-items.json').heroes[1].n, 2);
  assert.equal(result.writes.get('hero-items-ranked.json').ranked.low.heroes[1].n, 2);
  const empty = await run([{ ...base, id: 1, lobby_type: 0, mode: 22 }]);
  assert.equal(empty.proc.exitCode, 1);
  assert.equal(empty.writes.size, 0, 'failed coverage must preserve every previous output');
  console.log('hero-items ranked/legacy/Turbo/empty fixtures: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
