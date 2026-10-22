// Учебный центр: «Тренировка» (/academy/practice/) — интерфейс.
// Банк заданий кладёт в страницу сборщик (tools/academy-render.js → practiceBank): все вопросы
// тестов и игровые ситуации всех маршрутов. Статистика ответов — js/academy-records.js (drill).
//
// Режимы:
//   mix      — 10 заданий из всех маршрутов, сначала невиданные, затем те, что знаешь хуже;
//   mistakes — задания, где последний ответ был неверным или верных подряд меньше двух после ошибки;
//   topic    — 10 заданий одного маршрута с разбором после каждого;
//   exam     — до 15 заданий маршрута, разбор в конце; сдан от EXAM_PASS %.
// Уровень знания задания — «коробка» 0…4 (система Лейтнера): верно — +1, ошибка — 0.
(function () {
  'use strict';
  const root = document.querySelector('[data-academy-practice]');
  const R = window.DMAcademyRecords;
  if (!root || !R) return;
  let BANK;
  try { BANK = JSON.parse(document.getElementById('academyBank').textContent); } catch (e) { return; }
  if (!BANK || !Array.isArray(BANK.items) || !BANK.items.length) return;
  document.documentElement.classList.add('ac-js');

  const SET = 10, EXAM = 15, EXAM_PASS = 80;
  const LETTERS = ['A', 'B', 'C'];
  const $ = s => root.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
  const byId = new Map(BANK.items.map(x => [x.id, x]));
  const routeTitle = id => (BANK.routes.find(r => r.id === id) || {}).title || id;

  function note(ok) {
    const n = $('[data-academy-storage]');
    if (n && !ok) { n.textContent = 'Браузер не разрешает сайту хранить данные: статистика тренировки пропадёт после перезагрузки страницы.'; n.hidden = false; }
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Сначала невиданные, потом по уровню знания (меньше — раньше); внутри — случайно.
  function pick(pool, n, st) {
    const score = x => { const v = st.items[x.id]; return v ? 1 + v.box : 0; };
    return shuffle(pool.slice()).sort((a, b) => score(a) - score(b)).slice(0, n);
  }
  function isMistake(v) { return v && v.w > 0 && (!v.lastOk || v.box < 2); }

  // ---------- статистика ----------
  function renderStats() {
    const st = R.drill.load().state;
    let seen = 0, r = 0, w = 0, due = 0;
    Object.keys(st.items).forEach(id => {
      if (!byId.has(id)) return;
      const v = st.items[id];
      seen++; r += v.r; w += v.w;
      if (isMistake(v)) due++;
    });
    const set = (k, v) => { const el = $(`[data-dr-stat="${k}"]`); if (el) el.textContent = v; };
    set('seen', `${seen} из ${BANK.items.length}`);
    set('acc', r + w ? Math.round(r / (r + w) * 100) + ' %' : '—');
    set('due', String(due));
    set('streak', String(R.streak(st.days)));
    const mm = $('[data-dr-mistakes]');
    if (mm) mm.textContent = due ? `${due} ${plural(due, 'задание', 'задания', 'заданий')} ждут повторения — пока не ответишь верно дважды подряд.` : 'Ошибок к повторению нет. Сюда попадут задания, где ты ошибёшься.';
    const ex = $('[data-dr-exams]');
    if (ex) ex.innerHTML = Object.keys(st.exams).filter(id => BANK.routes.some(x => x.id === id)).map(id => {
      const e = st.exams[id];
      return `<li><b>${esc(routeTitle(id))}</b> — экзамен: лучший ${e.best}&nbsp;%${e.best >= EXAM_PASS ? ' · <span class="ac-ok">✓ сдан</span>' : ''}</li>`;
    }).join('');
  }

  // ---------- запуск ----------
  let run = null;   // { mode, course, items, i, answers: [n|null] }
  function msg(t) { const m = $('[data-dr-msg]'); if (m) m.textContent = t || ''; }
  function start(mode, course) {
    const st = R.drill.load().state;
    let pool = BANK.items, items;
    if (course) pool = pool.filter(x => x.course === course);
    if (mode === 'mistakes') {
      items = shuffle(pool.filter(x => isMistake(st.items[x.id]))).slice(0, SET);
      if (!items.length) { msg('Ошибок к повторению нет — начни со случайных заданий.'); return; }
    } else if (mode === 'exam') items = shuffle(pool.slice()).slice(0, EXAM);
    else items = pick(pool, SET, st);
    msg('');
    run = { mode, course, items, i: 0, answers: items.map(() => null) };
    $('[data-dr-setup]').hidden = true;
    renderRun();
  }

  // Ответ: в обычном режиме — сразу запись и разбор, на экзамене — запись и следующий вопрос.
  function answer(n) {
    const it = run.items[run.i];
    if (run.answers[run.i] !== null) return;
    run.answers[run.i] = n;
    const ok = n === it.best;
    const r = R.drill.mutate(st => {
      const v = st.items[it.id] || { r: 0, w: 0, box: 0, last: 0, lastOk: false };
      if (ok) { v.r++; v.box = Math.min(4, v.box + 1); } else { v.w++; v.box = 0; }
      v.last = Date.now(); v.lastOk = ok;
      st.items[it.id] = v;
      const d = R.today();
      if (st.days.indexOf(d) === -1) { st.days.push(d); st.days.sort(); st.days = st.days.slice(-120); }
    });
    note(r.ok);
    if (run.mode === 'exam') { next(); return; }
    renderRun();
  }
  function next() {
    run.i++;
    if (run.i >= run.items.length) { finish(); return; }
    renderRun();
  }

  function sources(it) {
    const src = it.sources.length ? `Источник: ${it.sources.map(s => `<a href="/guide/${esc(s.slug)}/">«${esc(s.title)}»</a>`).join(', ')}${it.checked ? ', ' + esc(it.checked) : ''} · ` : '';
    return `${src}Урок: <a href="${esc(it.href)}">${esc(it.stage)}</a>`;
  }
  function feedback(it, n) {
    const ok = n === it.best;
    let html = `<p class="ac-dr-verdict ${ok ? 'is-ok' : 'is-bad'}">${ok ? '✓ Верно.' : `✗ Неверно. Лучший ответ — ${LETTERS[it.best]}.`}</p>`;
    if (it.kind === 'q') html += `<p>${esc(it.explain)}</p>`;
    else {
      if (!ok) html += `<p><b>Твой выбор (${LETTERS[n]}).</b> ${esc(it.feedback[n])}</p>`;
      html += `<p><b>${ok ? 'Почему' : 'Лучше (' + LETTERS[it.best] + ')'}.</b> ${esc(it.feedback[it.best])}</p>`;
    }
    return html + `<p class="ac-src">${sources(it)}</p>`;
  }
  function card(it, i, chosen, reveal) {
    const opts = it.options.map((o, k) => {
      const cls = reveal && chosen !== null ? (k === it.best ? ' is-best' : k === chosen ? ' is-wrong' : '') : '';
      return `<button type="button" class="ac-opt${cls}" data-dr-answer="${k}" aria-pressed="${chosen === k}"${chosen !== null ? ' disabled' : ''}>` +
        `<i aria-hidden="true">${LETTERS[k]}</i><span class="ac-opt-text"><span class="ac-sr">${LETTERS[k]}. </span>${esc(o)}</span></button>`;
    }).join('');
    return `<article class="ac-sit ac-dr-card"><p class="ac-sit-head"><b>${it.kind === 's' ? 'Ситуация' : 'Вопрос'}</b>${it.context ? `<span>${esc(it.context)}</span>` : ''}<span>${esc(routeTitle(it.course))}</span></p>` +
      `<p class="ac-sit-q" id="dr-q-${i}">${esc(it.prompt)}</p><div class="ac-opts" role="group" aria-labelledby="dr-q-${i}">${opts}</div>` +
      (reveal && chosen !== null ? `<div class="ac-dr-fb">${feedback(it, chosen)}</div>` : '') + `</article>`;
  }
  function renderRun() {
    const box = $('[data-dr-run]');
    const it = run.items[run.i], chosen = run.answers[run.i], n = run.items.length;
    const title = run.mode === 'exam' ? `Экзамен · ${esc(routeTitle(run.course))}` : run.mode === 'mistakes' ? 'Работа над ошибками' : run.mode === 'topic' ? esc(routeTitle(run.course)) : 'Случайные задания';
    box.hidden = false;
    box.innerHTML = `<div class="ac-dr-top"><h2 class="ac-card-h">${title}</h2><span>Задание ${run.i + 1} из ${n}</span>` +
      `<button type="button" class="ac-link-btn" data-dr-quit>Закончить</button></div>` +
      `<div class="ac-dr-bar" aria-hidden="true"><i style="width:${(run.i / n * 100).toFixed(1)}%"></i></div>` +
      card(it, run.i, chosen, run.mode !== 'exam') +
      (chosen !== null && run.mode !== 'exam' ? `<div class="ac-dr-next"><button type="button" class="ac-cta ac-cta-sm" data-dr-next>${run.i + 1 < n ? 'Дальше →' : 'Итог'}</button></div>` : '');
    const focusEl = chosen !== null ? box.querySelector('[data-dr-next]') : box.querySelector('.ac-sit-q');
    if (focusEl) { if (!focusEl.matches('button')) focusEl.tabIndex = -1; try { focusEl.focus({ preventScroll: chosen === null }); } catch (e) { focusEl.focus(); } }
    if (chosen === null && run.i === 0) box.scrollIntoView({ block: 'start' });
  }

  function finish() {
    const n = run.items.length;
    const right = run.items.filter((it, i) => run.answers[i] === it.best).length;
    const pctv = Math.round(right / n * 100);
    let head = `<p class="ac-dr-score"><b>${right} из ${n}</b> · ${pctv}&nbsp;%</p>`;
    if (run.mode === 'exam') {
      let prev = null;
      const r = R.drill.mutate(st => {
        prev = st.exams[run.course] ? st.exams[run.course].best : null;
        st.exams[run.course] = { best: Math.max(prev || 0, pctv), last: pctv, date: Date.now() };
      });
      note(r.ok);
      head += `<p class="ac-dr-verdict ${pctv >= EXAM_PASS ? 'is-ok' : 'is-bad'}">${pctv >= EXAM_PASS ? `✓ Экзамен по маршруту «${esc(routeTitle(run.course))}» сдан.` : `Пока не сдан: нужно от ${EXAM_PASS}&nbsp;%. Повтори этапы с ошибками и попробуй ещё раз.`}` +
        `${prev !== null ? ` Лучший результат раньше — ${prev}&nbsp;%.` : ''}</p>`;
    }
    const wrong = run.items.map((it, i) => [it, run.answers[i]]).filter(([it, a]) => a !== it.best);
    const review = run.mode === 'exam'
      ? `<h3 class="ac-mr-h">Разбор всех заданий</h3>` + run.items.map((it, i) => card(it, i, run.answers[i], true)).join('')
      : wrong.length ? `<h3 class="ac-mr-h">Где ошибся</h3><ul class="ac-dr-wrong">${wrong.map(([it]) => `<li>${esc(it.prompt)} <a href="${esc(it.href)}">${esc(it.stage)} →</a></li>`).join('')}</ul>` : '<p class="ac-mr-ok">Без ошибок — отличный подход.</p>';
    const box = $('[data-dr-run]');
    box.innerHTML = `<div class="ac-dr-top"><h2 class="ac-card-h">Итог</h2></div>${head}${review}` +
      `<div class="ac-mr-actions"><button type="button" class="ac-cta ac-cta-sm" data-dr-again>${run.mode === 'exam' ? 'Пересдать' : 'Ещё подход'}</button>` +
      `<button type="button" class="ac-cta ac-cta-sm ac-cta-ghost" data-dr-mode="mistakes">Работа над ошибками</button>` +
      `<button type="button" class="ac-cta ac-cta-sm ac-cta-ghost" data-dr-back>Выбрать режим</button></div>`;
    renderStats();
    try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
    box.scrollIntoView({ block: 'start' });
  }
  function back() {
    run = null;
    $('[data-dr-run]').hidden = true;
    $('[data-dr-setup]').hidden = false;
    renderStats();
  }

  // ---------- события ----------
  let pending = null;   // режим, ждущий выбора маршрута
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.matches('[data-dr-mode]')) {
      const mode = t.getAttribute('data-dr-mode');
      root.querySelectorAll('.ac-mode').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
      if (mode === 'topic' || mode === 'exam') {
        if (run) back();
        pending = mode;
        const wrap = $('[data-dr-route-wrap]');
        wrap.hidden = false;
        $('[data-dr-start]').textContent = mode === 'exam' ? 'Начать экзамен' : 'Начать';
        $('#dr-route').focus();
        return;
      }
      $('[data-dr-route-wrap]').hidden = true;
      if (run) back();
      start(mode, null);
      return;
    }
    if (t.matches('[data-dr-start]') && pending) { start(pending, $('#dr-route').value); return; }
    if (t.matches('[data-dr-answer]') && run) { answer(Number(t.getAttribute('data-dr-answer'))); return; }
    if (t.matches('[data-dr-next]') && run) { next(); return; }
    if (t.matches('[data-dr-quit]')) { if (run && run.answers.some(a => a !== null) && run.mode !== 'exam') { run.items = run.items.slice(0, run.answers.filter(a => a !== null).length); finish(); } else back(); return; }
    if (t.matches('[data-dr-again]') && run) { const m = run.mode, c = run.course; back(); start(m, c); return; }   // back(): сообщение «ошибок нет» видно в выборе режима
    if (t.matches('[data-dr-back]')) { back(); return; }
    if (t.matches('[data-dr-reset]')) {
      let ok = false;
      try { ok = window.confirm('Сбросить статистику тренировки? Удалятся ответы, ошибки к повторению, серия дней и результаты экзаменов. Прогресс маршрутов и разборы матчей не изменятся.'); } catch (err) { ok = false; }
      if (!ok) return;
      note(R.drill.mutate(st => { st.items = {}; st.exams = {}; st.days = []; }).ok);
      back();
    }
  });
  window.addEventListener('storage', e => { if (e.key === R.KEY_D || e.key === null) renderStats(); });

  // ?mode=exam&route=carry — ссылки с карточек маршрутов.
  const q = new URLSearchParams(location.search);
  const qm = q.get('mode'), qr = q.get('route');
  if (qr && BANK.routes.some(r => r.id === qr)) $('#dr-route').value = qr;
  renderStats();
  if (qm === 'mistakes' || qm === 'mix') start(qm, null);
  else if ((qm === 'exam' || qm === 'topic') && qr && BANK.routes.some(r => r.id === qr)) start(qm, qr);
})();
