'use strict';
// Offline pre/post-deploy contract gate; never fetches or writes anything.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { createHash } = require('crypto');
const { parseKeyValues } = require('./build-ingame-guides');
const root = path.resolve(process.argv[2] || 'deploy');
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));
for (const mode of ['ranked', 'turbo']) {
  const file = mode === 'ranked' ? 'overlay-builds.json' : 'overlay-builds-turbo.json';
  if (mode === 'turbo' && !fs.existsSync(path.join(root, 'data', file))) {
    console.log(file + ': NO DATA'); continue;
  }
  const data = read(file);
  assert.ok(data.meta?.patch && data.meta.matches > 0 && Number.isFinite(Date.parse(data.meta.builtAt)), file);
  assert.ok(data.builds && Object.keys(data.builds).length && data.vsEnemy && data.skills, file);
  if (mode === 'turbo') { assert.equal(data.meta.mode, 'turbo'); assert.equal(data.meta.timings, false); }
  else assert.ok(data.meta.sources);
  for (const positions of Object.values(data.builds)) for (const [pos, groups] of Object.entries(positions)) {
    assert.match(pos, mode === 'turbo' ? /^0$/ : /^[0-5]$/);
    for (const [group, row] of Object.entries(groups)) {
      assert.ok((mode === 'turbo' ? ['all'] : ['all', 'low', 'high']).includes(group));
      assert.ok(row.n >= 100 && Array.isArray(row.core));
      for (const item of row.core) {
        assert.ok(Number.isInteger(item.id) && typeof item.key === 'string' && item.share >= 0.2 && item.share <= 1);
        if (mode === 'turbo') assert.equal(item.t, null);
        else assert.ok(Array.isArray(item.t) && item.t.length === 3 && item.t.every(Number.isFinite));
      }
    }
  }
  console.log(file + ': contract OK');
}
assert.ok(!fs.existsSync(path.join(root, 'data', 'hero-items-ranked.json')), 'private ranked source leaked');
const m = read('ingame-guides/manifest.json');
assert.equal(m.format, 1); assert.ok(m.patch && m.heroes >= 120 && m.count >= 100);
assert.equal(m.count, m.files.length);
const dir = path.join(root, 'data', 'ingame-guides');
assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.build')).length, m.count);
const seen = new Set();
const heroes = new Set();
for (const f of m.files) {
  assert.match(f.file, /^[a-z][a-z0-9_]*_19\d{8}\.build$/);
  assert.ok(!seen.has(f.file)); seen.add(f.file);
  assert.ok(['all', 'low', 'high'].includes(f.rankGroup));
  heroes.add(f.heroId);
  const data = fs.readFileSync(path.join(dir, f.file));
  assert.equal(data.length, f.bytes);
  assert.equal(createHash('sha256').update(data).digest('hex'), f.sha256);
  const guide = parseKeyValues(data.toString('utf8'))[0];
  assert.equal(guide[0], 'guidedata');
  const get = key => guide[1].find(r => r[0] === key)?.[1];
  assert.equal(get('Hero'), f.hero); assert.equal(get('Title'), f.title);
  assert.ok(f.file.startsWith(f.hero + '_') && f.title.startsWith('DotaMate · '));
  assert.ok(Array.from(f.title).length <= 60);
}
assert.equal(heroes.size, m.heroes);
console.log(`manifest: ${m.count} .build; names/Title/bytes/sha256 OK`);
