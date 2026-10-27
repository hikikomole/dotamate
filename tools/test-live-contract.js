'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('live viewer keeps Valve API, archive distinction and no excluded model fetch', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'live.js'), 'utf8');
  const php = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'api', 'index.php'), 'utf8');
  assert.match(js, /getJson\('\/api\/live\/online'\)/);
  assert.match(js, /getJson\('\/api\/live\/online\/' \+ g\.sid\)/);
  assert.match(js, /повторы · все видят одну секунду/);
  assert.match(js, /задержка трансляции Valve/);
  assert.doesNotMatch(js, /getJson\('\/data\/(?:our-matrix-top|item-impact)\.json'\)/);
  assert.match(php, /LIVE_LIST_TTL = 60/);
});
