/*
 * Раздел «Эфир» (/live/): круглосуточный повтор разобранных матчей.
 * Данные: /api/live/now (расписание, общее для всех зрителей), /api/live/match/<id>
 * (файл матча из tools/replay/normalize.js), /api/live/heat (фон карты из архива).
 * Координаты матча «клеточные» (odota/parser), перевод на карту — как в tools/replay/minimap.js.
 */
(function () {
  'use strict';
  var root = document.getElementById('live');
  if (!root) return;

  var MAP_MIN = 54, MAP_SPAN = 148;          // tools/replay/minimap.js — границы из dota/resource/overviews/dota.txt
  var RESYNC_MS = 60000;
  var COL = { radiant: '#5fbf6b', dire: '#d9534f' };
  // Строения: позиции постоянны в пределах карты — извлечены из реплея обработчиком Clarity
  // tools/replay-parser/MapProbe.java (02.10.2026, совпали в матчах 9024842732 и 9024489311). Имена — как в журнале боя
  // (поле buildings файла матча). Обе башни 4-го уровня там называются одинаково (goodguys_tower4), поэтому
  // какая именно пала, неизвестно: с карты убирается первая по списку. При смене карты патчем — извлечь заново.
  var BUILDINGS = [
    ['badguys_fort', 'f', 171.2, 167.1],
    ['badguys_melee_rax_bot', 'r', 179.5, 154.5],
    ['badguys_melee_rax_mid', 'r', 164.7, 157.9],
    ['badguys_melee_rax_top', 'r', 158.5, 170.9],
    ['badguys_range_rax_bot', 'r', 175.4, 154.4],
    ['badguys_range_rax_mid', 'r', 161.9, 160.7],
    ['badguys_range_rax_top', 'r', 158.4, 175.1],
    ['badguys_tower1_bot', 't', 177.0, 110.5],
    ['badguys_tower1_mid', 't', 132.1, 133.1],
    ['badguys_tower1_top', 't', 86.8, 175.2],
    ['badguys_tower2_bot', 't', 178.0, 131.0],
    ['badguys_tower2_mid', 't', 147.5, 144.5],
    ['badguys_tower2_top', 't', 127.0, 175.0],
    ['badguys_tower3_bot', 't', 177.5, 151.7],
    ['badguys_tower3_mid', 't', 161.4, 157.4],
    ['badguys_tower3_top', 't', 155.8, 173.1],
    ['badguys_tower4', 't', 166.6, 165.3],
    ['badguys_tower4', 't', 169.3, 162.6],
    ['goodguys_fort', 'f', 81.8, 86.2],
    ['goodguys_melee_rax_bot', 'r', 94.6, 78.3],
    ['goodguys_melee_rax_mid', 'r', 91.5, 92.4],
    ['goodguys_melee_rax_top', 'r', 78.5, 98.6],
    ['goodguys_range_rax_bot', 'r', 94.6, 82.3],
    ['goodguys_range_rax_mid', 'r', 88.5, 95.2],
    ['goodguys_range_rax_top', 'r', 74.5, 98.6],
    ['goodguys_tower1_bot', 't', 166.0, 78.2],
    ['goodguys_tower1_mid', 't', 115.9, 117.0],
    ['goodguys_tower1_top', 't', 78.5, 142.5],
    ['goodguys_tower2_bot', 't', 125.2, 79.1],
    ['goodguys_tower2_mid', 't', 103.1, 105.1],
    ['goodguys_tower2_top', 't', 77.2, 121.2],
    ['goodguys_tower3_bot', 't', 97.1, 80.3],
    ['goodguys_tower3_mid', 't', 91.8, 95.6],
    ['goodguys_tower3_top', 't', 76.5, 101.4],
    ['goodguys_tower4', 't', 83.4, 90.0],
    ['goodguys_tower4', 't', 85.9, 87.4]
  ];
  var $ = function (id) { return document.getElementById(id); };
  var map = $('lvMap'), adv = $('lvAdv'), overlay = $('lvOverlay');
  var ctx = map.getContext('2d'), actx = adv.getContext('2d');

  var offset = 0, sched = null, lastSync = 0, syncing = false, lastItem = null;
  var matches = {}, heatCanvas = null, icons = {};
  // Официальная миникарта из файлов игры (materials/overviews/dota_tga, на неё ссылается dota.vmat).
  // Её границы — те же pos_x/pos_y/scale из resource/overviews/dota.txt, поэтому координаты ложатся без подгонки.
  var mapImg = new Image(); mapImg.src = '/assets/live/minimap.jpg';
  var lastSecond = null, errorShown = false, advKind = 'heroes', lastPanel = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n).toLocaleString('ru-RU'); }
  function clock(t) { var s = Math.abs(Math.floor(t)); return (t < 0 ? '−' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function uv(x, y) { return [(x - MAP_MIN) / MAP_SPAN, (MAP_MIN + MAP_SPAN - y) / MAP_SPAN]; }

  // Загрузка с таймаутом и понятными ошибками (тот же подход, что в js/meta.js).
  function getJson(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 15000);
    return fetch(url, ctl ? { signal: ctl.signal, cache: 'no-store' } : {}).then(function (r) {
      if (r.status === 503) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error === 'live_empty' ? 'В архиве пока нет матчей — первые появятся в течение часа.' : 'Эфир временно недоступен.'); });
      if (r.status === 404) throw new Error('Данных нет (404).');
      if (!r.ok) throw new Error('Сервер ответил ' + r.status + '.');
      return r.text();
    }).then(function (t) {
      if (!t) throw new Error('Пустой ответ сервера.');
      try { return JSON.parse(t); } catch (e) { throw new Error('Данные повреждены.'); }
    }).catch(function (e) {
      if (e.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд.');
      if (e instanceof TypeError) throw new Error('Нет соединения с сервером.');
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function showError(msg) { if (online) return; errorShown = true; overlay.hidden = false; overlay.innerHTML = '<p>' + esc(msg) + '</p><p class="lv-muted">Переподключаемся автоматически.</p>'; }
  // Обрыв связи: повтор через 5, 10, 20… до 60 с, плашка внизу экрана (fixed — вёрстку не сдвигает). Загруженный матч
  // продолжает играть по своим часам, поэтому при живом матче оверлей на карту не кладём.
  var lostSince = 0, retryMs = 0, nextRetry = 0, failAt = {}, conn = $('lvConn');
  function lost(msg) {
    if (!lostSince) lostSince = Date.now();
    retryMs = Math.min(60000, retryMs ? retryMs * 2 : 5000); nextRetry = Date.now() + retryMs;
    if (conn) { conn.hidden = false; conn.className = 'lv-conn'; conn.textContent = 'Связь потеряна. Переподключаемся…'; conn.title = msg; }
  }
  function restored() {
    if (!lostSince) return;
    lostSince = retryMs = nextRetry = 0;
    if (conn) { conn.className = 'lv-conn ok'; conn.textContent = 'Связь восстановлена'; setTimeout(function () { if (!lostSince) conn.hidden = true; }, 3000); }
  }
  function retryDue() { return !lostSince || Date.now() >= nextRetry; }
  window.addEventListener('online', function () { nextRetry = 0; failAt = {}; });
  // Цели Метрики (как в js/home-daily.js): счётчик грузится только после согласия на cookies — без него молча не шлём.
  function goal(name) { try { if (typeof window.ym === 'function') window.ym(112755250, 'reachGoal', name); } catch (_) {} }
  var viewedMatch = null, manual = false;

  // Полоса матчей (/api/live/list): общий эфир + последние про-матчи и рейтинговые матчи «Властелина» (выше ранга в архиве нет).
  // Выбранный матч идёт у зрителя с начала по своим часам (own); адрес /live/?m=<номер> — прямая ссылка. Общий эфир не прерывается.
  var RANKS = ['', 'Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'];
  function rankName(r) { r = +r || 0; var t = Math.floor(r / 10), s = r % 10; return RANKS[t] ? RANKS[t] + (s ? ' ' + s : '') : 'Рейтинговый матч'; }
  function urlMatch() { var v = null; try { v = new URLSearchParams(location.search).get('m'); } catch (_) {} return v && /^\d{6,12}$/.test(v) ? v : null; }
  var own = urlMatch(), ownItem = null, ownMissing = false, LIST = null, stripFor = null, tours = {};

  // «Сейчас в игре»: идущие матчи из Steam Web API — /api/live/online (список, общий для всех, обновляется раз в минуту)
  // и /api/live/online/<server_steam_id> (матч). Valve отдаёт их с задержкой трансляции (2–15 мин). Сервер переводит
  // координаты в клетки карты архива, поэтому карта, таблицы и графики — те же, что у повторов. Позиции приходят раз
  // в 3–5 с: показ идёт на ONLINE_LAG с позади последнего кадра, между кадрами — плавно. Крипов и вардов в этих данных нет.
  var ONLINE_POLL = 4000, ONLINE_LAG = 8, ONLINE_NEXT = 20000, ONLIST = null, ONL = null;
  function urlOnline() { var v = null; try { v = new URLSearchParams(location.search).get('g'); } catch (_) {} return v && /^\d{6,12}$/.test(v) ? v : null; }
  var online = null;                         // номер идущего матча (match_id) или null
  function loadOnline() {
    getJson('/api/live/online').then(function (j) { ONLIST = { at: j.at, games: j.games || [], err: null }; renderStrip(); })
      .catch(function (e) { if (window.console) console.warn('Идущие матчи:', e.message); ONLIST = { at: ONLIST ? ONLIST.at : 0, games: [], err: e.message }; renderStrip(); });
  }
  function onlineGame() {
    var g = null;
    if (ONLIST) ONLIST.games.forEach(function (x) { if (x.matchId === online) g = x; });
    if (g && ONL) ONL.sid = g.sid;
    return g || (ONL && ONL.sid ? { sid: ONL.sid } : null);
  }
  // Состояние с сервера -> объект матча в том же виде, что файл матча архива (tools/replay/normalize.js).
  function onlineMatch(s) {
    var fr = s.frames || [];
    if (!fr.length || !s.players || s.players.length !== 10 || !s.teams) return null;
    var t0 = Math.floor(fr[0][0]), t1 = fr[fr.length - 1][0], n = t1 - t0 + 1, H = s.hist, from = H.from * H.step;
    var players = s.players.map(function (p, k) {
      var x = [], y = [], j = 0;
      for (var i = 0; i < n; i++) {
        var tt = t0 + i; while (j < fr.length - 1 && fr[j + 1][0] <= tt) j++;
        var a = fr[j], b = fr[Math.min(j + 1, fr.length - 1)], f = b[0] > a[0] ? Math.max(0, Math.min(1, (tt - a[0]) / (b[0] - a[0]))) : 0;
        x.push(a[1][2 * k] + (b[1][2 * k] - a[1][2 * k]) * f); y.push(a[1][2 * k + 1] + (b[1][2 * k + 1] - a[1][2 * k + 1]) * f);
      }
      if (p.slug && !icons[p.slug]) { var img = new Image(); img.src = '/assets/heroes/' + p.slug + '.webp'; icons[p.slug] = img; }
      return { slot: p.slot, team: p.team, heroId: p.heroId, slug: p.slug, hero: p.hero || 'Герой', x: x, y: y, dead: [], items: [], inv: [[-Infinity, p.items || []]], k: p.k, d: p.d, a: p.a,
        econ: { nw: H.nw.map(function (r) { return r ? r[k] : null; }), lvl: [p.lvl], lh: [p.lh], dn: [p.dn], cur: [p.gold], gold: [], xp: [] } };
    });
    var at = [], ag = [];
    H.nw.forEach(function (r, i) { if (!r) return; var d = 0; for (var q = 0; q < 10; q++) d += q < 5 ? r[q] : -r[q]; at.push(from + i * H.step); ag.push(d); });
    var bld = s.bld || {};
    return { live: true, matchId: s.matchId, t0: t0, t1: t1, players: players,
      deaths: (s.deaths || []).map(function (d) { return { t: d.t, victim: d.victim, killer: d.killer, x: d.x, y: d.y, gold: 0, counts: false }; }),
      buildings: Object.keys(bld).map(function (k) { var b = bld[k]; return { name: b.name, t: b.t == null ? -1 : b.t, pre: b.t == null }; }),
      wards: [], roshan: [], chat: [], creeps: null, adv: { t: at, gold: ag, xp: [] }, econFrom: from, econStep: H.step,
      pro: { radiant: s.teams.radiant.name || 'Radiant', dire: s.teams.dire.name || 'Dire', league: s.league || '' },
      score: [s.teams.radiant.score, s.teams.dire.score], ended: !!s.ended, radiantWin: s.radiantWin, delay: s.delay, viewers: s.viewers, mmr: s.mmr, league: s.league, leagueId: s.leagueId };
  }
  function pollOnline() {
    var id = online, g = onlineGame(); if (!g) return;
    ONL.busy = true; ONL.at = Date.now();
    getJson('/api/live/online/' + g.sid).then(function (s) {
      if (!ONL || online !== id) return;
      var m = onlineMatch(s); ONL.phase = s.phase; ONL.delay = s.delay;
      if (m) { if (!ONL.m || m.t1 !== ONL.m.t1) ONL.gotAt = Date.now(); ONL.m = m; ONL.dirty = true; }
      ONL.err = null; restored();
    }).catch(function (e) {
      if (!ONL || online !== id) return;
      if (/404/.test(e.message)) ONL.gone = true; else { ONL.err = e.message; lost(e.message); }
    }).finally(function () { if (ONL && online === id) { ONL.busy = false; ONL.at = Date.now(); } });
  }
  function onlineFrame() {
    var nowMs = Date.now(), m = ONL.m;
    // Матч закончился или пропал из трансляции — через ONLINE_NEXT мс сами переходим на самый смотримый из идущих (нет — в общий эфир).
    if ((m && m.ended) || ONL.gone) { if (!ONL.endAt) ONL.endAt = nowMs; else if (nowMs - ONL.endAt > ONLINE_NEXT) { nextOnline(); return; } }
    if (!ONL.busy && !ONL.gone && !(m && m.ended) && nowMs - ONL.at > ONLINE_POLL && retryDue()) pollOnline();
    if (!m) {
      drawMap(null, 0); $('lvWin').hidden = true; overlay.hidden = false;
      var msg = ONL.gone || (ONLIST && !ONLIST.err && !onlineGame()) ? 'Этот матч уже закончился или Valve убрала его из списка идущих игр. Выберите другой в полосе выше.'
        : ONLIST && ONLIST.err && !onlineGame() ? 'Список идущих матчей не загрузился: ' + ONLIST.err : ONL.err ? 'Не удалось получить матч: ' + ONL.err + ' Пробуем снова.'
        : ONL.phase != null && ONL.phase < 5 ? 'В трансляции Valve ещё идёт ' + (ONL.phase <= 3 ? 'выбор героев' : 'подготовка к игре') + (ONL.delay ? ' (задержка ' + Math.round(ONL.delay / 60) + ' мин)' : '') + '. Карта оживёт, когда начнётся игра.' : 'Подключаемся к матчу…';
      var h = '<p>' + esc(msg) + '</p>'; if (overlay._h !== h) { overlay._h = h; overlay.innerHTML = h; }
      return;
    }
    overlay.hidden = true; overlay._h = null;
    // Часы показа догоняют «последний кадр минус ONLINE_LAG» плавно (скорость 0,8–1,25), без рывков при приходе кадра.
    var target = Math.min(m.t1, m.t1 - ONLINE_LAG + (nowMs - ONL.gotAt) / 1000), dt = ONL.wall ? Math.min(1, (nowMs - ONL.wall) / 1000) : 0;
    ONL.wall = nowMs;
    if (m.ended) ONL.disp = m.t1;
    else if (ONL.disp == null || Math.abs(ONL.disp - target) > 10) ONL.disp = target;
    else ONL.disp += dt * Math.max(0.8, Math.min(1.25, 1 + (target - ONL.disp) * 0.15));
    var t = Math.max(m.t0, Math.min(m.t1, ONL.disp));
    drawMap(m, t); draft(m); winBanner(m, t);
    $('lvClock').textContent = clock(t);
    var sec = Math.floor(t);
    if (sec !== lastSecond || ONL.dirty) { ONL.dirty = false; lastSecond = sec; panel(m, null, t); }
  }
  function nextOnline() {
    var cur = online, g = ONLIST ? ONLIST.games.filter(function (x) { return x.matchId !== cur && !x.ended; }).sort(function (a, b) { return (b.viewers || 0) - (a.viewers || 0); })[0] : null;
    if (g) { switchOnline(g.matchId, false); try { history.replaceState(null, '', '/live/?g=' + g.matchId); } catch (_) {} }
    else { switchTo(null, false); try { history.replaceState(null, '', '/live/'); } catch (_) {} }
  }
  function setMode() {
    root.classList.toggle('is-online', !!online);
    Array.prototype.forEach.call(document.querySelectorAll('.lv-cols span:nth-child(6)'), function (s) { s.textContent = online ? 'Зол.' : 'XPM'; s.title = online ? 'Золото на руках' : 'Опыт в минуту'; });
    if (online && advKind === 'xp') { advKind = 'heroes'; Array.prototype.forEach.call(document.querySelectorAll('[data-adv]'), function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-adv') === 'heroes' ? 'true' : 'false'); }); }
  }
  function switchOnline(id, push) {
    if (online === id && ONL) return;
    online = id; own = null; ownItem = null; ownMissing = false; lastItem = null; lastSecond = null; errorShown = false; manual = true;
    ONL = { sid: null, m: null, at: 0, busy: false, gone: false, endAt: 0, err: null, disp: null, wall: 0, gotAt: 0, dirty: true };
    overlay.hidden = true; overlay._h = null; $('lvWin').hidden = true; setMode();
    if (push !== false) { try { history.pushState(null, '', '/live/?g=' + id); } catch (_) {} }
    goal('live_online'); renderStrip();
  }
  function onlineCardHtml(g, on) {
    var heroes = g.heroes.map(function (s, i) { return s ? '<img src="/assets/heroes/' + esc(s) + '.webp" alt="" width="17" height="10" loading="lazy"' + (i === 5 ? ' class="d"' : '') + '>' : ''; }).join('');
    var top = '<span class="lv-air">В эфире</span>' + esc(g.league || (g.leagueId ? 'Турнирный матч' : g.mmr ? 'MMR ' + num(g.mmr) : 'Рейтинговая игра'));
    var mid = esc((g.radiant || 'Radiant') + ' — ' + (g.dire || 'Dire'));
    var sub = Math.floor(g.gt / 60) + ' мин · <b>' + g.score[0] + ':' + g.score[1] + '</b><i class="lv-eye" title="Зрителей в игре" aria-label="зрителей">' + num(g.viewers) + '</i>';
    return '<button type="button" class="lv-sc lv-sc-air' + (on ? ' on' : '') + '" data-g="' + esc(g.matchId) + '" aria-pressed="' + on + '"><span class="lv-sc-top">' + top + '</span><span class="lv-sc-mid">' + mid + '</span><span class="lv-sc-h">' + heroes + '</span><span class="lv-sc-sub">' + sub + '</span></button>';
  }
  function onlineStamp(m) {
    var kind = m.league ? esc(m.league) : m.leagueId ? 'Турнирный матч' : 'Рейтинговая игра' + (m.mmr ? ', средний MMR ' + num(m.mmr) : '');
    return '<span class="lv-air">В эфире</span>' + kind + ' · матч <b>' + esc(m.matchId) + '</b> · задержка трансляции Valve <b>' + Math.round(m.delay / 60) + ' мин</b>' +
      (m.viewers ? ' · ' + num(m.viewers) + ' ' + plural(m.viewers, 'зритель', 'зрителя', 'зрителей') + ' в игре' : '') + ' · <a href="/live/" data-m="">в общий эфир</a>';
  }
  function loadList() {
    getJson('/api/live/list').then(function (j) {
      LIST = j.items || [];
      LIST.forEach(function (c) { if (c.pro && c.pro.tour) tours[c.matchId] = c.pro.tour; });
      renderStrip();
    }).catch(function (e) { if (!LIST) { var el = $('lvStrip'); if (el) el.innerHTML = '<p class="lv-strip-note">Список матчей не загрузился: ' + esc(e.message) + '</p>'; } });
  }
  function cardHtml(id, top, mid, heroes, sub, on) {
    return '<button type="button" class="lv-sc' + (on ? ' on' : '') + '" data-m="' + esc(id) + '" aria-pressed="' + on + '"><span class="lv-sc-top">' + top + '</span><span class="lv-sc-mid">' + mid + '</span><span class="lv-sc-h">' + heroes + '</span><span class="lv-sc-sub">' + sub + '</span></button>';
  }
  function teamsOf(p) { return esc((p.radiant || 'Radiant') + ' — ' + (p.dire || 'Dire')); }
  function renderStrip() {
    var el = $('lvStrip'); if (!el || (!LIST && !ONLIST)) return;
    var bc = sched && sched.current ? sched.current.matchId : '', seen = false;
    stripFor = (own || '') + '|' + bc;
    var lc = LIST.filter(function (c) { return c.matchId === bc; })[0], bm = matches[bc];
    var bmid = !bc ? 'Пауза между матчами' : lc ? (lc.pro ? teamsOf(lc.pro) : esc(rankName(lc.rank))) : bm && bm !== 'loading' ? (bm.pro ? teamsOf(bm.pro) : 'Рейтинговый матч') : 'Матч ' + esc(bc);
    var html = cardHtml('', '<span class="lv-live" aria-hidden="true"></span>Общий эфир', bmid, '', 'повторы · все видят одну секунду', !own && !online);
    if (ONLIST && ONLIST.err) html += '<span class="lv-strip-note">Идущие матчи недоступны: ' + esc(ONLIST.err) + '</span>';
    else if (ONLIST && !ONLIST.games.length) html += '<span class="lv-strip-note">Сейчас нет доступных идущих матчей.</span>';
    if (ONLIST && ONLIST.games.length) {
      html += '<span class="lv-strip-sep" aria-hidden="true"></span>';
      ONLIST.games.forEach(function (g) { html += onlineCardHtml(g, g.matchId === online); });
      html += '<span class="lv-strip-sep" aria-hidden="true"></span>';
    }
    (LIST || []).forEach(function (c) {
      var heroes = c.heroes.map(function (s, i) { return s ? '<img src="/assets/heroes/' + esc(s) + '.webp" alt="" width="17" height="10" loading="lazy"' + (i === 5 ? ' class="d"' : '') + '>' : ''; }).join('');
      var t = c.pro && c.pro.tour;
      var top = c.pro ? '<span class="lv-pro">Про</span> ' + esc((t && t.league) || c.pro.league) : esc(rankName(c.rank));
      var played = new Date(c.end * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      if (c.matchId === own) seen = true;
      html += cardHtml(c.matchId, top, c.pro ? teamsOf(c.pro) : 'Radiant — Dire', heroes, clock(c.dur) + ' · ' + esc(played) + (t && t.game && t.bo > 1 ? ' · игра ' + t.game : ''), c.matchId === own);
    });
    if (own && !seen) html += cardHtml(own, 'По ссылке', 'Матч ' + esc(own), '', 'с начала', true);
    el.innerHTML = html;
    var on = el.querySelector('.lv-sc.on'); if (on && (own || online)) { var l = on.offsetLeft - el.offsetLeft; if (l < el.scrollLeft || l + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = l - 8; }
  }
  function switchTo(id, push) {
    id = id || null;
    var was = online;
    if (online) { online = null; ONL = null; setMode(); overlay._h = null; }
    if (!was && id === own && !(id && ownItem && now() >= ownItem.start + ownItem.len * 1000)) return;
    own = id; ownItem = null; ownMissing = false; lastItem = null; lastSecond = null; errorShown = false; manual = true;
    overlay.hidden = true; $('lvWin').hidden = true;
    if (id) { delete failAt[id]; loadMatch(id); } else if (sched) [sched.current, sched.next].forEach(function (i) { if (i) loadMatch(i.matchId); });
    if (push !== false) { try { history.pushState(null, '', id ? '/live/?m=' + id : '/live/'); } catch (_) {} }
    renderStrip();
  }
  // Турнир матча: /api/live/card/<id> — те же данные, что у раздела /pro/. Счёт серии — до этой игры.
  function tourLine(m) {
    var id = String(m.matchId);
    if (!(id in tours)) {
      tours[id] = null;
      getJson('/api/live/card/' + id).then(function (c) { tours[id] = (c.pro && c.pro.tour) || false; lastSecond = null; }).catch(function () { tours[id] = false; });
    }
    var t = tours[id]; if (!t) return '';
    var r = (m.pro && m.pro.radiant) || t.radiant || 'Radiant', d = (m.pro && m.pro.dire) || t.dire || 'Dire', parts = [];
    if (t.bo > 1) parts.push('Bo' + t.bo + (t.game ? ', игра ' + t.game : ''));
    if (t.bo > 1 && t.score && t.game > 1) parts.push('счёт серии до игры: ' + esc(r) + ' <b>' + t.score[0] + ':' + t.score[1] + '</b> ' + esc(d));
    if (t.leaguePage) parts.push('<a href="/pro/league/' + (+t.leagueId) + '/">Страница турнира →</a>');
    if (t.matchPage) parts.push('<a href="/pro/match/' + esc(id) + '/">Разбор матча →</a>');
    return parts.length ? '<span class="lv-tour">' + parts.join(' · ') + '</span>' : '';
  }
  // Ключевые покупки для ленты: собранные предметы от 2000 золота (data/live-items.json, tools/build-live-items.js).
  var keyItems = null, itemNames = null;
  function loadKeyItems() { getJson('/data/live-items.json').then(function (j) { keyItems = j.items || {}; itemNames = j.names || keyItems; lastSecond = null; }).catch(function (e) { if (window.console) console.warn('live-items:', e.message); }); }

  // Карточка игрока: средние по герою из архива эфира (tools/build-live-hero-avg.js → data/live-hero-avg.json, только
  // отметки, где у героя ≥ minN матчей) и предметы с лучшим эффектом (data/item-impact.json). Нет файла или данных — блока нет.
  var HAVG = null, IMPACT = null;
  function loadCardData() {
    getJson('/data/live-hero-avg.json').then(function (j) { if (j && j.heroes && j.minN) { HAVG = j; lastSecond = null; } }).catch(function (e) { if (window.console) console.warn('live-hero-avg:', e.message); });
  }

  // Шанс победы по ходу игры (js/live-winprob.js, коэффициенты — tools/build-live-winprob.js). Нет файла — строки нет.
  var WPJ = null;
  function loadWinProb() { if (!window.LiveWinProb) return; getJson('/data/live-winprob.json').then(function (j) { if (j && j.w && j.w.length === 8) { WPJ = j; lastSecond = null; } }).catch(function (e) { if (window.console) console.warn('live-winprob:', e.message); }); }
  function wpLine(m, t) {
    var el = $('lvWp'); if (!el) return;
    // У идущего матча опыта нет (Steam его не отдаёт), а модель без опыта не обучена — строку не показываем.
    if (!WPJ || m.live) { if (el.innerHTML) el.innerHTML = ''; el.title = ''; return; }
    var p = window.LiveWinProb.at(m, WPJ.w, t), pct = function (v) { return Math.round(v * 100) + '%'; };
    var html = p === null ? 'Шанс по ходу игры — с 1-й минуты' : '<b class="rad">' + pct(p) + '</b> по ходу игры <b class="dire">' + pct(1 - p) + '</b>';
    if (el.innerHTML !== html) el.innerHTML = html;
    el.title = 'Шанс по разнице капитала, опыта, башен и бараков с поправкой на минуту матча. Обучено на ' + WPJ.matches + ' матчах архива эфира; на ' + WPJ.test.matches + ' отложенных матчах прогноз указывал на победителя в ' + Math.round(WPJ.test.accuracy * 100) + '% минут.' + (WPJ.built ? ' Модель обновлена ' + new Date(WPJ.built).toLocaleDateString('ru-RU') + '.' : '');
  }
  function now() { return Date.now() + offset; }
  function sync() {
    if (syncing) return;
    syncing = true;
    getJson('/api/live/now').then(function (s) {
      offset = s.serverTime - Date.now(); sched = s; lastSync = Date.now(); if (!ownMissing) errorShown = false; restored();
      // Свой матч: общий эфир не скачиваем (лишние ~0,5 МБ на зрителя), догрузится при возврате.
      if (!own && !online) [s.current, s.next, s.prev].forEach(function (i) { if (i) loadMatch(i.matchId); });
      if (stripFor !== (own || '') + '|' + (s.current ? s.current.matchId : '')) renderStrip();
    }).catch(function (e) { lastSync = Date.now(); if (!online) lost(e.message); if (!sched) showError(e.message); })
      .finally(function () { syncing = false; });
  }
  function loadMatch(id) {
    if (matches[id] || (failAt[id] && Date.now() < failAt[id])) return;
    matches[id] = 'loading';
    getJson('/api/live/match/' + id).then(function (m) {
      matches[id] = m;
      m.players.forEach(function (p) {
        if (icons[p.slug]) return;
        var img = new Image(); img.src = '/assets/heroes/' + p.slug + '.webp'; icons[p.slug] = img;
      });
      // Счёт по времени — то же правило, что в normalize.js: без убийцы и без награды не засчитывается.
      m.deaths.forEach(function (d) { d.counts = !(d.killer < 0 && !d.gold); });
      delete failAt[id]; restored();
      if (sched && sched.current && sched.current.matchId === id) renderStrip();
    }).catch(function (e) {
      delete matches[id];
      if (id === own && /404/.test(e.message)) {
        ownMissing = true; failAt[id] = Infinity; errorShown = true; overlay.hidden = false;
        overlay.innerHTML = '<p>Матча ' + esc(id) + ' нет в архиве эфира: полные записи обычных матчей хранятся 14 дней.</p><p class="lv-muted">Выберите матч в полосе выше или <a href="/live/" data-m="">вернитесь в общий эфир</a>.</p>';
        return;
      }
      lost(e.message); failAt[id] = nextRetry; if (!sched || !current() || current().item.matchId === id) showError(e.message); });
  }
  function loadHeat() {
    getJson('/api/live/heat').then(function (h) {
      var bin = atob(h.data), n = h.size, c = document.createElement('canvas');
      c.width = c.height = n;
      var g = c.getContext('2d'), img = g.createImageData(n, n);
      for (var i = 0; i < n * n; i++) {
        var v = bin.charCodeAt(i) / 255, o = i * 4;
        // тёмная земля -> дорожки цвета песка: по ним ходят чаще всего
        img.data[o] = 14 + v * 190; img.data[o + 1] = 20 + v * 170; img.data[o + 2] = 17 + v * 110; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0); heatCanvas = c;
      $('lvHeatNote').textContent = 'В архиве эфира ' + num(h.matches) + ' разобранных матчей.';
    }).catch(function () { /* без фона карта всё равно работает */ });
  }

  function current() {
    if (own) {
      var om = matches[own];
      if (!om || om === 'loading') return null;
      if (!ownItem) ownItem = { matchId: own, start: now(), len: om.t1 - om.t0, t0: om.t0 };
      var tt = now();
      return tt < ownItem.start + ownItem.len * 1000 ? { item: ownItem, t: ownItem.t0 + (tt - ownItem.start) / 1000 } : null;
    }
    if (!sched) return null;
    var t = now();
    var items = [sched.current, sched.next].filter(Boolean);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (t >= it.start && t < it.start + it.len * 1000) return { item: it, t: it.t0 + (t - it.start) / 1000 };
    }
    return null;
  }

  function sizeCanvas(c, h) {
    var w = c.clientWidth, d = window.devicePixelRatio || 1, hh = h || w;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(hh * d)) { c.width = Math.round(w * d); c.height = Math.round(hh * d); }
    return { w: w, h: hh, d: d };
  }
  function idxAt(m, t) { return Math.max(0, Math.min(m.t1 - m.t0, t - m.t0)); }
  function isDead(p, t) { for (var i = 0; i < p.dead.length; i++) if (t >= p.dead[i][0] && t < p.dead[i][1]) return p.dead[i]; return null; }

  // Значки строений — из файлов игры (pak01: materials/vgui/hud/minimap_tower, minimap_tower45, minimap_ancient),
  // перекрашены в цвета команд: assets/live/bld-<tower|rax|fort>-<radiant|dire>.png. Разрушенное строение исчезает с карты.
  var BLD_IMG = {}, BLD_SIZE = { t: 13, r: 9, f: 20 };
  ['t', 'r', 'f'].forEach(function (k) {
    ['radiant', 'dire'].forEach(function (side) {
      var im = new Image(); im.src = '/assets/live/bld-' + { t: 'tower', r: 'rax', f: 'fort' }[k] + '-' + side + '.png'; BLD_IMG[k + side] = im;
    });
  });
  function drawBuildings(m, t, P, W) {
    var dead = {}, seen = {}, k = Math.max(1, W / 420);
    m.buildings.forEach(function (b) { if (t >= b.t) dead[b.name] = (dead[b.name] || 0) + 1; });
    BUILDINGS.forEach(function (b) {
      seen[b[0]] = (seen[b[0]] || 0) + 1;
      if ((dead[b[0]] || 0) >= seen[b[0]]) return;
      var side = b[0].indexOf('goodguys') === 0 ? 'radiant' : 'dire', im = BLD_IMG[b[1] + side];
      var q = P(b[2], b[3]), h = BLD_SIZE[b[1]] * k;
      if (im.complete && im.naturalWidth) { var w = h * im.naturalWidth / im.naturalHeight; ctx.drawImage(im, q[0] - w / 2, q[1] - h / 2, w, h); return; }
      ctx.fillStyle = COL[side]; ctx.fillRect(q[0] - h / 3, q[1] - h / 3, h * 2 / 3, h * 2 / 3);
    });
  }
  // Крипы (поле creeps файла матча, см. tools/replay/normalize.js): кадр раз в creeps.step с, [сторона, x, y, …].
  // Номеров у крипов в файле нет, поэтому для плавного движения каждый крип сдвигается к ближайшему свободному
  // крипу той же стороны в следующем кадре (не дальше 8 клеток); без пары — стоит на месте.
  function drawCreeps(m, t, P, W) {
    var c = m.creeps; if (!c || !c.f.length) return;
    var x = (t - c.from) / c.step; if (x < 0 || x > c.f.length - 1) return;
    var i = Math.floor(x), f = x - i, A = c.f[i], B = c.f[Math.min(i + 1, c.f.length - 1)], used = [], r = 1.7 * Math.max(1, W / 420);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    for (var a = 0; a < A.length; a += 3) {
      var best = 64, bj = -1;
      for (var b = 0; b < B.length; b += 3) {
        if (B[b] !== A[a] || used[b]) continue;
        var d = (B[b + 1] - A[a + 1]) * (B[b + 1] - A[a + 1]) + (B[b + 2] - A[a + 2]) * (B[b + 2] - A[a + 2]);
        if (d < best) { best = d; bj = b; }
      }
      var px = A[a + 1], py = A[a + 2];
      if (bj >= 0) { used[bj] = true; px += (B[bj + 1] - px) * f; py += (B[bj + 2] - py) * f; }
      var q = P(px, py);
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7);
      ctx.fillStyle = A[a] === 0 ? COL.radiant : COL.dire; ctx.fill(); ctx.stroke();
    }
  }
  function drawMap(m, t) {
    var s = sizeCanvas(map), W = s.w;
    ctx.setTransform(s.d, 0, 0, s.d, 0, 0);
    ctx.fillStyle = '#0d1410'; ctx.fillRect(0, 0, W, W);
    ctx.imageSmoothingEnabled = true;
    if (mapImg.complete && mapImg.naturalWidth) ctx.drawImage(mapImg, 0, 0, W, W);
    else if (heatCanvas) ctx.drawImage(heatCanvas, 0, 0, W, W);
    if (!m) return;
    var P = function (x, y) { var q = uv(x, y); return [q[0] * W, q[1] * W]; };
    drawCreeps(m, t, P, W);
    drawBuildings(m, t, P, W);
    m.wards.forEach(function (w) {
      if (t < w.t || (w.end != null && t >= w.end)) return;
      var q = P(w.x, w.y), team = w.slot < 5 ? 'radiant' : 'dire';
      ctx.beginPath(); ctx.arc(q[0], q[1], w.kind === 'obs' ? 4 : 3, 0, 7);
      ctx.fillStyle = w.kind === 'obs' ? '#f2d16b' : '#6fc3ff'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = COL[team]; ctx.stroke();
    });
    m.deaths.forEach(function (d) {
      if (d.x == null || t < d.t || t > d.t + 8) return;
      var q = P(d.x, d.y), a = 1 - (t - d.t) / 8, r = 6;
      ctx.globalAlpha = a; ctx.strokeStyle = d.victim < 5 ? COL.radiant : COL.dire; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(q[0] - r, q[1] - r); ctx.lineTo(q[0] + r, q[1] + r); ctx.moveTo(q[0] + r, q[1] - r); ctx.lineTo(q[0] - r, q[1] + r); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    var R = Math.max(9, W / 42), fi = t - m.t0;
    m.players.forEach(function (p) {
      if (isDead(p, t)) return;
      var i = Math.max(0, Math.min(p.x.length - 1, Math.floor(fi))), j = Math.min(p.x.length - 1, i + 1), f = Math.max(0, Math.min(1, fi - i));
      var q = P(p.x[i] + (p.x[j] - p.x[i]) * f, p.y[i] + (p.y[j] - p.y[i]) * f);
      ctx.save(); ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, 7); ctx.closePath();
      ctx.fillStyle = '#111'; ctx.fill(); ctx.clip();
      var img = icons[p.slug];
      if (img && img.complete && img.naturalWidth) { var ih = R * 2, iw = ih * img.naturalWidth / img.naturalHeight; ctx.drawImage(img, q[0] - iw / 2, q[1] - R, iw, ih); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(q[0], q[1], R, 0, 7); ctx.lineWidth = 2.5; ctx.strokeStyle = COL[p.team]; ctx.stroke();
    });
  }

  // Цвета игроков как в клиенте Dota (слоты 0–9).
  var PCOL = ['#3375ff', '#66ffbf', '#bf00bf', '#f3f00b', '#ff6b00', '#fe86c2', '#a1b447', '#65d9f7', '#008321', '#a46900'];
  var POS = { 1: ['Керри', '/assets/roles/carry.svg'], 2: ['Мид', '/assets/roles/mid.png'], 3: ['Оффлейн', '/assets/roles/offlane.png'], 4: ['Поддержка', '/assets/roles/support.png'], 5: ['Полная поддержка', '/assets/roles/hardsupport.png'] };
  // Позиций 1–5 в реплее нет. Правило: линия — по средней точке героя на 1–10 минуте,
  // внутри линии старшая позиция у того, у кого больше капитал на 10-й минуте.
  function roles(m) {
    if (m._roles) return m._roles;
    var out = {};
    if (m.live) { m.players.forEach(function (p) { out[p.slot] = p.slot % 5 + 1; }); return (m._roles = out); }   // позиций у идущего матча нет — порядок слотов
    ['radiant', 'dire'].forEach(function (side) {
      var ps = m.players.filter(function (p) { return p.team === side; }).map(function (p) {
        var sx = 0, sy = 0, n = 0;
        for (var t = 60; t <= 600; t += 5) { var i = t - m.t0; if (i >= 0 && i < p.x.length) { sx += p.x[i]; sy += p.y[i]; n++; } }
        var d = n ? (sx - sy) / n : 0;
        var lane = Math.abs(d) < 12 ? 'mid' : (d < 0 ? 'top' : 'bot');
        var k = Math.max(0, Math.min(p.econ.nw.length - 1, Math.floor((600 - m.econFrom) / m.econStep)));
        return { slot: p.slot, lane: lane, nw: p.econ.nw[k] || 0 };
      });
      var safe = side === 'radiant' ? 'bot' : 'top', off = side === 'radiant' ? 'top' : 'bot', left = ps.slice();
      function take(pos, filter) {
        var c = left.filter(filter).sort(function (a, b) { return b.nw - a.nw; })[0] || left.slice().sort(function (a, b) { return b.nw - a.nw; })[0];
        if (!c) return; out[c.slot] = pos; left.splice(left.indexOf(c), 1);
      }
      take(2, function (q) { return q.lane === 'mid'; });
      take(1, function (q) { return q.lane === safe; });
      take(3, function (q) { return q.lane === off; });
      left.sort(function (a, b) { return (a.lane === safe ? 0 : 1) - (b.lane === safe ? 0 : 1) || a.nw - b.nw; });
      if (left[0]) out[left[0].slot] = 5;
      if (left[1]) out[left[1].slot] = 4;
    });
    return (m._roles = out);
  }
  function roleIcon(m, slot, cls) {
    var r = !m.live && POS[roles(m)[slot]]; if (!r) return '';
    return '<img class="' + cls + '" src="' + r[1] + '" alt="" title="' + r[0] + ' (определено по линии и фарму)">';
  }
  function draft(m) {
    if (m._draftFor === m.matchId) return;
    m._draftFor = m.matchId;
    var side = function (team) {
      return m.players.filter(function (p) { return p.team === team; }).sort(function (a, b) { return roles(m)[a.slot] - roles(m)[b.slot]; }).map(function (p) {
        return '<a class="lv-pick" href="/hero/' + esc(p.slug) + '/" title="' + esc(p.hero) + '"><img src="/assets/heroes/' + esc(p.slug) + '.webp" alt="' + esc(p.hero) + '" loading="lazy">' + roleIcon(m, p.slot, 'lv-pick-role') + '</a>';
      }).join('');
    };
    // «Табло»: у каждой команды — название, шанс по драфту и пики; полоса шанса — по нижнему краю табло,
    // разложение шанса — под табло, свёрнуто в «Как считается».
    $('lvPicksRad').innerHTML = side('radiant'); $('lvPicksDire').innerHTML = side('dire');
    var d = draftProb(m), bar = $('lvProbBar');
    $('lvProbRad').textContent = d ? d.rad : ''; $('lvProbDire').textContent = d ? d.dire : '';
    bar.hidden = !d; bar.innerHTML = d ? d.bar : '';
    $('lvDraft').innerHTML = d ? d.note : '';
  }
  // «Как считается шанс победы» — всплывающее окно под кнопкой. Разметку перерисовывает
  // табло, поэтому обработчики висят на документе, а не на кнопке.
  function howToggle(open) {
    var b = document.querySelector('.lv-how-btn'), pop = $('lvHowPop'); if (!b || !pop) return;
    pop.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.lv-how-btn');
    if (b) { howToggle(b.getAttribute('aria-expanded') !== 'true'); return; }
    if (!e.target.closest('.lv-how-pop')) howToggle(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') howToggle(false); });
  // Мышью: увёл указатель с кнопки и окна — окно закрывается (небольшая задержка прощает дрожь руки).
  var howTimer = 0;
  document.addEventListener('mouseout', function (e) {
    if (!e.target.closest || !e.target.closest('.lv-how')) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.lv-how')) return;
    clearTimeout(howTimer); howTimer = setTimeout(function () { howToggle(false); }, 200);
  });
  document.addEventListener('mouseover', function (e) { if (e.target.closest && e.target.closest('.lv-how')) clearTimeout(howTimer); });
  // Прогноз по драфту — та же модель, что у DraftMate на главной (js/draft-model.js), срез Divine 5 и Immortal.
  // Только вероятность по пикам: ход матча не учитывается. Без данных модели блок не показывается.
  var DM = { M: null, idx: null, calib: null, state: 'idle' };
  function loadDraftModel() {
    // Historical top matrix has no approved independent provenance for live predictions.
  }
  function draftProb(m) {
    loadDraftModel();
    if (DM.state !== 'ready') return null;
    var ids = function (team) { return m.players.filter(function (p) { return p.team === team; }).map(function (p) { return p.heroId; }); };
    var rad = ids('radiant'), dire = ids('dire');
    var D = window.DraftModel, synR = D.synergy(DM.M, DM.idx, rad, 0), synD = D.synergy(DM.M, DM.idx, dire, 0), mu = D.matchup(DM.M, DM.idx, rad, dire, 0);
    var p = D.prob(synR - synD + mu, DM.calib);
    if (p === null) return null;
    var nameR = m.pro && m.pro.radiant || 'Radiant', nameD = m.pro && m.pro.dire || 'Dire';
    var pct = function (v) { return v.toFixed(1).replace('.', ',') + '%'; };
    var pp = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ','); };
    var fav = p >= 50 ? nameR : nameD;
    // Шанс победы каждой стороны и из чего он сложен (как у помощника драфта на главной).
    return {
      rad: pct(p) + ' по драфту', dire: pct(100 - p) + ' по драфту',
      bar: '<i class="radiant" style="width:' + p.toFixed(1) + '%"></i><i class="dire" style="width:' + (100 - p).toFixed(1) + '%"></i>',
      note: '<div class="lv-prob-line"><div class="lv-how"><button type="button" class="lv-how-btn" aria-expanded="false" aria-controls="lvHowPop">Как считается шанс победы</button>' +
        '<div class="lv-how-pop" id="lvHowPop" role="dialog" aria-label="Как считается шанс победы по драфту" hidden><b>Шанс победы по драфту</b><p>По одним пикам сильнее <b>' + esc(fav) + '</b>. Синергия: ' + esc(nameR) + ' ' + pp(synR) + ', ' + esc(nameD) + ' ' + pp(synD) + '; контрпики в пользу ' + esc(mu >= 0 ? nameR : nameD) + ' ' + pp(Math.abs(mu)) + ' п.п. ' +
        'Ход матча не учитывается. Считает DraftMate по ' + DM.M.matchesUsed.toLocaleString('ru-RU') + ' матчам Divine 5 и Immortal.</p></div></div>' +
        '<a class="lv-open" href="/#draft=' + rad.join('-') + '_' + dire.join('-') + '_">Открыть в DraftMate →</a></div>'
    };
  }
  // Трон: событие *_fort; если матч кончился сдачей (трон цел) — победа на последних секундах.
  function winAt(m) {
    var f = m.buildings.filter(function (b) { return /_fort$/.test(b.name); })[0];
    return f ? f.t : m.t1 - 3;
  }
  function winBanner(m, t, note) {
    var el = $('lvWin');
    if (m.live) {
      if (!m.ended) { if (!el.hidden) el.hidden = true; return; }
      var w = m.radiantWin == null ? '' : m.radiantWin ? m.pro.radiant : m.pro.dire;
      var lh = (w ? '<b class="' + (m.radiantWin ? 'radiant' : 'dire') + '">Победа ' + esc(w) + '</b><span>трон разрушен</span>' : '<b>Матч завершён</b><span>Valve больше не присылает данные этого матча</span>') + '<small>Через несколько секунд включится другой идущий матч.</small>';
      if (el.innerHTML !== lh) el.innerHTML = lh;
      el.hidden = false; return;
    }
    if (t < winAt(m)) { if (!el.hidden) el.hidden = true; return; }
    var name = m.radiantWin ? (m.pro && m.pro.radiant || 'Radiant') : (m.pro && m.pro.dire || 'Dire');
    var html = '<b class="' + (m.radiantWin ? 'radiant' : 'dire') + '">Победа ' + esc(name) + '</b><span>' + (m.buildings.some(function (b) { return /_fort$/.test(b.name); }) ? 'трон разрушен' : 'соперник сдался') + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '<a class="lv-res" href="/live/match/?id=' + esc(m.matchId) + '">Итоги матча →</a>';
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
  }
  function econ(m, p, key, t) {
    var i = Math.floor((t - m.econFrom) / m.econStep);
    var a = p.econ[key]; if (!a.length) return null;
    i = Math.max(0, Math.min(a.length - 1, i));
    return a[i];
  }
  // Расходники и рецепты в «последних предметах» не показываем — только то, что меняет героя.
  var SKIP_ITEM = /^(recipe_|tango|flask|clarity|enchanted_mango|faerie_fire|ward_|smoke_of_deceit|dust|tpscroll|tome_of_knowledge|blood_grenade|branches|famango|great_famango|greater_famango|cheese|aegis|refresher_shard)/;
  function items(p, t) {
    var out = [];
    // Схема 3+: готовый инвентарь по покупкам (собранные предметы вместо компонентов), самые дорогие — первыми.
    if (p.inv) {
      for (var j = p.inv.length - 1; j >= 0; j--) if (p.inv[j][0] <= t) { out = p.inv[j][1].slice(0, 6); break; }
      return out.map(function (k) { return '<img class="lv-it" src="/assets/items/' + esc(k) + '.png" alt="" title="' + esc(k.replace(/_/g, ' ')) + '" loading="lazy">'; }).join('');
    }
    for (var i = p.items.length - 1; i >= 0 && out.length < 6; i--) {
      var it = p.items[i]; if (it[0] > t || SKIP_ITEM.test(it[1]) || out.indexOf(it[1]) >= 0) continue;
      out.push(it[1]);
    }
    return out.reverse().map(function (k) { return '<img class="lv-it" src="/assets/items/' + esc(k) + '.png" alt="" title="' + esc(k.replace(/_/g, ' ')) + '" loading="lazy">'; }).join('');
  }
  function team(m, side, t, kd) {
    var mins = Math.max(1 / 60, t / 60);
    return m.players.filter(function (p) { return p.team === side; }).map(function (p) {
      var dead = isDead(p, t), k = kd[p.slot] || [0, 0];
      var lvl = econ(m, p, 'lvl', t), nw = econ(m, p, 'nw', t), lh = econ(m, p, 'lh', t), dn = econ(m, p, 'dn', t), xp = econ(m, p, 'xp', t);
      return '<div class="lv-row' + (dead ? ' is-dead' : '') + (p.slot === heroSel ? ' is-sel' : '') + '" data-slot="' + p.slot + '" tabindex="0" title="Карточка игрока">' +
        '<span class="lv-herobox"><img class="lv-hero" src="/assets/heroes/' + esc(p.slug) + '.webp" alt="" loading="lazy">' + roleIcon(m, p.slot, 'lv-role') + '</span>' +
        '<div class="lv-who"><a class="lv-name" href="/hero/' + esc(p.slug) + '/">' + esc(p.hero) + '</a><span class="lv-items">' + items(p, t) + '</span></div>' +
        '<span class="lv-lvl" title="Уровень">' + (lvl == null ? '—' : lvl) + '</span>' +
        '<span class="lv-kd" title="Убийства / смерти">' + k[0] + '/' + k[1] + '</span>' +
        '<span class="lv-lh" title="Добивания / денаи">' + (lh == null ? '—' : lh + '/' + dn) + '</span>' +
        (m.live ? '<span class="lv-xpm" title="Золото на руках">' + num(econ(m, p, 'cur', t)) + '</span>' : '<span class="lv-xpm" title="Опыт в минуту">' + (xp == null || t <= 0 ? '—' : Math.round(xp / mins)) + '</span>') +
        '<span class="lv-nw" title="Капитал">' + (nw == null ? '—' : num(nw)) + '</span>' +
        '<span class="lv-state">' + (dead ? '† ' + Math.ceil(dead[1] - t) + ' с' : '') + '</span></div>';
    }).join('');
  }
  function teamStats(m, side, t) {
    var nw = 0, obs = 0, sen = 0, lost = 0;
    m.players.forEach(function (p) { if (p.team === side) { var v = econ(m, p, 'nw', t); nw += v || 0; } });
    m.wards.forEach(function (w) { if (w.t <= t && (w.slot < 5) === (side === 'radiant')) { if (w.kind === 'obs') obs++; else sen++; } });
    var pre = side === 'radiant' ? 'goodguys_tower' : 'badguys_tower';
    m.buildings.forEach(function (b) { if (b.t <= t && b.name.indexOf(pre) === 0) lost++; });
    if (m.live) return 'Капитал <b>' + num(nw) + '</b> · башен <b>' + (11 - lost) + '/11</b>';
    return 'Капитал <b>' + num(nw) + '</b> · башен <b>' + (11 - lost) + '/11</b> · варды <b>' + obs + '</b> obs, <b>' + sen + '</b> sen';
  }
  function plural(n, one, few, many) { var d = n % 10, h = n % 100; return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many; }
  var r1 = function (v) { return (Math.round(v * 10) / 10).toLocaleString('ru-RU'); };
  function card(m, t, kd) {
    var p = m.players.filter(function (q) { return q.slot === heroSel; })[0] || m.players[0];
    var k = kd[p.slot] || [0, 0], fin = t >= m.t1, mins = t / 60;
    var lvl = econ(m, p, 'lvl', t), lh = econ(m, p, 'lh', t), dn = econ(m, p, 'dn', t), gold = econ(m, p, 'gold', t), xp = econ(m, p, 'xp', t), nw = econ(m, p, 'nw', t);
    var per = function (v) { return v == null || t < 60 ? '—' : num(Math.round(v / mins)); };
    var tile = function (n, v, tip) { return '<div title="' + tip + '"><b>' + v + '</b><span>' + n + '</span></div>'; };
    var html = '<div class="lv-c-head"><span class="lv-herobox"><img class="lv-hero" src="/assets/heroes/' + esc(p.slug) + '.webp" alt="">' + roleIcon(m, p.slot, 'lv-role') + '</span>' +
      '<a class="lv-name ' + p.team + '" href="/hero/' + esc(p.slug) + '/">' + esc(p.hero) + '</a><span class="lv-muted">' + (p.team === 'radiant' ? 'Radiant' : 'Dire') + ' · выберите игрока в таблице</span></div>' +
      '<div class="lv-c-items">' + (items(p, t) || '<span class="lv-muted">Предметов пока нет</span>') + '</div>' +
      (m.live ? '<div class="lv-c-tiles">' + tile('Уровень', lvl == null ? '—' : lvl, 'Уровень героя') + tile('У/С/П', p.k + '/' + p.d + '/' + p.a, 'Убийства / смерти / помощь') +
        tile('Добив./денаи', lh + '/' + dn, 'Добивания / денаи') + tile('Золото', num(econ(m, p, 'cur', t)), 'Золото на руках') + tile('Капитал', nw == null ? '—' : num(nw), 'Капитал (стоимость предметов и золото)') + '</div>' :
      '<div class="lv-c-tiles">' + tile('Уровень', lvl == null ? '—' : lvl, 'Уровень героя') +
      (fin ? tile('У/С/П', k[0] + '/' + k[1] + '/' + p.a, 'Убийства / смерти / помощь (помощь есть только в итоге матча)') : tile('У/С', k[0] + '/' + k[1], 'Убийства / смерти; помощь записывается только в итоге матча')) +
      tile('Добив./денаи', lh == null ? '—' : lh + '/' + dn, 'Добивания / денаи') + tile('GPM', per(gold), 'Заработанное золото в минуту') +
      tile('XPM', per(xp), 'Опыт в минуту') + tile('Капитал', nw == null ? '—' : num(nw), 'Капитал (стоимость предметов и золото)') + '</div>');
    var cmp = '';
    if (HAVG && !m.live) {
      var mark = Math.min(3600, Math.floor(t / 300) * 300), h = HAVG.heroes[p.heroId], a = h && mark >= 300 && h[mark];
      if (mark < 300) cmp = '<p class="lv-muted">Сравнение со средними по герою — с 5-й минуты.</p>';
      else if (!a) cmp = '<p class="lv-muted">Средних по герою нет: в нашем архиве эфира меньше ' + HAVG.minN + ' матчей ' + esc(p.hero) + ', дошедших до ' + (mark / 60) + '-й минуты.</p>';
      else {
        var i = Math.round((mark - m.econFrom) / m.econStep), at = function (key) { var v = p.econ[key] && p.econ[key][i]; return v == null ? null : v; };
        var mk = 0, md = 0; m.deaths.forEach(function (d) { if (d.t <= mark) { if (d.killer === p.slot) mk++; if (d.victim === p.slot) md++; } });
        var g = at('gold'), row = function (n, pv, av) { return '<tr><th>' + n + '</th><td>' + pv + '</td><td>' + av + '</td></tr>'; };
        cmp = '<table class="lv-cmp"><caption>На ' + (mark / 60) + '-й минуте — игрок и в среднем у героя (' + num(a[0]) + ' ' + plural(a[0], 'матч', 'матча', 'матчей') + ' архива эфира)</caption>' +
          '<tr><th></th><td>Игрок</td><td>В среднем</td></tr>' +
          row('Добивания', at('lh') == null ? '—' : at('lh'), r1(a[1])) + row('GPM', g == null ? '—' : num(Math.round(g / (mark / 60))), num(a[2])) +
          row('Уровень', at('lvl') == null ? '—' : at('lvl'), r1(a[3])) + row('Убийства', mk, r1(a[4])) + row('Смерти', md, r1(a[5])) + '</table>';
      }
    }
    var imp = IMPACT && IMPACT.heroes && IMPACT.heroes[p.heroId], best = imp ? Object.keys(imp).filter(function (key) { return imp[key][0] > 0; }).sort(function (x, y) { return imp[y][0] - imp[x][0]; }).slice(0, 3) : [];
    var ib = best.length ? '<div class="lv-imp"><h3>Что чаще приносит победу на ' + esc(p.hero) + '</h3><ul>' + best.map(function (key) {
      var v = imp[key], nm = (itemNames && itemNames[key]) || key.replace(/_/g, ' ');
      return '<li title="Купили до ' + Math.round(v[3] / 60) + '-й минуты: ' + num(v[1]) + ' матчей, не покупали: ' + num(v[2]) + '"><img class="lv-it" src="/assets/items/' + esc(key) + '.png" alt="">' +
        '<span>' + esc(nm) + '</span><b>+' + r1(v[0]) + ' п.п.</b><small>до ' + Math.round(v[3] / 60) + ' мин</small></li>';
    }).join('') + '</ul><p class="lv-muted">Доля побед, если предмет куплен до указанной минуты, против матчей без него — сверх обычного эффекта предметов героя. ' +
      num(IMPACT.matches) + ' детальных матчей Stratz, не меньше ' + IMPACT.minN + ' в каждой группе. Состав соперников не учитывается.</p></div>' : '';
    return '<div class="lv-c-main">' + html + '</div><div class="lv-c-cmp">' + cmp + '</div>' + (ib ? '<div class="lv-c-imp">' + ib + '</div>' : '');
  }
  var BUILD = { tower1: 'башня T1', tower2: 'башня T2', tower3: 'башня T3', tower4: 'башня T4', melee_rax: 'казармы ближнего боя', range_rax: 'казармы дальнего боя', fort: 'трон' };
  var LANE = { top: 'верх', mid: 'центр', bot: 'низ' };
  function buildingName(n) {
    var side = n.indexOf('goodguys') === 0 ? 'Radiant' : 'Dire', rest = n.replace(/^(goodguys|badguys)_/, '');
    var lane = (rest.match(/_(top|mid|bot)$/) || [])[1]; rest = rest.replace(/_(top|mid|bot)$/, '');
    return side + ': ' + (BUILD[rest] || rest) + (lane ? ', ' + LANE[lane] : '');
  }
  function feed(m, t) {
    var name = function (s) { var p = m.players[s]; return p ? '<b class="' + p.team + '">' + esc(p.hero) + '</b>' : 'Крипы или башня'; };
    var ev = [];
    m.deaths.forEach(function (d) { if (d.t <= t) ev.push([d.t, d.killer >= 0 && d.killer <= 9 ? name(d.killer) + ' убивает ' + name(d.victim) : name(d.victim) + ' погибает']); });
    m.buildings.forEach(function (b) { if (b.t <= t && !b.pre) ev.push([b.t, 'Разрушено — ' + esc(buildingName(b.name))]); });
    m.roshan.forEach(function (r) { if (r.t <= t) ev.push([r.t, 'Рошан убит']); });
    (m.chat || []).forEach(function (c) { if (c[0] <= t) ev.push([c[0], '<span class="lv-chat">' + name(c[1]) + ': ' + esc(c[2]) + '</span>']); });
    var fb = m.deaths.filter(function (d) { return d.killer >= 0 && d.killer <= 9; })[0];
    if (fb && fb.t <= t && !m.live) ev.push([fb.t, 'Первая кровь — ' + name(fb.killer)]);
    if (keyItems) m.players.forEach(function (p) { p.items.forEach(function (it) { var nm = keyItems[it[1]]; if (nm && it[0] <= t) ev.push([it[0], name(p.slot) + ' покупает <img class="lv-fi" src="/assets/items/' + esc(it[1]) + '.png" alt="">' + esc(nm)]); }); });
    ev.sort(function (a, b) { return b[0] - a[0]; });
    return ev.slice(0, 25).map(function (e) { return '<li><time>' + clock(e[0]) + '</time><span>' + e[1] + '</span></li>'; }).join('') || '<li class="lv-muted">' + (m.live ? 'Событий пока нет: лента ведётся с момента, когда матч открыли на сайте.' : 'Матч только начался.') + '</li>';
  }
  var hoverX = null, hoverY = null, heroSel = 0, hoverHero = null;
  function drawHeroes(m, t, W, H) {
    // Как график капитала героев в игре: ось времени растягивается до текущей секунды, сетка по капиталу и минутам.
    // В эфире «В эфире» история капитала есть только с момента, когда матч открыли на сайте: ось — с начала истории, а не с 0:00.
    var n = Math.max(0, Math.floor((t - m.econFrom) / m.econStep) + 1), x0 = m.live ? Math.max(0, m.econFrom) : 0, maxT = Math.max(x0 + 60, t);
    var max = 1000;
    m.players.forEach(function (p) { for (var i = 0; i < Math.min(n, p.econ.nw.length); i++) if (p.econ.nw[i] > max) max = p.econ.nw[i]; });
    var L = 40, B = 18, R = 26;
    var X = function (k) { return L + (W - L - R) * (m.econFrom + k * m.econStep - x0) / (maxT - x0); }, Y = function (v) { return H - B - (H - B - 10) * v / max; };
    var step = [1000, 2000, 5000, 10000, 20000].filter(function (s) { return max / s <= 5; })[0] || 20000;
    actx.font = '10px Manrope,system-ui,sans-serif'; actx.fillStyle = 'rgba(255,255,255,.4)'; actx.lineWidth = 1;
    actx.textAlign = 'right'; actx.textBaseline = 'middle';
    for (var g = 0; g <= max; g += step) {
      actx.strokeStyle = 'rgba(255,255,255,' + (g ? '.07' : '.18') + ')'; actx.beginPath(); actx.moveTo(L, Y(g)); actx.lineTo(W - R, Y(g)); actx.stroke();
      actx.fillText(g ? (g / 1000) + 'k' : '0', L - 6, Y(g));
    }
    var tstep = [60, 120, 300, 600].filter(function (s) { return (maxT - x0) / s <= 8; })[0] || 600;
    actx.textAlign = 'center'; actx.textBaseline = 'top';
    for (var tt = Math.ceil(x0 / tstep) * tstep; tt <= maxT; tt += tstep) actx.fillText(Math.round(tt / 60) + ':00', L + (W - L - R) * (tt - x0) / (maxT - x0), H - B + 4);
    // Наведение на линию — подсветка этого героя; клик закрепляет выбор. По умолчанию выбран первый герой.
    // Остальные линии бледнее, у Dire — пунктир, чтобы команды не сливались.
    var k0 = null, hov = null;
    if (hoverX != null && n > 1) {
      k0 = Math.max(0, Math.min(n - 1, Math.round(((hoverX - L) / (W - L - R) * (maxT - x0) + x0 - m.econFrom) / m.econStep)));
      m.players.forEach(function (p) { var v = p.econ.nw[k0]; if (v == null) return; var dy = Math.abs(Y(v) - hoverY); if (dy < 14 && (!hov || dy < hov[1])) hov = [p, dy]; });
    }
    var sel = hov ? hov[0] : (m.players.filter(function (p) { return p.slot === heroSel; })[0] || m.players[0]);
    hoverHero = hov ? hov[0].slot : null;
    var ends = [];
    m.players.slice().sort(function (a, b) { return (a === sel) - (b === sel); }).forEach(function (p) {
      var a = p.econ.nw, last = Math.min(n, a.length) - 1; if (last < 1) return;
      var on = p === sel;
      actx.globalAlpha = on ? 1 : 0.38; actx.strokeStyle = PCOL[p.slot]; actx.lineWidth = on ? 3 : 1.5;
      actx.setLineDash(p.team === 'dire' && !on ? [5, 3] : []); actx.beginPath();
      for (var i = 0; i <= last; i++) { if (a[i] == null) continue; i ? actx.lineTo(X(i), Y(a[i])) : actx.moveTo(X(i), Y(a[i])); }
      actx.stroke(); actx.setLineDash([]); actx.globalAlpha = 1;
      ends.push([p, X(last), Y(a[last]), a[last]]);
    });
    // иконки героев на концах линий — как в игре
    ends.forEach(function (e) {
      var img = icons[e[0].slug], r = 8;
      actx.save(); actx.beginPath(); actx.arc(e[1] + r + 2, e[2], r, 0, 7); actx.clip();
      if (img && img.complete && img.naturalWidth) actx.drawImage(img, e[1] + 2 - r * 0.6, e[2] - r, r * 3.2, r * 2); else { actx.fillStyle = PCOL[e[0].slot]; actx.fill(); }
      actx.restore(); actx.beginPath(); actx.arc(e[1] + r + 2, e[2], r, 0, 7); actx.strokeStyle = PCOL[e[0].slot]; actx.lineWidth = 1.5; actx.stroke();
    });
    var k = k0 != null ? k0 : n - 1, v = sel.econ.nw[Math.min(k, sel.econ.nw.length - 1)];
    if (k0 != null) { actx.strokeStyle = 'rgba(255,255,255,.25)'; actx.beginPath(); actx.moveTo(X(k), 6); actx.lineTo(X(k), H - B); actx.stroke(); }
    if (v != null && n > 0) { actx.beginPath(); actx.arc(X(k), Y(v), 4, 0, 7); actx.fillStyle = PCOL[sel.slot]; actx.fill(); }
    var label = v == null ? sel.hero : sel.hero + ': ' + num(v) + ' (' + clock(m.econFrom + k * m.econStep) + ')';
    $('lvAdvNow').textContent = label;
  }
  function drawAdv(m, t) {
    var hh = advKind === 'heroes' ? 260 : 140; if (adv.style.height !== hh + 'px') adv.style.height = hh + 'px';
    var s = sizeCanvas(adv, hh), W = s.w, H = s.h;
    actx.setTransform(s.d, 0, 0, s.d, 0, 0); actx.clearRect(0, 0, W, H);
    if (advKind === 'heroes') return drawHeroes(m, t, W, H);
    var n = 0; while (n < m.adv.t.length && m.adv.t[n] <= t) n++;
    var x0 = m.live && m.adv.t.length ? m.adv.t[0] : 0, maxT = Math.max(x0 + 60, m.adv.t[m.adv.t.length - 1] || 60);
    var series = advKind === 'xp' ? m.adv.xp : m.adv.gold;
    var lim = 1000; for (var k = 0; k < n; k++) lim = Math.max(lim, Math.abs(series[k]));
    var X = function (tt) { return 8 + (W - 16) * (tt - x0) / (maxT - x0); }, Y = function (g) { return H / 2 - (H / 2 - 10) * g / lim; };
    actx.strokeStyle = 'rgba(255,255,255,.15)'; actx.lineWidth = 1; actx.beginPath(); actx.moveTo(8, H / 2); actx.lineTo(W - 8, H / 2); actx.stroke();
    if (n < 2) return;
    for (var i = 1; i < n; i++) {
      actx.strokeStyle = (series[i] + series[i - 1]) >= 0 ? COL.radiant : COL.dire; actx.lineWidth = 2;
      actx.beginPath(); actx.moveTo(X(m.adv.t[i - 1]), Y(series[i - 1])); actx.lineTo(X(m.adv.t[i]), Y(series[i])); actx.stroke();
    }
    var g = series[n - 1];
    $('lvAdvNow').textContent = g === 0 ? 'поровну' : (g > 0 ? 'Radiant' : 'Dire') + ' +' + num(Math.abs(g));
  }
  function panel(m, item, t) {
    var kd = {}, sc = { radiant: 0, dire: 0 };
    if (m.live) { m.players.forEach(function (p) { kd[p.slot] = [p.k, p.d]; }); sc = { radiant: m.score[0], dire: m.score[1] }; }
    else m.deaths.forEach(function (d) {
      if (d.t > t) return;
      kd[d.victim] = kd[d.victim] || [0, 0]; kd[d.victim][1]++;
      if (d.killer >= 0 && d.killer <= 9) { kd[d.killer] = kd[d.killer] || [0, 0]; kd[d.killer][0]++; }
      if (d.counts) sc[d.victim < 5 ? 'dire' : 'radiant']++;
    });
    $('lvScoreRad').textContent = sc.radiant; $('lvScoreDire').textContent = sc.dire;
    $('lvRad').innerHTML = team(m, 'radiant', t, kd); $('lvDire').innerHTML = team(m, 'dire', t, kd);
    $('lvRadSum').innerHTML = teamStats(m, 'radiant', t); $('lvDireSum').innerHTML = teamStats(m, 'dire', t);
    lastPanel = [m, item, t];
    $('lvFeed').innerHTML = feed(m, t);
    $('lvCard').innerHTML = card(m, t, kd);
    if (!m.live) { words(); poll(m); }
    var played = m.live ? '' : new Date(m.endTime * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    $('lvRadName').textContent = m.pro && m.pro.radiant ? m.pro.radiant : 'Radiant';
    $('lvDireName').textContent = m.pro && m.pro.dire ? m.pro.dire : 'Dire';
    $('lvScoreRadName').textContent = m.pro && m.pro.radiant ? m.pro.radiant : 'Radiant';
    $('lvScoreDireName').textContent = m.pro && m.pro.dire ? m.pro.dire : 'Dire';
    $('lvStamp').innerHTML = m.live ? onlineStamp(m) : (m.pro ? '<span class="lv-pro">Про-матч</span> ' + esc(m.pro.league) + ' · ' : 'Рейтинговый матч · ') + 'матч <b>' + esc(m.matchId) + '</b> · сыгран ' + esc(played) + (own ? ' · <a href="/live/" data-m="">в общий эфир</a>' : '') + (m.pro ? tourLine(m) : '');
    drawAdv(m, t);
    wpLine(m, t);
  }

  // Чат 5: опрос «кто победит» (/api/live/poll/<id>).
  var POLL = {};
  var VOTE_ERR = { already_voted: 'С этого браузера уже голосовали.', poll_closed: 'Голосование по этому матчу закрыто.', rate_limited: 'Слишком много голосов с вашего адреса. Попробуйте позже.', no_cookie: 'Браузер не сохранил cookie — голос не принят. Обновите страницу.', forbidden: 'Голос не принят.' };
  // Частые слова — общий накопительный счётчик по всем матчам эфира (/api/live/words-all), не по текущему матчу:
  // со сменой матча не обнуляется. Полное облако — на /live/words/. Обновляется раз в 10 минут.
  var WALL = { at: 0, j: undefined };
  function words() {
    var el = $('lvWords');
    if (!el) return;
    if (WALL.j !== 'loading' && Date.now() - WALL.at > 600000) {
      WALL.at = Date.now(); if (WALL.j === undefined) WALL.j = 'loading';
      getJson('/api/live/words-all').then(function (j) { WALL.j = j && j.words ? j : false; lastSecond = null; })
        .catch(function (e) { if (!WALL.j || WALL.j === 'loading') WALL.j = false; lastSecond = null; if (window.console) console.warn('Слова чата:', e.message); });
    }
    var w = WALL.j, html;
    if (!w || w === 'loading') html = '<p class="lv-muted">' + (w === false ? 'Слова чата сейчас недоступны.' : 'Загружаем…') + '</p>';
    else html = w.words.length ? '<ol class="lv-words">' + w.words.slice(0, 12).map(function (x) { return '<li><span>' + esc(x[0]) + '</span><b>' + Number(x[1]).toLocaleString('ru-RU') + '</b></li>'; }).join('') + '</ol>'
      : '<p class="lv-muted">В чате матчей пока не набралось слов.</p>';
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
  }
  function loadPoll(id) {
    var p = POLL[id] = POLL[id] || {};
    p.busy = true; p.at = Date.now();
    getJson('/api/live/poll/' + id).then(function (j) { p.data = j; p.err = null; }).catch(function (e) { p.err = e.message; })
      .finally(function () { p.busy = false; p.at = Date.now(); lastSecond = null; });
  }
  function pollHtml(m, p) {
    var rn = m.pro && m.pro.radiant || 'Radiant', dn = m.pro && m.pro.dire || 'Dire';
    var note = p && p.note ? '<p class="lv-poll-note" role="status">' + esc(p.note) + '</p>' : '';
    if (!p || !p.data) return p && p.err ? '<p class="lv-muted">Опрос сейчас недоступен: ' + esc(p.err) + '</p>' : '<p class="lv-muted">Загружаем опрос…</p>';
    var d = p.data;
    if (d.open && !d.my) return '<div class="lv-poll-btns"><button type="button" class="rad" data-vote="r"' + (p.sending ? ' disabled' : '') + '>' + esc(rn) + '</button>' +
      '<button type="button" class="dire" data-vote="d"' + (p.sending ? ' disabled' : '') + '>' + esc(dn) + '</button></div>' + note +
      '<p class="lv-muted">Один голос с браузера. Счёт откроется после голоса, итог — на странице итогов матча.</p>';
    var tot = d.total || 0, closed = d.open ? '' : 'Голосовать можно, пока матч идёт в общем эфире. ';
    if (!tot) return note + '<p class="lv-muted">' + closed + 'По этому матчу голосов нет.</p>';
    var pr = Math.round(d.r / tot * 100), row = function (cls, name, n, pc) { return '<div class="lv-poll-row ' + cls + '"><span>' + esc(name) + '</span><b>' + pc + '%</b><small>' + num(n) + '</small></div>'; };
    return row('rad', rn, d.r, pr) + row('dire', dn, d.d, 100 - pr) + '<div class="lv-poll-bar"><i style="width:' + pr + '%"></i></div>' + note +
      '<p class="lv-muted">' + closed + 'Голосов: ' + num(tot) + (d.my ? '. Ваш голос — ' + esc(d.my === 'r' ? rn : dn) : '') + '.</p>';
  }
  function poll(m) {
    var el = $('lvPoll'), id = m.matchId, p = POLL[id];
    if (!el) return;
    if (!p || (!p.busy && !p.sending && Date.now() - p.at > (p.data && !p.data.open ? 300000 : 30000))) loadPoll(id);
    el.setAttribute('data-match', id);
    var html = pollHtml(m, POLL[id]);
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
  }
  function vote(id, side) {
    var p = POLL[id];
    if (!p || p.sending) return;
    p.sending = true; p.note = ''; lastSecond = null;
    fetch('/api/live/poll/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: side }), credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return [r.status, j]; }); })
      .then(function (x) {
        var j = x[1] || {};
        if (j.matchId) p.data = j;
        p.at = Date.now();
        if (x[0] === 200) goal('live_vote'); else p.note = VOTE_ERR[j.error] || 'Голос не принят (ответ ' + x[0] + ').';
      })
      .catch(function () { p.note = 'Нет соединения — голос не отправлен.'; })
      .finally(function () { p.sending = false; lastSecond = null; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-vote]'), box = $('lvPoll');
    if (b && box && box.contains(b)) vote(box.getAttribute('data-match'), b.getAttribute('data-vote'));
  });

  function frame() {
    requestAnimationFrame(frame);
    if (lostSince ? retryDue() : Date.now() - lastSync > RESYNC_MS) sync();
    if (online) { onlineFrame(); return; }
    var c = current();
    if (!c && own) {
      var om = matches[own];
      if (ownMissing) return;
      if (!om || om === 'loading') { loadMatch(own); drawMap(null, 0); if (!errorShown) { overlay.hidden = false; overlay.innerHTML = '<p>Загружаем матч…</p>'; } return; }
      if (!errorShown) overlay.hidden = true;
      drawMap(om, om.t1); $('lvClock').textContent = clock(om.t1);
      draft(om); if (lastSecond !== -om.t1) { lastSecond = -om.t1; panel(om, ownItem, om.t1); }
      winBanner(om, om.t1, 'Матч закончился. Выберите другой в полосе выше или вернитесь в общий эфир.');
      return;
    }
    if (!c) {
      // Заставка между матчами: трон часто падает в последнюю секунду записи, поэтому последний кадр
      // прошедшего матча с плашкой «Победа …» держим на карте до начала следующего.
      // Прошедший матч берём из того, что сейчас играло (lastItem), а не из расписания: после пересинхронизации
      // в паузе сервер уже не присылает его как current, и плашка победы пропадала. Без lastItem — prev от сервера.
      var prev = lastItem || (sched && (sched.prev || sched.current)), pm = prev && matches[prev.matchId];
      if (pm && pm !== 'loading' && now() >= prev.start + prev.len * 1000 && sched.next && now() < sched.next.start) {
        if (!errorShown) overlay.hidden = true;
        drawMap(pm, pm.t1); $('lvClock').textContent = clock(pm.t1);
        // Итоговые счёт, пики и таблицы команд — и для страницы, открытой прямо в паузе.
        draft(pm); if (lastSecond !== -pm.t1) { lastSecond = -pm.t1; panel(pm, prev, pm.t1); }
        winBanner(pm, pm.t1, 'Следующий матч через ' + Math.ceil((sched.next.start - now()) / 1000) + ' с');
        return;
      }
      $('lvWin').hidden = true;
      drawMap(null, 0);
      if (sched && sched.next && now() < sched.next.start) {
        overlay.hidden = false;
        overlay.innerHTML = '<p>Следующий матч через ' + Math.ceil((sched.next.start - now()) / 1000) + ' с</p>';
      } else if (sched && !syncing && Date.now() - lastSync > 3000 && retryDue()) sync();
      return;
    }
    lastItem = c.item;
    var m = matches[c.item.matchId];
    // live_switch — только смена матча самим эфиром, не выбор в полосе.
    if (m && m !== 'loading' && viewedMatch !== c.item.matchId) { if (!viewedMatch) goal('live_view'); else if (!manual) goal('live_switch'); manual = false; viewedMatch = c.item.matchId; }
    if (!m || m === 'loading') { loadMatch(c.item.matchId); drawMap(null, 0); return; }
    if (!errorShown) overlay.hidden = true;
    drawMap(m, c.t);
    draft(m); winBanner(m, c.t);
    $('lvClock').textContent = clock(c.t);
    var sec = Math.floor(c.t);
    if (sec !== lastSecond) { lastSecond = sec; panel(m, c.item, c.t); }
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-adv]'), function (b) {
    b.addEventListener('click', function () {
      advKind = b.getAttribute('data-adv');
      Array.prototype.forEach.call(document.querySelectorAll('[data-adv]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      if (lastPanel) drawAdv(lastPanel[0], lastPanel[2]);
    });
  });
  // иконки предметов, которых нет в assets/items, просто прячем
  root.addEventListener('error', function (e) { if (e.target && e.target.classList && e.target.classList.contains('lv-it')) e.target.remove(); }, true);
  adv.addEventListener('mousemove', function (e) { var r = adv.getBoundingClientRect(); hoverX = e.clientX - r.left; hoverY = e.clientY - r.top; if (lastPanel && advKind === 'heroes') drawAdv(lastPanel[0], lastPanel[2]); });
  adv.addEventListener('click', function () { if (hoverHero != null) { heroSel = hoverHero; if (lastPanel && advKind === 'heroes') drawAdv(lastPanel[0], lastPanel[2]); } });
  adv.addEventListener('mouseleave', function () { hoverX = hoverY = null; if (lastPanel && advKind === 'heroes') drawAdv(lastPanel[0], lastPanel[2]); });
  function pick(row) { heroSel = +row.getAttribute('data-slot'); if (lastPanel) { panel(lastPanel[0], lastPanel[1], lastPanel[2]); if (advKind === 'heroes') drawAdv(lastPanel[0], lastPanel[2]); } }
  ['lvRad', 'lvDire'].forEach(function (id) {
    $(id).addEventListener('click', function (e) { if (e.target.closest('a')) return; var r = e.target.closest('.lv-row'); if (r) pick(r); });
    $(id).addEventListener('keydown', function (e) { var r = e.target.closest && e.target.closest('.lv-row'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(r); } });
  });
  root.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-g]');
    if (g && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); switchOnline(g.getAttribute('data-g')); return; }
    var b = e.target.closest && e.target.closest('[data-m]'); if (!b || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); switchTo(b.getAttribute('data-m'));
  });
  window.addEventListener('popstate', function () { var g = urlOnline(); if (g) switchOnline(g, false); else switchTo(urlMatch(), false); });
  setInterval(loadList, 300000);
  setInterval(loadOnline, 60000);
  if (urlOnline()) switchOnline(urlOnline(), false);
  if (own) loadMatch(own);
  loadHeat(); loadKeyItems(); loadWinProb(); loadCardData(); loadList(); loadOnline(); sync(); requestAnimationFrame(frame);
})();
