'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const HOME = process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector');
const FILE = path.join(HOME, 'archive', 'gc-accounts.json');
function count() {
  try { return Math.floor(fs.readFileSync(path.join(ROOT, 'secrets', 'Steam.txt'), 'utf8').split(/\r?\n/).filter(Boolean).length / 2); } catch { return 0; }
}
function locked(fn) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const lock = FILE + '.lock';
  for (let i = 0; i < 100; i++) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (i === 99) throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmdirSync(lock); } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  try {
    let state; try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {
      state = {};
      try {
        const old = JSON.parse(fs.readFileSync(path.join(HOME, 'archive', '_state.json'), 'utf8'));
        if (old._acc?.day === new Date().toISOString().slice(0, 10)) state = { day: old._acc.day, used: old._acc.used || [], off: old._accOff || {} };
      } catch {}
    }
    if (state.day !== new Date().toISOString().slice(0, 10)) state = { day: new Date().toISOString().slice(0, 10), used: [], off: state.off || {} };
    const result = fn(state);
    const tmp = FILE + '.' + process.pid + '.part';
    fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, FILE);
    return result;
  } finally { fs.rmdirSync(lock); }
}
function reserve(n = 1) {
  return locked(state => {
    let best = null;
    for (let i = 0; i < count(); i++) if (!(state.off[i] && Date.now() - state.off[i] < 86400e3) && (state.used[i] || 0) + n <= 90 && (best === null || (state.used[i] || 0) < (state.used[best] || 0))) best = i;
    if (best !== null) state.used[best] = (state.used[best] || 0) + n;
    return best;
  });
}
function guard(i) { locked(state => { state.off[i] = Date.now(); }); }
function reserveSpecific(i) { return locked(state => { if (state.off[i] && Date.now() - state.off[i] < 86400e3 || (state.used[i] || 0) >= 90) return false; state.used[i] = (state.used[i] || 0) + 1; return true; }); }
module.exports = { reserve, reserveSpecific, guard };
