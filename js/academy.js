// Учебный центр (/academy/): интерфейс этапов, вкладок шагов, ситуаций, теста,
// практики и дневника. Разметку рисует сборщик (tools/academy-render.js),
// состояние хранит и считает js/academy-store.js (подключается раньше).
//
// Прогресс живёт только в этом браузере и никуда не отправляется. Если хранилище
// запрещено или переполнено — всё работает в памяти, страница коротко об этом говорит.
(function () {
  'use strict';

  var S = window.DMAcademyStore;
  var indexEl = document.getElementById('academyIndex');
  if (!S || !indexEl) return;
  var INDEX;
  try { INDEX = JSON.parse(indexEl.textContent); } catch (e) { return; }
  if (!INDEX || INDEX.version !== 2 || !INDEX.courses) return;

  // Без этого класса CSS показывает всё подряд: этапы раскрыты, разборы видны.
  document.documentElement.classList.add('ac-js');

  var STEPS = ['read', 'scenario', 'quiz', 'practice'];
  var LETTERS = ['A', 'B', 'C'];
  var CHARS_HINT = ' / ' + S.MAX_TEXT + ' · только в этом браузере';

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return root.querySelectorAll(sel); }

  // ---------- состояние ----------

  function showStorageNote() {
    each($$(document, '[data-academy-storage]'), function (n) {
      n.textContent = 'Прогресс не сохранится: браузер не разрешает сайту хранить данные. Уроки, ситуации и тесты работают, но отметки и дневник пропадут после перезагрузки страницы.';
      n.hidden = false;
    });
  }
  function state() {
    var l = S.current(INDEX);
    if (!l.storageOk) showStorageNote();
    return l.state;
  }
  // Изменение: перечитать хранилище, применить, сохранить, перерисовать.
  function change(fn) {
    var r = S.mutate(INDEX, fn);
    if (!r.ok) showStorageNote();
    renderAll();
    return r;
  }
  function courseOf(el) {
    var r = el.closest('[data-academy-course]');
    return r ? r.getAttribute('data-academy-course') : null;
  }
  function stageOf(el) { return el.closest('details.ac-stage'); }
  function toggleIn(list, id, on) {
    var i = list.indexOf(id);
    if (on && i === -1) list.push(id);
    if (!on && i !== -1) list.splice(i, 1);
  }

  // ---------- этапы, вкладки, ситуации ----------

  function selectTab(stage, step, focus) {
    each($$(stage, '[data-academy-step]'), function (t) {
      var on = t.getAttribute('data-academy-step') === step;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    each($$(stage, '[data-academy-panel]'), function (p) { p.hidden = p.getAttribute('data-academy-panel') !== step; });
  }
  function showScenario(stage, n) {
    var sits = $$(stage, '[data-academy-scenario]');
    if (!sits.length) return;
    n = Math.max(0, Math.min(n, sits.length - 1));
    each(sits, function (s, i) {
      s.hidden = i !== n;
      var prev = $(s, '[data-academy-sit-go="prev"]'), next = $(s, '[data-academy-sit-go="next"]');
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === sits.length - 1;
    });
  }
  function scenarioIndex(stage, id) {
    var sits = $$(stage, '[data-academy-scenario]'), n = 0;
    each(sits, function (s, i) { if (s.getAttribute('data-academy-scenario') === id) n = i; });
    return n;
  }
  function feedbackText(sit, n) {
    var el = $(sit, 'details.ac-sit-reveal [data-academy-feedback="' + n + '"] span');
    return el ? el.textContent : '';
  }
  function renderScenarioState(sit, choice, announce) {
    var best = Number(sit.getAttribute('data-best'));
    var has = choice === 0 || choice === 1 || choice === 2;
    each($$(sit, '[data-academy-choice]'), function (opt) {
      var n = Number(opt.getAttribute('data-academy-choice'));
      var chosen = has && n === choice;
      opt.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      opt.classList.toggle('is-chosen', chosen);
      opt.classList.toggle('is-best', has && n === best);
      opt.classList.toggle('is-wrong', chosen && n !== best);
      var fb = $(opt, '[data-academy-opt-fb]');
      if (!fb) return;
      if (!has || (!chosen && n !== best)) { fb.hidden = true; fb.textContent = ''; return; }
      fb.textContent = '';
      var b = document.createElement('b');
      b.textContent = chosen ? (n === best ? 'Твой выбор — лучший. ' : 'Твой выбор. ') : 'Лучше. ';
      fb.appendChild(b);
      fb.appendChild(document.createTextNode(feedbackText(sit, n)));
      fb.hidden = false;
    });
    var live = $(sit, '[data-academy-sit-live]');
    if (live && announce) live.textContent = (announce === 'saved' ? 'Ответ сохранён. ' : 'Ответ принят, но не сохранён в браузере. ') +
      (choice === best ? 'Это лучший вариант.' : 'Лучший вариант — ' + LETTERS[best] + '.');
  }
  function openStage(id) {
    var d = document.getElementById('module-' + id);
    if (d) d.open = true;
    return d;
  }
  function hashId() {
    var h = (location.hash || '').slice(1);
    try { return decodeURIComponent(h); } catch (e) { return ''; } // испорченный хеш — как без хеша
  }
  function goTo(el) {
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }

  // ---------- отрисовка ----------

  function setStat(stage, key, text, done) {
    var el = $(stage, '[data-academy-stat="' + key + '"]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', !!done);
  }
  function setStepTab(stage, key, n, sub, done) {
    var t = $(stage, '[data-academy-step="' + key + '"]');
    if (!t) return;
    t.classList.toggle('is-done', !!done);
    var i = $(t, 'i'), small = $(t, '[data-academy-step-count]');
    if (i) i.textContent = done ? '✓' : String(n);
    if (small) small.textContent = sub;
  }
  function renderDiary(form, c) {
    var list = $(form, '[data-academy-diary-list]');
    if (!list) return;
    var id = form.getAttribute('data-academy-diary');
    var items = c.diary.filter(function (e) { return e.moduleId === id; }).sort(function (a, b) { return b.date - a.date; });
    list.textContent = '';
    items.forEach(function (e) {
      var li = document.createElement('li');
      var date = new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      var t = document.createElement('time');
      t.dateTime = new Date(e.date).toISOString();
      t.textContent = date;
      var p = document.createElement('p');
      p.textContent = e.text;
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ac-link-btn ac-del';
      del.setAttribute('data-academy-diary-del', e.id);
      del.setAttribute('aria-label', 'Удалить запись от ' + date);
      del.textContent = 'Удалить';
      li.appendChild(t); li.appendChild(p); li.appendChild(del);
      list.appendChild(li);
    });
  }

  function renderCoursePage(root, st) {
    var id = root.getAttribute('data-academy-course');
    if (!INDEX.courses[id]) return;
    var c = st.courses[id], sum = S.compute(INDEX, st, id);

    var fill = $(root, '.ac-next .ac-ring-fill');
    if (fill) fill.style.strokeDashoffset = String(169.65 * (1 - sum.percent / 100));
    var pct = $(root, '[data-academy-percent]');
    if (pct) pct.textContent = sum.percent + '%';
    var summ = $(root, '[data-academy-summary]');
    if (summ) summ.textContent = sum.stepsDone + ' из ' + sum.stepsTotal + ' ' + plural(sum.stepsTotal, 'шага', 'шагов', 'шагов') +
      ' · этапов завершено ' + sum.modulesDone;
    var cta = $(root, '[data-academy-continue]');
    if (cta) {
      var first = sum.next ? sum.next.moduleId : sum.modules[0].id;
      cta.setAttribute('href', '#module-' + first);
      cta.firstChild.nodeValue = !sum.next ? 'Маршрут пройден' : sum.stepsDone ? 'Следующий шаг' : 'Начать маршрут';
      var sub = $(cta, '[data-academy-continue-sub]');
      if (sub) sub.textContent = sum.next ? sum.next.label : 'Вернуться к началу';
    }

    sum.modules.forEach(function (m) {
      var cur = sum.next && sum.next.moduleId === m.id;
      var started = m.read.done + m.scenario.done + (m.quizTaken ? 1 : 0) + m.practice.done > 0;
      each($$(root, '[data-academy-nav="' + m.id + '"]'), function (a) {
        a.classList.toggle('is-done', m.complete);
        a.classList.toggle('is-cur', !!cur);
        var dot = $(a, '.ac-dot');
        if (dot) dot.textContent = m.complete ? '✓' : String(m.index + 1);
        var stt = $(a, '[data-academy-nav-state]');
        if (stt) stt.textContent = m.complete ? 'Завершён'
          : (cur || started) && m.step ? 'Шаг ' + (STEPS.indexOf(m.step) + 1) + ' из 4 · ' + S.STEP_LABEL[m.step].toLowerCase()
          : m.read.total + ' ' + plural(m.read.total, 'урок', 'урока', 'уроков');
      });
      var stage = document.getElementById('module-' + m.id);
      if (!stage) return;
      stage.classList.toggle('is-done', m.complete);
      stage.classList.toggle('is-cur', !!cur);
      var badge = $(stage, '[data-academy-stage-badge]');
      if (badge) badge.textContent = m.complete ? '✓ Завершён' : '';
      setStat(stage, 'read', 'Чтение ' + m.read.done + '/' + m.read.total, m.read.done === m.read.total);
      setStat(stage, 'scenario', 'Ситуации ' + m.scenario.done + '/' + m.scenario.total, m.scenario.done === m.scenario.total);
      setStat(stage, 'quiz', m.quizTaken ? 'Тест ' + m.bestScore + '%' : 'Тест —', m.quizTaken);
      setStat(stage, 'practice', 'Практика ' + m.practice.done + '/' + m.practice.total, m.practice.done === m.practice.total);
      var qn = $$(stage, '[data-academy-question]').length;
      setStepTab(stage, 'read', 1, m.read.done + ' из ' + m.read.total, m.read.done === m.read.total);
      setStepTab(stage, 'scenario', 2, m.scenario.done + ' из ' + m.scenario.total, m.scenario.done === m.scenario.total);
      setStepTab(stage, 'quiz', 3, m.quizTaken ? 'лучший ' + m.bestScore + '%' : qn + ' ' + plural(qn, 'вопрос', 'вопроса', 'вопросов'), m.quizTaken);
      setStepTab(stage, 'practice', 4, m.practice.done + ' из ' + m.practice.total, m.practice.done === m.practice.total);

      each($$(stage, '[data-academy-lesson]'), function (li) {
        var lid = li.getAttribute('data-academy-lesson');
        var done = c.completedLessons.indexOf(lid) !== -1;
        var next = !!(sum.next && sum.next.step === 'read' && sum.next.itemId === lid);
        var box = $(li, '[data-academy-done]');
        if (box) box.checked = done;
        li.classList.toggle('is-done', done);
        li.classList.toggle('is-next', next);
        var tag = $(li, '[data-academy-badge]');
        if (tag) tag.textContent = next ? 'Следующий' : '';
      });
      each($$(stage, '[data-academy-task]'), function (box) {
        var done = c.practiceDone.indexOf(box.getAttribute('data-academy-task')) !== -1;
        box.checked = done;
        var li = box.closest('.ac-task');
        if (li) li.classList.toggle('is-done', done);
      });
      each($$(stage, '[data-academy-scenario]'), function (sit) {
        var sid = sit.getAttribute('data-academy-scenario');
        renderScenarioState(sit, Object.prototype.hasOwnProperty.call(c.scenarioChoices, sid) ? c.scenarioChoices[sid] : null, false);
      });
      var best = $(stage, '[data-academy-best]');
      if (best) best.textContent = m.quizTaken ? 'Лучший результат в этом браузере: ' + m.bestScore + '%' : '';
      each($$(stage, '[data-academy-diary]'), function (f) { renderDiary(f, c); });
    });

    var dc = $(root, '[data-academy-diary-count]');
    if (dc) dc.textContent = sum.diaryCount ? 'В дневнике ' + sum.diaryCount + ' ' + plural(sum.diaryCount, 'запись', 'записи', 'записей') : 'Дневник пока пуст';
  }

  function renderLandingPage(root, st) {
    var latest = null;
    each($$(root, '.ac-route[data-academy-course]'), function (card) {
      var id = card.getAttribute('data-academy-course');
      var info = INDEX.courses[id];
      if (!info) return;
      var c = st.courses[id], sum = S.compute(INDEX, st, id);
      var active = sum.stepsDone > 0 || c.diary.length > 0;
      sum.modules.forEach(function (m) {
        var seg = $(card, '[data-academy-track="' + m.id + '"]');
        if (!seg) return;
        var started = m.read.done + m.scenario.done + (m.quizTaken ? 1 : 0) + m.practice.done > 0;
        seg.className = m.complete ? 'done' : started ? 'half' : '';
      });
      var meta = $(card, '[data-academy-route-meta]');
      if (meta && active) meta.textContent = sum.modulesDone + ' из ' + sum.modules.length + ' этапов · ' + sum.stepsDone + ' из ' + sum.stepsTotal +
        ' ' + plural(sum.stepsTotal, 'шага', 'шагов', 'шагов') + ' · записей в дневнике ' + sum.diaryCount;
      var cta = $(card, '[data-academy-continue]');
      if (cta && active) {
        cta.classList.remove('ac-cta-ghost');
        cta.textContent = sum.next ? 'Продолжить: ' + S.STEP_LABEL[sum.next.step] : 'Маршрут пройден — повторить';
        cta.setAttribute('href', info.href + '#module-' + (sum.next ? sum.next.moduleId : sum.modules[0].id));
      }
      if (active && c.updatedAt > 0 && (!latest || c.updatedAt > latest.c.updatedAt)) latest = { id: id, c: c, sum: sum, info: info };
    });
    var panel = $(root, '[data-academy-resume]');
    if (!panel) return;
    panel.hidden = !latest;
    if (!latest) return;
    $(panel, '[data-academy-resume-title]').textContent = 'Продолжить «' + latest.info.title + '»';
    $(panel, '[data-academy-resume-sub]').textContent = latest.sum.next
      ? latest.sum.next.label + ' · пройдено ' + latest.sum.percent + '%' : 'Маршрут пройден';
    $(panel, '[data-academy-resume-go]').setAttribute('href', latest.info.href + '#module-' + (latest.sum.next ? latest.sum.next.moduleId : latest.sum.modules[0].id));
    var fill = $(panel, '.ac-ring-fill');
    if (fill) fill.style.strokeDashoffset = String(169.65 * (1 - latest.sum.percent / 100));
  }

  function renderAll() {
    var st = state();
    each($$(document, '.ac-course[data-academy-course]'), function (r) { renderCoursePage(r, st); });
    each($$(document, '.ac-landing'), function (r) { renderLandingPage(r, st); });
  }

  // ---------- тест (поведение MVP) ----------

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
    if (courseId) change(function (st) {
      var c = st.courses[courseId];
      if (!Object.prototype.hasOwnProperty.call(c.bestScores, moduleId) || pct > c.bestScores[moduleId]) c.bestScores[moduleId] = pct;
      return courseId;
    });
    if (result) result.textContent = 'Результат: ' + right + ' из ' + qs.length + ' (' + pct + '%). ' +
      (right === qs.length ? 'Все ответы верны.' : 'Объяснения — под каждым вопросом. Тест можно пройти ещё раз, а маршрут продолжать в любом случае.');
    var retry = form.querySelector('[data-academy-retry]');
    if (retry) retry.hidden = false;
  }

  // ---------- дневник ----------

  function setChars(form, text) {
    var el = $(form, '[data-academy-diary-count-chars]');
    if (el) el.textContent = text;
  }
  function saveDiary(form) {
    var courseId = courseOf(form), moduleId = form.getAttribute('data-academy-diary');
    var ta = $(form, 'textarea');
    if (!courseId || !ta) return;
    var text = ta.value.slice(0, S.MAX_TEXT);
    if (!text.trim()) {
      setChars(form, 'Запись пустая — напиши, что получилось в матче.');
      ta.focus();
      return;
    }
    var evicted = false;
    var r = change(function (st) {
      var d = st.courses[courseId].diary;
      d.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), moduleId: moduleId, date: Date.now(), text: text });
      while (d.length > S.MAX_DIARY) {
        var oldest = 0;
        for (var i = 1; i < d.length; i++) if (d[i].date < d[oldest].date) oldest = i;
        d.splice(oldest, 1);
        evicted = true;
      }
      return courseId;
    });
    if (!r.ok) {
      setChars(form, 'Запись не сохранена в браузере — текст остался в поле.');
      return;
    }
    ta.value = '';
    setChars(form, evicted
      ? 'Сохранено. Самая старая запись удалена: в дневнике хранится до ' + S.MAX_DIARY + ' записей.'
      : 'Сохранено · 0' + CHARS_HINT);
  }

  // ---------- события ----------

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var courseId = courseOf(t);
    if (!courseId) return;
    if (t.matches('[data-academy-done]')) {
      var li = t.closest('[data-academy-lesson]');
      if (li) change(function (st) { toggleIn(st.courses[courseId].completedLessons, li.getAttribute('data-academy-lesson'), t.checked); return courseId; });
    } else if (t.matches('[data-academy-task]')) {
      change(function (st) { toggleIn(st.courses[courseId].practiceDone, t.getAttribute('data-academy-task'), t.checked); return courseId; });
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t.closest || t.tagName !== 'TEXTAREA') return;
    var form = t.closest('[data-academy-diary]');
    if (form) setChars(form, t.value.length + CHARS_HINT);
  });

  function onOpenLesson(e) {
    var a = e.target.closest && e.target.closest('[data-academy-open]');
    if (!a) return;
    var li = a.closest('[data-academy-lesson]'), courseId = courseOf(a);
    if (li && courseId) change(function (st) { st.courses[courseId].lastLessonId = li.getAttribute('data-academy-lesson'); return courseId; });
  }
  document.addEventListener('auxclick', onOpenLesson);

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var el;

    if ((el = t.closest('[data-academy-open]'))) { onOpenLesson(e); return; }

    if ((el = t.closest('[data-academy-step]'))) {
      selectTab(stageOf(el), el.getAttribute('data-academy-step'), false);
      return;
    }

    if ((el = t.closest('[data-academy-choice]'))) {
      var sit = el.closest('[data-academy-scenario]'), courseId = courseOf(el);
      var n = Number(el.getAttribute('data-academy-choice')), sid = sit.getAttribute('data-academy-scenario');
      var saved = courseId ? change(function (st) { st.courses[courseId].scenarioChoices[sid] = n; return courseId; }).ok : false;
      renderScenarioState(sit, n, saved ? 'saved' : 'memory');
      return;
    }

    if ((el = t.closest('[data-academy-sit-go]'))) {
      var stage = stageOf(el), cur = scenarioIndex(stage, el.closest('[data-academy-scenario]').getAttribute('data-academy-scenario'));
      showScenario(stage, cur + (el.getAttribute('data-academy-sit-go') === 'next' ? 1 : -1));
      return;
    }

    if ((el = t.closest('[data-academy-to-quiz]'))) {
      e.preventDefault();
      selectTab(stageOf(el), 'quiz', true);
      return;
    }

    if ((el = t.closest('[data-academy-nav]'))) {
      e.preventDefault();
      var id = el.getAttribute('data-academy-nav');
      goTo(openStage(id));
      if (window.history && history.replaceState) history.replaceState(null, '', '#module-' + id);
      return;
    }

    if ((el = t.closest('.ac-course [data-academy-continue]'))) {
      e.preventDefault();
      goToNextStep(el.closest('.ac-course'));
      return;
    }

    if ((el = t.closest('[data-academy-diary-del]'))) {
      var cid = courseOf(el), entry = el.getAttribute('data-academy-diary-del');
      if (cid) change(function (st) {
        st.courses[cid].diary = st.courses[cid].diary.filter(function (x) { return x.id !== entry; });
        return cid;
      });
      return;
    }

    if ((el = t.closest('[data-academy-reset]'))) {
      var rid = courseOf(el);
      if (!rid) return;
      var ok = false;
      try {
        ok = window.confirm('Сбросить прогресс маршрута «' + INDEX.courses[rid].title + '»? Удалятся отметки уроков и заданий, ответы в ситуациях, результаты тестов и записи дневника этого маршрута. Другой маршрут не изменится.');
      } catch (err) { ok = false; }
      if (!ok) return;
      // null: не проставлять updatedAt, чтобы сброшенный маршрут не попал в панель «Продолжить».
      change(function (st) { st.courses[rid] = S.emptyCourse(); return null; });
      var root = el.closest('[data-academy-course]');
      each($$(root, '[data-academy-quiz]'), function (f) {
        f.reset();
        clearQuizFeedback(f);
        var r = $(f, '[data-academy-result]'); if (r) r.textContent = '';
        var rt = $(f, '[data-academy-retry]'); if (rt) rt.hidden = true;
      });
      each($$(root, '[data-academy-sit-live]'), function (l) { l.textContent = ''; });
      return;
    }

    if ((el = t.closest('[data-academy-retry]'))) {
      var form = el.closest('[data-academy-quiz]');
      if (!form) return;
      form.reset();
      clearQuizFeedback(form);
      var res = $(form, '[data-academy-result]'); if (res) res.textContent = 'Ответы очищены — можно пройти тест ещё раз.';
      el.hidden = true;
      var first = $(form, 'input[type=radio]'); if (first) first.focus();
    }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t.matches || !t.matches('[data-academy-step]')) return;
    var keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var stage = stageOf(t), i = STEPS.indexOf(t.getAttribute('data-academy-step'));
    var k = keys[e.key];
    i = k === 'first' ? 0 : k === 'last' ? STEPS.length - 1 : (i + k + STEPS.length) % STEPS.length;
    selectTab(stage, STEPS[i], true);
  });

  document.addEventListener('submit', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var quiz = t.closest('[data-academy-quiz]');
    if (quiz) { e.preventDefault(); gradeQuiz(quiz); return; }
    var diary = t.closest('[data-academy-diary]');
    if (diary) { e.preventDefault(); saveDiary(diary); }
  });

  window.addEventListener('storage', function (e) {
    if (e.key === S.KEY || e.key === null) renderAll();
  });

  // ---------- переходы к шагу ----------

  function focusItem(stage, step, itemId) {
    var el = null;
    if (step === 'read') el = $(stage, '#lesson-' + itemId + ' [data-academy-done]');
    else if (step === 'practice') el = $(stage, '[data-academy-task="' + itemId + '"]');
    else if (step === 'scenario') el = $(stage, '[data-academy-scenario="' + itemId + '"] [data-academy-choice]');
    else el = $(stage, '[data-academy-step="quiz"]');
    if (el) { try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); } }
  }
  function goToNextStep(root) {
    var id = root.getAttribute('data-academy-course');
    var sum = S.compute(INDEX, state(), id);
    var next = sum.next || { moduleId: sum.modules[0].id, step: 'read', itemId: null };
    var stage = openStage(next.moduleId);
    if (!stage) return;
    selectTab(stage, next.step, false);
    if (next.step === 'scenario') showScenario(stage, scenarioIndex(stage, next.itemId));
    goTo(stage);
    if (next.itemId) focusItem(stage, next.step, next.itemId);
  }

  // ---------- старт ----------

  function initCourse(root) {
    var id = root.getAttribute('data-academy-course');
    if (!INDEX.courses[id]) return;
    var st = state(), c = st.courses[id], sum = S.compute(INDEX, st, id);
    var hash = hashId();
    var target = sum.next ? sum.next.moduleId : sum.modules[0].id, targetStep = null, focusEl = null;
    if (/^lesson-/.test(hash)) {
      var li = document.getElementById(hash);
      var st0 = li && stageOf(li);
      if (st0) { target = st0.getAttribute('data-academy-module'); targetStep = 'read'; focusEl = li; }
    } else if (/^module-/.test(hash) && document.getElementById(hash)) {
      target = hash.slice(7);
      focusEl = document.getElementById(hash);
    }
    sum.modules.forEach(function (m) {
      var stage = document.getElementById('module-' + m.id);
      if (!stage) return;
      stage.open = m.id === target;
      selectTab(stage, m.id === target && targetStep ? targetStep : (m.step || 'read'), false);
      // Первая неразобранная ситуация этапа, иначе первая.
      var sits = $$(stage, '[data-academy-scenario]'), firstOpen = 0;
      for (var i = sits.length - 1; i >= 0; i--) {
        if (!Object.prototype.hasOwnProperty.call(c.scenarioChoices, sits[i].getAttribute('data-academy-scenario'))) firstOpen = i;
      }
      showScenario(stage, firstOpen);
    });
    renderAll();
    if (focusEl) goTo(focusEl);
  }

  // Смена только хеша на той же странице (ссылка на этап или урок, «Назад»):
  // браузер не раскрывает свёрнутый этап, если ссылка ведёт на сам этап,
  // и не показывает урок из неактивной вкладки — делаем это сами.
  window.addEventListener('hashchange', function () {
    var hash = hashId(), el = hash && document.getElementById(hash);
    if (!el || !el.closest('.ac-course')) return;
    var stage = /^lesson-/.test(hash) ? stageOf(el) : /^module-/.test(hash) ? el : null;
    if (!stage) return;
    stage.open = true;
    if (/^lesson-/.test(hash)) selectTab(stage, 'read', false);
    goTo(el);
  });

  each($$(document, '.ac-course[data-academy-course]'), initCourse);
  if ($(document, '.ac-landing')) renderAll();
})();
