const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-quota-'));
process.env.API_QUOTA_DIR = dir;
const quota = require('./api-quota');
const realNow = Date.now;
const now = Date.UTC(2026, 9, 28, 12);
Date.now = () => now;
const state = source => path.join(dir, source + '.json');
const seed = (source, data) => fs.writeFileSync(state(source), JSON.stringify({ day: '2026-10-28', minute: Math.floor(now / 60000), hour: Math.floor(now / 3600000), ...data }));

test('priority thresholds and concurrent reservations', async () => {
  seed('opendota', { dayCount: 1755 });
  assert.equal(await quota.take('opendota', { priority: 'fill' }), false);
  assert.equal(await quota.take('opendota', { priority: 'normal' }), true);
  seed('opendota', { dayCount: 1891 });
  assert.equal(await quota.take('opendota', { priority: 'normal' }), false);
  seed('opendota', { dayCount: 1949 });
  assert.deepEqual(await Promise.all([quota.take('opendota', { priority: 'critical' }), quota.take('opendota', { priority: 'critical' })]), [true, false]);
});

test('minute window, pause and observed lower balance', async () => {
  seed('stratz', { minute: Math.floor(now / 60000) - 1, minuteCount: 120, dayCount: 1 });
  assert.equal(await quota.take('stratz', { priority: 'critical' }), true);
  assert.equal(JSON.parse(fs.readFileSync(state('stratz'))).minuteCount, 1);
  seed('stratz', { dayCount: 1 });
  await quota.observe('stratz', new Headers({ 'x-ratelimit-remaining-day': '10' }));
  await quota.observe('stratz', new Headers({ 'x-rate-limit-remaining-day': '100' }));
  assert.equal(JSON.parse(fs.readFileSync(state('stratz'))).remainingDay, 10);
  await quota.pause('stratz', 2);
  assert.equal(JSON.parse(fs.readFileSync(state('stratz'))).pauseUntil, now + 2000);
});

test('separate processes share reservations and release the lock', async () => {
  const workerNow = realNow();
  fs.writeFileSync(state('opendota'), JSON.stringify({ day: new Date(workerNow).toISOString().slice(0, 10), minute: Math.floor(workerNow / 60000), hour: Math.floor(workerNow / 3600000), minuteCount: 54, dayCount: 1890 }));
  const worker = () => new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'api-quota-worker.js'), [], { env: { ...process.env, API_QUOTA_DIR: dir, API_QUOTA_TEST_NOW: String(workerNow) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let answer;
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', value => { answer = value; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(answer) : reject(new Error('worker exit ' + code + ': ' + stderr)));
  });
  const results = await Promise.all([worker(), worker(), worker()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(state('opendota'))).minuteCount, 55);
  assert.equal(fs.existsSync(state('opendota') + '.lock'), false);
});

test.after(() => { Date.now = realNow; fs.rmSync(dir, { recursive: true, force: true }); });
