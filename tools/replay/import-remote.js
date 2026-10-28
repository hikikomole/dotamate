'use strict';
// Перенос матчей, разобранных домашним ПК-помощником, в архив сервера (27.10.2026).
//   node tools/replay/import-remote.js
// Вход: ~/dotamate-collector/incoming/{index.json, purchases.jsonl, matches/<id>.json} — копия архива помощника.
// Берёт только матчи, которых ещё нет в архиве сервера. Работает под тем же collect.lock, что и collect.js,
// чтобы не затереть index.json / _state.json сборщика. Печатает «IMPORTED n».
const fs = require('fs');
const path = require('path');

const HOME = process.env.DOTAMATE_COLLECTOR || path.join(require('os').homedir(), 'dotamate-collector');
const ARCHIVE = path.join(HOME, 'archive');
const MATCHES = path.join(ARCHIVE, 'matches');
const INDEX = path.join(ARCHIVE, 'index.json');
const STATE = path.join(ARCHIVE, '_state.json');
const PURCHASES = path.join(ARCHIVE, 'purchases.jsonl');
const IN = path.join(HOME, 'incoming');
const LOCK = path.join(HOME, 'collect.lock');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.part', JSON.stringify(v)); fs.renameSync(f + '.part', f); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lock() {
  for (let i = 0; i < 90; i++) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
    catch { await sleep(10e3); }
  }
  return false;
}

async function main() {
  const inIndex = readJson(path.join(IN, 'index.json'), null);
  if (!inIndex || !Array.isArray(inIndex.matches)) { console.log('IMPORTED 0 (нет входных данных)'); return; }
  const lines = new Map();
  try {
    for (const l of fs.readFileSync(path.join(IN, 'purchases.jsonl'), 'utf8').split('\n')) {
      const m = l.match(/^\{"id":"(\d+)"/); if (m) lines.set(m[1], l);
    }
  } catch {}
  if (!await lock()) throw new Error('collect.lock занят 15 мин');
  try {
    fs.mkdirSync(MATCHES, { recursive: true });
    const index = readJson(INDEX, { matches: [] }), state = readJson(STATE, {});
    const have = new Set(index.matches.map(m => m.matchId));
    let n = 0;
    for (const e of inIndex.matches) {
      const id = String(e && e.matchId || '');
      if (!/^\d+$/.test(id) || have.has(id) || !lines.has(id)) continue;
      const src = path.join(IN, 'matches', id + '.json');
      const match = readJson(src, null);
      if (!match || String(match.matchId) !== id || !Array.isArray(match.players)) continue;
      match.lobbyType = match.lobbyType ?? match.lobby_type ?? match.lobby ?? e.lobbyType ?? e.lobby_type ?? e.lobby ?? null;
      writeJson(path.join(MATCHES, id + '.json'), match);
      fs.appendFileSync(PURCHASES, lines.get(id) + '\n');
      index.matches.push({ ...e, matchId: id, lobbyType: match.lobbyType });
      state[id] = { ...(state[id] || {}), tries: 0, rank: e.rank ?? null, done: new Date().toISOString(), remote: true };
      have.add(id); n++;
    }
    if (n) {
      index.matches.sort((a, b) => b.endTime - a.endTime);
      index.updated = new Date().toISOString();
      writeJson(INDEX, index);
      writeJson(STATE, state);
    }
    console.log('IMPORTED ' + n);
  } finally { try { fs.unlinkSync(LOCK); } catch {} }
}

main().catch(e => { console.error(e.message); process.exit(1); });
