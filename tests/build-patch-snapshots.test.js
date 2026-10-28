'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { steamRows, steamSignature } = require('../tools/build-patch-snapshots');

test('snapshot input excludes current UTC day from rows and signature', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-snapshot-'));
  const today = '2026-10-28';
  const prior = path.join(dir, '2026-10-27.jsonl.gz');
  const current = path.join(dir, today + '.jsonl.gz');
  try {
    fs.writeFileSync(prior, zlib.gzipSync('[1]\n'));
    fs.writeFileSync(current, zlib.gzipSync('[2]\n'));
    const before = steamSignature(dir, today);
    fs.appendFileSync(current, zlib.gzipSync('[3]\n'));
    assert.equal(steamSignature(dir, today), before);
    const rows = [];
    for await (const row of steamRows(dir, today)) rows.push(row);
    assert.deepEqual(rows, [[1]]);
    fs.unlinkSync(prior);
    assert.notEqual(steamSignature(dir, today), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
