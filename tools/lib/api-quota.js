const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../match-source');

const CONFIG = {
  stratz: { day: 13000, hour: 1400, minute: 120, minIntervalMs: 1000 },
  opendota: { day: 1950, minute: 55, minIntervalMs: 1100 }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = process.env.API_QUOTA_DIR || path.join(__dirname, '..', '..', 'data', '_quota');

async function locked(source, action) {
  if (!CONFIG[source]) throw new Error('Unknown API quota source: ' + source);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, source + '.json');
  const lock = file + '.lock';
  for (;;) {
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      await sleep(50);
      continue;
    }
    try {
      let state;
      try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = {}; }
      const result = action(state, Date.now(), CONFIG[source]);
      writeJsonAtomic(file, state);
      return result;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}

function roll(state, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.day !== day) { state.day = day; state.dayCount = 0; state.remainingDay = null; }
  const minute = Math.floor(now / 60000);
  if (state.minute !== minute) { state.minute = minute; state.minuteCount = 0; }
  const hour = Math.floor(now / 3600000);
  if (state.hour !== hour) { state.hour = hour; state.hourCount = 0; }
}

async function take(source, { priority = 'normal' } = {}) {
  if (!['critical', 'normal', 'fill'].includes(priority)) throw new Error('Unknown API quota priority');
  for (;;) {
    const result = await locked(source, (s, now, c) => {
      roll(s, now);
      const cap = Math.floor(c.day * ({ critical: 1, normal: .97, fill: .9 })[priority]);
      if (s.dayCount >= cap || (s.remainingDay !== null && s.remainingDay <= c.day - cap)) return false;
      const wait = Math.max(0, (s.pauseUntil || 0) - now,
        (s.lastTake || 0) + c.minIntervalMs - now,
        s.minuteCount >= c.minute ? (s.minute + 1) * 60000 - now : 0,
        c.hour && s.hourCount >= c.hour ? (s.hour + 1) * 3600000 - now : 0);
      if (wait) return wait;
      s.dayCount++; s.minuteCount++; s.hourCount++; s.lastTake = now;
      if (s.remainingDay !== null) s.remainingDay--;
      return true;
    });
    if (result === true || result === false) return result;
    await sleep(result);
  }
}

async function pause(source, retryAfterSec = 75) {
  const seconds = Number(retryAfterSec);
  await locked(source, (s, now) => { s.pauseUntil = Math.max(s.pauseUntil || 0, now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 75) * 1000); });
}

async function observe(source, headers) {
  const raw = headers.get('x-rate-limit-remaining-day') ?? headers.get('x-ratelimit-remaining-day');
  if (raw === null) return;
  const remaining = Number(raw);
  if (!Number.isFinite(remaining) || remaining < 0) return;
  await locked(source, (s, now, c) => { roll(s, now); s.remainingDay = Math.min(s.remainingDay ?? c.day, remaining); });
}

module.exports = { take, pause, observe };
