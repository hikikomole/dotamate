// Учебный центр (/academy/): отметки уроков, мини-тесты и прогресс маршрутов.
// Разметку рисует сборщик (tools/academy-render.js); здесь только поведение.
//
// Прогресс живёт только в этом браузере (localStorage) и никуда не отправляется.
// Если хранилище запрещено, переполнено или в нём мусор — страница работает как
// обычно, просто без сохранения, и коротко об этом говорит.
(function () {
  'use strict';

  var KEY = 'dotamate.academy.progress.v1';
  var indexEl = document.getElementById('academyIndex');
  if (!indexEl) return;
  var INDEX;
  try { INDEX = JSON.parse(indexEl.textContent); } catch (e) { return; }
  if (!INDEX || !INDEX.courses) return;

  var storageOk = true;
  var progress = loadProgress(INDEX.courses);

  function emptyCourse() { return { completedLessons: [], bestScores: {}, lastLessonId: null }; }

  function lessonIds(courseId) {
    var c = INDEX.courses[courseId];
    return c ? c.lessons.map(function (l) { return l.id; }) : [];
  }
  function lessonTitle(courseId, lessonId) {
    var c = INDEX.courses[courseId];
    for (var i = 0; c && i < c.lessons.length; i++) if (c.lessons[i].id === lessonId) return c.lessons[i].title;
    return '';
  }

  // Принимаем только версию 1 и только известные ID; всё остальное — пустой прогресс.
  function loadProgress(courses) {
    var out = { version: 1, courses: {} };
    Object.keys(courses).forEach(function (id) { out.courses[id] = emptyCourse(); });
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { storageOk = false; return out; }
    if (!raw) return out;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return out; }
    if (!data || typeof data !== 'object' || data.version !== 1 || !data.courses || typeof data.courses !== 'object') return out;
    Object.keys(courses).forEach(function (id) {
      var saved = data.courses[id];
      if (!saved || typeof saved !== 'object') return;
      var lessons = courses[id].lessons.map(function (l) { return l.id; });
      var modules = courses[id].modules;
      var c = emptyCourse();
      if (Array.isArray(saved.completedLessons)) {
        saved.completedLessons.forEach(function (l) {
          if (typeof l === 'string' && lessons.indexOf(l) !== -1 && c.completedLessons.indexOf(l) === -1) c.completedLessons.push(l);
        });
      }
      if (saved.bestScores && typeof saved.bestScores === 'object') {
        Object.keys(saved.bestScores).forEach(function (m) {
          var v = saved.bestScores[m];
          if (modules.indexOf(m) !== -1 && typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100) c.bestScores[m] = Math.round(v);
        });
      }
      if (typeof saved.lastLessonId === 'string' && lessons.indexOf(saved.lastLessonId) !== -1) c.lastLessonId = saved.lastLessonId;
      out.courses[id] = c;
    });
    return out;
  }

  function saveProgress(p) {
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(p));
      return true;
    } catch (e) {
      storageOk = false;
      showStorageNote();
      return false;
    }
  }

  // Перед каждым изменением перечитываем хранилище: в другой вкладке могли
  // отметить уроки другого маршрута, и запись старой копии их бы стёрла.
  function refresh() {
    if (!storageOk) return;
    var fresh = loadProgress(INDEX.courses);
    if (storageOk) progress = fresh;
  }

  function course(courseId) {
    if (!progress.courses[courseId]) progress.courses[courseId] = emptyCourse();
    return progress.courses[courseId];
  }

  function setLessonComplete(courseId, lessonId, complete) {
    refresh();
    if (lessonIds(courseId).indexOf(lessonId) === -1) return;
    var c = course(courseId);
    var i = c.completedLessons.indexOf(lessonId);
    if (complete && i === -1) c.completedLessons.push(lessonId);
    if (!complete && i !== -1) c.completedLessons.splice(i, 1);
    saveProgress(progress);
  }

  function saveQuizScore(courseId, moduleId, score) {
    refresh();
    var c = course(courseId);
    if (!(moduleId in c.bestScores) || score > c.bestScores[moduleId]) c.bestScores[moduleId] = score;
    saveProgress(progress);
    return c.bestScores[moduleId];
  }

  function resetCourse(courseId) {
    refresh();
    progress.courses[courseId] = emptyCourse();
    saveProgress(progress);
  }

  function setLastLesson(courseId, lessonId) {
    if (lessonIds(courseId).indexOf(lessonId) === -1) return;
    refresh();
    course(courseId).lastLessonId = lessonId;
    saveProgress(progress);
  }

  // Следующий — первый неотмеченный урок по порядку маршрута. Маршрут пройден —
  // последний открытый урок, а если ни один не открывали — первый.
  function nextLesson(courseId) {
    var ids = lessonIds(courseId), c = course(courseId);
    for (var i = 0; i < ids.length; i++) if (c.completedLessons.indexOf(ids[i]) === -1) return { id: ids[i], state: c.completedLessons.length ? 'continue' : 'start' };
    return { id: c.lastLessonId || ids[0], state: 'done' };
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function showStorageNote() {
    var notes = document.querySelectorAll('[data-academy-storage]');
    for (var i = 0; i < notes.length; i++) {
      notes[i].textContent = 'Прогресс не сохранится: браузер не разрешает сайту хранить данные. Уроки и тесты работают, но отметки пропадут после перезагрузки страницы.';
      notes[i].hidden = false;
    }
  }

  function renderCourse(root) {
    var courseId = root.getAttribute('data-academy-course');
    if (!INDEX.courses[courseId]) return;
    var ids = lessonIds(courseId), c = course(courseId);
    var done = c.completedLessons.length, total = ids.length;

    var bar = root.querySelector('.ac-bar');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-valuetext', done + ' из ' + total);
      var fill = bar.querySelector('.ac-bar-fill');
      if (fill) fill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    }
    var txt = root.querySelector('[data-academy-progress-text]');
    if (txt) txt.textContent = done === total && total
      ? 'Маршрут пройден: отмечены все ' + total + ' ' + plural(total, 'урок', 'урока', 'уроков')
      : 'Отмечено ' + done + ' из ' + total + ' ' + plural(total, 'урока', 'уроков', 'уроков');

    var next = nextLesson(courseId);
    var onCoursePage = !!root.querySelector('[data-academy-lesson]');
    var link = root.querySelector('[data-academy-continue]');
    if (link && next.id) {
      var title = lessonTitle(courseId, next.id);
      link.setAttribute('href', (onCoursePage ? '' : INDEX.courses[courseId].href) + '#lesson-' + next.id);
      if (onCoursePage) link.textContent = (next.state === 'start' ? 'Начать: ' : next.state === 'continue' ? 'Продолжить: ' : 'Маршрут пройден — вернуться к уроку: ') + title;
      else link.textContent = next.state === 'start' ? 'Начать маршрут' : next.state === 'continue' ? 'Продолжить: ' + title : 'Маршрут пройден — повторить';
    }

    var lessons = root.querySelectorAll('[data-academy-lesson]');
    for (var i = 0; i < lessons.length; i++) {
      var el = lessons[i], id = el.getAttribute('data-academy-lesson');
      var isDone = c.completedLessons.indexOf(id) !== -1;
      var isNext = next.state !== 'done' && id === next.id;
      var box = el.querySelector('[data-academy-done]');
      if (box) box.checked = isDone;
      el.classList.toggle('is-done', isDone);
      el.classList.toggle('is-next', isNext);
      var badge = el.querySelector('[data-academy-badge]');
      if (badge) badge.textContent = isDone ? '✓ Пройдено' : isNext ? 'Следующий' : '';
    }

    var quizzes = root.querySelectorAll('[data-academy-quiz]');
    for (var q = 0; q < quizzes.length; q++) {
      var best = quizzes[q].querySelector('[data-academy-best]');
      var m = quizzes[q].getAttribute('data-academy-quiz');
      if (best) best.textContent = (m in c.bestScores) ? 'Лучший результат в этом браузере: ' + c.bestScores[m] + '%' : '';
    }
  }

  function renderAll() {
    var roots = document.querySelectorAll('[data-academy-course]');
    for (var i = 0; i < roots.length; i++) renderCourse(roots[i]);
  }

  function courseOf(el) {
    var root = el.closest('[data-academy-course]');
    return root ? root.getAttribute('data-academy-course') : null;
  }

  function clearQuizFeedback(form) {
    var qs = form.querySelectorAll('[data-academy-question]');
    for (var i = 0; i < qs.length; i++) {
      qs[i].classList.remove('is-missing', 'is-right', 'is-wrong');
      qs[i].removeAttribute('aria-invalid');
      var fb = qs[i].querySelector('[data-academy-feedback]');
      if (fb) fb.hidden = true;
      var labels = qs[i].querySelectorAll('.ac-choice');
      for (var j = 0; j < labels.length; j++) labels[j].classList.remove('is-correct', 'is-chosen-wrong');
    }
  }

  function gradeQuiz(form) {
    var courseId = courseOf(form), moduleId = form.getAttribute('data-academy-quiz');
    var qs = form.querySelectorAll('[data-academy-question]');
    var result = form.querySelector('[data-academy-result]');
    var missing = [];
    for (var i = 0; i < qs.length; i++) if (!qs[i].querySelector('input[type=radio]:checked')) missing.push(i);
    clearQuizFeedback(form);
    if (missing.length) {
      missing.forEach(function (i) { qs[i].classList.add('is-missing'); qs[i].setAttribute('aria-invalid', 'true'); });
      if (result) result.textContent = 'Выбери ответ ' + (missing.length === 1 ? 'в вопросе ' : 'в вопросах ') + missing.map(function (i) { return i + 1; }).join(', ') + ' и проверь ещё раз.';
      var first = qs[missing[0]].querySelector('input[type=radio]');
      if (first) first.focus();
      return;
    }
    var right = 0;
    for (var k = 0; k < qs.length; k++) {
      var f = qs[k], correct = Number(f.getAttribute('data-correct'));
      var chosen = f.querySelector('input[type=radio]:checked');
      var ok = Number(chosen.value) === correct;
      if (ok) right++;
      f.classList.add(ok ? 'is-right' : 'is-wrong');
      var inputs = f.querySelectorAll('input[type=radio]');
      var correctLabel = inputs[correct] ? inputs[correct].closest('.ac-choice') : null;
      if (correctLabel) correctLabel.classList.add('is-correct');
      if (!ok) { var wl = chosen.closest('.ac-choice'); if (wl) wl.classList.add('is-chosen-wrong'); }
      var verdict = f.querySelector('[data-academy-verdict]');
      if (verdict) verdict.textContent = ok ? '✓ Верно.' : '✗ Неверно. Правильный ответ: «' + (correctLabel ? correctLabel.textContent.trim() : '') + '».';
      var fb = f.querySelector('[data-academy-feedback]');
      if (fb) fb.hidden = false;
    }
    var pct = Math.round(right / qs.length * 100);
    var best = courseId ? saveQuizScore(courseId, moduleId, pct) : pct;
    if (result) result.textContent = 'Результат: ' + right + ' из ' + qs.length + ' (' + pct + '%). ' +
      (right === qs.length ? 'Все ответы верны.' : 'Объяснения — под каждым вопросом. Тест можно пройти ещё раз, а маршрут продолжать в любом случае.');
    var retry = form.querySelector('[data-academy-retry]');
    if (retry) retry.hidden = false;
    var bestEl = form.querySelector('[data-academy-best]');
    if (bestEl) bestEl.textContent = 'Лучший результат в этом браузере: ' + best + '%';
  }

  document.addEventListener('change', function (e) {
    var box = e.target.closest && e.target.closest('[data-academy-done]');
    if (!box) return;
    var lesson = box.closest('[data-academy-lesson]'), courseId = courseOf(box);
    if (!lesson || !courseId) return;
    setLessonComplete(courseId, lesson.getAttribute('data-academy-lesson'), box.checked);
    renderAll();
  });

  function onOpen(e) {
    var a = e.target.closest && e.target.closest('[data-academy-open]');
    if (!a) return;
    var lesson = a.closest('[data-academy-lesson]'), courseId = courseOf(a);
    if (lesson && courseId) setLastLesson(courseId, lesson.getAttribute('data-academy-lesson'));
  }
  document.addEventListener('click', onOpen);
  document.addEventListener('auxclick', onOpen);

  document.addEventListener('click', function (e) {
    var reset = e.target.closest && e.target.closest('[data-academy-reset]');
    if (reset) {
      var courseId = courseOf(reset);
      if (!courseId) return;
      var ok = false;
      try { ok = window.confirm('Сбросить прогресс маршрута «' + INDEX.courses[courseId].title + '»? Отметки уроков и результаты тестов этого маршрута удалятся. Другой маршрут не изменится.'); } catch (err) { ok = false; }
      if (!ok) return;
      resetCourse(courseId);
      var root = reset.closest('[data-academy-course]');
      var forms = root ? root.querySelectorAll('[data-academy-quiz]') : [];
      for (var i = 0; i < forms.length; i++) {
        forms[i].reset();
        clearQuizFeedback(forms[i]);
        var r = forms[i].querySelector('[data-academy-result]'); if (r) r.textContent = '';
        var rt = forms[i].querySelector('[data-academy-retry]'); if (rt) rt.hidden = true;
      }
      renderAll();
      var txt = root && root.querySelector('[data-academy-progress-text]');
      if (txt) txt.textContent = 'Прогресс маршрута сброшен. ' + txt.textContent;
      return;
    }
    var retry = e.target.closest && e.target.closest('[data-academy-retry]');
    if (retry) {
      var form = retry.closest('[data-academy-quiz]');
      if (!form) return;
      form.reset();
      clearQuizFeedback(form);
      var res = form.querySelector('[data-academy-result]'); if (res) res.textContent = 'Ответы очищены — можно пройти тест ещё раз.';
      retry.hidden = true;
      var first = form.querySelector('input[type=radio]'); if (first) first.focus();
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest && e.target.closest('[data-academy-quiz]');
    if (!form) return;
    e.preventDefault();
    gradeQuiz(form);
  });

  // Прогресс изменили в другой вкладке — показываем актуальное состояние.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY && e.key !== null) return;
    refresh();
    renderAll();
  });

  if (!storageOk) showStorageNote();
  renderAll();
})();
