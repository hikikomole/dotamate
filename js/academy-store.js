// Учебный центр: состояние прогресса в браузере (localStorage), без интерфейса.
// Хранится только здесь, на сервер не уходит. Интерфейс — js/academy.js.
// Формат v2: см. docs/superpowers/specs/2026-10-11-uchebny-tsentr-v2-design.md.
(function () {
  'use strict';
  var KEY = 'dotamate.academy.progress.v2';
  var KEY_V1 = 'dotamate.academy.progress.v1';
  var MAX_TEXT = 500;
  var MAX_DIARY = 30;
  var STEP_LABEL = { read: 'Прочитай', scenario: 'Разбери ситуацию', quiz: 'Проверь себя', practice: 'Сыграй и запиши' };

  function emptyCourse() {
    return { completedLessons: [], bestScores: {}, lastLessonId: null, scenarioChoices: {}, practiceDone: [], diary: [], updatedAt: 0 };
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ids(index, courseId) {
    var c = index.courses[courseId], out = { lessons: [], modules: [], scenarios: [] };
    c.modules.forEach(function (m) {
      out.modules.push(m.id);
      m.lessons.forEach(function (l) { out.lessons.push(l.id); });
      m.scenarios.forEach(function (s) { out.scenarios.push(s); });
    });
    return out;
  }
  function strList(v, allowed) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (x) { if (typeof x === 'string' && allowed.indexOf(x) !== -1 && out.indexOf(x) === -1) out.push(x); });
    return out;
  }
  function sanitizeCourse(saved, known) {
    var c = emptyCourse();
    if (!saved || typeof saved !== 'object') return c;
    c.completedLessons = strList(saved.completedLessons, known.lessons);
    c.practiceDone = strList(saved.practiceDone, known.lessons);
    if (saved.bestScores && typeof saved.bestScores === 'object') Object.keys(saved.bestScores).forEach(function (m) {
      var v = saved.bestScores[m];
      if (known.modules.indexOf(m) !== -1 && typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100) c.bestScores[m] = Math.round(v);
    });
    if (saved.scenarioChoices && typeof saved.scenarioChoices === 'object') Object.keys(saved.scenarioChoices).forEach(function (s) {
      var v = saved.scenarioChoices[s];
      if (known.scenarios.indexOf(s) !== -1 && (v === 0 || v === 1 || v === 2)) c.scenarioChoices[s] = v;
    });
    if (typeof saved.lastLessonId === 'string' && known.lessons.indexOf(saved.lastLessonId) !== -1) c.lastLessonId = saved.lastLessonId;
    if (Array.isArray(saved.diary)) saved.diary.forEach(function (e) {
      if (e && typeof e.id === 'string' && typeof e.text === 'string' && e.text.trim() && typeof e.date === 'number' && isFinite(e.date)
        && known.modules.indexOf(e.moduleId) !== -1 && c.diary.length < MAX_DIARY)
        c.diary.push({ id: e.id, moduleId: e.moduleId, date: e.date, text: e.text.slice(0, MAX_TEXT) });
    });
    if (typeof saved.updatedAt === 'number' && isFinite(saved.updatedAt)) c.updatedAt = saved.updatedAt;
    return c;
  }
  function blank(index) {
    var s = { version: 2, courses: {} };
    Object.keys(index.courses).forEach(function (id) { s.courses[id] = emptyCourse(); });
    return s;
  }
  function sanitize(raw, index) {
    var s = blank(index);
    if (!raw || typeof raw !== 'object' || raw.version !== 2 || !raw.courses || typeof raw.courses !== 'object') return s;
    Object.keys(index.courses).forEach(function (id) { if (own(raw.courses, id)) s.courses[id] = sanitizeCourse(raw.courses[id], ids(index, id)); });
    return s;
  }
  function migrateV1(raw, index) {
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.courses || typeof raw.courses !== 'object') return null;
    var s = blank(index);
    Object.keys(index.courses).forEach(function (id) {
      var v = raw.courses[id];
      if (!v || typeof v !== 'object') return;
      s.courses[id] = sanitizeCourse({ completedLessons: v.completedLessons, bestScores: v.bestScores, lastLessonId: v.lastLessonId, updatedAt: Date.now() }, ids(index, id));
    });
    return s;
  }
  function read(key) { return window.localStorage.getItem(key); }
  function parse(txt) { try { return JSON.parse(txt); } catch (e) { return null; } }

  function load(index) {
    var raw2, raw1;
    try { raw2 = read(KEY); raw1 = raw2 ? null : read(KEY_V1); }
    catch (e) { return { state: blank(index), storageOk: false, migrated: false }; }
    if (raw2) return { state: sanitize(parse(raw2), index), storageOk: true, migrated: false };
    var m = raw1 ? migrateV1(parse(raw1), index) : null;
    return { state: m || blank(index), storageOk: true, migrated: !!m };
  }
  function save(state) {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  var memory = null;
  // Перечитать хранилище, применить изменение, сохранить. fn возвращает id изменённого курса.
  function mutate(index, fn) {
    var loaded = load(index);
    var state = loaded.storageOk ? loaded.state : (memory || loaded.state);
    var courseId = fn(state);
    if (courseId && state.courses[courseId]) state.courses[courseId].updatedAt = Date.now();
    var ok = loaded.storageOk && save(state);
    memory = state;
    return { state: state, ok: ok };
  }
  function current(index) {
    var loaded = load(index);
    if (!loaded.storageOk && memory) return { state: memory, storageOk: false, migrated: false };
    if (loaded.migrated) save(loaded.state);
    return loaded;
  }

  function compute(index, state, courseId) {
    var c = state.courses[courseId] || emptyCourse(), info = index.courses[courseId];
    var sum = { stepsDone: 0, stepsTotal: 0, percent: 0, modulesDone: 0, modules: [], next: null, diaryCount: c.diary.length };
    info.modules.forEach(function (m, i) {
      var ls = m.lessons.map(function (l) { return l.id; });
      var read = ls.filter(function (id) { return c.completedLessons.indexOf(id) !== -1; }).length;
      var scen = m.scenarios.filter(function (id) { return own(c.scenarioChoices, id); }).length;
      var quiz = own(c.bestScores, m.id);
      var prac = ls.filter(function (id) { return c.practiceDone.indexOf(id) !== -1; }).length;
      var mod = {
        id: m.id, title: m.title, index: i,
        read: { done: read, total: ls.length }, scenario: { done: scen, total: m.scenarios.length },
        quizTaken: quiz, bestScore: quiz ? c.bestScores[m.id] : null, practice: { done: prac, total: ls.length },
        complete: false, step: null,
      };
      var firstLesson = ls.filter(function (id) { return c.completedLessons.indexOf(id) === -1; })[0];
      var firstScen = m.scenarios.filter(function (id) { return !own(c.scenarioChoices, id); })[0];
      var firstTask = ls.filter(function (id) { return c.practiceDone.indexOf(id) === -1; })[0];
      var step = firstLesson ? ['read', firstLesson] : firstScen ? ['scenario', firstScen] : !quiz ? ['quiz', m.id] : firstTask ? ['practice', firstTask] : null;
      mod.step = step ? step[0] : null;
      mod.complete = !step;
      if (mod.complete) sum.modulesDone++;
      if (step && !sum.next) sum.next = { moduleId: m.id, moduleIndex: i, step: step[0], itemId: step[1], label: 'Этап ' + (i + 1) + ' · ' + STEP_LABEL[step[0]] };
      sum.stepsTotal += ls.length * 2 + m.scenarios.length + 1;
      sum.stepsDone += read + scen + (quiz ? 1 : 0) + prac;
      sum.modules.push(mod);
    });
    sum.percent = sum.stepsTotal ? Math.round(sum.stepsDone / sum.stepsTotal * 100) : 0;
    return sum;
  }

  window.DMAcademyStore = {
    KEY: KEY, KEY_V1: KEY_V1, MAX_TEXT: MAX_TEXT, MAX_DIARY: MAX_DIARY, STEP_LABEL: STEP_LABEL,
    emptyCourse: emptyCourse, sanitize: sanitize, migrateV1: migrateV1,
    load: load, current: current, save: save, mutate: mutate, compute: compute,
  };
})();
