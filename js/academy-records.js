// Учебный центр: разборы матчей, цели и тренировка — хранение в браузере (localStorage), без интерфейса.
// Прогресс маршрутов — отдельно, js/academy-store.js. Ничего из этого на сервер не уходит.
//
// dotamate.academy.matches.v1 = { version: 1, analyses: [{ id, saved, input }], goals: [{ id, text, area, created, done }] }
//   input — то, что ввёл посетитель или вернул Steam (см. cleanInput): по нему разбор пересчитывается заново,
//   поэтому новые правила разбора действуют и на старые записи.
// dotamate.academy.drill.v1 = { version: 1, items: { [id]: { r, w, box, last, lastOk } }, exams: { [courseId]: { best, last, date } }, days: ['ГГГГ-ММ-ДД'] }
//
// Всё прочитанное проверяется: неизвестные поля и неверные типы отбрасываются, повреждённая запись — пустое состояние.
// Недоступное или переполненное хранилище — работа в памяти (ok: false), страница об этом коротко говорит.
(function () {
  'use strict';
  var KEY_M = 'dotamate.academy.matches.v1', KEY_D = 'dotamate.academy.drill.v1';
  var MAX_ANALYSES = 30, MAX_GOALS = 12, MAX_DAYS = 120, MAX_TEXT = 300;
  var POS = [1, 2, 3, 4, 5, 'sup'];
  var NUMS = ['k', 'd', 'a', 'lh', 'dn', 'gpm', 'xpm', 'hd', 'td', 'nw'];
  var ANS = { lane: ['won', 'even', 'lost', 'unknown'], deaths: ['ganked', 'fight', 'greedy', 'few', 'unknown'], hard: ['farm', 'fights', 'map', 'draft', 'none'], mood: ['calm', 'annoyed', 'tilt'] };

  function fin(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
  function int(v, lo, hi) { return fin(v, lo, hi) ? Math.round(v) : null; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // Вход разбора: только известные поля разумного размера.
  function cleanInput(x) {
    if (!x || typeof x !== 'object') return null;
    var o = {
      source: x.source === 'steam' ? 'steam' : 'manual',
      heroId: int(x.heroId, 1, 1000), pos: POS.indexOf(x.pos) !== -1 ? x.pos : null,
      win: typeof x.win === 'boolean' ? x.win : null, duration: int(x.duration, 60, 6 * 3600),
    };
    if (!o.heroId || o.pos === null || o.win === null || !o.duration) return null;
    if (typeof x.matchId === 'string' && /^\d{1,19}$/.test(x.matchId)) o.matchId = x.matchId;
    if (fin(x.start, 0, 4e9)) o.start = Math.round(x.start);
    if (fin(x.gameMode, 0, 99)) o.gameMode = Math.round(x.gameMode);
    if (fin(x.lobbyType, 0, 99)) o.lobbyType = Math.round(x.lobbyType);
    if (x.posModel === 'sup' || [1, 2, 3].indexOf(x.posModel) !== -1) o.posModel = x.posModel;
    NUMS.forEach(function (k) { var v = int(x[k], 0, 1e6); if (v !== null) o[k] = v; });
    if (Array.isArray(x.items)) o.items = x.items.slice(0, 6).map(function (v) { return int(v, 0, 100000) || 0; });
    if (Array.isArray(x.team) && x.team.length === 5) {
      var team = x.team.map(function (q) {
        if (!q || typeof q !== 'object') return null;
        var t = { hero: int(q.hero, 0, 1000) || 0, me: q.me === true };
        NUMS.forEach(function (k) { var v = int(q[k], 0, 1e6); if (v !== null) t[k] = v; });
        return t;
      });
      if (team.every(Boolean)) o.team = team;
    }
    if (x.answers && typeof x.answers === 'object') {
      var a = {};
      Object.keys(ANS).forEach(function (k) { if (ANS[k].indexOf(x.answers[k]) !== -1) a[k] = x.answers[k]; });
      o.answers = a;
    }
    return o;
  }

  function blankM() { return { version: 1, analyses: [], goals: [] }; }
  function blankD() { return { version: 1, items: {}, exams: {}, days: [] }; }

  function sanitizeM(raw) {
    var s = blankM();
    if (!raw || raw.version !== 1) return s;
    (Array.isArray(raw.analyses) ? raw.analyses : []).forEach(function (e) {
      if (s.analyses.length >= MAX_ANALYSES || !e || typeof e.id !== 'string' || !fin(e.saved, 0, 1e14)) return;
      var input = cleanInput(e.input);
      if (input && !s.analyses.some(function (x) { return x.id === e.id; })) s.analyses.push({ id: e.id.slice(0, 40), saved: e.saved, input: input });
    });
    (Array.isArray(raw.goals) ? raw.goals : []).forEach(function (g) {
      if (s.goals.length >= MAX_GOALS || !g || typeof g.id !== 'string' || !str(g.text, MAX_TEXT).trim() || !fin(g.created, 0, 1e14)) return;
      s.goals.push({ id: g.id.slice(0, 40), text: str(g.text, MAX_TEXT), area: str(g.area, 20), created: g.created, done: g.done === true });
    });
    return s;
  }
  function sanitizeD(raw) {
    var s = blankD();
    if (!raw || raw.version !== 1) return s;
    if (raw.items && typeof raw.items === 'object') Object.keys(raw.items).forEach(function (id) {
      var v = raw.items[id];
      if (!/^[a-z0-9-]{1,80}$/.test(id) || !v || typeof v !== 'object') return;
      var r = int(v.r, 0, 1e5), w = int(v.w, 0, 1e5), box = int(v.box, 0, 4);
      if (r === null || w === null || box === null) return;
      s.items[id] = { r: r, w: w, box: box, last: fin(v.last, 0, 1e14) ? v.last : 0, lastOk: v.lastOk === true };
    });
    if (raw.exams && typeof raw.exams === 'object') Object.keys(raw.exams).forEach(function (id) {
      var v = raw.exams[id];
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !v) return;
      var best = int(v.best, 0, 100), last = int(v.last, 0, 100);
      if (best !== null) s.exams[id] = { best: best, last: last === null ? best : last, date: fin(v.date, 0, 1e14) ? v.date : 0 };
    });
    if (Array.isArray(raw.days)) raw.days.forEach(function (d) {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && s.days.indexOf(d) === -1 && s.days.length < MAX_DAYS) s.days.push(d);
    });
    s.days.sort();
    return s;
  }

  function store(key, sanitize, blank) {
    var memory = null, failed = false;
    function load() {
      var txt;
      try { txt = window.localStorage.getItem(key); } catch (e) { return { state: memory || blank(), ok: false }; }
      if (memory && failed) return { state: memory, ok: false };
      var raw = null;
      try { raw = txt ? JSON.parse(txt) : null; } catch (e) { raw = null; }
      return { state: sanitize(raw), ok: true };
    }
    // Перечитать, изменить, сохранить: вторая вкладка не затирает изменения первой.
    function mutate(fn) {
      var l = load(), st = l.state;
      fn(st);
      var ok = false;
      if (l.ok) { try { window.localStorage.setItem(key, JSON.stringify(st)); ok = true; } catch (e) { ok = false; } }
      failed = !ok; memory = st;
      return { state: st, ok: ok };
    }
    return { load: load, mutate: mutate, key: key };
  }

  var M = store(KEY_M, sanitizeM, blankM), D = store(KEY_D, sanitizeD, blankD);

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Серия: сколько дней подряд до сегодня (или до вчера, если сегодня ещё не тренировался).
  function streak(days) {
    if (!days.length) return 0;
    var set = {}; days.forEach(function (d) { set[d] = true; });
    var d = new Date(), n = 0, key = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    if (!set[key(d)]) d.setDate(d.getDate() - 1);
    while (set[key(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  window.DMAcademyRecords = {
    KEY_M: KEY_M, KEY_D: KEY_D, MAX_ANALYSES: MAX_ANALYSES, MAX_GOALS: MAX_GOALS, MAX_TEXT: MAX_TEXT,
    cleanInput: cleanInput, sanitizeM: sanitizeM, sanitizeD: sanitizeD,
    matches: M, drill: D, uid: uid, today: today, streak: streak, own: own,
    // Сохранить разбор (повтор того же матча заменяет старую запись). Возвращает { ok, id }.
    saveAnalysis: function (input) {
      var clean = cleanInput(input);
      if (!clean) return { ok: false, id: null };
      var id = clean.matchId ? 'm' + clean.matchId : 'x' + uid();
      var r = M.mutate(function (st) {
        st.analyses = st.analyses.filter(function (a) { return a.id !== id; });
        st.analyses.unshift({ id: id, saved: Date.now(), input: clean });
        st.analyses = st.analyses.slice(0, MAX_ANALYSES);
      });
      return { ok: r.ok, id: id };
    },
    addGoal: function (text, area) {
      var t = str(text, MAX_TEXT).trim();
      if (!t) return { ok: false };
      var dup = false;
      var r = M.mutate(function (st) {
        if (st.goals.some(function (g) { return !g.done && g.text === t; })) { dup = true; return; }
        st.goals.unshift({ id: uid(), text: t, area: str(area, 20), created: Date.now(), done: false });
        // Сверх предела — сначала уходят выполненные, затем самые старые.
        while (st.goals.length > MAX_GOALS) {
          var i = -1;
          for (var k = st.goals.length - 1; k >= 0; k--) if (st.goals[k].done) { i = k; break; }
          st.goals.splice(i === -1 ? st.goals.length - 1 : i, 1);
        }
      });
      return { ok: r.ok, dup: dup };
    },
  };
})();
