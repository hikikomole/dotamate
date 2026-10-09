/* Модель драфта — одна на сайт: помощник DraftMate (js/draft-tool.js) и прогноз в эфире (js/live.js).
 *
 * Матрица пар (data/our-matrix*.json, data/draft-matrix.json): pairs.with/vs — верхний треугольник [матчей, побед].
 * Доля побед пары сглаживается к 50% ((w + K/2)/(n + K), K = 50), отклонения в п.п. складываются:
 *   S = (синергия Света − синергия Тьмы) + сумма матчапов Свет×Тьма.
 * Вероятность: P(Свет) = 1 / (1 + exp(−a·S)), a — из data/draft-calibration*.json (tools/build-draft-calibration.js).
 * Та же формула в tools/build-draft-calibration.js — менять обе вместе.
 */
(function () {
  'use strict';
  var K = 50;
  function index(M) { var idx = {}; M.heroIds.forEach(function (id, i) { idx[id] = i; }); return idx; }
  function pairKey(N, i, j) {
    return i < j ? (i * (2 * N - i - 1)) / 2 + (j - i - 1) : (j * (2 * N - j - 1)) / 2 + (i - j - 1);
  }
  // minN > 0 — режим отсечки малой выборки: пара с n < minN не учитывается.
  function adv(n, w, minN) {
    if (!n || (minN && n < minN)) return 0;
    return 100 * ((w + K / 2) / (n + K)) - 50;
  }
  function withAdv(M, idx, a, b, minN) {
    var i = idx[a], j = idx[b];
    if (i === undefined || j === undefined || i === j) return 0;
    var p = M.pairs['with'][pairKey(M.heroCount, i, j)];
    return adv(p[0], p[1], minN);
  }
  // Преимущество героя a против героя b.
  function vsAdv(M, idx, a, b, minN) {
    var i = idx[a], j = idx[b];
    if (i === undefined || j === undefined || i === j) return 0;
    var p = M.pairs.vs[pairKey(M.heroCount, i, j)];
    return i < j ? adv(p[0], p[1], minN) : adv(p[0], p[0] - p[1], minN);
  }
  function synergy(M, idx, ids, minN) {
    var p = ids.filter(Boolean), s = 0;
    for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++) s += withAdv(M, idx, p[i], p[j], minN);
    return s;
  }
  function matchup(M, idx, rad, dire, minN) {
    var s = 0;
    rad.filter(Boolean).forEach(function (a) { dire.filter(Boolean).forEach(function (b) { s += vsAdv(M, idx, a, b, minN); }); });
    return s;
  }
  function score(M, idx, rad, dire, minN) {
    return synergy(M, idx, rad, minN) - synergy(M, idx, dire, minN) + matchup(M, idx, rad, dire, minN);
  }
  function prob(S, calib) { return calib && calib.alpha ? 100 / (1 + Math.exp(-calib.alpha * S)) : null; }
  window.DraftModel = { K: K, index: index, adv: adv, withAdv: withAdv, vsAdv: vsAdv, synergy: synergy, matchup: matchup, score: score, prob: prob };
})();
