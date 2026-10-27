'use strict';
const { SOURCE, COHORT, createRowFilter, newCoverage, count } = require('./stats-cohort');

async function buildSummary(rows, patch, known, now = new Date()) {
  const patchFrom = Number(patch.timestamp);
  if (!patch.version || !Number.isInteger(patchFrom) || patchFrom <= 0) throw new Error('Invalid Valve patch boundary');
  const check = createRowFilter({ known, patchFrom, patchTo: Infinity });
  const coverage = newCoverage(), heroes = new Map();
  let matches = 0, radiantWins = 0, from = Infinity, to = 0, banRecorded = 0;
  for await (const row of rows) {
    const reason = check(row);
    count(coverage, reason);
    if (reason) continue;
    const picks = row.slice(9, 19).map(p => p[0]);
    const bans = row[8];
    if (row[19] === true && Array.isArray(bans)) {
      banRecorded++;
      const distinct = new Set(bans.filter(id => known.has(id)));
      if (picks.some(id => distinct.has(id))) throw new Error(`Pick/ban overlap in match ${row[0]}`);
      for (const id of distinct) {
        const h = heroes.get(id) || { id, picks: 0, wins: 0, bans: 0 };
        h.bans++; heroes.set(id, h);
      }
    }
    for (const [i, id] of picks.entries()) {
      const h = heroes.get(id) || { id, picks: 0, wins: 0, bans: 0 };
      h.picks++; heroes.set(id, h);
      h.wins += (i < 5) === (row[5] === 1) ? 1 : 0;
    }
    matches++; radiantWins += row[5];
    from = Math.min(from, row[2]); to = Math.max(to, row[2]);
  }
  const asOf = now.toISOString(), releasedAt = new Date(patchFrom * 1000).toISOString();
  const patchDays = patchFrom <= now.getTime() / 1000 ? Math.floor((now.getTime() / 1000 - patchFrom) / 86400) : null;
  const contested = matches && banRecorded === matches
    ? [...heroes.values()].map(h => ({ ...h, total: h.picks + h.bans })).sort((a, b) => b.total - a.total || a.id - b.id)[0] || null : null;
  return {
    schemaVersion: 1, builtAt: asOf, status: matches ? 'ok' : 'insufficient',
    meta: { source: SOURCE, cohort: COHORT, patch: patch.version, patchFrom, from: matches ? new Date(from * 1000).toISOString() : null,
      to: matches ? new Date(to * 1000).toISOString() : null, matches, players: matches * 10,
      methodVersion: 1, exclusions: coverage.excluded, coverage: { seen: coverage.seen, banRecorded, banPresenceKnown: banRecorded === matches && matches > 0 } },
    heroes: [...heroes.values()].sort((a, b) => a.id - b.id),
    summary: { patch: patch.version, releasedAt: patchDays === null ? null : releasedAt, asOf,
      patchDays, matches, from: matches ? new Date(from * 1000).toISOString() : null,
      to: matches ? new Date(to * 1000).toISOString() : null, radiantWins,
      radiantWr: matches ? Math.round(10000 * radiantWins / matches) / 100 : null,
      banCoverage: { recorded: banRecorded, matches, known: banRecorded === matches && matches > 0 }, contested }
  };
}

module.exports = { buildSummary };
