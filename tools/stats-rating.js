'use strict';

const Z = 1.96;

function wilsonLow(w, n) {
  if (!Number.isInteger(n) || !Number.isInteger(w) || n < 0 || w < 0 || w > n) throw new Error('Invalid win counts');
  if (!n) return null;
  const q = w / n, z2 = Z * Z;
  return (q + z2 / (2 * n) - Z * Math.sqrt(q * (1 - q) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function rankRole(rows, labeledSlots) {
  const round = x => Math.round(x * 100) / 100;
  const sorted = rows.map(({ id, n, w }) => {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid hero ID');
    const lo = wilsonLow(w, n);
    return { id, n, w, wr: n >= 30 ? round(100 * w / n) : null,
      lo: n >= 100 ? round(100 * lo) : null, rating: n >= 100 ? round(100 * lo) : null,
      tier: null, pickShare: labeledSlots > 0 ? round(100 * n / labeledSlots) : null,
      _sort: lo };
  }).sort((a, b) => (b._sort ?? -1) - (a._sort ?? -1) || b.n - a.n || a.id - b.id);
  const eligible = sorted.filter(x => x.n >= 100);
  if (eligible.length >= 5) eligible.forEach((h, i) => {
    h.tier = i < Math.ceil(eligible.length * .2) ? 'S' : i < Math.ceil(eligible.length * .5) ? 'A' : 'B';
  });
  return sorted.map(({ _sort, ...row }) => row);
}

module.exports = { wilsonLow, rankRole };
