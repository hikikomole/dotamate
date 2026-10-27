'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const MS = require('./match-source');
const { rankRole } = require('./stats-rating');
const { archiveMatches, labelReplay, startTime } = require('./replay-cohort');

function auditGate(audit) {
  if (!audit || audit.source !== 'valve-replay' || audit.methodVersion !== 1 || audit.teams < 100 ||
      !Array.isArray(audit.matchIds) || new Set(audit.matchIds.map(String)).size < 50 ||
      !Array.isArray(audit.days) || audit.days.length < 2 ||
      !Number.isInteger(audit.lineups) || audit.lineups < 2 || !Number.isInteger(audit.ambiguous) || audit.ambiguous < 0) return false;
  return [1, 2, 3, 4, 5].every(pos => {
    const r = audit.roles && audit.roles[pos];
    const confusion = r?.confusion;
    return r && Number.isInteger(r.total) && r.total >= 50 && Number.isInteger(r.correct) &&
      confusion && Object.values(confusion).every(n => Number.isInteger(n) && n >= 0) &&
      Object.values(confusion).reduce((n, x) => n + x, 0) === r.total && confusion[pos] === r.correct &&
      r.correct / r.total >= .85;
  });
}

function buildRoleMeta(matches, patch, known, audit, now = new Date()) {
  const patchFrom = Number(patch.timestamp);
  if (!patch.version || !Number.isInteger(patchFrom) || patchFrom <= 0) throw new Error('Invalid patch');
  const positions = Object.fromEntries([1, 2, 3, 4, 5].map(p => [p, { matches: 0, labeledSlots: 0, eligibleHeroes: 0, lowSampleHeroes: 0, hiddenHeroes: 0, hiddenAppearances: 0, heroes: [] }]));
  const raw = Object.fromEntries([1, 2, 3, 4, 5].map(p => [p, new Map()]));
  const exclusions = {}, seen = new Set();
  let accepted = 0, players = 0, labeled = 0, from = Infinity, to = 0;
  for (const m of matches) {
    const id = String(m.matchId ?? m.id ?? '');
    if (!id || seen.has(id)) { exclusions.duplicateId = (exclusions.duplicateId || 0) + 1; continue; }
    seen.add(id);
    const { reason, labels } = labelReplay(m, { patchFrom, known });
    if (reason) { exclusions[reason] = (exclusions[reason] || 0) + 1; continue; }
    accepted++; players += 10;
    const start = startTime(m); from = Math.min(from, start); to = Math.max(to, start);
    for (const q of labels) {
      if (!Number.isInteger(q.pos) || q.pos < 1 || q.pos > 5) continue;
      labeled++;
      positions[q.pos].labeledSlots++;
      const h = raw[q.pos].get(q.h) || { id: q.h, n: 0, w: 0 };
      h.n++; h.w += (q.s < 128) === m.radiantWin ? 1 : 0;
      raw[q.pos].set(q.h, h);
    }
    for (let p = 1; p <= 5; p++) if (labels.filter(q => q.pos === p).length === 2) positions[p].matches++;
  }
  const coverage = players ? labeled / players : 0;
  const gatePassed = auditGate(audit) && coverage >= .9;
  for (let p = 1; p <= 5; p++) {
    const counts = [...raw[p].values()];
    positions[p].eligibleHeroes = counts.filter(h => h.n >= 100).length;
    positions[p].lowSampleHeroes = counts.filter(h => h.n >= 30 && h.n < 100).length;
    positions[p].hiddenHeroes = counts.filter(h => h.n < 30).length;
    positions[p].hiddenAppearances = counts.filter(h => h.n < 30).reduce((n, h) => n + h.n, 0);
    positions[p].heroes = gatePassed ? rankRole(counts.filter(h => h.n >= 30), positions[p].labeledSlots) : [];
  }
  const hasRows = Object.values(positions).some(q => q.heroes.length > 0);
  return { schemaVersion: 1, builtAt: now.toISOString(), status: gatePassed && hasRows ? 'ok' : 'insufficient',
    meta: { source: 'valve-replay', cohort: 'ranked-replay-sample', patch: patch.version, patchFrom,
      from: accepted ? new Date(from * 1000).toISOString() : null, to: accepted ? new Date(to * 1000).toISOString() : null,
      matches: accepted, players, methodVersion: 1, exclusions,
      coverage: { labeledSlots: labeled, possibleSlots: players, share: Math.round(coverage * 10000) / 100, gatePassed,
        audit: { teams: audit?.teams || 0, days: audit?.days?.length || 0, lineups: audit?.lineups || 0,
          roles: audit?.roles || {}, ambiguous: audit?.ambiguous || 0 } } }, positions };
}

function main() {
  const args = process.argv.slice(2), arg = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  const fixture = args.includes('--fixture');
  if (fixture && !arg('--input-dir')) throw new Error('--fixture requires --input-dir');
  const input = path.resolve(arg('--input-dir') || path.join(__dirname, '..', 'data'));
  const output = path.resolve(arg('--out-dir') || input);
  const archive = path.resolve(arg('--archive-dir') || (fixture ? path.join(input, 'archive') : path.join(process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector'), 'archive')));
  const read = name => JSON.parse(fs.readFileSync(path.join(input, name), 'utf8'));
  const patch = read('patch-notes.json'), known = new Set(read('heroes.json').heroes.map(h => Number(h.id)));
  const auditPath = path.join(archive, 'positions-audit.json');
  const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, 'utf8')) : null;
  const result = buildRoleMeta(archiveMatches(archive), patch, known, audit);
  fs.mkdirSync(output, { recursive: true });
  MS.writeJsonAtomic(path.join(output, 'role-meta.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`role-meta.json: ${result.status}, ${result.meta.matches} matches`);
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { auditGate, buildRoleMeta };
