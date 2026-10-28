#!/usr/bin/env bash
# Read-only. Run from ~/dotamate-src: bash tools/diag-positions.sh
# Node is already required by the builders. Never invoke the builder's main().
set -eu
node <<'NODE'
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const root = process.cwd();
const home = process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector');
const archive = path.join(home, 'archive');
let lines = 0;
const say = s => { if (lines++ < 79) console.log(s); };
const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const list = p => { try { return fs.readdirSync(p); } catch { return []; } };
const stat = p => { try { return fs.statSync(p); } catch { return null; } };
const count = v => Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
const patchValue = v => typeof v === 'number' ? String(v) : typeof v === 'string' && /^[0-9.a-z-]{1,24}$/i.test(v) ? v : 'missing/other';
function inventory(label, dir, filter = () => true) {
  const names = list(dir).filter(filter), times = names.map(n => stat(path.join(dir, n))?.mtimeMs || 0);
  say(`${label}: count=${names.length}, newest=${times.length ? new Date(Math.max(...times)).toISOString() : 'none'}`);
}
say('Positions diagnostic (read-only; paths relative to collector unless specified)');
say(`collector override=${!!process.env.DOTAMATE_COLLECTOR}; default=~/dotamate-collector`);
const patch = read(path.join(root, 'data/patch-notes.json'));
say(`current patch=${patchValue(patch?.version)} timestamp=${Number(patch?.timestamp) || 0}; filter=startTime >= timestamp (NOT patch ID)`);
for (const file of ['data/role-meta.json', 'deploy/data/role-meta.json']) {
  const j = read(path.join(root, file));
  say(`${file}: ${j ? 'keys=' + Object.keys(j).filter(k => /^[a-zA-Z0-9_]+$/.test(k)).join(',') : 'missing/invalid'}`);
  if (!j) continue;
  const m = j.meta || {}, c = m.coverage || {};
  say(`  status=${['ok','insufficient','unavailable'].includes(j.status) ? j.status : 'other'} patch=${patchValue(m.patch)} matches=${Number(m.matches)||0} players=${Number(m.players)||0}`);
  say(`  meta keys=${Object.keys(m).filter(k => /^[a-zA-Z0-9_]+$/.test(k)).join(',')}`);
  say(`  to=${m.to && Number.isFinite(Date.parse(m.to)) ? new Date(m.to).toISOString() : 'null/invalid'} labeled=${Number(c.labeledSlots)||0}/${Number(c.possibleSlots)||0} gate=${c.gatePassed === true}`);
  say(`  exclusions=${JSON.stringify(Object.fromEntries(Object.entries(m.exclusions || {}).filter(([k,v]) => /^[a-zA-Z]+$/.test(k) && typeof v === 'number')))}`);
  say(`  position hero counts=${[1,2,3,4,5].map(p => p + ':' + count(j.positions?.[p]?.heroes)).join(' ')}`);
}
inventory('archive/matches JSON', path.join(archive, 'matches'), n => /^\d+\.json$/.test(n));
const index = read(path.join(archive, 'index.json'));
say(`archive/index.json entries=${count(index?.matches)} mtime=${stat(path.join(archive,'index.json'))?.mtime.toISOString() || 'missing'}`);
const known = new Set((read(path.join(root,'data/heroes.json'))?.heroes || []).map(h => Number(h.id)));
const { labelReplay } = require(path.join(root, 'tools/replay-cohort.js'));
const { auditGate } = require(path.join(root, 'tools/build-role-meta.js'));
const audit = read(path.join(archive, 'positions-audit.json'));
say(`positions-audit.json present=${!!stat(path.join(archive,'positions-audit.json'))} validGate=${auditGate(audit)}`);
const ids = new Set(), patches = new Map(), reasons = {};
let missing = 0, accepted = 0, min = Infinity, max = 0;
for (const entry of index?.matches || []) {
  const id = String(entry.matchId);
  if (!/^\d+$/.test(id) || ids.has(id)) continue;
  ids.add(id);
  const m = read(path.join(archive, 'matches', id + '.json'));
  if (!m) { missing++; continue; }
  const pv = patchValue(m.patch ?? m.patchId ?? m.patch_id ?? m.gameVersion);
  patches.set(pv, (patches.get(pv)||0)+1);
  m.pro = entry.pro === true || m.pro === true;
  m.lobbyType = m.lobbyType ?? entry.lobbyType ?? entry.lobby;
  const t = Number.isFinite(m.startTime) ? m.startTime : m.endTime - m.duration;
  if (Number.isFinite(t)) { min = Math.min(min,t); max = Math.max(max,t); }
  try {
    const { reason } = labelReplay(m, { patchFrom: Number(patch?.timestamp), known });
    if (reason) reasons[reason] = (reasons[reason]||0)+1; else accepted++;
  } catch { reasons.labelError = (reasons.labelError||0)+1; }
}
say(`indexed inputs: unique=${ids.size} missing/invalid=${missing} accepted=${accepted} exclusions=${JSON.stringify(reasons)}`);
say(`input start range=${Number.isFinite(min) ? new Date(min*1000).toISOString() : 'none'} .. ${max ? new Date(max*1000).toISOString() : 'none'}`);
say(`patch IDs (indexed files; absent is normal): ${JSON.stringify([...patches].sort((a,b)=>b[1]-a[1]).slice(0,12))}`);
for (const file of ['archive/_state.json', 'server-state.json']) {
  const j = read(path.join(home,file));
  // Only structural counts: never dump state values, account names or tokens.
  say(`${file}: present=${!!stat(path.join(home,file))} done=${count(j?.done)} skipped=${count(j?.skipped)} tries=${count(j?.tries)}`);
}
for (const [label,dir] of [['requests',path.join(home,'requests')],['archive/requested',path.join(archive,'requested')],['incoming/matches',path.join(home,'incoming/matches')],['work',path.join(home,'work')],['tmp',path.join(home,'tmp')]]) inventory(label,dir);
for (const file of ['archive/remote-worker.heartbeat','collect.lock']) {
  const s = stat(path.join(home,file));
  say(`${file}: present=${!!s} mtime=${s?.mtime.toISOString() || 'none'}`);
}
// Grep-equivalent match on builder name / its log label. Last three daily logs
// with hits are runs; cron.log is reported separately because it may mix runs.
const logs = path.join(root,'logs');
const files = list(logs).filter(n => /^daily-.*\.log$/.test(n)).sort().reverse();
let runs = 0;
for (const file of [...files, 'cron.log']) {
  if (file !== 'cron.log' && runs >= 3) continue;
  let hits = [];
  try { hits = fs.readFileSync(path.join(logs,file),'utf8').split(/\r?\n/).map((s,i)=>({s,i:i+1})).filter(x => /build-role-meta|role-meta\.json|Мета по ролям/.test(x.s)); } catch {}
  if (!hits.length) { if (file === 'cron.log') say('logs/cron.log: no builder hits'); continue; }
  if (file !== 'cron.log') runs++;
  for (const h of hits.slice(-3)) {
    // Whitelist only recognised result fragments; raw log text is never printed.
    const result = h.s.match(/role-meta\.json: (ok|insufficient|unavailable), (\d+) matches/);
    const flags = /fail|error|ошиб|не удалось/i.test(h.s) ? 'error marker' : 'builder marker';
    say(`logs/${file.replace(/[^a-zA-Z0-9._-]/g,'_')}:${h.i}: ${result ? result[0] : flags} [other text omitted]`);
  }
}
say(`daily logs with builder hits shown=${runs}/3; on-demand requested files are NOT builder inputs`);
NODE
