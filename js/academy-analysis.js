// Учебный центр: разбор одного матча — расчёт без интерфейса.
// Интерфейс — js/academy-match.js; страница /academy/match/ (tools/academy-render.js).
// Модуль работает и в браузере (window.DMMatchAnalysis), и в Node (module.exports):
// сборщик проверяет каталог рекомендаций, tools/check-academy-analysis.js — расчёт.
//
// Что сравнивается и с чем (подробно — в «Как считается» на странице):
// - эталон — средний игрок на этом герое и этой позиции по data/stats.json (positions:
//   GPM, XPM, K/D/A, урон по героям, добивания; m — средняя длительность матча, мин);
//   если героя на позиции нет в базе — среднее по позиции (только GPM и XPM);
// - всё, что зависит от длительности (добивания, смерти, участие, урон), переводится
//   «в минуту», иначе длинный матч всегда выглядел бы лучше короткого;
// - порог «заметно выше/ниже» — ±15 % (смерти ±20 %): один матч шумный, мелкие отличия
//   ничего не говорят. Пороги — константы ниже, на странице выводятся теми же числами.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DMMatchAnalysis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HI = 1.15, LO = 0.85;            // заметно выше / ниже эталона
  var D_HI = 1.20, D_LO = 0.80;        // для смертей (меньше — лучше)
  var MIN_DURATION = 600;              // короче 10 минут — не разбираем (ранний выход, ливер)
  var TURBO = 23;                      // game_mode Turbo: другая экономика, сравнение не делаем
  var MAX_RECS = 3;                    // показываются сразу, остальные — под «Ещё»

  // Роль по позиции: какой ролевой маршрут предлагать.
  function roleOf(pos) { return pos === 1 ? 'carry' : pos === 2 ? 'mid' : pos === 3 ? 'offlane' : 'support'; }
  function isCore(pos) { return pos === 1 || pos === 2 || pos === 3; }

  // Каталог рекомендаций. stage — этап маршрута по роли (course/module), общий — запасной.
  // Каждый slug и этап проверяет сборка (tools/academy-render.js → checkCatalog).
  var REC = {
    lane: {
      title: 'Линия', guides: ['laning-stage', 'creep-aggro'],
      stage: { carry: ['carry', 'carry-lane'], mid: ['mid', 'mid-lane'], offlane: ['offlane', 'offlane-lane'], support: ['support', 'support-lane'], any: ['rank-up', 'lane-and-economy'] },
      how: 'Первые 10 минут решают, сколько золота у тебя будет потом. Держись за своей волной, не стой под чужими крипами и добивай, а не размен ради размена.',
    },
    farm: {
      title: 'Фарм', guides: ['farming-efficiency', 'last-hitting-denying'],
      stage: { carry: ['carry', 'carry-farm'], mid: ['mid', 'mid-lane'], offlane: ['rank-up', 'lane-and-economy'], any: ['rank-up', 'lane-and-economy'] },
      how: 'Не стой на месте: добил волну — иди к ближайшему лагерю, зачистил — встречай следующую волну. Время на дорогу без фарма — главная потеря золота.',
    },
    xp: {
      title: 'Опыт', guides: ['gold-and-experience', 'how-not-to-die'],
      stage: { support: ['support', 'support-lane'], any: ['rank-up', 'lane-and-economy'] },
      how: 'Опыт дают крипы и герои рядом с тобой, а смерть отнимает время, в которое ты его не получаешь. Будь рядом с волнами и дракой, а не на фонтане.',
    },
    deaths: {
      title: 'Смерти', guides: ['how-not-to-die', 'minimap-awareness'],
      stage: { carry: ['carry', 'carry-late'], mid: ['mid', 'mid-fights'], offlane: ['offlane', 'offlane-lane'], support: ['support', 'support-vision'], any: ['beginner', 'farm-and-read-map'] },
      how: 'Перед тем как идти вперёд, посмотри на миникарту: сколько врагов не видно. Если трёх-четырёх нет — не фарми там, где нет обзора и пути отхода.',
    },
    fights: {
      title: 'Участие в драках', guides: ['ganking-rotations', 'tp-scroll-usage'],
      stage: { carry: ['carry', 'carry-late'], mid: ['mid', 'mid-tempo'], offlane: ['offlane', 'offlane-space'], support: ['support', 'support-save'], any: ['rank-up', 'read-map-and-tempo'] },
      how: 'Всегда носи свиток телепортации и смотри на миникарту: если союзники собираются на драку или объект — приходи, пока она не закончилась.',
    },
    damage: {
      title: 'Урон в драках', guides: ['teamfight-positioning', 'itemization-basics'],
      stage: { carry: ['carry', 'carry-late'], mid: ['mid', 'mid-fights'], offlane: ['offlane', 'offlane-space'], support: ['support', 'support-save'], any: ['rank-up', 'teamfight-decisions'] },
      how: 'Урон наносит тот, кто жив и стоит на своей дистанции. Входи в драку, когда враги потратили контроль, и бей того, до кого дотягиваешься, а не самого желанного.',
    },
    objectives: {
      title: 'Строения и объекты', guides: ['map-objectives-741', 'high-ground-siege'],
      stage: { carry: ['carry', 'carry-late'], mid: ['mid', 'mid-fights'], offlane: ['offlane', 'offlane-team'], any: ['rank-up', 'read-map-and-tempo'] },
      how: 'Выигранная драка без снесённой башни — упущенное преимущество. После победы в драке сразу переводи её в строение, Рошана или вражеский лес.',
    },
    items: {
      title: 'Предметы', guides: ['itemization-basics'],
      stage: { carry: ['carry', 'carry-farm'], any: ['rank-up', 'teamfight-decisions'] },
      how: 'Сборка — ответ на матч, а не список. Посмотри, что обычно собирают на твоём герое на этой позиции, и чем это отличается от твоих предметов.',
    },
    vision: {
      title: 'Обзор и миникарта', guides: ['minimap-awareness', 'vision-fog-of-war'],
      stage: { support: ['support', 'support-vision'], any: ['rank-up', 'read-map-and-tempo'] },
      how: 'Смотри на миникарту каждые несколько секунд и считай пропавших врагов. Без обзора у тебя есть только догадки — купи вард или фарми ближе к своей стороне.',
    },
    positioning: {
      title: 'Позиция в драке', guides: ['teamfight-positioning', 'how-not-to-die'],
      stage: { carry: ['carry', 'carry-late'], mid: ['mid', 'mid-fights'], offlane: ['offlane', 'offlane-space'], support: ['support', 'support-save'], any: ['rank-up', 'teamfight-decisions'] },
      how: 'Не стой первым, если ты не инициатор. Держись так, чтобы до тебя не дотянулись все пятеро сразу, и входи после того, как враги потратят контроль.',
    },
    macro: {
      title: 'Понимание карты', guides: ['match-timings', 'map-objectives-741'],
      stage: { mid: ['mid', 'mid-tempo'], any: ['rank-up', 'read-map-and-tempo'] },
      how: 'В каждой фазе у матча свои цели: руны, лотосы, Рошан, башни. Если не знаешь, куда идти, — иди к ближайшей цели, которая сейчас важна для команды.',
    },
    draft: {
      title: 'Пик и контрпики', guides: ['counter-picks', 'draft-fundamentals'],
      stage: { any: ['rank-up', 'pick-role-and-pool'] },
      how: 'Перед пиком посмотри, кто уже выбран у соперника и чего не хватает твоей команде. Против неудобного героя часто помогает предмет, а не другой герой.',
    },
    tilt: {
      title: 'Эмоции и общение', guides: ['tilt-control', 'team-communication'],
      stage: { any: ['rank-up', 'teamfight-decisions'] },
      how: 'После двух поражений подряд сделай перерыв. Заглуши голос и текст того, кто мешает, но оставь пинги — в них полезная информация.',
    },
  };

  // ---------- числа ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function fmt(v, d) {
    if (v == null) return '—';
    var s = (d ? v.toFixed(d) : String(Math.round(v)));
    return s.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function pct(v) { return Math.round(v * 100) + ' %'; }

  // Средняя длительность матча базы, мин (корзины по 5 минут: [начало, матчей]).
  function baseMinutes(stats) {
    var h = stats && stats.base && stats.base.duration, t = 0, n = 0;
    if (Array.isArray(h)) h.forEach(function (b) { if (Array.isArray(b) && num(b[0]) != null && num(b[1]) != null) { t += (b[0] + 2.5) * b[1]; n += b[1]; } });
    return n ? t / n : null;
  }

  // Эталон героя на позиции. pos: 1..5 или 'sup' (4 и 5 вместе, среднее по числу матчей).
  function baseline(stats, heroId, pos) {
    var P = (stats && stats.positions) || {};
    var keys = pos === 'sup' ? ['4', '5'] : [String(pos)];
    var acc = { n: 0 }, fields = ['gpm', 'xpm', 'k', 'd', 'a', 'hd', 'lh', 'm'], w = {};
    keys.forEach(function (k) {
      var list = (P[k] && P[k].heroes) || [];
      for (var i = 0; i < list.length; i++) {
        var h = list[i];
        if (Number(h.id) !== heroId || !num(h.n)) continue;
        acc.n += h.n;
        fields.forEach(function (f) { if (num(h[f]) != null) { acc[f] = (acc[f] || 0) + h[f] * h.n; w[f] = (w[f] || 0) + h.n; } });
      }
    });
    var out;
    if (acc.n > 0) {
      out = { kind: 'hero', n: acc.n };
      fields.forEach(function (f) { if (w[f]) out[f] = acc[f] / w[f]; });
    } else {
      var n = 0, g = 0, x = 0;
      keys.forEach(function (k) { var q = P[k]; if (q && num(q.n) && num(q.gpm) != null && num(q.xpm) != null) { n += q.n; g += q.gpm * q.n; x += q.xpm * q.n; } });
      if (!n) return null;
      out = { kind: 'position', n: n, gpm: g / n, xpm: x / n };
    }
    out.minutes = out.m || baseMinutes(stats);
    out.minutesFrom = out.m ? 'hero' : 'base';
    return out;
  }

  function verdict(ratio, lowerBetter) {
    if (ratio == null) return 'na';
    if (lowerBetter) return ratio <= D_LO ? 'good' : ratio >= D_HI ? 'low' : 'ok';
    return ratio >= HI ? 'good' : ratio <= LO ? 'low' : 'ok';
  }

  // Показатели игрока против эталона.
  function metrics(p, b) {
    var min = p.duration / 60, bm = b && b.minutes;
    var out = [];
    function add(key, label, value, base, d, lowerBetter, unit) {
      var ratio = value != null && base != null && base > 0 ? value / base : null;
      out.push({ key: key, label: label, value: value, base: base, ratio: ratio, verdict: verdict(ratio, lowerBetter), lowerBetter: !!lowerBetter, digits: d, unit: unit || '' });
    }
    var perMin = function (v) { return v == null ? null : v / min; };
    var basePerMin = function (f) { return b && b[f] != null && bm ? b[f] / bm : null; };
    add('gpm', 'Золото в минуту (GPM)', num(p.gpm), b ? num(b.gpm) : null, 0);
    add('xpm', 'Опыт в минуту (XPM)', num(p.xpm), b ? num(b.xpm) : null, 0);
    add('lh', 'Добивания в минуту', perMin(num(p.lh)), basePerMin('lh'), 1);
    add('deaths', 'Смерти за 10 минут', num(p.d) == null ? null : p.d / min * 10, basePerMin('d') == null ? null : basePerMin('d') * 10, 1, true);
    var ka = num(p.k) != null && num(p.a) != null ? (p.k + p.a) / min * 10 : null;
    var bka = b && b.k != null && b.a != null && bm ? (b.k + b.a) / bm * 10 : null;
    add('ka', 'Убийства и помощь за 10 минут', ka, bka, 1);
    add('hd', 'Урон по героям в минуту', perMin(num(p.hd)), basePerMin('hd'), 0);
    return out;
  }

  // Контекст команды (только матч из Steam: известны все пятеро).
  function teamContext(p, team) {
    if (!Array.isArray(team) || team.length !== 5) return null;
    var sum = function (f) { return team.reduce(function (s, q) { return s + (num(q[f]) || 0); }, 0); };
    var rank = function (f) { return 1 + team.filter(function (q) { return (num(q[f]) || 0) > (num(p[f]) || 0); }).length; };
    var kills = sum('k'), deaths = sum('d'), nw = sum('nw'), hd = sum('hd'), td = sum('td');
    return {
      kills: kills,
      kp: kills > 0 ? Math.min(1, ((p.k || 0) + (p.a || 0)) / kills) : null,
      kpRank: kills > 0 ? 1 + team.filter(function (q) { return (q.k || 0) + (q.a || 0) > (p.k || 0) + (p.a || 0); }).length : null,
      nwShare: nw > 0 && num(p.nw) != null ? p.nw / nw : null, nwRank: num(p.nw) != null ? rank('nw') : null,
      hdShare: hd > 0 && num(p.hd) != null ? p.hd / hd : null, hdRank: num(p.hd) != null ? rank('hd') : null,
      deathShare: deaths > 0 ? (p.d || 0) / deaths : null, deathRank: rank('d'),
      tdShare: td > 0 && num(p.td) != null ? p.td / td : null, tdRank: num(p.td) != null && td > 0 ? rank('td') : null,
    };
  }

  // Предметы: итоговые слоты против частых законченных покупок героя на позиции (data/hero-items.json).
  function itemsContext(p, heroItems, items, pos) {
    if (!heroItems || !items || !Array.isArray(p.items)) return null;
    var H = heroItems.heroes && heroItems.heroes[String(p.heroId)];
    if (!H) return null;
    var keys = pos === 'sup' ? ['4', '5'] : [String(pos)];
    var byId = {}, slugById = {};
    Object.keys(items).forEach(function (slug) { var it = items[slug]; if (it && num(it.id) != null) { byId[it.id] = it; slugById[it.id] = slug; } });
    var count = {}, n = 0;
    var src = keys.map(function (k) { return H.pos && H.pos[k]; }).filter(function (x) { return x && num(x.n); });
    var scope = 'pos';
    if (!src.length) { src = [H]; scope = 'hero'; }
    src.forEach(function (s) {
      n += s.n;
      ['early', 'mid', 'late', 'vlate'].forEach(function (ph) {
        (s[ph] || []).forEach(function (x) {
          var it = byId[x.i];
          if (!it || it.cat !== 'item' || !(it.cost >= 1000)) return;
          count[x.i] = Math.max(count[x.i] || 0, x.g);       // доля матчей с покупкой — по самой частой фазе
        });
      });
    });
    var ids = Object.keys(count).map(Number);
    // Компонент другого частого предмета в итоговых слотах обычно не остаётся — убираем.
    var slugs = ids.map(function (id) { return slugById[id]; });
    ids = ids.filter(function (id) { var into = byId[id].into || []; return !into.some(function (s) { return slugs.indexOf(s) !== -1; }); });
    ids.sort(function (a, b) { return count[b] - count[a]; });
    var popular = ids.slice(0, 8).map(function (id) { return { id: id, share: n ? count[id] / n : 0 }; });
    var mine = p.items.filter(function (id) { return id > 0 && byId[id]; });
    var have = popular.filter(function (x) { return mine.indexOf(x.id) !== -1; });
    return { n: n, scope: scope, popular: popular, have: have.map(function (x) { return x.id; }), mine: mine };
  }

  function stageFor(area, role) {
    var s = REC[area].stage;
    return s[role] || s.any;
  }

  // Самооценка после матча (необязательные вопросы на странице).
  var ANSWERS = {
    lane: { won: null, even: null, lost: 'lane', unknown: null },
    deaths: { ganked: 'vision', fight: 'positioning', greedy: 'deaths', few: null, unknown: null },
    hard: { farm: 'farm', fights: 'positioning', map: 'macro', draft: 'draft', none: null },
    mood: { calm: null, annoyed: 'tilt', tilt: 'tilt' },
  };
  var ANSWER_WHY = {
    lane: 'Ты отметил, что линия проиграна.',
    vision: 'Ты отметил, что чаще всего тебя ловили без обзора.',
    positioning: 'Ты отметил, что тяжелее всего давались драки или ты погибал в них первым.',
    deaths: 'Ты отметил, что умирал на рискованном фарме.',
    farm: 'Ты отметил, что тяжелее всего давался фарм.',
    macro: 'Ты отметил, что не всегда понимал, куда идти.',
    draft: 'Ты отметил, что соперники контрили твоего героя.',
    tilt: 'Ты отметил, что раздражался или тильтовал во время матча.',
  };

  function analyze(input, refs) {
    var p = input || {}, r = refs || {};
    var res = { ok: false, warnings: [], role: null, metrics: [], team: null, items: null, recs: [], strengths: [] };
    if (!(num(p.duration) >= MIN_DURATION)) { res.error = 'short'; return res; }
    if (p.gameMode === TURBO) { res.error = 'turbo'; return res; }
    var pos = p.pos === 'sup' ? 'sup' : Number(p.pos);
    if (pos !== 'sup' && !(pos >= 1 && pos <= 5)) { res.error = 'pos'; return res; }
    var role = pos === 'sup' ? 'support' : roleOf(pos);
    res.role = role; res.pos = pos;
    var b = baseline(r.stats, Number(p.heroId), pos);
    res.baseline = b;
    if (!b) { res.error = 'no_base'; return res; }
    if (b.kind === 'position') res.warnings.push('position_base');
    res.metrics = metrics(p, b);
    res.team = teamContext(p, p.team);
    res.items = itemsContext(p, r.heroItems, r.items, pos);
    res.ok = true;

    var M = {};
    res.metrics.forEach(function (m) { M[m.key] = m; });
    var core = pos !== 'sup' && isCore(pos);
    var found = {};
    // severity — насколько далеко от эталона (0…1+), weight — важность для роли.
    function add(area, why, severity) {
      if (found[area]) { found[area].why.push(why); found[area].severity = Math.max(found[area].severity, severity); return; }
      var st = stageFor(area, role);
      found[area] = { id: area, title: REC[area].title, why: [why], how: REC[area].how, guides: REC[area].guides.slice(), stage: { course: st[0], module: st[1] }, severity: severity };
    }
    function gap(m) { return m.ratio == null ? 0 : m.lowerBetter ? m.ratio - 1 : 1 - m.ratio; }
    function line(m) {
      return m.label + ': ' + fmt(m.value, m.digits) + ' при ' + fmt(m.base, m.digits) + ' у среднего игрока (' + (m.ratio >= 1 ? '+' : '−') + pct(Math.abs(m.ratio - 1)) + ').';
    }

    if (core && (M.gpm.verdict === 'low' || M.lh.verdict === 'low')) {
      var fm = M.lh.verdict === 'low' && gap(M.lh) > gap(M.gpm) ? M.lh : M.gpm;
      add('farm', line(fm), gap(fm) * 1.2);
    }
    if (M.xpm.verdict === 'low') add('xp', line(M.xpm), gap(M.xpm) * (core ? 0.8 : 1));
    if (M.deaths.verdict === 'low') add('deaths', line(M.deaths), gap(M.deaths));
    if (M.ka.verdict === 'low') add('fights', line(M.ka), gap(M.ka) * 0.9);
    if (core && M.hd.verdict === 'low') add('damage', line(M.hd), gap(M.hd) * 0.8);

    var T = res.team;
    if (T) {
      if (T.kp != null && T.kills >= 10 && T.kpRank === 5 && T.kp < 0.5)
        add('fights', 'Участие в убийствах команды — ' + pct(T.kp) + ', меньше всех в команде.', 0.5 - T.kp);
      if (T.deathShare != null && T.deathRank === 1 && T.deathShare >= 0.3 && (p.d || 0) >= 6)
        add('deaths', 'На тебя пришлось ' + pct(T.deathShare) + ' смертей команды — больше всех.', T.deathShare - 0.2);
      if ((pos === 1 || pos === 2) && T.nwRank != null && T.nwRank >= 4)
        add('farm', 'По итоговой ценности ты ' + T.nwRank + '-й в команде, хотя на позиции ' + pos + ' обычно первый-второй.', 0.3);
      if (core && T.tdRank != null && T.tdRank >= 4 && p.duration >= 1500 && (p.td || 0) < 2000)
        add('objectives', 'Урон по строениям — ' + fmt(p.td) + ', ' + T.tdRank + '-й в команде.', 0.2);
    }
    if (res.items && res.items.popular.length >= 3 && res.items.mine.length >= 3 && !res.items.have.length && p.duration >= 1500)
      add('items', 'В итоговых слотах нет ни одного из частых законченных предметов на этом герое.', 0.2);

    var A = p.answers || {};
    Object.keys(ANSWERS).forEach(function (q) {
      var area = A[q] && ANSWERS[q][A[q]];
      if (area) add(area, ANSWER_WHY[area], 0.25);
    });

    res.recs = Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) { return b.severity - a.severity; });
    res.strengths = res.metrics.filter(function (m) { return m.verdict === 'good'; }).map(function (m) { return { key: m.key, text: line(m) }; });
    if (T && T.kp != null && T.kills >= 10 && T.kpRank === 1 && T.kp >= 0.6) res.strengths.push({ key: 'kp', text: 'Участие в убийствах команды — ' + pct(T.kp) + ', больше всех в команде.' });
    res.task = taskFor(res.recs[0], M, pos);
    return res;
  }

  // Измеримое задание на следующий матч по главной рекомендации: цель — уровень эталона.
  function taskFor(rec, M, pos) {
    if (!rec) return null;
    // Числовая цель — только если сам показатель заметно хуже эталона; рекомендация из ответов или контекста
    // команды при нормальном показателе получает текстовое задание (иначе цель была бы уже выполнена).
    var m = { farm: M.lh.verdict === 'low' ? M.lh : M.gpm, xp: M.xpm, deaths: M.deaths, fights: M.ka, damage: M.hd }[rec.id];
    if (m && m.verdict === 'low' && m.base != null && m.value != null) {
      var goal = m.lowerBetter ? 'не больше ' + fmt(m.base, m.digits) : 'не меньше ' + fmt(m.base, m.digits);
      return { area: rec.id, text: 'В следующем матче на этой позиции: ' + m.label.charAt(0).toLowerCase() + m.label.slice(1) + ' — ' + goal + ' (в этом матче было ' + fmt(m.value, m.digits) + ').' };
    }
    var T = {
      farm: 'В следующем матче после линии не стой на месте: между волнами зачищай один-два ближайших лагеря и отмечай, когда шёл без цели.',
      xp: 'В следующем матче держись рядом с волнами и дракой: опыт дают крипы и герои поблизости, а не дорога и фонтан.',
      deaths: 'В следующем матче перед каждым шагом в чужую половину карты считай пропавших врагов на миникарте; если их трое и больше — фарми ближе к своей стороне.',
      fights: 'В следующем матче всегда носи свиток телепортации и приходи на каждую драку и объект команды, пока они не закончились.',
      damage: 'В следующем матче входи в драку после того, как враги потратят контроль, и бей тех, до кого дотягиваешься.',
      lane: 'В следующем матче к 10:00 не умирай на линии и не уходи на базу ради лечения — бери расходники с собой.',
      objectives: 'После каждой выигранной драки в следующем матче предложи команде снести строение или убить Рошана.',
      items: 'Перед матчем открой гайд по своему герою и выбери первый ключевой предмет под состав соперника.',
      vision: 'В следующем матче смотри на миникарту после каждого добитого крипа или лагеря и считай пропавших врагов.',
      positioning: 'В следующем матче в каждой драке сначала дождись, пока враги потратят контроль, и только потом входи.',
      macro: 'В следующем матче перед каждой минутой :00 спрашивай себя, какая цель на карте сейчас главная.',
      draft: 'Перед следующим пиком посмотри контрпики своего героя на его странице и подбери предмет против самого опасного.',
      tilt: 'После двух поражений подряд сделай перерыв не меньше 15 минут, прежде чем искать новую игру.',
    };
    return T[rec.id] ? { area: rec.id, text: T[rec.id] } : null;
  }

  // Проверка каталога для сборки: все гайды и этапы существуют.
  function checkCatalog(hasGuide, hasModule) {
    var errors = [];
    Object.keys(REC).forEach(function (area) {
      REC[area].guides.forEach(function (g) { if (!hasGuide(g)) errors.push(area + ': нет гайда ' + g); });
      Object.keys(REC[area].stage).forEach(function (role) {
        var s = REC[area].stage[role];
        if (!hasModule(s[0], s[1])) errors.push(area + '/' + role + ': нет этапа ' + s.join('/'));
      });
    });
    return errors;
  }

  return {
    analyze: analyze, baseline: baseline, baseMinutes: baseMinutes, metrics: metrics, teamContext: teamContext, itemsContext: itemsContext,
    checkCatalog: checkCatalog, roleOf: roleOf, fmt: fmt, pct: pct,
    REC: REC, MAX_RECS: MAX_RECS, HI: HI, LO: LO, D_HI: D_HI, D_LO: D_LO, MIN_DURATION: MIN_DURATION, TURBO: TURBO,
  };
});
