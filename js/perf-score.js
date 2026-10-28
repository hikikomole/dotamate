(function (root) {
  'use strict';
  const keys = ['k', 'd', 'a', 'lh', 'gpm', 'xpm', 'hd'];
  const sources = { k: 'kills', d: 'deaths', a: 'assists', lh: 'last_hits', gpm: 'gold_per_min', xpm: 'xp_per_min', hd: 'hero_damage' };
  const reasons = { wrongPatch: 'Другой патч', insufficientHero: 'Мало игр на герое', notEligible: 'Матч не подходит для оценки', dataMissing: 'Не хватает данных', jsonUnavailable: 'Данные оценки недоступны' };
  const leaverNote = 'статус выхода игроков не проверен (старый кеш)';
  function tooltip(match, perf) { return `${perf?.stale ? 'Данные старше 48 часов' : 'Индекс по 7 показателям'}${match.leaverUnknown && perf?.score != null ? `. ${leaverNote}` : ''}`; }
  let pending;
  function load() {
    if (!pending) pending = Promise.all(['/data/performance-percentiles.json', '/data/patch-notes.json'].map(url => fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }))).then(([data, patch]) => {
      if (data.patch !== patch.version || data.patchFrom !== patch.timestamp) throw new Error('Patch mismatch');
      return data;
    });
    return pending;
  }
  function percentile(value, points) {
    if (!Number.isFinite(value) || !Array.isArray(points) || points.length !== 21 || points.some(x => !Number.isFinite(x))) return null;
    if (value < points[0]) return 0;
    if (value > points[20]) return 100;
    let left = 0, right = 20;
    while (left < right) { const mid = Math.floor((left + right) / 2); if (points[mid] < value) left = mid + 1; else right = mid; }
    if (points[left] === value) {
      let end = left;
      while (end < 20 && points[end + 1] === value) end++;
      return (left + end) * 2.5;
    }
    const lo = left - 1;
    return (lo + (value - points[lo]) / (points[left] - points[lo])) * 5;
  }
  function score(match, player, data) {
    if (!data || data.methodVersion !== '2' || !data.heroes || !data.weights || !Number.isFinite(Number(data.patchFrom))) return { score: null, perMetric: null, reason: 'jsonUnavailable' };
    const start = Number(match.start);
    if (!Number.isFinite(start) || start < Number(data.patchFrom)) return { score: null, perMetric: null, reason: 'wrongPatch' };
    if (match.scoreEligible !== true) return { score: null, perMetric: null, reason: 'notEligible' };
    const hero = data.heroes[String(player.hero ?? player.heroId)];
    if (!hero || hero.insufficient || keys.some(k => !hero.metrics?.[k] || hero.metrics[k].insufficient)) return { score: null, perMetric: null, reason: 'insufficientHero' };
    const duration = Number(match.duration), missing = player.missing || [];
    if (!Number.isFinite(duration) || !(duration >= 900) || keys.some(k => missing.includes(sources[k]) || player[k === 'lh' && player.lastHits != null ? 'lastHits' : k === 'hd' && player.heroDamage != null ? 'heroDamage' : k] == null)) return { score: null, perMetric: null, reason: 'dataMissing' };
    const perMetric = {}; let total = 0, weight = 0;
    for (const k of keys) {
      const raw = Number(player[k === 'lh' && player.lastHits != null ? 'lastHits' : k === 'hd' && player.heroDamage != null ? 'heroDamage' : k]);
      if (!Number.isFinite(raw) || raw < 0) return { score: null, perMetric: null, reason: 'dataMissing' };
      const value = ['k', 'd', 'a', 'lh', 'hd'].includes(k) ? raw * 60 / duration : raw;
      const p = percentile(value, hero.metrics[k].breakpoints);
      if (p == null) return { score: null, perMetric: null, reason: 'dataMissing' };
      const w = Number(data.weights[k]);
      if (!Number.isFinite(w) || w <= 0) return { score: null, perMetric: null, reason: 'jsonUnavailable' };
      perMetric[k] = k === 'd' ? 100 - p : p;
      total += perMetric[k] * w; weight += w;
    }
    const stale = Date.now() - Date.parse(data.builtAt) > 48 * 3600 * 1000;
    return { score: Math.round(total / weight), perMetric, stale, n: hero.n, patch: data.patch, from: data.from, to: data.to, weights: data.weights, reason: null };
  }
  async function evaluate(match, player) { try { return score(match, player, await load()); } catch (_) { return { score: null, perMetric: null, reason: 'jsonUnavailable' }; } }
  root.perfScore = { load, score, evaluate, percentile, reasons, tooltip, leaverNote };
  if (typeof module !== 'undefined') module.exports = root.perfScore;
})(typeof window !== 'undefined' ? window : globalThis);
