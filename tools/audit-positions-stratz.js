'use strict';
// Run under <collector>/heavy.lock, just like daily-update; never publish the reference cache.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { archiveMatches, labelReplay, startTime } = require('./replay-cohort');
const { rankedReplayIds } = require('./replay-lobby');
const { auditGate } = require('./build-role-meta');
const { writeJsonAtomic } = require('./match-source');
const { readToken, ask, PAUSE_MS } = require('./collect-meta-matches');
const METHOD_VERSION = 1;
const LABELS = Symbol('validated replay labels');
const valid = p => Number.isInteger(p) && p >= 1 && p <= 5;
function referencePlayers(m) {
  return (m?.p || m?.players || []).map(p => ({ h: p.h ?? p.heroId,
    r: p.r ?? (typeof p.isRadiant === 'boolean' ? Number(p.isRadiant) : null),
    pos: p.pos ?? (/^POSITION_[1-5]$/.test(p.position) ? Number(p.position.slice(-1)) : null) }));
}
function buildAudit(matches, references, options, now = new Date()) {
  const roles = Object.fromEntries([1, 2, 3, 4, 5].map(p => [p, { total: 0, correct: 0, confusion: Object.fromEntries([1, 2, 3, 4, 5].map(q => [q, 0])) }]));
  const ids = new Set(), days = new Set(), lineups = new Set(), seen = new Set();
  let teams = 0, ambiguous = 0, referenceIncompleteTeams = 0, referenceIncompletePlayers = 0, from = Infinity, to = 0;
  for (const m of matches) {
    const id = String(m.matchId ?? m.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const { reason, labels } = m[LABELS] ? { reason: null, labels: m[LABELS] } : labelReplay(m, options);
    if (reason || !references.has(id) || !references.get(id)) continue;
    const refs = referencePlayers(references.get(id));
    if (!refs.length) continue;
    for (const [r, team] of ['dire', 'radiant'].entries()) {
      const players = m.players.filter(p => p.team === team);
      const teamRefs = refs.filter(p => p.r === r);
      const complete = players.length === 5 && teamRefs.length === 5 &&
        new Set(teamRefs.map(p => p.pos)).size === 5 && teamRefs.every(p => valid(p.pos)) &&
        players.every(player => teamRefs.filter(p => p.h === player.heroId).length === 1);
      if (!complete) { referenceIncompleteTeams++; referenceIncompletePlayers += players.length; continue; }
      ids.add(id); const time = startTime(m);
      from = Math.min(from, time); to = Math.max(to, time);
      days.add(new Date(time * 1000).toISOString().slice(0, 10));
      teams++;
      lineups.add(players.map(p => p.heroId).sort((a, b) => a - b).join(','));
      for (const player of players) {
        const predictions = labels.filter(p => p.s === player.slot);
        const pred = predictions[0]?.pos, reference = teamRefs.find(p => p.h === player.heroId).pos;
        if (predictions.length !== 1 || !valid(pred)) { ambiguous++; continue; }
        const row = roles[pred]; row.total++; row.confusion[reference]++;
        if (pred === reference) row.correct++;
      }
    }
  }
  return { source: 'valve-replay', methodVersion: METHOD_VERSION, reference: 'stratz', method: 'auto-crosscheck',
    builtAt: now.toISOString(), from: ids.size ? new Date(from * 1000).toISOString() : null,
    to: ids.size ? new Date(to * 1000).toISOString() : null,
    teams, matchIds: [...ids], days: [...days].sort(), lineups: lineups.size, ambiguous,
    referenceIncompleteTeams, referenceIncompletePlayers, roles };
}
function isFresh(audit, now = Date.now()) {
  const age = now - Date.parse(audit?.builtAt);
  return audit?.method === 'auto-crosscheck' && audit.reference === 'stratz' && audit.methodVersion === METHOD_VERSION && age >= 0 && age < 7 * 86400000;
}
async function loadReferences(dir, wanted, references) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const m = JSON.parse(line), id = String(m.id ?? m.matchId);
      if (wanted.has(id)) references.set(id, m);
    }
  }
}
async function main() {
  const args = process.argv.slice(2), arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const input = path.resolve(arg('--input-dir') || path.join(__dirname, '..', 'data'));
  const collector = path.resolve(process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector'));
  // daily-update inherits the scheduler's heavy.lock; standalone runs acquire it themselves.
  if (process.platform === 'linux' && !args.includes('--lock-held')) {
    const { spawnSync } = require('child_process');
    const child = spawnSync('flock', ['-n', path.join(collector, 'heavy.lock'), process.execPath,
      '--max-old-space-size=500', __filename, ...args, '--lock-held'], { stdio: 'inherit', env: process.env });
    process.exitCode = child.status ?? 1;
    return;
  }
  const archive = path.resolve(arg('--archive-dir') || path.join(collector, 'archive'));
  const output = path.join(archive, 'positions-audit.json');
  if (!args.includes('--force') && fs.existsSync(output) && isFresh(JSON.parse(fs.readFileSync(output, 'utf8')))) {
    console.log('Positions audit: less than 7 days old; skipped'); return;
  }
  const max = Number(arg('--max') ?? 150);
  if (!Number.isInteger(max) || max < 0 || max > 150) throw new Error('--max must be 0..150');
  const read = file => JSON.parse(fs.readFileSync(path.join(input, file), 'utf8'));
  const patch = read('patch-notes.json');
  if (!patch.version || !Number.isInteger(patch.timestamp) || patch.timestamp <= 0) throw new Error('Invalid patch');
  const index = JSON.parse(fs.readFileSync(path.join(archive, 'index.json'), 'utf8'));
  const wanted = new Set((index.matches || []).map(m => String(m.matchId)));
  const rankedIds = await rankedReplayIds(path.join(input, 'steam-matches'), wanted, patch.timestamp);
  const options = { patchFrom: patch.timestamp, rankedIds, known: new Set(read('heroes.json').heroes.map(h => Number(h.id))) };
  // Keep only labels and identity after validation, not all replay coordinate/economy arrays.
  const eligible = [];
  for (const m of archiveMatches(archive)) {
    const { reason, labels } = labelReplay(m, options);
    if (!reason) eligible.push({ matchId: m.matchId, startTime: startTime(m),
      players: m.players.map(p => ({ heroId: p.heroId, slot: p.slot, team: p.team })), [LABELS]: labels });
  }
  const ids = new Set(eligible.map(m => String(m.matchId)));
  const references = new Map();
  const cache = path.join(collector, 'positions-audit-stratz');
  await loadReferences(cache, ids, references);
  await loadReferences(path.join(input, 'meta-matches'), ids, references);
  let audit = buildAudit(eligible, references, options), fetched = 0;
  // Fetch only to fill sample minimums, never to improve a failing accuracy score.
  const minimums = a => a.teams >= 100 && a.matchIds.length >= 50 && a.days.length >= 2 && a.lineups >= 2 &&
    Object.values(a.roles).every(r => r.total >= 50) &&
    Object.values(a.roles).reduce((n, r) => n + r.total, 0) / (a.teams * 5) >= .9;
  let token;
  for (const m of eligible) {
    if (minimums(audit) || fetched >= max) break;
    const id = String(m.matchId);
    if (references.has(id)) continue;
    if (!/^\d+$/.test(id)) continue;
    token ||= readToken();
    const got = await ask(token, Number(id), 'query($id:Long!){match(id:$id){id players{heroId isRadiant position}}}');
    const row = got || { id, players: [] };
    fs.mkdirSync(cache, { recursive: true });
    fs.appendFileSync(path.join(cache, 'matches.jsonl'), JSON.stringify(row) + '\n');
    references.set(id, row); fetched++;
    audit = buildAudit(eligible, references, options);
    await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
  }
  fs.mkdirSync(archive, { recursive: true });
  writeJsonAtomic(output, audit);
  console.log(`Positions audit: ${audit.matchIds.length} matches, ${audit.ambiguous} ambiguous, ${fetched} fetched, gate ${auditGate(audit) ? 'pass' : 'fail'}`);
}
if (require.main === module) main().catch(() => { console.error('Positions audit failed; previous audit preserved (check input, Stratz access and limits)'); process.exitCode = 1; });
module.exports = { buildAudit, referencePlayers, isFresh, LABELS };
