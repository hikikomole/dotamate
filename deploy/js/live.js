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
  function showError(msg) { errorShown = true; overlay.hidden = false; overlay.innerHTML = '<p>' + esc(msg) + '</p><p class="lv-muted">Пробуем снова через минуту.</p>'; }

  function now() { return Date.now() + offset; }
  function sync() {
    if (syncing) return;
    syncing = true;
    getJson('/api/live/now').then(function (s) {
      offset = s.serverTime - Date.now(); sched = s; lastSync = Date.now(); errorShown = false;
      [s.current, s.next, s.prev].forEach(function (i) { if (i) loadMatch(i.matchId); });
    }).catch(function (e) { lastSync = Date.now(); showError(e.message); })
      .finally(function () { syncing = false; });
  }
  function loadMatch(id) {
    if (matches[id]) return;
    matches[id] = 'loading';
    getJson('/api/live/match/' + id).then(function (m) {
      matches[id] = m;
      m.players.forEach(function (p) {
        if (icons[p.slug]) return;
        var img = new Image(); img.src = '/assets/heroes/' + p.slug + '.png'; icons[p.slug] = img;
      });
      // Счёт по времени — то же правило, что в normalize.js: без убийцы и без награды не засчитывается.
      m.deaths.forEach(function (d) { d.counts = !(d.killer < 0 && !d.gold); });
    }).catch(function (e) { delete matches[id]; showError(e.message); });
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
    var r = POS[roles(m)[slot]]; if (!r) return '';
    return '<img class="' + cls + '" src="' + r[1] + '" alt="" title="' + r[0] + ' (определено по линии и фарму)">';
  }
  function draft(m) {
    if (m._draftFor === m.matchId) return;
    m._draftFor = m.matchId;
    var side = function (team) {
      return m.players.filter(function (p) { return p.team === team; }).sort(function (a, b) { return roles(m)[a.slot] - roles(m)[b.slot]; }).map(function (p) {
        return '<a class="lv-pick" href="/hero/' + esc(p.slug) + '/" title="' + esc(p.hero) + '"><img src="/assets/heroes/' + esc(p.slug) + '.png" alt="' + esc(p.hero) + '" loading="lazy">' + roleIcon(m, p.slot, 'lv-pick-role') + '</a>';
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
  // Прогноз по драфту — та же модель, что у DraftMate на главной (js/draft-model.js), срез Divine 5 и Immortal.
  // Только вероятность по пикам: ход матча не учитывается. Без данных модели блок не показывается.
  var DM = { M: null, idx: null, calib: null, state: 'idle' };
  function loadDraftModel() {
    if (DM.state !== 'idle' || !window.DraftModel) return;
    DM.state = 'loading';
    Promise.all([getJson('/data/our-matrix-top.json'), getJson('/data/draft-calibration-top.json')]).then(function (r) {
      if (!r[0] || !r[0].pairs || !r[1] || !r[1].alpha) throw new Error('нет данных модели');
      DM.M = r[0]; DM.idx = window.DraftModel.index(r[0]); DM.calib = r[1]; DM.state = 'ready';
      Object.keys(matches).forEach(function (k) { if (matches[k] && matches[k] !== 'loading') matches[k]._draftFor = null; });
    }).catch(function (e) { DM.state = 'failed'; console.warn('Прогноз по драфту недоступен:', e.message); });
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
      note: '<details class="lv-prob-more"><summary>Как считается шанс победы по драфту</summary><p>По одним пикам сильнее <b>' + esc(fav) + '</b>. Синергия: ' + esc(nameR) + ' ' + pp(synR) + ', ' + esc(nameD) + ' ' + pp(synD) + '; контрпики в пользу ' + esc(mu >= 0 ? nameR : nameD) + ' ' + pp(Math.abs(mu)) + ' п.п. ' +
        'Ход матча не учитывается. Считает DraftMate по ' + DM.M.matchesUsed.toLocaleString('ru-RU') + ' матчам Divine 5 и Immortal. <a href="/#draft=' + rad.join('-') + '_' + dire.join('-') + '_">Открыть в DraftMate</a></p></details>'
    };
  }
  // Трон: событие *_fort; если матч кончился сдачей (трон цел) — победа на последних секундах.
  function winAt(m) {
    var f = m.buildings.filter(function (b) { return /_fort$/.test(b.name); })[0];
    return f ? f.t : m.t1 - 3;
  }
  function winBanner(m, t, note) {
    var el = $('lvWin');
    if (t < winAt(m)) { if (!el.hidden) el.hidden = true; return; }
    var name = m.radiantWin ? (m.pro && m.pro.radiant || 'Radiant') : (m.pro && m.pro.dire || 'Dire');
    var html = '<b class="' + (m.radiantWin ? 'radiant' : 'dire') + '">Победа ' + esc(name) + '</b><span>' + (m.buildings.some(function (b) { return /_fort$/.test(b.name); }) ? 'трон разрушен' : 'соперник сдался') + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '');
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
      return '<div class="lv-row' + (dead ? ' is-dead' : '') + '">' +
        '<span class="lv-herobox"><img class="lv-hero" src="/assets/heroes/' + esc(p.slug) + '.png" alt="" loading="lazy">' + roleIcon(m, p.slot, 'lv-role') + '</span>' +
        '<div class="lv-who"><a class="lv-name" href="/hero/' + esc(p.slug) + '/">' + esc(p.hero) + '</a><span class="lv-items">' + items(p, t) + '</span></div>' +
        '<span class="lv-lvl" title="Уровень">' + (lvl == null ? '—' : lvl) + '</span>' +
        '<span class="lv-kd" title="Убийства / смерти">' + k[0] + '/' + k[1] + '</span>' +
        '<span class="lv-lh" title="Добивания / денаи">' + (lh == null ? '—' : lh + '/' + dn) + '</span>' +
        '<span class="lv-xpm" title="Опыт в минуту">' + (xp == null || t <= 0 ? '—' : Math.round(xp / mins)) + '</span>' +
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
    return 'Капитал <b>' + num(nw) + '</b> · башен <b>' + (11 - lost) + '/11</b> · варды <b>' + obs + '</b> obs, <b>' + sen + '</b> sen';
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
    m.buildings.forEach(function (b) { if (b.t <= t) ev.push([b.t, 'Разрушено — ' + esc(buildingName(b.name))]); });
    m.roshan.forEach(function (r) { if (r.t <= t) ev.push([r.t, 'Рошан убит']); });
    (m.chat || []).forEach(function (c) { if (c[0] <= t) ev.push([c[0], '<span class="lv-chat">' + name(c[1]) + ': ' + esc(c[2]) + '</span>']); });
    var fb = m.deaths.filter(function (d) { return d.killer >= 0 && d.killer <= 9; })[0];
    if (fb && fb.t <= t) ev.push([fb.t, 'Первая кровь — ' + name(fb.killer)]);
    ev.sort(function (a, b) { return b[0] - a[0]; });
    return ev.slice(0, 25).map(function (e) { return '<li><time>' + clock(e[0]) + '</time><span>' + e[1] + '</span></li>'; }).join('') || '<li class="lv-muted">Матч только начался.</li>';
  }
  var hoverX = null, hoverY = null, heroSel = 0, hoverHero = null;
  function drawHeroes(m, t, W, H) {
    // Как график капитала героев в игре: ось времени растягивается до текущей секунды, сетка по капиталу и минутам.
    var n = Math.max(0, Math.floor((t - m.econFrom) / m.econStep) + 1), maxT = Math.max(60, t);
    var max = 1000;
    m.players.forEach(function (p) { for (var i = 0; i < Math.min(n, p.econ.nw.length); i++) if (p.econ.nw[i] > max) max = p.econ.nw[i]; });
    var L = 40, B = 18, R = 26;
    var X = function (k) { return L + (W - L - R) * (m.econFrom + k * m.econStep) / maxT; }, Y = function (v) { return H - B - (H - B - 10) * v / max; };
    var step = [1000, 2000, 5000, 10000, 20000].filter(function (s) { return max / s <= 5; })[0] || 20000;
    actx.font = '10px Manrope,system-ui,sans-serif'; actx.fillStyle = 'rgba(255,255,255,.4)'; actx.lineWidth = 1;
    actx.textAlign = 'right'; actx.textBaseline = 'middle';
    for (var g = 0; g <= max; g += step) {
      actx.strokeStyle = 'rgba(255,255,255,' + (g ? '.07' : '.18') + ')'; actx.beginPath(); actx.moveTo(L, Y(g)); actx.lineTo(W - R, Y(g)); actx.stroke();
      actx.fillText(g ? (g / 1000) + 'k' : '0', L - 6, Y(g));
    }
    var tstep = [60, 120, 300, 600].filter(function (s) { return maxT / s <= 8; })[0] || 600;
    actx.textAlign = 'center'; actx.textBaseline = 'top';
    for (var tt = 0; tt <= maxT; tt += tstep) actx.fillText(Math.round(tt / 60) + ':00', L + (W - L - R) * tt / maxT, H - B + 4);
    // Наведение на линию — подсветка этого героя; клик закрепляет выбор. По умолчанию выбран первый герой.
    // Остальные линии бледнее, у Dire — пунктир, чтобы команды не сливались.
    var k0 = null, hov = null;
    if (hoverX != null && n > 1) {
      k0 = Math.max(0, Math.min(n - 1, Math.round(((hoverX - L) / (W - L - R) * maxT - m.econFrom) / m.econStep)));
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
    var maxT = Math.max(60, m.adv.t[m.adv.t.length - 1] || 60);
    var series = advKind === 'xp' ? m.adv.xp : m.adv.gold;
    var lim = 1000; for (var k = 0; k < n; k++) lim = Math.max(lim, Math.abs(series[k]));
    var X = function (tt) { return 8 + (W - 16) * tt / maxT; }, Y = function (g) { return H / 2 - (H / 2 - 10) * g / lim; };
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
    m.deaths.forEach(function (d) {
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
    var played = new Date(m.endTime * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    $('lvRadName').textContent = m.pro && m.pro.radiant ? m.pro.radiant : 'Radiant';
    $('lvDireName').textContent = m.pro && m.pro.dire ? m.pro.dire : 'Dire';
    $('lvScoreRadName').textContent = m.pro && m.pro.radiant ? m.pro.radiant : 'Radiant';
    $('lvScoreDireName').textContent = m.pro && m.pro.dire ? m.pro.dire : 'Dire';
    $('lvStamp').innerHTML = (m.pro ? '<span class="lv-pro">Про-матч</span> ' + esc(m.pro.league) + ' · ' : 'Рейтинговый матч · ') + 'матч <b>' + esc(m.matchId) + '</b> · сыгран ' + esc(played);
    drawAdv(m, t);
  }

  function frame() {
    requestAnimationFrame(frame);
    if (Date.now() - lastSync > RESYNC_MS) sync();
    var c = current();
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
      } else if (sched && !syncing && Date.now() - lastSync > 3000) sync();
      return;
    }
    lastItem = c.item;
    var m = matches[c.item.matchId];
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
  loadHeat(); sync(); requestAnimationFrame(frame);
})();
