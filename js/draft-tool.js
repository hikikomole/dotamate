/* Ranked All Pick — помощник пика на главной.
 *
 * Данные:
 *   /data/draft-calibration.json — коэффициент перевода перевеса в вероятность
 *   /data/our-matrix.json     — матрица пар по нашей базе матчей 0-4500 MMR
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
  var MAX_BANS = 16;     // столько героев банится в Ranked All Pick
  var POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
  var POS_LABEL = { POSITION_1: 'Керри', POSITION_2: 'Мид', POSITION_3: 'Офлейн', POSITION_4: 'Саппорт', POSITION_5: 'Хардсаппорт' };
  var POS_SHORT = { POSITION_1: 'Поз. 1', POSITION_2: 'Поз. 2', POSITION_3: 'Поз. 3', POSITION_4: 'Поз. 4', POSITION_5: 'Поз. 5' };
  var POS_ICON = {
    POSITION_1: '/assets/roles/carry.svg',
    POSITION_2: '/assets/roles/mid.png',
    POSITION_3: '/assets/roles/offlane.png',
    POSITION_4: '/assets/roles/support.png',
    POSITION_5: '/assets/roles/hardsupport.png'
  };
  // Эмблемы сторон рисуем сами: листом и клыком, в цветах команд.
  var SIDE_MARK = {
    radiant: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5c3 2.2 5.3 4.4 5.3 7.2A5.3 5.3 0 0 1 8 14.5a5.3 5.3 0 0 1-5.3-5.8C2.7 5.9 5 3.7 8 1.5Z"/><path d="M8 5.2v7" class="dt-mark-line"/></svg>',
    dire: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 2.4 6 6 8 2l2 4 3.6-3.6-1.2 5.1A5 5 0 0 1 8 14.5a5 5 0 0 1-4.4-6.9L2.4 2.4Z"/></svg>'
  };
  var SIDES = ['radiant', 'dire'];

  var root = document.getElementById('draftTool');
  if (!root) return;

  var M = null, heroes = [], heroById = {}, posData = {}, matrixIdx = {}, metaThreshold = 0;
  var matrices = {};     // 'our' и 'stratz' — два среза одной и той же структуры
  var ourMeta = null;    // герои нашего среза: матчи, винрейт, доля пиков
  var calib = null;      // калибровка перевеса в вероятность победы
  var loaded = false, loading = false;

  var state = {
    picks: { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] },
    posOverride: { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] },
    bans: [],
    target: { side: 'radiant', slot: 0 },
    mode: 'radiant',     // radiant | dire | ban — куда кладёт быстрый ввод
    metaOnly: false,
    confident: false,
    slice: 'our',
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
  // Сколько матчей у героя — в том срезе, который сейчас выбран.
  // Раньше тут всегда стояли числа Stratz, и на своём срезе подпись врала.
  function heroMatches(id) {
    if (state.slice === 'our' && ourMeta && ourMeta[id]) return ourMeta[id].matches || 0;
    var h = posData[String(id)];
    return h && h.totalMatches ? h.totalMatches : 0;
  }
  // Доля матчей героя на позиции. Позиции берутся у Stratz в любом срезе:
  // в ленте публичных матчей ролей нет вовсе.
  function posShare(id, p) {
    var h = posData[String(id)];
    var cell = h && h.positions && h.positions[p];
    if (!cell) return 0;
    return cell.share != null ? cell.share : (h.totalMatches ? cell.matches / h.totalMatches * 100 : 0);
  }

  // Раскладка позиций внутри команды.
  //
  // Жадный перебор по порядку слотов давал заметные глупости: если Earthshaker
  // занимал третью позицию первым, Tidehunter получал пятую, которую он почти
  // не играет. Поэтому перебираем все 120 расстановок и берём ту, где сумма
  // долей по позициям наибольшая — это точный оптимум, а не порядок слотов.
  var PERMS = (function () {
    var out = [];
    (function rec(rest, acc) {
      if (!rest.length) { out.push(acc); return; }
      for (var i = 0; i < rest.length; i++) {
        rec(rest.slice(0, i).concat(rest.slice(i + 1)), acc.concat([rest[i]]));
      }
    })([0, 1, 2, 3, 4], []);
    return out;
  })();

  function assignPositions(side) {
    var picks = state.picks[side], over = state.posOverride[side];
    var out = [null, null, null, null, null];
    var fixed = {};                       // позиция -> слот, занята вручную
    picks.forEach(function (id, i) {
      if (id && over[i] && !fixed[over[i]]) { out[i] = over[i]; fixed[over[i]] = true; }
    });
    var freeSlots = [], freePos = POSITIONS.filter(function (p) { return !fixed[p]; });
    picks.forEach(function (id, i) { if (id && !out[i]) freeSlots.push(i); });
    if (!freeSlots.length) return out;

    // считаем на полном наборе из пяти позиций, лишние отбросим
    var best = null, bestScore = -1;
    for (var k = 0; k < PERMS.length; k++) {
      var perm = PERMS[k], score = 0, ok = true;
      for (var j = 0; j < freeSlots.length; j++) {
        var p = POSITIONS[perm[j]];
        if (fixed[p]) { ok = false; break; }
        score += posShare(picks[freeSlots[j]], p);
      }
      if (!ok) continue;
      if (score > bestScore) { bestScore = score; best = perm; }
    }
    if (best) {
      for (var j2 = 0; j2 < freeSlots.length; j2++) out[freeSlots[j2]] = POSITIONS[best[j2]];
    } else {
      freeSlots.forEach(function (slot, n) { out[slot] = freePos[n] || null; });
    }
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
  // Для шкалы берём среднее по посчитанным линиям: 50 плюс среднее читается
  // как «доля выигранных линий», а сумма трёх линий не значит ничего.
  function laneAverage() {
    var sum = 0, cnt = 0;
    LANES.forEach(function (l) { var sc = laneScore(l); if (sc.value !== null) { sum += sc.value; cnt++; } });
    return cnt ? sum / cnt : null;
  }

  // ---------- рекомендации ----------
  function isTaken(id) {
    return state.bans.indexOf(id) !== -1 ||
      state.picks.radiant.indexOf(id) !== -1 || state.picks.dire.indexOf(id) !== -1;
  }
  function passesMeta(id) { return !state.metaOnly || heroMatches(id) >= metaThreshold; }
  // «Мета»: герой играется не реже половины среднего по всем героям в текущем срезе.
  function recalcMetaThreshold() {
    var total = 0, cnt = 0;
    heroes.forEach(function (h) { var m = heroMatches(h.id); if (m) { total += m; cnt++; } });
    metaThreshold = cnt ? (total / cnt) * 0.5 : 0;
  }
  function recommend(side) {
    var enemy = side === 'radiant' ? 'dire' : 'radiant';
    var allies = state.picks[side].filter(Boolean);
    var enemies = state.picks[enemy].filter(Boolean);
    var wantPos = state.role[side] === 'any' ? null : state.role[side];

    // Свободные позиции этой стороны. Раньше кандидату приписывалась одна общая
    // «первая свободная», из-за чего на пустом драфте все герои числились керри.
    // Теперь каждому берём его самую частую роль из ещё свободных.
    var used = assignPositions(side).filter(Boolean);
    var free = POSITIONS.filter(function (p) { return used.indexOf(p) === -1; });

    // лейновые соперники для каждой свободной позиции считаем один раз
    var laneFoes = {};
    free.forEach(function (p) {
      var lane = LANES.filter(function (l) { return l[side === 'radiant' ? 'rad' : 'dire'].indexOf(p) !== -1; })[0];
      laneFoes[p] = lane ? heroesAt(enemy, lane[enemy === 'radiant' ? 'rad' : 'dire']) : [];
    });

    var rows = [];
    heroes.forEach(function (h) {
      if (isTaken(h.id) || !passesMeta(h.id)) return;
      var own = heroPositions(h.id);
      if (wantPos && own.indexOf(wantPos) === -1) return;

      var slotPos = wantPos;
      if (!slotPos) {
        for (var k = 0; k < own.length; k++) { if (free.indexOf(own[k]) !== -1) { slotPos = own[k]; break; } }
        if (!slotPos) slotPos = free[0] || own[0] || null;
      }

      var syn = 0, mat = 0;
      allies.forEach(function (a) { syn += withAdv(h.id, a); });
      enemies.forEach(function (e) { mat += vsAdv(h.id, e); });

      var laneVal = null;
      var foes = slotPos ? (laneFoes[slotPos] || []) : [];
      if (slotPos && foes.length) {
        var sum = 0, cnt = 0;
        foes.forEach(function (e) {
          var v = laneAdv(h.id, slotPos, e.id, e.pos);
          if (v !== null) { sum += v; cnt++; }
        });
        if (cnt) laneVal = sum / cnt;
      }

      rows.push({
        hero: h, pos: slotPos,
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
    return rows;
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
    var cnt = $('dtBanCount');
    if (cnt) cnt.textContent = state.bans.length + '/' + MAX_BANS;
    if (!state.bans.length) {
      el.className = 'dt-bans-empty';
      el.textContent = 'Забаненные герои не попадают в подсказки';
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

  // Перевес в вероятность: P = 1 / (1 + exp(-a * S)), коэффициент a подобран
  // логистической регрессией по исходам настоящих матчей нашей базы.
  // Линии в S не входят — по истории их не восстановить, поэтому они идут
  // отдельной шкалой, где число и так читается как вероятность выиграть линию.
  function winProbability(S) {
    if (!calib) return null;
    return 100 / (1 + Math.exp(-calib.alpha * S));
  }

  function renderPrediction() {
    var synR = teamSynergy('radiant'), synD = teamSynergy('dire'), mat = crossMatchup(), lane = laneTotal();
    var laneAvg = laneAverage();
    var anyPick = state.picks.radiant.concat(state.picks.dire).some(Boolean);
    var S = (synR - synD) + mat;

    function pct(v) { return v.toFixed(1).replace('.', ',') + '%'; }
    function pp(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ','); }
    function setPair(a, b, valA, kind) {
      // valA — доля в процентах за Свет; вторая сторона дополняет до ста
      if (valA === null || valA === undefined) {
        [a, b].forEach(function (el) { el.textContent = '—'; el.className = el.className.replace(/\s*dt-(up|down|zero)/g, '') + ' dt-zero'; });
        return 50;
      }
      var setOne = function (el, v) {
        el.className = el.className.replace(/\s*dt-(up|down|zero)/g, '');
        el.textContent = kind === 'pct' ? pct(v) : pp(v);
        el.className += v > 50.05 ? ' dt-up' : (v < 49.95 ? ' dt-down' : ' dt-zero');
      };
      setOne(a, valA); setOne(b, 100 - valA);
      return valA;
    }

    var p = anyPick ? winProbability(S) : null;
    var fillWin = setPair($('dtWinRad'), $('dtWinDire'), anyPick ? (p === null ? null : p) : null, 'pct');
    $('dtWinFillRad').style.width = fillWin + '%';
    $('dtWinFillDire').style.width = (100 - fillWin) + '%';

    var title = $('dtWinTitle');
    if (title) {
      title.textContent = p === null
        ? (calib ? 'Прогноз победы' : 'Перевес драфта, п.п.')
        : 'Прогноз победы · перевес ' + pp(S) + ' п.п.';
    }

    var laneP = laneAvg === null ? null : 50 + laneAvg;
    var fillLane = setPair($('dtLaneRad'), $('dtLaneDire'), laneP, 'pct');
    $('dtLaneFillRad').style.width = fillLane + '%';
    $('dtLaneFillDire').style.width = (100 - fillLane) + '%';

    function sum(side) {
      var v = side === 'radiant' ? synR : synD;
      var m = side === 'radiant' ? mat : -mat;
      var picked = state.picks[side].filter(Boolean).length;
      var other = state.picks[side === 'radiant' ? 'dire' : 'radiant'].filter(Boolean).length;
      return 'синергия ' + (picked > 1 ? pp(v) : '—') + ' · контрпик ' + (picked && other ? pp(m) : '—');
    }
    $('dtSumRad').textContent = sum('radiant');
    $('dtSumDire').textContent = sum('dire');
  }

  function renderLanes() {
    $('dtLaneGrid').innerHTML = LANES.map(function (l) {
      var sc = laneScore(l);
      var val;
      if (sc.value === null) val = sc.pending ? '<b class="dt-zero">…</b>' : '<b class="dt-zero">—</b>';
      else {
        var lp = 50 + sc.value;
        var cls = lp > 50.05 ? 'dt-up' : (lp < 49.95 ? 'dt-down' : 'dt-zero');
        val = '<b class="' + cls + '" title="Доля линий, выигранных Светом в этой паре">' +
          lp.toFixed(1).replace('.', ',') + '%</b>';
      }
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
        var ico = POS_ICON[c[0]]
          ? '<i class="dt-role-ico"><img src="' + POS_ICON[c[0]] + '" alt="" width="18" height="18" loading="lazy" decoding="async"></i>'
          : '';
        return '<button type="button" class="dt-role' + (state.role[side] === c[0] ? ' active' : '') +
          '" data-role="' + c[0] + '" data-side="' + side + '">' + ico + c[1] + '</button>';
      }).join('');
    });
    // эмблемы сторон проставляем один раз, они не зависят от состояния
    root.querySelectorAll('[data-side-mark]').forEach(function (el) {
      if (!el.firstChild) el.innerHTML = SIDE_MARK[el.dataset.sideMark] || '';
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
    notifyMirrors();
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
    if (state.mode === 'ban') {
      if (state.bans.length >= MAX_BANS) { state.history.pop(); return; }
      state.bans.push(id); render(); return;
    }
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

  // ---------- выбор героя прямо у слота ----------
  // Клик по слоту открывает список рядом с ним, а не отправляет к строке поиска
  // наверху: в All Pick на выбор 25 секунд, лишний прыжок глазами лишний.
  var picker = null, pickerCursor = -1, pickerTarget = null;

  function buildPicker() {
    if (picker) return picker;
    picker = document.createElement('div');
    picker.className = 'dt-picker';
    picker.innerHTML =
      '<div class="dt-picker-head">' +
        '<span class="dt-picker-tag" id="dtPickerTag"></span>' +
        '<input type="text" id="dtPickerInput" placeholder="Поиск героя…" autocomplete="off" aria-label="Поиск героя">' +
        '<button type="button" class="dt-picker-close" aria-label="Закрыть">×</button>' +
      '</div>' +
      '<div class="dt-picker-list" id="dtPickerList"></div>';
    root.querySelector('.dt-shell').appendChild(picker);

    var inp = picker.querySelector('#dtPickerInput');
    inp.addEventListener('input', function () { pickerCursor = -1; renderPickerList(); });
    inp.addEventListener('keydown', function (e) {
      var list = pickerCandidates(inp.value);
      if (e.key === 'ArrowDown') { pickerCursor = Math.min(list.length - 1, pickerCursor + 1); renderPickerList(true); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { pickerCursor = Math.max(0, pickerCursor - 1); renderPickerList(true); e.preventDefault(); }
      else if (e.key === 'Enter') {
        var h = list[pickerCursor < 0 ? 0 : pickerCursor];
        if (h) pickInPicker(h.id);
        e.preventDefault();
      } else if (e.key === 'Escape') { closePicker(); }
    });
    picker.querySelector('.dt-picker-close').addEventListener('click', closePicker);
    picker.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick-hero]');
      if (b) pickInPicker(Number(b.dataset.pickHero));
    });
    return picker;
  }

  function pickerCandidates(q) {
    q = String(q || '').trim().toLowerCase();
    var list = heroes.filter(function (h) { return !isTaken(h.id); });
    if (q) list = list.filter(function (h) { return h.localized_name.toLowerCase().indexOf(q) !== -1; });
    list.sort(function (a, b) {
      if (q) {
        var ai = a.localized_name.toLowerCase().indexOf(q), bi = b.localized_name.toLowerCase().indexOf(q);
        if (ai !== bi) return ai - bi;
      }
      return heroMatches(b.id) - heroMatches(a.id);
    });
    return list;
  }

  function renderPickerList(scroll) {
    var box = $('dtPickerList');
    var list = pickerCandidates($('dtPickerInput').value);
    if (!list.length) { box.innerHTML = '<div class="dt-picker-empty">Никого не нашлось</div>'; return; }
    box.innerHTML = list.map(function (h, i) {
      var pos = heroPositions(h.id)[0], m = heroMatches(h.id);
      return '<button type="button" data-pick-hero="' + h.id + '"' + (i === pickerCursor ? ' class="cursor"' : '') + '>' +
        '<img src="' + icon(h) + '" alt="" loading="lazy">' +
        '<span><b>' + esc(h.localized_name) + '</b><small>' +
        (pos ? POS_LABEL[pos] : '') + (m ? ' · ' + m.toLocaleString('ru-RU') + ' матчей' : '') +
        '</small></span></button>';
    }).join('');
    if (scroll && pickerCursor >= 0) {
      var el = box.children[pickerCursor];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function pickerLabel() {
    if (pickerTarget.mode === 'ban') return 'Бан ' + state.bans.length + '/' + MAX_BANS;
    return (pickerTarget.side === 'radiant' ? 'Свет' : 'Тьма') + ' · слот ' + (pickerTarget.slot + 1);
  }

  function placePicker(anchor) {
    var shell = root.querySelector('.dt-shell');
    var sr = shell.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    var w = picker.offsetWidth || 320;
    var left = ar.left - sr.left;
    left = Math.max(8, Math.min(left, shell.clientWidth - w - 8));
    picker.style.left = left + 'px';
    picker.style.top = (ar.bottom - sr.top + 6) + 'px';
  }

  function openPicker(target, anchor) {
    buildPicker();
    pickerTarget = target;
    pickerCursor = -1;
    picker.classList.add('open');
    $('dtPickerTag').textContent = pickerLabel();
    var inp = $('dtPickerInput');
    inp.value = '';
    renderPickerList();
    placePicker(anchor);
    inp.focus();
  }

  function closePicker() {
    if (picker) picker.classList.remove('open');
    pickerTarget = null;
  }

  function pickerOpen() { return picker && picker.classList.contains('open'); }

  // Выбор из пикера: кладём героя и сразу переезжаем на следующий пустой слот,
  // чтобы можно было набрать состав подряд, не закрывая список.
  function pickInPicker(id) {
    if (!pickerTarget) return;
    if (pickerTarget.mode === 'ban') {
      state.mode = 'ban';
      placeHero(id);
      if (state.bans.length >= MAX_BANS) { closePicker(); return; }
    } else {
      state.mode = pickerTarget.side;
      state.target = { side: pickerTarget.side, slot: pickerTarget.slot };
      placeHero(id);
      var free = state.picks[pickerTarget.side].indexOf(null);
      if (free < 0) { closePicker(); return; }
      pickerTarget = { side: pickerTarget.side, slot: free };
    }
    syncSideSwitch();
    $('dtPickerTag').textContent = pickerLabel();
    var inp = $('dtPickerInput');
    inp.value = '';
    pickerCursor = -1;
    renderPickerList();
    var anchor = pickerTarget.mode === 'ban'
      ? $('dtBanAdd')
      : root.querySelector('.dt-slot[data-side="' + pickerTarget.side + '"][data-slot="' + pickerTarget.slot + '"]');
    if (anchor) placePicker(anchor);
    inp.focus();
  }

  // ---------- события ----------
  function bind() {
    root.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-clear]'))) { clearSlot(t.dataset.side, Number(t.dataset.clear)); return; }
      if ((t = e.target.closest('.dt-slot'))) {
        if (e.target.closest('select')) return;          // селектор позиции внутри слота
        var side = t.dataset.side, slot = Number(t.dataset.slot);
        state.target = { side: side, slot: slot };
        state.mode = side;
        syncSideSwitch();
        render();
        openPicker({ side: side, slot: slot }, root.querySelector('.dt-slot[data-side="' + side + '"][data-slot="' + slot + '"]') || t);
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

    var sliceSw = $('dtSliceSwitch');
    if (sliceSw) sliceSw.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-slice]');
      if (b && !b.disabled) applySlice(b.dataset.slice);
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
    document.addEventListener('mousedown', function (e) {
      if (!pickerOpen()) return;
      if (e.target.closest('.dt-picker') || e.target.closest('.dt-slot') || e.target.closest('#dtBanAdd')) return;
      closePicker();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePicker(); });
    window.addEventListener('resize', function () { if (pickerOpen()) closePicker(); });

    $('dtMetaOnly').addEventListener('change', function (e) { state.metaOnly = e.target.checked; renderRecs(); });
    $('dtConfident').addEventListener('change', function (e) { state.confident = e.target.checked; render(); });
    $('dtReset').addEventListener('click', function () { closePicker(); resetAll(); });
    $('dtUndo').addEventListener('click', undo);
    $('dtBanAdd').addEventListener('click', function (e) {
      if (state.bans.length >= MAX_BANS) return;
      state.mode = 'ban';
      syncSideSwitch();
      openPicker({ mode: 'ban' }, e.currentTarget);
    });
    $('dtShare').addEventListener('click', function () {
      writeHash();
      var url = location.href;
      var done = function () { $('dtShare').textContent = 'Скопировано'; setTimeout(function () { $('dtShare').textContent = 'Ссылка'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('Ссылка на драфт:', url); });
      else prompt('Ссылка на драфт:', url);
    });
  }
  // Матрицы двух срезов устроены одинаково, поэтому переключение — это подмена M
  // и пересчёт индексов. Линии не переключаются: другого источника для них нет.
  function applySlice(slice) {
    if (!matrices[slice]) return;
    state.slice = slice;
    M = matrices[slice];
    matrixIdx = {};
    M.heroIds.forEach(function (id, i) { matrixIdx[id] = i; });
    recalcMetaThreshold();
    syncSliceSwitch();
    render();
  }
  function syncSliceSwitch() {
    var sw = $('dtSliceSwitch');
    if (sw) sw.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.slice === state.slice);
      b.disabled = !matrices[b.dataset.slice];
    });
    var note = $('dtSliceNote');
    if (!note || !M) return;
    var when = M.fetchedAt ? new Date(M.fetchedAt).toLocaleDateString('ru-RU') : '';
    note.textContent = state.slice === 'our'
      ? 'Считаем по своей базе: ' + (M.matchesUsed || 0).toLocaleString('ru-RU') + ' матчей Ranked All Pick 0–4500 MMR, снимок от ' + when + '. Линии — по срезу Divine/Immortal.'
      : 'Считаем по срезу Stratz: матчи ранга Divine/Immortal, снимок от ' + when + '.';
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
      getJson('/data/our-matrix.json').catch(function () { return null; }),
      getJson('/api/dota/hero-positions').catch(function () { return getJson('/data/hero-positions.json'); }),
      getJson('/data/heroes.json'),
      getJson('/data/draft-matrix.json'),
      getJson('/data/our-meta.json').catch(function () { return null; }),
      getJson('/data/draft-calibration.json').catch(function () { return null; })
    ]).then(function (res) {
      ourMeta = (res[4] && res[4].heroes) || null;
      calib = res[5] && res[5].alpha ? res[5] : null;
      matrices.our = res[0];
      matrices.stratz = res[3];
      if (!matrices.our) state.slice = 'stratz';
      M = matrices[state.slice];
      posData = (res[1] && res[1].heroes) || {};
      var raw = (res[2] && res[2].heroes) || [];
      M.heroIds.forEach(function (id, i) { matrixIdx[id] = i; });
      heroes = raw.filter(function (h) { return matrixIdx[h.id] !== undefined; })
        .map(function (h) { return { id: h.id, name: h.name, localized_name: h.localized_name }; })
        .sort(function (a, b) { return a.localized_name.localeCompare(b.localized_name); });
      heroes.forEach(function (h) { heroById[h.id] = h; });

      recalcMetaThreshold();

      var f = $('dtFetched');
      if (f && M.fetchedAt) f.textContent = new Date(M.fetchedAt).toLocaleDateString('ru-RU');
      if (calib) {
        var ru = function (v, d) { return v.toFixed(d).replace('.', ','); };
        var put = function (id, txt) { var e = $(id); if (e) e.textContent = txt; };
        put('dtCalLL', ru(calib.testLogLoss, 3));
        put('dtCalLLBase', ru(calib.baselineLogLoss, 3));
        put('dtCalBr', ru(calib.testBrier, 3));
        put('dtCalAcc', ru(calib.testAccuracy, 1) + '%');
        put('dtCalN', calib.matchesTest.toLocaleString('ru-RU'));
      }
      $('dtState').style.display = 'none';

      readHash();
      renderRoles();
      syncSideSwitch();
      syncSliceSwitch();
      loaded = true;
      bind();
      render();
    }).catch(function (e) {
      loading = false;
      $('dtState').textContent = 'Не удалось загрузить данные драфта: ' + e.message;
    });
  }

  // ---------- мост к полосе драфта на первом экране ----------
  // Полоса наверху — НЕ вторая копия инструмента, а его вид: состояние,
  // расчёты и окно выбора героя здесь одни и те же. Наружу отдаём только
  // чтение состояния и команду «открой выбор для этого слота», чтобы
  // рассинхронизироваться было нечему.
  var mirrors = [];
  function notifyMirrors() {
    for (var i = 0; i < mirrors.length; i++) {
      try { mirrors[i](); } catch (e) { console.warn('Полоса драфта:', e); }
    }
  }
  window.D2HDraft = {
    ready: function () { return loaded; },
    load: function () { if (!loaded && !loading) load(); },
    picks: function () {
      return { radiant: state.picks.radiant.slice(), dire: state.picks.dire.slice() };
    },
    hero: function (id) { return heroById[id] || null; },
    icon: icon,
    // anchor — элемент, рядом с которым показать окно выбора. Поэтому с
    // первого экрана оно открывается у самой полосы, а не внизу страницы.
    open: function (side, slot, anchor) {
      if (!loaded) { if (!loading) load(); return false; }
      state.target = { side: side, slot: slot };
      // Окно выбора живёт внутри .dt-shell и позиционируется относительно
      // него, поэтому якорем всегда берём настоящий слот инструмента —
      // иначе при вызове с первого экрана оно уезжало бы за пределы блока.
      openPicker({ side: side, slot: slot },
        anchor || root.querySelector('.dt-slot[data-side="' + side + '"][data-slot="' + slot + '"]'));
      return true;
    },
    // Перевес и тройка рекомендаций — теми же функциями, что и в самом
    // инструменте: renderPrediction считает ровно это выражение.
    summary: function () {
      if (!loaded) return null;
      var any = state.picks.radiant.concat(state.picks.dire).some(Boolean);
      if (!any) return { any: false, advantage: 0, recs: [] };
      var S = (teamSynergy('radiant') - teamSynergy('dire')) + crossMatchup();
      var ours = state.picks.radiant.filter(Boolean).length;
      var theirs = state.picks.dire.filter(Boolean).length;
      var side = ours <= theirs ? 'radiant' : 'dire';
      var recs = [];
      if (ours + theirs < 10) {
        recs = recommend(side).slice(0, 3).map(function (r) {
          return { id: r.hero.id, name: r.hero.localized_name, icon: icon(r.hero), all: r.all, side: side };
        });
      }
      return { any: true, advantage: S, recs: recs, side: side };
    },
    // Полоса на первом экране выбирает героя своим списком, поэтому ей нужны
    // кандидаты и сама постановка героя в слот. Расчёты, история и проверка
    // «герой уже занят» остаются здесь: наверху только показ и клик.
    candidates: function (q, limit) {
      if (!loaded) return [];
      return pickerCandidates(q).slice(0, limit || 60).map(function (h) {
        var pos = heroPositions(h.id)[0], m = heroMatches(h.id);
        return {
          id: h.id, name: h.localized_name, icon: icon(h),
          pos: pos ? POS_LABEL[pos] : '', matches: m || 0
        };
      });
    },
    set: function (side, slot, id) {
      if (!loaded) return false;
      state.mode = side;
      state.target = { side: side, slot: slot };
      placeHero(id);
      syncSideSwitch();
      return true;
    },
    clear: function (side, slot) {
      if (!loaded || !state.picks[side][slot]) return false;
      pushHistory();
      state.picks[side][slot] = null;
      state.posOverride[side][slot] = null;
      render();
      return true;
    },
    onChange: function (fn) { mirrors.push(fn); if (loaded) fn(); }
  };

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.disconnect(); load(); } });
    }, { rootMargin: '300px' });
    io.observe(root);
  } else { load(); }
})();
