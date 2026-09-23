/* Инструмент драфта на главной.
 *
 * Данные:
 *   /data/draft-matrix.json   — матрица пар (Stratz heroStats.matchUp, Divine/Immortal)
 *   /api/dota/hero-positions  — доли и винрейты героев по пяти позициям
 *   /data/lane-matrix.json    — исходы линий по парам (Stratz laneOutcome)
 *
 * Снимки, а не живые запросы: Stratz пускает токен не больше чем с двух
 * IP-адресов за 15 минут, а Cloudflare Worker ходит наружу с разных адресов.
 *
 * Счёт: доля побед пары сглаживается к 50% по выборке ((w + K/2)/(n + K), K=50),
 * отклонения от 50% в процентных пунктах складываются. Метод и его границы
 * расписаны в блоке «Откуда числа» под инструментом.
 */
(function () {
  'use strict';

  var K = 50;            // сила сглаживания: пара с 50 матчами тянется к 50% наполовину
  var MIN_N = 30;        // порог «малой выборки» для режима отсечки
  var TOP_N = 15;        // сколько героев показываем в рекомендациях
  var POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
  var POS_LABEL = { POSITION_1: 'Керри', POSITION_2: 'Мид', POSITION_3: 'Офлейн', POSITION_4: 'Саппорт', POSITION_5: 'Хардсаппорт' };
  var POS_SHORT = { POSITION_1: 'Поз. 1', POSITION_2: 'Поз. 2', POSITION_3: 'Поз. 3', POSITION_4: 'Поз. 4', POSITION_5: 'Поз. 5' };
  var SIDES = ['radiant', 'dire'];

  var root = document.getElementById('draftTool');
  if (!root) return;

  var M = null, heroes = [], heroById = {}, posData = {}, matrixIdx = {}, metaThreshold = 0;
  var loaded = false, loading = false;

  var state = {
    picks: { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] },
    posOverride: { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] },
    bans: [],
    target: { side: 'radiant', slot: 0 },
    mode: 'radiant',     // radiant | dire | ban — куда кладёт быстрый ввод
    metaOnly: true,
    confident: false,
    sort: { radiant: 'all', dire: 'all' },
    role: { radiant: 'any', dire: 'any' },
    history: []
  };

  // ---------- утилиты ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function slug(h) { return String(h && h.name || '').replace(/^npc_dota_hero_/, ''); }
  function icon(h) { return '/assets/heroes/' + slug(h) + '.png'; }
  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return '<span class="dt-zero">—</span>';
    var r = Math.round(v * 10) / 10;
    var cls = r > 0.05 ? 'dt-up' : (r < -0.05 ? 'dt-down' : 'dt-zero');
    var sign = r > 0.05 ? '+' : '';
    return '<span class="' + cls + '">' + sign + r.toFixed(1).replace('.', ',') + '</span>';
  }

  // ---------- матрица ----------
  function pairKey(i, j) {
    var N = M.heroCount;
    return i < j ? (i * (2 * N - i - 1)) / 2 + (j - i - 1) : (j * (2 * N - j - 1)) / 2 + (i - j - 1);
  }
  // Сглаженное отклонение доли побед от 50% в процентных пунктах.
  function adv(n, w) {
    if (!n) return 0;
    if (state.confident && n < MIN_N) return 0;
    return 100 * ((w + K / 2) / (n + K)) - 50;
  }
  function withAdv(a, b) {
    var i = matrixIdx[a], j = matrixIdx[b];
    if (i === undefined || j === undefined || i === j) return 0;
    var p = M.pairs['with'][pairKey(i, j)];
    return adv(p[0], p[1]);
  }
  // Преимущество героя a против героя b.
  function vsAdv(a, b) {
    var i = matrixIdx[a], j = matrixIdx[b];
    if (i === undefined || j === undefined || i === j) return 0;
    var p = M.pairs.vs[pairKey(i, j)];
    return i < j ? adv(p[0], p[1]) : adv(p[0], p[0] - p[1]);
  }

  // ---------- позиции ----------
  function heroPositions(id) {
    var h = posData[String(id)];
    if (!h || !h.positions) return [];
    return POSITIONS.filter(function (p) { return h.positions[p]; })
      .sort(function (a, b) { return h.positions[b].matches - h.positions[a].matches; });
  }
  function heroMatches(id) {
    var h = posData[String(id)];
    return h && h.totalMatches ? h.totalMatches : 0;
  }
  // Раскладка позиций внутри команды: ручной выбор в приоритете, остальным —
  // самая частая ещё свободная роль.
  function assignPositions(side) {
    var picks = state.picks[side], over = state.posOverride[side];
    var taken = {}, out = [null, null, null, null, null];
    picks.forEach(function (id, i) {
      if (id && over[i] && !taken[over[i]]) { out[i] = over[i]; taken[over[i]] = true; }
    });
    picks.forEach(function (id, i) {
      if (!id || out[i]) return;
      var order = heroPositions(id);
      for (var k = 0; k < order.length; k++) { if (!taken[order[k]]) { out[i] = order[k]; taken[order[k]] = true; return; } }
      for (var p = 0; p < POSITIONS.length; p++) { if (!taken[POSITIONS[p]]) { out[i] = POSITIONS[p]; taken[POSITIONS[p]] = true; return; } }
    });
    return out;
  }
  function firstFreePosition(side) {
    var used = assignPositions(side).filter(Boolean);
    for (var i = 0; i < POSITIONS.length; i++) { if (used.indexOf(POSITIONS[i]) === -1) return POSITIONS[i]; }
    return null;
  }

  // ---------- линии ----------
  // Снимок грузим отдельно и только когда в драфте появился первый герой:
  // на главной он иначе висел бы мёртвым весом.
  var laneData = null, lanePromise = null;
  function ensureLane() {
    if (laneData || lanePromise) return;
    lanePromise = getJson('/data/lane-matrix.json').then(function (j) {
      var idx = {};
      Object.keys(j.heroes || {}).forEach(function (id) {
        idx[id] = {};
        Object.keys(j.heroes[id]).forEach(function (pos) {
          var map = {};
          j.heroes[id][pos].forEach(function (r) { map[r[0]] = r; });
          idx[id][pos] = map;
        });
      });
      laneData = { idx: idx, fetchedAt: j.fetchedAt };
      render();
    }).catch(function () { laneData = { idx: {}, failed: true }; render(); });
  }
  function laneRow(id, pos, vsId) {
    if (!laneData) return null;
    var h = laneData.idx[id];
    if (!h || !h[pos]) return null;
    return h[pos][vsId] || null;
  }
  // Преимущество героя id (на позиции pos) на линии против vsId, в п.п.
  // Ничьи не считаем: берём только явно выигранные и проигранные линии.
  // У Stratz есть два среза на одно и то же событие — «id против vsId» и
  // «vsId против id». Они слегка расходятся, поэтому берём обе оценки и
  // усредняем по выборке: иначе зеркальный драфт давал бы другой ответ.
  function laneAdv(id, pos, vsId, enemyPos) {
    var a = laneRow(id, pos, vsId);
    var b = enemyPos ? laneRow(vsId, enemyPos, id) : null;
    var nA = a ? a[2] + a[3] : 0, nB = b ? b[2] + b[3] : 0;
    if (!nA && !nB) return null;
    if (!nB) return adv(nA, a[2]);
    if (!nA) return -adv(nB, b[2]);
    // доли складываем с весами выборок, сглаживание применяем к общей оценке
    var rate = (a[2] + (nB - b[2])) / (nA + nB);
    var n = Math.max(nA, nB);
    return adv(n, Math.round(n * rate));
  }

  var LANES = [
    { key: 'bot', title: 'Нижняя', rad: ['POSITION_1', 'POSITION_5'], dire: ['POSITION_3', 'POSITION_4'] },
    { key: 'mid', title: 'Центр', rad: ['POSITION_2'], dire: ['POSITION_2'] },
    { key: 'top', title: 'Верхняя', rad: ['POSITION_3', 'POSITION_4'], dire: ['POSITION_1', 'POSITION_5'] }
  ];
  function heroesAt(side, positions) {
    var assign = assignPositions(side), picks = state.picks[side], out = [];
    assign.forEach(function (p, i) { if (p && picks[i] && positions.indexOf(p) !== -1) out.push({ id: picks[i], pos: p }); });
    return out;
  }
  function laneScore(lane) {
    var rad = heroesAt('radiant', lane.rad), dire = heroesAt('dire', lane.dire);
    if (!rad.length || !dire.length) return { rad: rad, dire: dire, value: null, pending: false };
    var sum = 0, cnt = 0, pending = false;
    rad.forEach(function (r) {
      dire.forEach(function (d) {
        var v = laneAdv(r.id, r.pos, d.id, d.pos);
        if (v === null) { pending = !laneData; return; }
        sum += v; cnt++;
      });
    });
    return { rad: rad, dire: dire, value: cnt ? sum / cnt : null, pending: pending };
  }

  // ---------- расчёт драфта ----------
  function teamSynergy(side) {
    var p = state.picks[side].filter(Boolean), s = 0;
    for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++) s += withAdv(p[i], p[j]);
    return s;
  }
  function crossMatchup() {
    var r = state.picks.radiant.filter(Boolean), d = state.picks.dire.filter(Boolean), s = 0;
    r.forEach(function (a) { d.forEach(function (b) { s += vsAdv(a, b); }); });
    return s;
  }
  function laneTotal() {
    var sum = 0, any = false;
    LANES.forEach(function (l) { var sc = laneScore(l); if (sc.value !== null) { sum += sc.value; any = true; } });
    return any ? sum : null;
  }

  // ---------- рекомендации ----------
  function isTaken(id) {
    return state.bans.indexOf(id) !== -1 ||
      state.picks.radiant.indexOf(id) !== -1 || state.picks.dire.indexOf(id) !== -1;
  }
  function passesMeta(id) { return !state.metaOnly || heroMatches(id) >= metaThreshold; }
  function recommend(side) {
    var enemy = side === 'radiant' ? 'dire' : 'radiant';
    var allies = state.picks[side].filter(Boolean);
    var enemies = state.picks[enemy].filter(Boolean);
    var wantPos = state.role[side] === 'any' ? null : state.role[side];
    var openPos = wantPos || firstFreePosition(side);
    var lane = openPos ? LANES.filter(function (l) { return l[side === 'radiant' ? 'rad' : 'dire'].indexOf(openPos) !== -1; })[0] : null;
    var laneEnemies = lane ? heroesAt(enemy, lane[enemy === 'radiant' ? 'rad' : 'dire']) : [];

    var rows = [];
    heroes.forEach(function (h) {
      if (isTaken(h.id) || !passesMeta(h.id)) return;
      if (wantPos && heroPositions(h.id).indexOf(wantPos) === -1) return;
      var syn = 0, mat = 0;
      allies.forEach(function (a) { syn += withAdv(h.id, a); });
      enemies.forEach(function (e) { mat += vsAdv(h.id, e); });
      var laneVal = null;
      if (openPos && laneEnemies.length) {
        var s = 0, c = 0;
        laneEnemies.forEach(function (e) {
          var v = laneAdv(h.id, openPos, e.id, e.pos);
          if (v !== null) { s += v; c++; }
        });
        if (c) laneVal = s / c;
      }
      rows.push({
        hero: h, pos: openPos || heroPositions(h.id)[0] || null,
        syn: allies.length ? syn : null,
        mat: enemies.length ? mat : null,
        lane: laneVal,
        all: syn + mat + (laneVal || 0),
        matches: heroMatches(h.id)
      });
    });
    var key = state.sort[side];
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null && bv === null) return b.matches - a.matches;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (Math.abs(bv - av) < 0.001) return b.matches - a.matches;
      return bv - av;
    });
    return rows.slice(0, TOP_N);
  }

  // ---------- отрисовка ----------
  function renderSlots(side) {
    var el = $(side === 'radiant' ? 'dtSlotsRad' : 'dtSlotsDire');
    var assign = assignPositions(side);
    el.innerHTML = state.picks[side].map(function (id, i) {
      var active = state.target.side === side && state.target.slot === i ? ' active' : '';
      if (!id) return '<div class="dt-slot' + active + '" data-slot="' + i + '" data-side="' + side + '" role="button" tabindex="0">+ Пик</div>';
      var h = heroById[id], pos = assign[i];
      var opts = POSITIONS.map(function (p) {
        return '<option value="' + p + '"' + (p === pos ? ' selected' : '') + '>' + POS_SHORT[p] + '</option>';
      }).join('');
      return '<div class="dt-slot filled' + active + '" data-slot="' + i + '" data-side="' + side + '" role="button" tabindex="0">' +
        '<button type="button" class="dt-slot-clear" data-clear="' + i + '" data-side="' + side + '" aria-label="Убрать героя">×</button>' +
        '<img src="' + icon(h) + '" alt="' + esc(h.localized_name) + '" loading="lazy">' +
        '<span class="dt-slot-name">' + esc(h.localized_name) + '</span>' +
        '<select data-pos="' + i + '" data-side="' + side + '" aria-label="Позиция героя">' + opts + '</select>' +
        '</div>';
    }).join('');
  }

  function renderBans() {
    var el = $('dtBanList');
    if (!state.bans.length) {
      el.className = 'dt-bans-empty';
      el.textContent = 'Пусто — забаненные герои пропадают из подсказок и рекомендаций';
      return;
    }
    el.className = '';
    el.style.display = 'flex';
    el.style.flexWrap = 'wrap';
    el.style.gap = '8px';
    el.innerHTML = state.bans.map(function (id) {
      var h = heroById[id];
      return '<button type="button" class="dt-ban" data-unban="' + id + '" title="Снять бан">' +
        '<img src="' + icon(h) + '" alt="" loading="lazy">' + esc(h.localized_name) + ' ×</button>';
    }).join('');
  }

  function renderPrediction() {
    var synR = teamSynergy('radiant'), synD = teamSynergy('dire'), mat = crossMatchup(), lane = laneTotal();
    var anyPick = state.picks.radiant.concat(state.picks.dire).some(Boolean);
    var total = (synR - synD) + mat + (lane || 0);

    // Шкала показывает перевес в процентных пунктах, а не вероятность победы:
    // сумма парных преимуществ не откалибрована по исходам матчей (см. «Откуда числа»).
    function pp(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ','); }
    function fill(v) { return 50 + Math.max(-45, Math.min(45, v)) / 2; }

    $('dtWinRad').textContent = anyPick ? pp(total) : '—';
    $('dtWinDire').textContent = anyPick ? pp(-total) : '—';
    $('dtWinFillRad').style.width = (anyPick ? fill(total) : 50) + '%';
    $('dtWinFillDire').style.width = (100 - (anyPick ? fill(total) : 50)) + '%';

    $('dtLaneRad').textContent = lane === null ? '—' : pp(lane);
    $('dtLaneDire').textContent = lane === null ? '—' : pp(-lane);
    $('dtLaneFillRad').style.width = (lane === null ? 50 : fill(lane)) + '%';
    $('dtLaneFillDire').style.width = (100 - (lane === null ? 50 : fill(lane))) + '%';

    function sum(side) {
      var s = side === 'radiant' ? synR : synD;
      var m = side === 'radiant' ? mat : -mat;
      var picked = state.picks[side].filter(Boolean).length;
      var other = state.picks[side === 'radiant' ? 'dire' : 'radiant'].filter(Boolean).length;
      return 'синергия ' + (picked > 1 ? pp(s) : '—') + ' · контрпик ' + (picked && other ? pp(m) : '—');
    }
    $('dtSumRad').textContent = sum('radiant');
    $('dtSumDire').textContent = sum('dire');
  }

  function renderLanes() {
    $('dtLaneGrid').innerHTML = LANES.map(function (l) {
      var sc = laneScore(l);
      var val = sc.value === null
        ? (sc.pending ? '<b class="dt-zero">…</b>' : '<b class="dt-zero">—</b>')
        : '<b>' + fmt(sc.value) + ' п.п.</b>';
      var body = (!sc.rad.length || !sc.dire.length)
        ? '<span class="dt-lane-wait">Ждём пики</span>'
        : '<span class="dt-lane-side">' + sc.rad.map(function (x) { return '<img src="' + icon(heroById[x.id]) + '" alt="' + esc(heroById[x.id].localized_name) + '" title="' + esc(heroById[x.id].localized_name + ' · ' + POS_LABEL[x.pos]) + '" loading="lazy">'; }).join('') + '</span>' +
        '<span class="dt-lane-vs">против</span>' +
        '<span class="dt-lane-side">' + sc.dire.map(function (x) { return '<img src="' + icon(heroById[x.id]) + '" alt="' + esc(heroById[x.id].localized_name) + '" title="' + esc(heroById[x.id].localized_name + ' · ' + POS_LABEL[x.pos]) + '" loading="lazy">'; }).join('') + '</span>';
      return '<div class="dt-lane"><div class="dt-lane-top"><span>' + l.title + '</span>' + val + '</div>' +
        '<div class="dt-lane-body">' + body + '</div></div>';
    }).join('');
  }

  var ROLE_CHIPS = [['any', 'Любая']].concat(POSITIONS.map(function (p) { return [p, POS_LABEL[p]]; }));
  function renderRoles() {
    SIDES.forEach(function (side) {
      var el = root.querySelector('[data-roles="' + side + '"]');
      el.innerHTML = ROLE_CHIPS.map(function (c) {
        return '<button type="button" class="dt-role' + (state.role[side] === c[0] ? ' active' : '') + '" data-role="' + c[0] + '" data-side="' + side + '">' + c[1] + '</button>';
      }).join('');
    });
  }

  function renderRecs() {
    SIDES.forEach(function (side) {
      var rows = recommend(side);
      var tb = $(side === 'radiant' ? 'dtRecRad' : 'dtRecDire');
      if (!rows.length) { tb.innerHTML = '<tr><td colspan="5" class="dt-zero">Нет героев под этот фильтр</td></tr>'; return; }
      tb.innerHTML = rows.map(function (r, i) {
        return '<tr data-pick="' + r.hero.id + '" data-side="' + side + '">' +
          '<td><div class="dt-rec-hero"><img src="' + icon(r.hero) + '" alt="" loading="lazy">' +
          '<span><b>' + (i + 1) + '. ' + esc(r.hero.localized_name) + '</b>' +
          '<small>' + (r.pos ? POS_LABEL[r.pos] + ' · ' : '') + (r.matches ? r.matches.toLocaleString('ru-RU') + ' матчей' : 'нет данных') + '</small></span></div></td>' +
          '<td>' + fmt(r.lane) + '</td><td>' + fmt(r.syn) + '</td><td>' + fmt(r.mat) + '</td><td>' + fmt(r.all) + '</td></tr>';
      }).join('');
      root.querySelectorAll('.dt-rec-panel[data-side="' + side + '"] th.sortable').forEach(function (th) {
        th.classList.toggle('sorted', th.dataset.sort === state.sort[side]);
      });
    });
  }

  function render() {
    if (!loaded) return;
    SIDES.forEach(renderSlots);
    renderBans();
    renderPrediction();
    renderLanes();
    renderRecs();
    if (state.picks.radiant.concat(state.picks.dire).some(Boolean)) ensureLane();
    writeHash();
  }

  // ---------- действия ----------
  function pushHistory() {
    state.history.push(JSON.stringify({ picks: state.picks, posOverride: state.posOverride, bans: state.bans }));
    if (state.history.length > 40) state.history.shift();
  }
  function undo() {
    var prev = state.history.pop();
    if (!prev) return;
    var s = JSON.parse(prev);
    state.picks = s.picks; state.posOverride = s.posOverride; state.bans = s.bans;
    render();
  }
  function placeHero(id) {
    if (isTaken(id)) return;
    pushHistory();
    if (state.mode === 'ban') { state.bans.push(id); render(); return; }
    var side = state.mode;
    var slot = state.target.side === side ? state.target.slot : -1;
    if (slot < 0 || state.picks[side][slot]) slot = state.picks[side].indexOf(null);
    if (slot < 0) return;
    state.picks[side][slot] = id;
    state.posOverride[side][slot] = null;
    var next = state.picks[side].indexOf(null);
    state.target = { side: side, slot: next < 0 ? slot : next };
    render();
  }
  function clearSlot(side, i) {
    pushHistory();
    state.picks[side][i] = null;
    state.posOverride[side][i] = null;
    render();
  }
  function resetAll() {
    pushHistory();
    state.picks = { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] };
    state.posOverride = { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] };
    state.bans = [];
    state.target = { side: 'radiant', slot: 0 };
    render();
  }

  // ---------- ссылка на драфт ----------
  function writeHash() {
    var r = state.picks.radiant.map(function (x) { return x || ''; }).join('-');
    var d = state.picks.dire.map(function (x) { return x || ''; }).join('-');
    var b = state.bans.join('-');
    var any = state.picks.radiant.concat(state.picks.dire).some(Boolean) || state.bans.length;
    var hash = any ? '#draft=' + r + '_' + d + '_' + b : '';
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  }
  function readHash() {
    var m = /#draft=([^&]*)/.exec(location.hash);
    if (!m) return;
    var parts = decodeURIComponent(m[1]).split('_');
    var toIds = function (s) { return (s || '').split('-').map(function (x) { var n = Number(x); return n && heroById[n] ? n : null; }); };
    var r = toIds(parts[0]), d = toIds(parts[1]);
    for (var i = 0; i < 5; i++) { state.picks.radiant[i] = r[i] || null; state.picks.dire[i] = d[i] || null; }
    state.bans = toIds(parts[2]).filter(Boolean);
  }

  // ---------- подсказки поиска ----------
  var sugCursor = -1;
  function suggestions(q) {
    q = q.trim().toLowerCase();
    var list = heroes.filter(function (h) { return !isTaken(h.id); });
    if (q) list = list.filter(function (h) { return h.localized_name.toLowerCase().indexOf(q) !== -1; });
    list.sort(function (a, b) {
      if (q) {
        var ai = a.localized_name.toLowerCase().indexOf(q), bi = b.localized_name.toLowerCase().indexOf(q);
        if (ai !== bi) return ai - bi;
      }
      return heroMatches(b.id) - heroMatches(a.id);
    });
    return list.slice(0, 12);
  }
  function renderSuggest() {
    var box = $('dtSuggest'), q = $('dtSearch').value;
    var list = suggestions(q);
    if (!list.length) { box.classList.remove('open'); box.innerHTML = ''; return; }
    box.innerHTML = list.map(function (h, i) {
      var pos = heroPositions(h.id)[0];
      return '<button type="button" data-hero="' + h.id + '"' + (i === sugCursor ? ' class="cursor"' : '') + '>' +
        '<img src="' + icon(h) + '" alt="" loading="lazy"><b>' + esc(h.localized_name) + '</b>' +
        '<small>' + (pos ? POS_LABEL[pos] : '') + '</small></button>';
    }).join('');
    box.classList.add('open');
  }
  function closeSuggest() { $('dtSuggest').classList.remove('open'); sugCursor = -1; }

  // ---------- события ----------
  function bind() {
    root.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-clear]'))) { clearSlot(t.dataset.side, Number(t.dataset.clear)); return; }
      if ((t = e.target.closest('.dt-slot'))) {
        state.target = { side: t.dataset.side, slot: Number(t.dataset.slot) };
        state.mode = t.dataset.side;
        syncSideSwitch();
        render();
        $('dtSearch').focus();
        return;
      }
      if ((t = e.target.closest('[data-unban]'))) {
        pushHistory();
        state.bans = state.bans.filter(function (x) { return x !== Number(t.dataset.unban); });
        render(); return;
      }
      if ((t = e.target.closest('[data-hero]'))) { placeHero(Number(t.dataset.hero)); $('dtSearch').value = ''; closeSuggest(); return; }
      if ((t = e.target.closest('[data-role]'))) { state.role[t.dataset.side] = t.dataset.role; renderRoles(); renderRecs(); return; }
      if ((t = e.target.closest('th.sortable'))) {
        var panel = t.closest('.dt-rec-panel');
        state.sort[panel.dataset.side] = t.dataset.sort;
        renderRecs(); return;
      }
      if ((t = e.target.closest('[data-pick]'))) {
        var side = t.dataset.side;
        state.mode = side;
        if (state.target.side !== side || state.picks[side][state.target.slot]) {
          var free = state.picks[side].indexOf(null);
          state.target = { side: side, slot: free < 0 ? 0 : free };
        }
        syncSideSwitch();
        placeHero(Number(t.dataset.pick)); return;
      }
      if ((t = e.target.closest('[data-side][data-side-btn]'))) { return; }
    });

    root.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-pos]');
      if (!sel) return;
      pushHistory();
      var side = sel.dataset.side, i = Number(sel.dataset.pos), val = sel.value;
      // если позицию уже держит другой слот — освобождаем её
      state.posOverride[side].forEach(function (p, k) { if (k !== i && p === val) state.posOverride[side][k] = null; });
      state.posOverride[side][i] = val;
      render();
    });

    $('dtSideSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-side]');
      if (!b) return;
      state.mode = b.dataset.side;
      if (state.mode !== 'ban') {
        var free = state.picks[state.mode].indexOf(null);
        state.target = { side: state.mode, slot: free < 0 ? 0 : free };
      }
      syncSideSwitch();
      render();
      $('dtSearch').focus();
    });

    var inp = $('dtSearch');
    inp.addEventListener('input', function () { sugCursor = -1; renderSuggest(); });
    inp.addEventListener('focus', renderSuggest);
    inp.addEventListener('keydown', function (e) {
      var list = suggestions(inp.value);
      if (e.key === 'ArrowDown') { sugCursor = Math.min(list.length - 1, sugCursor + 1); renderSuggest(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sugCursor = Math.max(0, sugCursor - 1); renderSuggest(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        var pick = list[sugCursor < 0 ? 0 : sugCursor];
        if (pick) { placeHero(pick.id); inp.value = ''; closeSuggest(); }
        e.preventDefault();
      } else if (e.key === 'Escape') { closeSuggest(); }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.dt-search')) closeSuggest(); });

    $('dtMetaOnly').addEventListener('change', function (e) { state.metaOnly = e.target.checked; renderRecs(); });
    $('dtConfident').addEventListener('change', function (e) { state.confident = e.target.checked; render(); });
    $('dtReset').addEventListener('click', resetAll);
    $('dtUndo').addEventListener('click', undo);
    $('dtBanAdd').addEventListener('click', function () {
      state.mode = 'ban'; syncSideSwitch(); $('dtSearch').focus(); renderSuggest();
    });
    $('dtShare').addEventListener('click', function () {
      writeHash();
      var url = location.href;
      var done = function () { $('dtShare').textContent = 'Скопировано'; setTimeout(function () { $('dtShare').textContent = 'Ссылка'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Ссылка на драфт:', url); });
      else prompt('Ссылка на драфт:', url);
    });
  }
  function syncSideSwitch() {
    $('dtSideSwitch').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.side === state.mode);
    });
  }

  // ---------- загрузка ----------
  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }
  function load() {
    if (loading || loaded) return;
    loading = true;
    Promise.all([
      getJson('/data/draft-matrix.json'),
      getJson('/api/dota/hero-positions').catch(function () { return getJson('/data/hero-positions.json'); }),
      getJson('/data/heroes.json')
    ]).then(function (res) {
      M = res[0];
      posData = (res[1] && res[1].heroes) || {};
      var raw = (res[2] && res[2].heroes) || [];
      M.heroIds.forEach(function (id, i) { matrixIdx[id] = i; });
      heroes = raw.filter(function (h) { return matrixIdx[h.id] !== undefined; })
        .map(function (h) { return { id: h.id, name: h.name, localized_name: h.localized_name }; })
        .sort(function (a, b) { return a.localized_name.localeCompare(b.localized_name); });
      heroes.forEach(function (h) { heroById[h.id] = h; });

      // «мета»: герой играется не реже половины среднего по всем героям
      var total = 0, cnt = 0;
      heroes.forEach(function (h) { var m = heroMatches(h.id); if (m) { total += m; cnt++; } });
      metaThreshold = cnt ? (total / cnt) * 0.5 : 0;

      var f = $('dtFetched');
      if (f && M.fetchedAt) f.textContent = new Date(M.fetchedAt).toLocaleDateString('ru-RU');
      $('dtState').style.display = 'none';

      readHash();
      renderRoles();
      syncSideSwitch();
      loaded = true;
      bind();
      render();
    }).catch(function (e) {
      loading = false;
      $('dtState').textContent = 'Не удалось загрузить данные драфта: ' + e.message;
    });
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.disconnect(); load(); } });
    }, { rootMargin: '300px' });
    io.observe(root);
  } else { load(); }
})();
