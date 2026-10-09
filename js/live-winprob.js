/* Шанс победы по ходу игры — одна формула для эфира (js/live.js), страницы итогов (js/live-match.js)
 * и обучения (tools/build-live-winprob.js). Менять признаки — только здесь, затем переобучить.
 *
 * Логистическая регрессия: P(Свет) = 1 / (1 + exp(−z)), z = w · x. Признаки на минуте t (кратно 60 с, поле adv
 * файла матча — разница сумм капитала и опыта Света и Тьмы, tools/replay/normalize.js):
 *   1, капитал/10 000, опыт/10 000, разница уничтоженных башен (Тьмы − Света), то же для бараков,
 *   капитал/10 000 × 10/мин, опыт/10 000 × 10/мин, разница башен × мин/60.
 * Коэффициенты и качество на отложенных матчах — data/live-winprob.json.
 */
(function (root) {
  'use strict';
  function count(m, t, re) { var n = 0; for (var i = 0; i < m.buildings.length; i++) if (m.buildings[i].t <= t && re.test(m.buildings[i].name)) n++; return n; }
  // Признаки на i-й минуте adv.
  function features(m, i) {
    var t = m.adv.t[i], mi = t / 60, s = Math.max(mi, 1), g = m.adv.gold[i] / 1e4, x = m.adv.xp[i] / 1e4;
    var tw = count(m, t, /^badguys_tower/) - count(m, t, /^goodguys_tower/), rx = count(m, t, /^badguys_.*rax/) - count(m, t, /^goodguys_.*rax/);
    return [1, g, x, tw, rx, g * 10 / s, x * 10 / s, tw * mi / 60];
  }
  function logit(w, f) { var z = 0; for (var j = 0; j < w.length; j++) z += w[j] * f[j]; return 1 / (1 + Math.exp(-z)); }
  // Ряд прогноза по всем минутам матча с первой: [{t, p}], p — шанс Света 0..1.
  function series(m, w) {
    var out = [];
    for (var i = 0; i < m.adv.t.length; i++) if (m.adv.t[i] >= 60) out.push({ t: m.adv.t[i], p: logit(w, features(m, i)) });
    return out;
  }
  // Шанс Света на секунде t — по последней прошедшей минуте; до 1-й минуты — null.
  function at(m, w, t) {
    var k = -1; for (var i = 0; i < m.adv.t.length && m.adv.t[i] <= t; i++) if (m.adv.t[i] >= 60) k = i;
    return k < 0 ? null : logit(w, features(m, k));
  }
  var api = { features: features, logit: logit, series: series, at: at };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LiveWinProb = api;
})(this);
