'use strict';

const SOURCE = 'steam';
const COHORT = 'ranked-all-ranks';

function assertProvenance(meta, patch) {
  if (!meta || meta.source !== SOURCE || meta.cohort !== COHORT || meta.patch !== patch ||
      !Number.isInteger(meta.patchFrom) || meta.patchFrom <= 0) throw new Error('Invalid Steam ranked provenance or patch');
  return meta;
}

function inspectSteamRow(row, { known, patchFrom, patchTo = Infinity } = {}) {
  if (!Array.isArray(row) || row.length < 19) return 'malformed';
  if (!Number.isInteger(row[0]) || row[0] <= 0) return 'invalidId';
  if (!Number.isInteger(row[2]) || row[2] < patchFrom || row[2] >= patchTo) return 'outsidePatch';
  if (row[7] !== 7 || row[6] !== 22) return 'notRanked';
  if (!Number.isFinite(row[3]) || row[3] < 900) return 'short';
  if (row[5] !== 0 && row[5] !== 1) return 'missingResult';
  const ids = row.slice(9, 19).map(p => Array.isArray(p) ? p[0] : null);
  if (ids.some(id => !Number.isInteger(id) || id <= 0 || (known && !known.has(id))) || new Set(ids).size !== 10) return 'invalidHeroes';
  return null;
}

function newCoverage() { return { seen: 0, accepted: 0, excluded: {} }; }
function createRowFilter(options) {
  const ids = new Set();
  return row => {
    const reason = inspectSteamRow(row, options);
    if (reason) return reason;
    if (ids.has(row[0])) return 'duplicateId';
    ids.add(row[0]);
    return null;
  };
}
function count(coverage, reason) {
  coverage.seen++;
  if (reason) coverage.excluded[reason] = (coverage.excluded[reason] || 0) + 1;
  else coverage.accepted++;
}

module.exports = { SOURCE, COHORT, assertProvenance, inspectSteamRow, createRowFilter, newCoverage, count };
