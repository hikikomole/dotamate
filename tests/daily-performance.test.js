'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../tools/daily-update.js'), 'utf8');
const section = source.slice(source.indexOf('    if (!statsOk) problems.push'), source.indexOf('    // D2PT-разделы'));
test('optional percentiles failure does not skip home meta; failed stats skips both', async () => {
  for (const statsOk of [true, false]) {
    const calls = [], problems = [], skippedAlerts = [];
    await vm.runInNewContext('(async () => {' + section + '})()', {
      statsOk, problems, skippedAlerts, HOUR: 3600000,
      node: async (_, file) => { calls.push(file); return !file.includes('performance-percentiles'); }
    });
    assert.deepEqual(calls, statsOk ? ['tools/build-performance-percentiles.js', 'tools/build-home-meta.js'] : []);
    assert.equal(problems.length, statsOk ? 0 : 1);
    assert.equal(skippedAlerts.length, statsOk ? 1 : 0);
  }
});
