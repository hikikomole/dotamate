/*
 * Страница итогов матча эфира: /live/match/?id=<номер>. Данные — тот же файл матча, что у эфира
 * (/api/live/match/<id>, tools/replay/normalize.js). Прогнозы: по драфту — js/draft-model.js (срез Divine 5 и Immortal,
 * как в эфире), по ходу игры — js/live-winprob.js. Страница не индексируется (noindex, не в sitemap): решение владельца 09.10.2026.
 */
(function () {
  'use strict';
  var root = document.getElementById('liveMatch');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var body = $('lmBody');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n).toLocaleString('ru-RU'); }
  function clock(t) { var s = Math.abs(Math.floor(t)); return (t < 0 ? '−' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function msg(html) { body.innerHTML = '<p class="lm-msg">' + html + '</p>'; $('lmStamp').textContent = ''; }
  function getJson(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  var soft = function (p) { return p.catch(function (e) { if (window.console) console.warn(e.message); return null; }); };

  var id = (location.search.match(/[?&]id=(\d{6,12})\b/) || [])[1];
  if (!id) { msg('Не указан номер матча. <a href="/live/">Вернуться в эфир →</a>'); return; }

  var BUILD = { tower1: 'башня T1', tower2: 'башня T2', tower3: 'башня T3', tower4: 'башня T4', melee_rax: 'казармы ближнего боя', range_rax: 'казармы дальнего боя', fort: 'трон' };
  var LANE = { top: 'верх', mid: 'центр', bot: 'низ' };
  function bName(m, n) {
    var side = n.indexOf('goodguys') === 0 ? team(m, 'radiant') : team(m, 'dire'), rest = n.replace(/^(goodguys|badguys)_/, '');
    var lane = (rest.match(/_(top|mid|bot)$/) || [])[1]; rest = rest.replace(/_(top|mid|bot)$/, '');
    return esc(side) + ': ' + (BUILD[rest] || esc(rest)) + (lane ? ', ' + LANE[lane] : '');
  }
  function team(m, side) { return side === 'radiant' ? (m.pro && m.pro.radiant || 'Radiant') : (m.pro && m.pro.dire || 'Dire'); }

  Promise.all([
    getJson('/api/live/match/' + id),
    soft(getJson('/data/live-winprob.json')),
    soft(Promise.all([getJson('/data/our-matrix-top.json'), getJson('/data/draft-calibration-top.json')])),
    soft(getJson('/api/live/poll/' + id)),
    soft(getJson('/api/live/words/' + id)),
  ]).then(function (r) { render(r[0], r[1], r[2], r[3], r[4]); }).catch(function (e) {
    if (e.status === 404) msg('Матча <b>' + esc(id) + '</b> нет в архиве эфира: полные записи обычных матчей хранятся 14 дней. <a href="/live/">Вернуться в эфир →</a>');
    else msg('Не удалось загрузить матч (' + esc(e.message) + '). Обновите страницу чуть позже. <a href="/live/">Вернуться в эфир →</a>');
  });

  // SVG-график: ряд значений по минутам. mid — где проходит ноль/50 %.
  function chart(ts, vals, o) {
    var W = 640, H = o.h || 150, P = 8, maxT = Math.max(60, ts[ts.length - 1]);
    var lim = o.lim || Math.max(1000, Math.max.apply(null, vals.map(Math.abs)));
    var X = function (t) { return P + (W - 2 * P) * t / maxT; }, Y = function (v) { return o.pct ? P + (H - 2 * P) * (1 - v) : H / 2 - (H / 2 - P) * v / lim; };
    var s = '<svg class="lm-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(o.label) + '">';
    for (var mm = 600; mm < maxT; mm += 600) s += '<line class="lm-grid" x1="' + X(mm) + '" x2="' + X(mm) + '" y1="0" y2="' + H + '"/>';
    s += '<line class="lm-mid" x1="' + P + '" x2="' + (W - P) + '" y1="' + Y(o.pct ? 0.5 : 0) + '" y2="' + Y(o.pct ? 0.5 : 0) + '"/>';
    (o.marks || []).forEach(function (t) { s += '<line class="lm-mark" x1="' + X(t) + '" x2="' + X(t) + '" y1="0" y2="' + H + '"/>'; });
    for (var i = 1; i < vals.length; i++) {
      var up = o.pct ? (vals[i] + vals[i - 1]) / 2 >= 0.5 : vals[i] + vals[i - 1] >= 0;
      s += '<line class="' + (up ? 'rad' : 'dire') + '" x1="' + X(ts[i - 1]).toFixed(1) + '" y1="' + Y(vals[i - 1]).toFixed(1) + '" x2="' + X(ts[i]).toFixed(1) + '" y2="' + Y(vals[i]).toFixed(1) + '"/>';
    }
    s += '</svg><div class="lm-axis">';
    for (var m2 = 0; m2 <= maxT; m2 += 600) s += '<span style="left:' + (100 * X(m2) / W).toFixed(2) + '%">' + m2 / 60 + '</span>';
    return s + '</div>';
  }

  function render(m, wp, dm, pl, wd) {
    var win = m.radiantWin ? 'radiant' : 'dire', winName = team(m, win);
    var played = new Date(m.endTime * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    var fort = m.buildings.some(function (b) { return /_fort$/.test(b.name); });
    document.title = 'Итоги матча ' + m.matchId + ': ' + team(m, 'radiant') + ' — ' + team(m, 'dire') + ' | Dota Mate';
    $('lmTitle').textContent = 'Итоги матча';
    $('lmStamp').innerHTML = (m.pro ? '<span class="lv-pro">Про-матч</span> ' + esc(m.pro.league) + ' · ' : 'Рейтинговый матч · ') + 'матч <b>' + esc(m.matchId) + '</b> · сыгран ' + esc(played);
    var h = '';

    // Итог
    h += '<div class="lm-top lv-block"><div class="lm-res"><b class="' + win + '">Победа ' + esc(winName) + '</b><span>' + (fort ? 'трон разрушен' : 'соперник сдался') + ' на ' + clock(m.t1) + '</span></div>' +
      '<div class="lv-score"><span class="rad">' + m.score.radiant + '</span><span class="lv-score-sep">:</span><span class="dire">' + m.score.dire + '</span></div>' +
      '<div class="lm-links"><a href="/live/">← В эфир</a><a id="lmPro" href="/pro/match/' + esc(m.matchId) + '/" hidden>Разбор в про-матчах →</a></div></div>';

    // Прогнозы
    var ids = function (side) { return m.players.filter(function (p) { return p.team === side; }).map(function (p) { return p.heroId; }); };
    var pd = null;
    if (dm && dm[0] && dm[0].pairs && dm[1] && dm[1].alpha && window.DraftModel) {
      var D = window.DraftModel, idx = D.index(dm[0]), rad = ids('radiant'), dire = ids('dire');
      var S = D.synergy(dm[0], idx, rad, 0) - D.synergy(dm[0], idx, dire, 0) + D.matchup(dm[0], idx, rad, dire, 0), pr = D.prob(S, dm[1]);
      if (pr !== null) pd = { p: pr / 100, n: dm[0].matchesUsed, link: '/#draft=' + rad.join('-') + '_' + dire.join('-') + '_' };
    }
    var ser = wp && wp.w && window.LiveWinProb ? window.LiveWinProb.series(m, wp.w) : null;
    if (ser && !ser.length) ser = null;
    var pw = function (p) { return m.radiantWin ? p : 1 - p; }; // шанс победителя
    h += '<div class="lv-block lm-pred"><h2>Насколько угадали прогнозы</h2><div class="lm-cards">';
    if (pd) {
      var ok = pw(pd.p) >= 0.5;
      h += '<div class="lm-card"><span class="lm-k">По драфту</span><b class="' + (ok ? 'ok' : 'no') + '">' + (ok ? 'Угадал' : 'Не угадал') + '</b>' +
        '<span>' + esc(winName) + ': ' + pct(pw(pd.p)) + ' до начала игры</span><small>DraftMate, ' + num(pd.n) + ' матчей Divine 5 и Immortal. <a href="' + pd.link + '">Открыть драфт →</a></small></div>';
    }
    if (ser) {
      var right = ser.filter(function (q) { return pw(q.p) >= 0.5; }).length, since = null;
      for (var i = ser.length - 1; i >= 0 && pw(ser[i].p) >= 0.5; i--) since = ser[i].t;
      var worst = ser.reduce(function (a, q) { return pw(q.p) < pw(a.p) ? q : a; }, ser[0]);
      var at = function (min) { for (var j = 0; j < ser.length; j++) if (ser[j].t === min * 60) return pw(ser[j].p); return null; };
      var marks = [10, 20, 30].filter(function (x) { return at(x) !== null; }).map(function (x) { return x + '-я мин — ' + pct(at(x)); });
      h += '<div class="lm-card"><span class="lm-k">По ходу игры</span><b class="' + (since !== null ? 'ok' : 'no') + '">' +
        (since === null ? 'В конце ошибался' : since <= 60 ? 'Верно весь матч' : 'Верно с ' + Math.round(since / 60) + '-й минуты') + '</b>' +
        '<span>За победителя в ' + right + ' из ' + ser.length + ' мин' + (marks.length ? '; ' + marks.join(', ') : '') + '</span>' +
        (pw(worst.p) < 0.5 ? '<small>Самый низкий шанс у ' + esc(winName) + ': ' + pct(pw(worst.p)) + ' на ' + clock(worst.t) + (pw(worst.p) < 0.25 ? ' — настоящий камбэк.' : '.') + '</small>' : '<small>Шанс ' + esc(winName) + ' ни разу не опускался ниже 50%.</small>') + '</div>';
    }
    // Опрос зрителей общего эфира (чат 5). Пока опрос открыт и голоса нет, сервер счёт не отдаёт (total = null) — карточки нет.
    if (pl && pl.total) {
      var sh = (m.radiantWin ? pl.r : pl.d) / pl.total;
      h += '<div class="lm-card"><span class="lm-k">Зрители эфира</span><b class="' + (sh > 0.5 ? 'ok' : 'no') + '">' + (sh === 0.5 ? 'Поровну' : sh > 0.5 ? 'Угадали' : 'Не угадали') + '</b>' +
        '<span>За ' + esc(winName) + ': ' + pct(sh) + ' голосов</span><small>Опрос «Кто победит?» в общем эфире, голосов: ' + num(pl.total) + '. Один голос с браузера.</small></div>';
    }
    if (!pd && !ser) h += '<p class="lm-msg">Прогнозы сейчас недоступны.</p>';
    h += '</div>';
    if (wp && wp.test) h += '<p class="lm-note">Шанс по ходу игры считается по разнице капитала, опыта, башен и бараков с поправкой на минуту матча. Модель обучена на ' + num(wp.matches) + ' матчах архива эфира; на ' + num(wp.test.matches) + ' отложенных матчах, которых она не видела, прогноз указывал на победителя в ' + Math.round(wp.test.accuracy * 100) + '% минут (угадывание наугад — 50%).' + (wp.built ? ' Модель обновлена ' + esc(new Date(wp.built).toLocaleDateString('ru-RU')) + ', переобучается каждый день.' : '') + '</p>';
    h += '</div>';

    // Графики
    var rosh = m.roshan.map(function (q) { return q.t; });
    h += '<div class="lm-charts">';
    if (ser) h += '<div class="lv-block"><div class="lv-block-head"><h2>Шанс победы ' + esc(team(m, 'radiant')) + '</h2><span class="lm-leg">0–100%, линия посередине — 50%</span></div>' + chart(ser.map(function (q) { return q.t; }), ser.map(function (q) { return q.p; }), { pct: true, label: 'Шанс победы по минутам' }) + '</div>';
    if (m.adv && m.adv.t.length > 1) {
      h += '<div class="lv-block"><div class="lv-block-head"><h2>Перевес по капиталу</h2><span class="lm-leg">вверх — ' + esc(team(m, 'radiant')) + ', вертикальные линии — Рошан</span></div>' + chart(m.adv.t, m.adv.gold, { label: 'Разница капитала по минутам', marks: rosh }) + '</div>';
      h += '<div class="lv-block"><div class="lv-block-head"><h2>Перевес по опыту</h2><span class="lm-leg">вверх — ' + esc(team(m, 'radiant')) + '</span></div>' + chart(m.adv.t, m.adv.xp, { label: 'Разница опыта по минутам' }) + '</div>';
    }
    h += '</div>';

    // Ключевые моменты
    var ev = [], pname = function (s) { var p = m.players[s]; return p ? '<b class="' + p.team + '">' + esc(p.hero) + '</b>' : ''; };
    var fb = m.deaths.filter(function (d) { return d.killer >= 0 && d.killer <= 9; })[0];
    if (fb) ev.push([fb.t, 'Первая кровь — ' + pname(fb.killer) + ' убивает ' + pname(fb.victim)]);
    m.roshan.forEach(function (q, k) { ev.push([q.t, 'Рошан убит' + (m.roshan.length > 1 ? ' (' + (k + 1) + '-й раз)' : '')]); });
    m.buildings.forEach(function (b) { if (!/tower[12]_/.test(b.name)) ev.push([b.t, 'Разрушено — ' + bName(m, b.name)]); });
    ['goodguys', 'badguys'].forEach(function (s) { var f = m.buildings.filter(function (b) { return b.name.indexOf(s + '_tower1') === 0; })[0]; if (f) ev.push([f.t, 'Первая башня — ' + bName(m, f.name)]); });
    if (ser) {
      var sw = []; for (var k = 1; k < ser.length; k++) sw.push({ t: ser[k].t, a: ser[k - 1].p, b: ser[k].p });
      sw.filter(function (q) { return Math.abs(q.b - q.a) >= 0.1; }).sort(function (x, y) { return Math.abs(y.b - y.a) - Math.abs(x.b - x.a); }).slice(0, 3)
        .forEach(function (q) { ev.push([q.t, 'Перелом: шанс ' + esc(team(m, 'radiant')) + ' ' + pct(q.a) + ' → ' + pct(q.b) + ' за минуту']); });
    }
    ev.sort(function (a, b) { return a[0] - b[0]; });
    h += '<div class="lv-block lm-moments"><h2>Ключевые моменты</h2><ol class="lv-feed">' + ev.map(function (e) { return '<li><time>' + clock(e[0]) + '</time><span>' + e[1] + '</span></li>'; }).join('') + '</ol></div>';

    // Частые слова чата (чат 5): за весь матч, слова из двух и более сообщений.
    if (wd && wd.words) {
      var tw = wd.words.filter(function (x) { return x[1].length >= 2; }).slice(0, 10);
      h += '<div class="lv-block"><h2>Частые слова в чате</h2>' + (tw.length ? '<ol class="lv-words">' + tw.map(function (x) { return '<li><span>' + esc(x[0]) + '</span><b>' + x[1].length + '</b></li>'; }).join('') + '</ol>'
        : '<p class="lv-muted">' + (wd.msgs ? 'Ни одно слово не повторилось хотя бы в двух сообщениях.' : 'Игроки не писали в чат.') + '</p>') +
        '<p class="lv-muted lv-words-note">Сообщений в чате: ' + num(wd.msgs) + '. Каждое слово считается один раз на сообщение; ссылки и служебные слова убраны.</p></div>';
    }

    // Игроки
    var rows = function (side) {
      return m.players.filter(function (p) { return p.team === side; }).map(function (p) {
        return '<tr><td><a class="lm-hero" href="/hero/' + esc(p.slug) + '/"><img src="/assets/heroes/' + esc(p.slug) + '.webp" alt="" width="40" height="22" loading="lazy">' + esc(p.hero) + '</a></td>' +
          '<td>' + p.lvl + '</td><td>' + p.k + '/' + p.d + '/' + p.a + '</td><td>' + p.lh + '/' + p.dn + '</td><td>' + num(p.nw) + '</td></tr>';
      }).join('');
    };
    ['radiant', 'dire'].forEach(function (side) {
      h += '<div class="lv-block lm-team ' + side + '"><h2>' + esc(team(m, side)) + (side === win ? ' — победа' : '') + '</h2><div class="lm-scroll"><table class="lm-tbl"><thead><tr><th>Герой</th><th>Ур.</th><th>У/С/П</th><th>Д/Д</th><th>Капитал</th></tr></thead><tbody>' + rows(side) + '</tbody></table></div></div>';
    });
    body.innerHTML = h;

    if (m.pro) fetch('/pro/match/' + encodeURIComponent(m.matchId) + '/', { method: 'HEAD' }).then(function (r) { if (r.ok) $('lmPro').hidden = false; }).catch(function () {});
  }
})();
