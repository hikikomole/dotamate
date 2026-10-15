// Разметка Учебного центра (/academy/) для build-pages.js.
// Данные курсов — academy-content.js; поведение в браузере — js/academy.js.
//
// Всё рисуется на сборке: уроки, ссылки на гайды и вопросы тестов лежат в HTML,
// поэтому их видит поисковый робот, а страница работает и без JavaScript
// (без него не сохраняются отметки и не проверяются тесты).
//
// Сборка падает с понятной ошибкой, если урок ссылается на несуществующий гайд
// или в данных курса нарушена структура — лучше остановить сборку, чем выложить
// битую ссылку или тест без правильного ответа.
'use strict';

const path = require('path');

const ROOT = path.dirname(__dirname);
// Та же скорость чтения, что у карточек каталога /guides/ (build-pages.js, READ_WPM).
const READ_WPM = 180;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Слова всех текстов статьи — как wordsIn() в build-pages.js.
function wordsIn(x) {
  if (typeof x === 'string') return (x.match(/[0-9A-Za-zА-Яа-яЁё]+/g) || []).length;
  if (Array.isArray(x)) return x.reduce((s, v) => s + wordsIn(v), 0);
  if (x && typeof x === 'object') return Object.keys(x).filter(k => !['slug', 'icon', 'action', 'cat', 'role'].includes(k)).reduce((s, k) => s + wordsIn(x[k]), 0);
  return 0;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

let guideCache = null;
function guides() {
  if (!guideCache) {
    guideCache = new Map();
    for (const g of require(path.join(ROOT, 'guide-content.js'))) guideCache.set(g.slug, g);
  }
  return guideCache;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function need(cond, where, msg) {
  if (!cond) throw new Error(`Учебный центр: ${where}: ${msg}`);
}
function text(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// Проверяет курс целиком. Ошибка называет курс, этап и проблемный урок или гайд.
function validateCourse(course) {
  const c = `курс «${course && course.id}»`;
  need(course && ID_RE.test(course.id || ''), c, 'id курса — латиница, цифры и дефисы');
  need(ID_RE.test(course.slug || ''), c, 'slug курса — латиница, цифры и дефисы');
  for (const k of ['title', 'audience', 'description']) need(text(course[k]), c, `пустое поле ${k}`);
  need(Array.isArray(course.modules) && course.modules.length > 0, c, 'нет этапов');
  const moduleIds = new Set(), lessonIds = new Set(), questionIds = new Set(), scenarioIds = new Set();
  for (const m of course.modules) {
    const w = `${c}, этап «${m && m.id}»`;
    need(m && ID_RE.test(m.id || ''), w, 'id этапа — латиница, цифры и дефисы');
    need(!moduleIds.has(m.id), w, 'id этапа повторяется');
    moduleIds.add(m.id);
    need(text(m.title) && text(m.intro), w, 'нет названия или вступления');
    need(Array.isArray(m.lessons) && m.lessons.length > 0, w, 'нет уроков');
    for (const l of m.lessons) {
      const lw = `${w}, урок «${l && l.id}»`;
      need(l && ID_RE.test(l.id || ''), lw, 'id урока — латиница, цифры и дефисы');
      need(!lessonIds.has(l.id), lw, 'id урока повторяется в курсе');
      lessonIds.add(l.id);
      for (const k of ['title', 'summary', 'practice']) need(text(l[k]), lw, `пустое поле ${k}`);
      need(text(l.guideSlug) && guides().has(l.guideSlug), lw, `гайд «${l.guideSlug}» не найден в guide-content.js`);
    }
    need(Array.isArray(m.quiz) && m.quiz.length > 0, w, 'нет вопросов теста');
    for (const q of m.quiz) {
      const qw = `${w}, вопрос «${q && q.id}»`;
      need(q && ID_RE.test(q.id || ''), qw, 'id вопроса — латиница, цифры и дефисы');
      need(!questionIds.has(q.id), qw, 'id вопроса повторяется в курсе');
      questionIds.add(q.id);
      need(text(q.prompt) && text(q.explanation), qw, 'нет текста вопроса или объяснения');
      need(Array.isArray(q.choices) && q.choices.length === 3 && q.choices.every(text), qw, 'нужно ровно три непустых варианта ответа');
      need(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 3, qw, 'correctIndex должен быть 0, 1 или 2');
      need(q.checked === undefined || (text(q.checked) && guides().has(q.sourceSlug)), qw, `у патч-зависимого вопроса нет даты проверки или гайд-источник «${q.sourceSlug}» не найден`);
    }
    need(Array.isArray(m.scenarios) && m.scenarios.length === 2, w, 'нужно ровно 2 ситуации (scenarios)');
    m.scenarios.forEach((s, si) => {
      const sw = `${w}, ситуация «${s && s.id}»`;
      need(s && s.id === `${m.id}-s${si + 1}`, sw, `id ситуации должен быть ${m.id}-s${si + 1}`);
      need(!scenarioIds.has(s.id), sw, 'id ситуации повторяется в курсе');
      scenarioIds.add(s.id);
      need(text(s.context) && text(s.prompt), sw, 'пустой контекст или текст ситуации');
      need(Array.isArray(s.options) && s.options.length === 3, sw, 'нужно ровно три варианта');
      s.options.forEach((o, oi) => need(o && text(o.text) && text(o.feedback), sw, `вариант ${oi + 1}: пустой текст или разбор`));
      need(Number.isInteger(s.bestIndex) && s.bestIndex >= 0 && s.bestIndex < 3, sw, 'bestIndex должен быть 0, 1 или 2');
      need(Array.isArray(s.sources) && s.sources.length >= 1 && s.sources.length <= 2, sw, 'sources — 1–2 гайда');
      s.sources.forEach(g => need(guides().has(g), sw, `гайд «${g}» не найден в guide-content.js`));
      need(s.checked === undefined || text(s.checked), sw, 'поле checked пустое');
    });
  }
  return course;
}

function validateCourses(courses) {
  need(Array.isArray(courses) && courses.length > 0, 'COURSES', 'нет курсов');
  const ids = new Set(), slugs = new Set();
  for (const c of courses) {
    validateCourse(c);
    need(!ids.has(c.id), `курс «${c.id}»`, 'id курса повторяется');
    need(!slugs.has(c.slug), `курс «${c.id}»`, 'slug курса повторяется');
    ids.add(c.id); slugs.add(c.slug);
  }
  return courses;
}

function guideHref(slug) {
  return `/guide/${encodeURIComponent(slug)}/`;
}
function lessonMinutes(l) {
  return Math.max(1, Math.ceil(wordsIn(guides().get(l.guideSlug)) / READ_WPM));
}
function courseLessons(course) {
  return course.modules.flatMap(m => m.lessons);
}
function courseMinutes(course) {
  return courseLessons(course).reduce((s, l) => s + lessonMinutes(l), 0);
}
function courseHref(course) {
  return `/academy/${encodeURIComponent(course.slug)}/`;
}
function lessonAnchor(l) {
  return `lesson-${l.id}`;
}
function duration(min) {
  if (min < 60) return `≈&nbsp;${min}&nbsp;мин чтения`;
  const h = Math.floor(min / 60), m = min % 60;
  return `≈&nbsp;${h}&nbsp;ч${m ? `&nbsp;${m}&nbsp;мин` : ''} чтения`;
}

// Шаги этапа — в этом порядке их проходит посетитель и считает js/academy-store.js.
const STEPS = [
  { key: 'read', label: 'Прочитай' },
  { key: 'scenario', label: 'Разбери ситуацию' },
  { key: 'quiz', label: 'Проверь себя' },
  { key: 'practice', label: 'Сыграй и запиши' },
];
const LETTERS = ['A', 'B', 'C'];

// Шаги маршрута: уроки + ситуации + по тесту на этап + задания (одно на урок).
function courseSteps(course) {
  return course.modules.reduce((s, m) => s + m.lessons.length * 2 + m.scenarios.length + 1, 0);
}
function courseScenarios(course) {
  return course.modules.reduce((s, m) => s + m.scenarios.length, 0);
}

// Справочник ID для js/academy-store.js: по нему браузер проверяет сохранённый
// прогресс (неизвестные ID отбрасываются) и считает шаги. Кладётся на все
// страницы центра, чтобы сохранение с одной страницы не стирало прогресс
// другого маршрута.
function renderIndex(courses) {
  const data = { version: 2, courses: {} };
  for (const c of validateCourses(courses)) {
    data.courses[c.id] = {
      title: c.title,
      href: courseHref(c),
      modules: c.modules.map(m => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map(l => ({ id: l.id, title: l.title })),
        scenarios: m.scenarios.map(s => s.id),
        quiz: true,
      })),
    };
  }
  return `<script type="application/json" id="academyIndex">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// Кольцо прогресса: r=27 → длина окружности 169.65; заполнение задаёт JS.
function ring(size) {
  return `<svg class="ac-ring" data-academy-ring width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">` +
    `<circle cx="32" cy="32" r="27" class="ac-ring-bg"/>` +
    `<circle cx="32" cy="32" r="27" class="ac-ring-fill" stroke-dasharray="169.65" stroke-dashoffset="169.65" transform="rotate(-90 32 32)"/></svg>`;
}

function renderStageNav(course) {
  const items = course.modules.map((m, i) =>
    `<li><a href="#module-${esc(m.id)}" data-academy-nav="${esc(m.id)}"><span class="ac-dot">${i + 1}</span>` +
    `<span><strong>${esc(m.title)}</strong><small data-academy-nav-state>${m.lessons.length}&nbsp;${plural(m.lessons.length, 'урок', 'урока', 'уроков')}</small></span></a></li>`).join('');
  const chips = course.modules.map((m, i) =>
    `<a href="#module-${esc(m.id)}" data-academy-nav="${esc(m.id)}"><span class="ac-dot">${i + 1}</span>${esc(m.title)}</a>`).join('');
  return {
    side: `<nav class="ac-side" aria-label="Этапы маршрута"><p class="ac-h">Этапы маршрута</p><ol>${items}</ol>` +
      `<p class="ac-side-foot"><span aria-hidden="true">📓</span> <span data-academy-diary-count>Дневник пока пуст</span></p></nav>`,
    chips: `<nav class="ac-chiprow" aria-label="Этапы маршрута (лента)">${chips}</nav>`,
  };
}

function renderLessonRow(l) {
  const g = guides().get(l.guideSlug);
  const a = lessonAnchor(l);
  return `<li class="ac-lesson" id="${esc(a)}" data-academy-lesson="${esc(l.id)}">` +
    `<input type="checkbox" class="ac-check" data-academy-done aria-label="Урок пройден: ${esc(l.title)}">` +
    `<div class="ac-lesson-main"><strong id="${esc(a)}-title">${esc(l.title)}</strong> <span class="ac-tag" data-academy-badge></span>` +
    `<span class="ac-lesson-sum">${esc(l.summary)}</span></div>` +
    `<span class="ac-time">${lessonMinutes(l)}&nbsp;мин</span>` +
    `<a class="ac-open" href="${guideHref(l.guideSlug)}" data-academy-open>Открыть<span class="ac-sr">: ${esc(g.title)}</span></a>` +
    `</li>`;
}

function renderScenario(s, i, total) {
  const opts = s.options.map((o, n) =>
    `<button type="button" class="ac-opt" data-academy-choice="${n}" aria-pressed="false"><i aria-hidden="true">${LETTERS[n]}</i>` +
    `<span class="ac-opt-text"><span class="ac-sr">${LETTERS[n]}. </span>${esc(o.text)}</span>` +
    `<span class="ac-opt-fb" data-academy-opt-fb hidden></span></button>`).join('');
  const reveal = s.options.map((o, n) =>
    `<li data-academy-feedback="${n}"><b>${LETTERS[n]}${n === s.bestIndex ? ' — лучший вариант' : ''}.</b> <span>${esc(o.feedback)}</span></li>`).join('');
  const src = s.sources.map(g => `<a href="${guideHref(g)}">«${esc(guides().get(g).title)}»</a>`).join(', ');
  return `<article class="ac-sit" data-academy-scenario="${esc(s.id)}" data-best="${s.bestIndex}" aria-labelledby="${esc(s.id)}-q">` +
    `<p class="ac-sit-head"><b>Ситуация ${i + 1} из ${total}</b><span>${esc(s.context)}</span></p>` +
    `<p class="ac-sit-q" id="${esc(s.id)}-q">${esc(s.prompt)}</p>` +
    `<div class="ac-opts" role="group" aria-label="Варианты действий">${opts}</div>` +
    `<p class="ac-sit-live" data-academy-sit-live aria-live="polite"></p>` +
    `<details class="ac-sit-reveal"><summary>Показать разбор</summary><ol>${reveal}</ol></details>` +
    `<p class="ac-src">Источник: ${src}${s.checked ? `, ${esc(s.checked)}` : ''}.</p>` +
    `<div class="ac-sit-nav"><button type="button" class="ac-link-btn" data-academy-sit-go="prev">← Предыдущая</button>` +
    `<button type="button" class="ac-link-btn" data-academy-sit-go="next">Следующая →</button>` +
    `<a class="ac-cta ac-cta-sm" href="#" data-academy-to-quiz>К тесту →</a></div>` +
    `</article>`;
}

function renderPractice(m) {
  const tasks = m.lessons.map(l =>
    `<li class="ac-task"><label><input type="checkbox" class="ac-check" data-academy-task="${esc(l.id)}"><span>${esc(l.practice)}</span></label></li>`).join('');
  return `<div class="ac-two">` +
    `<div class="ac-box"><p class="ac-h">Задания на следующий матч</p><ul class="ac-tasks">${tasks}</ul></div>` +
    `<form class="ac-box ac-diary" data-academy-diary="${esc(m.id)}">` +
    `<label class="ac-h" for="diary-${esc(m.id)}">Дневник этапа</label>` +
    `<p class="ac-nojs">Дневник и отметки работают при включённом JavaScript.</p>` +
    `<textarea id="diary-${esc(m.id)}" name="text" maxlength="500" rows="3" placeholder="Что получилось в матче, а что нет?" aria-describedby="diary-${esc(m.id)}-c"></textarea>` +
    `<div class="ac-row"><span id="diary-${esc(m.id)}-c" data-academy-diary-count-chars>0 / 500 · только в этом браузере</span>` +
    `<button type="submit" class="ac-cta ac-cta-sm">Сохранить запись</button></div>` +
    `<ol class="ac-entries" data-academy-diary-list></ol>` +
    `</form></div>`;
}

function renderStage(m, i) {
  const panels = {
    read: `<ol class="ac-lessons">${m.lessons.map(renderLessonRow).join('')}</ol>`,
    scenario: m.scenarios.map((s, n) => renderScenario(s, n, m.scenarios.length)).join(''),
    quiz: renderQuiz(m, i),
    practice: renderPractice(m),
  };
  const tabs = STEPS.map((st, n) =>
    `<button type="button" class="ac-step" role="tab" id="${esc(m.id)}-${st.key}-tab" data-academy-step="${st.key}" aria-controls="${esc(m.id)}-${st.key}" aria-selected="false">` +
    `<i aria-hidden="true">${n + 1}</i><span>${st.label}<small data-academy-step-count></small></span></button>`).join('');
  const sections = STEPS.map((st, n) =>
    `<section class="ac-panel" role="tabpanel" id="${esc(m.id)}-${st.key}" data-academy-panel="${st.key}" aria-labelledby="${esc(m.id)}-${st.key}-tab">` +
    `<h3 class="ac-panel-title">Шаг ${n + 1} · ${st.label}</h3>${panels[st.key]}</section>`).join('');
  return `<details class="ac-stage" id="module-${esc(m.id)}" data-academy-module="${esc(m.id)}" open>` +
    `<summary><span class="ac-num">Этап ${i + 1}</span><span class="ac-stage-main"><span class="ac-stage-title">${esc(m.title)}</span>` +
    `<span class="ac-stats"><span class="ac-stat" data-academy-stat="read">Чтение 0/${m.lessons.length}</span>` +
    `<span class="ac-stat" data-academy-stat="scenario">Ситуации 0/${m.scenarios.length}</span>` +
    `<span class="ac-stat" data-academy-stat="quiz">Тест —</span>` +
    `<span class="ac-stat" data-academy-stat="practice">Практика 0/${m.lessons.length}</span></span></span>` +
    `<span class="ac-stage-badge" data-academy-stage-badge></span><span class="ac-chev" aria-hidden="true">⌄</span></summary>` +
    `<div class="ac-stage-body"><p class="ac-intro">${esc(m.intro)}</p>` +
    `<div class="ac-steps" role="tablist" aria-label="Шаги этапа ${i + 1}">${tabs}</div>${sections}</div>` +
    `</details>`;
}

function renderCourse(course, opts = {}) {
  validateCourse(course);
  const lessons = courseLessons(course);
  const scen = courseScenarios(course);
  const steps = courseSteps(course);
  const nav = renderStageNav(course);
  const patch = opts.patch && text(opts.patch.version)
    ? ` Изменения последнего патча — на странице <a href="/patch/${encodeURIComponent(opts.patch.version)}/">«Патч ${esc(opts.patch.version)}»</a>.`
    : '';
  return `<div class="ac-course${course.group === 'role' ? ' ac-course-role' : ''}" data-academy-course="${esc(course.id)}">` + renderSubnav('routes') +
    `<section class="ac-hero"><div class="ac-hero-main">` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · ${course.group === 'role' ? `маршрут по роли · ${esc(course.kicker)}` : 'маршрут'}</p>` +
    `<h1 class="page-title">${esc(course.title)}</h1>` +
    `<p class="ac-lead">${esc(course.description)}</p><p class="ac-for">${esc(course.audience)}</p>` +
    `<ul class="ac-facts"><li>${course.modules.length}&nbsp;${plural(course.modules.length, 'этап', 'этапа', 'этапов')}</li>` +
    `<li>${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')}</li>` +
    `<li>${scen}&nbsp;${plural(scen, 'ситуация', 'ситуации', 'ситуаций')}</li><li>${duration(courseMinutes(course))}</li></ul>` +
    `</div><div class="ac-next">` +
    `<div class="ac-ring-row">${ring(64)}<div><b data-academy-percent>0%</b><span data-academy-summary>0 из ${steps} ${plural(steps, 'шага', 'шагов', 'шагов')}</span></div></div>` +
    `<a class="ac-cta" href="#module-${esc(course.modules[0].id)}" data-academy-continue>Начать маршрут<small data-academy-continue-sub>Этап 1 · Прочитай</small></a>` +
    `<button type="button" class="ac-reset" data-academy-reset>Сбросить прогресс маршрута</button>` +
    `<p class="ac-note" data-academy-storage role="status" hidden></p>` +
    `</div></section>` +
    nav.chips +
    `<div class="ac-grid">${nav.side}<div class="ac-stages">${course.modules.map((m, i) => renderStage(m, i)).join('')}` +
    `<aside class="ac-cross"><b>Проверь себя на практике</b><span><a href="/academy/match/">Разбери свой матч</a> — увидишь, что из этого маршрута уже получается, а что нет. Вопросы и ситуации всех этапов можно повторять в <a href="/academy/practice/?mode=topic&amp;route=${encodeURIComponent(course.id)}">тренировке</a>, а весь маршрут проверить на <a href="/academy/practice/?mode=exam&amp;route=${encodeURIComponent(course.id)}">экзамене</a>.</span></aside>` +
    `<p class="ac-src ac-foot">Уроки ведут на гайды DOTAMATE; ситуации и тесты составлены по ним. Числа, которые меняются с патчами, помечены датой проверки.${patch}</p>` +
    `</div></div></div>`;
}

function renderLanding(courses) {
  validateCourses(courses);
  const cards = list => list.map(c => {
    const lessons = courseLessons(c);
    const scen = courseScenarios(c);
    const steps = courseSteps(c);
    const [aud, cls] = audience(c);
    const track = c.modules.map(m => `<span data-academy-track="${esc(m.id)}" title="${esc(m.title)}"></span>`).join('');
    const labels = c.modules.map(m => `<span>${esc(m.title)}</span>`).join('');
    const n = c.modules.length === 5 ? '' : ` style="--ac-n:${c.modules.length}"`;
    return `<article class="ac-route ${cls}${c.group === 'role' ? ' ac-route-role' : ''}" data-academy-course="${esc(c.id)}" aria-labelledby="ac-route-${esc(c.id)}"${n}>` +
      `<p class="ac-kicker ac-aud">${esc(aud)}</p>` +
      `<h2 class="page-title ac-route-title" id="ac-route-${esc(c.id)}"><a href="${courseHref(c)}">${esc(c.title)}</a></h2>` +
      `<p class="ac-route-desc">${esc(c.description)}</p>` +
      `<div class="ac-track" aria-hidden="true">${track}</div><div class="ac-track-labels" aria-hidden="true">${labels}</div>` +
      `<p class="ac-meta" data-academy-route-meta>${c.modules.length}&nbsp;${plural(c.modules.length, 'этап', 'этапа', 'этапов')} · ${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')} · ${scen}&nbsp;${plural(scen, 'ситуация', 'ситуации', 'ситуаций')} · ${steps}&nbsp;${plural(steps, 'шаг', 'шага', 'шагов')} · ${duration(courseMinutes(c))}</p>` +
      `<p class="ac-exam" data-academy-exam="${esc(c.id)}" hidden></p>` +
      `<a class="ac-cta ac-cta-ghost" href="${courseHref(c)}" data-academy-continue>Начать маршрут</a>` +
      `</article>`;
  }).join('');
  const general = courses.filter(c => c.group !== 'role'), roles = courses.filter(c => c.group === 'role');
  const routes = general.length && roles.length
    ? `<h2 class="ac-sec" id="routes">Общие маршруты</h2><div class="ac-routes">${cards(general)}</div>` +
      `<h2 class="ac-sec" id="roles">Маршруты по ролям</h2><p class="ac-sec-sub">Короткие маршруты для одной позиции: линия, середина игры и драки так, как их видит именно эта роль.</p><div class="ac-routes ac-routes-4">${cards(roles)}</div>`
    : `<div class="ac-routes" id="routes">${cards(courses)}</div>`;
  const total = courses.reduce((s, c) => s + c.modules.reduce((x, m) => x + m.quiz.length + m.scenarios.length, 0), 0);
  return `<div class="ac-landing">` + renderSubnav('landing') +
    `<h1 class="page-title">Учебный центр Dota&nbsp;2</h1>` +
    `<p class="ac-lead">${courses.length}&nbsp;${plural(courses.length, 'маршрут', 'маршрута', 'маршрутов')} по гайдам DOTAMATE, разбор твоих матчей с рекомендациями и тренировка решений. Прогресс, разборы и цели хранятся только в этом браузере, без регистрации.</p>` +
    `<p class="ac-note" data-academy-storage role="status" hidden></p>` +
    `<div class="ac-resume" data-academy-resume hidden>${ring(54)}<div class="ac-resume-text"><b data-academy-resume-title></b><span data-academy-resume-sub></span></div>` +
    `<a class="ac-cta" href="#" data-academy-resume-go>Продолжить →</a></div>` +
    `<div class="ac-tools">` +
    `<a class="ac-tool ac-tool-match" href="/academy/match/"><span class="ac-tool-ico" aria-hidden="true">🔍</span><b>Разбор матча</b>` +
    `<span>Выбери свой матч по Steam ID или введи цифры с табло — сравним с игроками на том же герое и позиции и подскажем, что тренировать.</span>` +
    `<small data-academy-tool="match">Начать разбор →</small></a>` +
    `<a class="ac-tool ac-tool-drill" href="/academy/practice/"><span class="ac-tool-ico" aria-hidden="true">🎯</span><b>Тренировка</b>` +
    `<span>${total}&nbsp;${plural(total, 'вопрос и ситуация', 'вопроса и ситуации', 'вопросов и ситуаций')} из всех маршрутов: случайный набор, работа над ошибками и экзамен по маршруту.</span>` +
    `<small data-academy-tool="drill">Начать тренировку →</small></a></div>` +
    `<section class="ac-goals" data-academy-goals hidden aria-labelledby="ac-goals-h"><h2 class="ac-h" id="ac-goals-h">Мои цели на следующие матчи</h2><ul class="ac-goal-list" data-academy-goal-list></ul>` +
    `<p class="ac-goals-foot"><a href="/academy/match/#history">Все разборы и цели →</a></p></section>` +
    `<ol class="ac-how">` +
    `<li><b><i aria-hidden="true">📖</i>Читай</b><span>Короткие уроки ведут на подробные гайды сайта.</span></li>` +
    `<li><b><i aria-hidden="true">🧭</i>Разбирай</b><span>Игровые ситуации: выбери решение и узнай, почему оно сработает.</span></li>` +
    `<li><b><i aria-hidden="true">✅</i>Проверяй</b><span>Тесты, тренировка и экзамен по маршруту.</span></li>` +
    `<li><b><i aria-hidden="true">🎮</i>Играй и разбирай</b><span>Задания на матч, дневник и разбор твоих матчей.</span></li></ol>` +
    routes + `</div>`;
}

// Подпись аудитории и цвет карточки маршрута: kicker из данных курса, для старых — по id.
function audience(c) {
  if (c.kicker) return [c.kicker, c.group === 'role' ? 'ac-role' : 'ac-gold'];
  return { beginner: ['Для новичков', 'ac-green'], 'rank-up': ['Для рейтинговых игр', 'ac-gold'] }[c.id] || ['', ''];
}

// Навигация по разделам центра — одна на всех его страницах.
const SUBNAV = [
  ['landing', '/academy/', 'Обзор'],
  ['routes', '/academy/#routes', 'Маршруты'],
  ['match', '/academy/match/', 'Разбор матча'],
  ['practice', '/academy/practice/', 'Тренировка'],
];
function renderSubnav(active) {
  return `<nav class="ac-subnav" aria-label="Разделы Учебного центра"><ul>` + SUBNAV.map(([k, href, label]) =>
    `<li><a href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a></li>`).join('') + `</ul></nav>`;
}

// ---------- Разбор матча (/academy/match/) ----------
// Справочник для js/academy-match.js: названия гайдов и этапов, на которые ссылаются рекомендации.
// Каталог рекомендаций живёт в js/academy-analysis.js; здесь он проверяется — битый slug или этап останавливает сборку.
function matchRefs(courses) {
  const A = require(path.join(ROOT, 'js', 'academy-analysis.js'));
  const mods = new Map();
  for (const c of courses) for (const m of c.modules) mods.set(`${c.id}/${m.id}`, { c, m });
  const errors = A.checkCatalog(g => guides().has(g), (c, m) => mods.has(`${c}/${m}`));
  if (errors.length) throw new Error('Учебный центр, разбор матча: ' + errors.join('; '));
  const ref = { guides: {}, stages: {} };
  for (const area of Object.keys(A.REC)) {
    for (const g of A.REC[area].guides) ref.guides[g] = guides().get(g).title;
    for (const st of Object.values(A.REC[area].stage)) {
      const k = st.join('/'), x = mods.get(k);
      const idx = x.c.modules.indexOf(x.m);
      ref.stages[k] = { title: x.m.title, course: x.c.title, n: idx + 1, href: `${courseHref(x.c)}#module-${x.m.id}` };
    }
  }
  ref.routes = courses.filter(c => c.group === 'role').map(c => ({ id: c.id, title: c.title, href: courseHref(c) }));
  return `<script type="application/json" id="academyMatchRefs">${JSON.stringify(ref).replace(/</g, '\\u003c')}</script>`;
}

function renderMatchPage(courses) {
  validateCourses(courses);
  const A = require(path.join(ROOT, 'js', 'academy-analysis.js'));
  const p = v => Math.round((v - 1) * 100);
  const posOpts = ['', '1', '2', '3', '4', '5'].map(v => `<option value="${v}">${v ? `Позиция ${v}` : 'Выбери позицию'}</option>`).join('');
  const field = (id, label, attrs, hint) => `<label class="ac-f" for="mt-${id}"><span>${label}</span><input id="mt-${id}" name="${id}" type="number" inputmode="numeric" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `<div class="ac-match" data-academy-match>` + renderSubnav('match') +
    `<section class="ac-hero ac-hero-match"><div class="ac-hero-main">` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · инструмент</p>` +
    `<h1 class="page-title">Разбор матча</h1>` +
    `<p class="ac-lead">Выбери свой матч по Steam ID или перепиши цифры с итогового табло. Сравним твою игру со средним игроком на том же герое и той же позиции, покажем сильные стороны и зоны роста и подскажем, какой урок пройти и какое задание взять на следующий матч.</p>` +
    `<ul class="ac-facts"><li>6 показателей</li><li>контекст команды</li><li>предметы</li><li>рекомендации и цели</li></ul>` +
    `</div><div class="ac-next ac-match-side"><p class="ac-h">Как это работает</p><ol class="ac-steps-list">` +
    `<li><b>Выбери матч</b><span>Steam ID или ручной ввод.</span></li><li><b>Посмотри разбор</b><span>Цифры против эталона героя.</span></li>` +
    `<li><b>Ответь на 4 вопроса</b><span>Рекомендации станут точнее.</span></li><li><b>Возьми цель</b><span>И проверь её в следующем разборе.</span></li></ol></div></section>` +
    `<p class="ac-note" data-academy-storage role="status" hidden></p>` +
    `<noscript><p class="ac-note">Разбор матча работает только с включённым JavaScript.</p></noscript>` +
    `<section class="ac-card" id="pick" aria-labelledby="mt-pick-h"><h2 class="ac-card-h" id="mt-pick-h"><i aria-hidden="true">1</i>Выбери матч</h2>` +
    `<div class="ac-seg" role="tablist" aria-label="Способ выбора матча">` +
    `<button type="button" role="tab" id="mt-tab-steam" aria-controls="mt-steam" aria-selected="true" data-mt-tab="steam">По Steam ID</button>` +
    `<button type="button" role="tab" id="mt-tab-manual" aria-controls="mt-manual" aria-selected="false" tabindex="-1" data-mt-tab="manual">Ввести вручную</button></div>` +
    `<div id="mt-steam" role="tabpanel" aria-labelledby="mt-tab-steam" data-mt-panel="steam">` +
    `<form class="ac-idform" data-mt-idform novalidate><label class="ac-f ac-f-wide" for="mt-id"><span>Steam ID, ссылка на профиль Steam или Dotabuff</span>` +
    `<input id="mt-id" name="id" type="text" autocomplete="off" spellcheck="false" placeholder="Например, 123456789 или steamcommunity.com/profiles/7656…"></label>` +
    `<button type="submit" class="ac-cta ac-cta-sm">Показать матчи</button></form>` +
    `<p class="ac-hint">Нужна открытая история матчей: в Dota 2 — Настройки → «Сообщество» → «Общедоступная история матчей». ID запоминается в этом браузере — тот же, что в разделе <a href="/me/">«Мой профиль»</a>. <button type="button" class="ac-link-btn" data-mt-forget hidden>Забыть ID</button></p>` +
    `<div class="ac-mt-msg" data-mt-msg role="status" aria-live="polite"></div>` +
    `<ul class="ac-mt-list" data-mt-list aria-label="Последние матчи"></ul></div>` +
    `<div id="mt-manual" role="tabpanel" aria-labelledby="mt-tab-manual" data-mt-panel="manual" hidden>` +
    `<form class="ac-manual" data-mt-manual novalidate><p class="ac-hint">Цифры — с итогового табло матча в клиенте Dota 2 (вкладка «Таблица» в просмотре матча) или с любого сайта статистики. Обязательные поля отмечены *.</p>` +
    `<div class="ac-fgrid">` +
    `<label class="ac-f ac-f-wide" for="mt-hero"><span>Герой *</span><select id="mt-hero" name="hero" required><option value="">Загружаем героев…</option></select></label>` +
    `<label class="ac-f" for="mt-pos"><span>Позиция *</span><select id="mt-pos" name="pos" required>${posOpts}</select></label>` +
    `<fieldset class="ac-f ac-f-radio"><legend>Результат *</legend><label><input type="radio" name="win" value="1"> Победа</label><label><input type="radio" name="win" value="0"> Поражение</label></fieldset>` +
    field('min', 'Длительность, мин *', 'min="10" max="150" step="1" required') +
    field('k', 'Убийства *', 'min="0" max="99" required') + field('d', 'Смерти *', 'min="0" max="99" required') + field('a', 'Помощь *', 'min="0" max="99" required') +
    field('lh', 'Добивания *', 'min="0" max="2500" required') + field('dn', 'Денаи', 'min="0" max="500"') +
    field('gpm', 'Золото в минуту *', 'min="0" max="2000" required') + field('xpm', 'Опыт в минуту *', 'min="0" max="3000" required') +
    field('hd', 'Урон по героям', 'min="0" max="300000"', 'необязательно') +
    `</div><p class="ac-form-err" data-mt-err role="alert"></p><button type="submit" class="ac-cta ac-cta-sm">Разобрать матч</button></form></div></section>` +
    `<section class="ac-card" id="result" data-mt-result hidden aria-labelledby="mt-res-h" tabindex="-1"><h2 class="ac-card-h" id="mt-res-h"><i aria-hidden="true">2</i>Разбор</h2><div data-mt-out aria-live="polite"></div></section>` +
    `<section class="ac-card" id="history" aria-labelledby="mt-hist-h"><h2 class="ac-card-h" id="mt-hist-h"><i aria-hidden="true">3</i>Мои цели и разборы</h2>` +
    `<div data-mt-history><p class="ac-hint">Здесь появятся сохранённые разборы, цели на следующие матчи и то, что повторяется из матча в матч. Всё хранится только в этом браузере.</p></div></section>` +
    `<section class="ac-card ac-method" aria-labelledby="mt-method-h"><h2 class="ac-card-h" id="mt-method-h">Как считается разбор</h2>` +
    `<ul class="ac-method-list">` +
    `<li><b>Эталон</b> — средний игрок на этом же герое и этой же позиции по базе рейтинговых матчей сайта (страница <a href="/stats/">«Статистика»</a>): золото и опыт в минуту, убийства, смерти, помощь, урон по героям и добивания. Если героя на этой позиции в базе мало, сравнение идёт со средним по позиции — только по золоту и опыту.</li>` +
    `<li><b>Всё «в минуту».</b> Добивания, смерти, участие в убийствах и урон делятся на длительность матча, у эталона — на среднюю длительность его матчей. Иначе длинный матч всегда выглядел бы лучше короткого.</li>` +
    `<li><b>Пороги.</b> «Заметно выше» — от +${p(A.HI)}&nbsp;% к эталону, «заметно ниже» — от −${-p(A.LO)}&nbsp;%; для смертей — ±${p(A.D_HI)}&nbsp;%. Всё между ними — «около среднего». Матчи короче ${A.MIN_DURATION / 60}&nbsp;минут и Turbo не разбираются: у Turbo другая экономика.</li>` +
    `<li><b>Контекст команды</b> (только матч по Steam ID): участие в убийствах, доля золота, урона и смертей команды. Позиция по Steam ID — оценка модели сайта, её можно поправить вручную.</li>` +
    `<li><b>Предметы</b> — итоговые шесть слотов против законченных предметов, которые чаще всего покупают на этом герое на этой позиции.</li>` +
    `<li><b>Ограничения.</b> Один матч — шумная выборка: в проигранном матче почти все показатели ниже среднего, в лёгкой победе — выше. Смотри на самые большие отличия и на то, что повторяется в нескольких разборах. Разбор не видит реплей: где ты стоял и почему умер, цифры не скажут — для этого есть <a href="/guide/replay-analysis/">гайд по разбору реплеев</a>.</li></ul>` +
    `<p class="ac-src">Steam ID и номер матча уходят на сервер сайта только для запроса истории у Steam (подробно — в <a href="/privacy/">политике конфиденциальности</a>). Разборы и цели остаются в этом браузере.</p></section>` +
    matchRefs(courses) + `</div>`;
}

// ---------- Тренировка (/academy/practice/) ----------
// Банк — все вопросы тестов и ситуации всех маршрутов; js/academy-practice.js выбирает из него наборы.
function practiceBank(courses) {
  const items = [], ids = new Set();
  const src = slugs => slugs.map(g => ({ slug: g, title: guides().get(g).title }));
  for (const c of courses) c.modules.forEach((m, mi) => {
    const where = { course: c.id, module: m.id, stage: `${c.title} · этап ${mi + 1}. ${m.title}`, href: `${courseHref(c)}#module-${m.id}` };
    for (const q of m.quiz) {
      need(!ids.has(q.id), `тренировка`, `id «${q.id}» повторяется между маршрутами`); ids.add(q.id);
      items.push(Object.assign({ id: q.id, kind: 'q', prompt: q.prompt, options: q.choices, best: q.correctIndex, explain: q.explanation,
        sources: src(q.sourceSlug ? [q.sourceSlug] : []), checked: q.checked || null }, where));   // гайд — только если он указан у вопроса, иначе ссылка на этап
    }
    for (const sc of m.scenarios) {
      need(!ids.has(sc.id), `тренировка`, `id «${sc.id}» повторяется между маршрутами`); ids.add(sc.id);
      items.push(Object.assign({ id: sc.id, kind: 's', context: sc.context, prompt: sc.prompt, options: sc.options.map(o => o.text),
        feedback: sc.options.map(o => o.feedback), best: sc.bestIndex, sources: src(sc.sources), checked: sc.checked || null }, where));
    }
  });
  const routes = courses.map(c => ({ id: c.id, title: c.title, href: courseHref(c), group: c.group || 'general' }));
  return { items, routes };
}

function renderPracticePage(courses) {
  validateCourses(courses);
  const bank = practiceBank(courses);
  const nq = bank.items.filter(x => x.kind === 'q').length, ns = bank.items.length - nq;
  const opts = bank.routes.map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('');
  return `<div class="ac-practice" data-academy-practice>` + renderSubnav('practice') +
    `<section class="ac-hero ac-hero-drill"><div class="ac-hero-main">` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · тренировка</p>` +
    `<h1 class="page-title">Тренировка решений</h1>` +
    `<p class="ac-lead">${nq}&nbsp;${plural(nq, 'вопрос', 'вопроса', 'вопросов')} и ${ns}&nbsp;${plural(ns, 'игровая ситуация', 'игровые ситуации', 'игровых ситуаций')} из всех маршрутов центра. Короткие подходы по 10 заданий, повторение ошибок до верного ответа и экзамен по маршруту.</p>` +
    `</div><div class="ac-next ac-drill-stats" data-dr-stats><p class="ac-h">Твоя статистика</p>` +
    `<dl class="ac-kv"><div><dt>Отвечено</dt><dd data-dr-stat="seen">0</dd></div><div><dt>Точность ответов</dt><dd data-dr-stat="acc">—</dd></div>` +
    `<div><dt>Ошибок к повторению</dt><dd data-dr-stat="due">0</dd></div><div><dt>Дней подряд</dt><dd data-dr-stat="streak">0</dd></div></dl>` +
    `<button type="button" class="ac-reset" data-dr-reset>Сбросить статистику тренировки</button></div></section>` +
    `<p class="ac-note" data-academy-storage role="status" hidden></p>` +
    `<noscript><p class="ac-note">Тренировка работает только с включённым JavaScript. Все вопросы с объяснениями есть на страницах маршрутов.</p></noscript>` +
    `<section class="ac-card" data-dr-setup aria-labelledby="dr-setup-h"><h2 class="ac-card-h" id="dr-setup-h">Выбери режим</h2>` +
    `<div class="ac-modes">` +
    `<button type="button" class="ac-mode" data-dr-mode="mix"><b>Случайные 10</b><span>Сначала то, что ты ещё не видел.</span></button>` +
    `<button type="button" class="ac-mode" data-dr-mode="mistakes"><b>Работа над ошибками</b><span data-dr-mistakes>Задания, где ты ошибся, — пока не ответишь верно дважды подряд.</span></button>` +
    `<button type="button" class="ac-mode" data-dr-mode="topic"><b>По маршруту</b><span>10 заданий одного маршрута с разбором после каждого.</span></button>` +
    `<button type="button" class="ac-mode" data-dr-mode="exam"><b>Экзамен</b><span>15 заданий маршрута, разбор в конце. Сдан — от 80&nbsp;%.</span></button></div>` +
    `<div class="ac-route-pick" data-dr-route-wrap hidden><label class="ac-f" for="dr-route"><span>Маршрут</span><select id="dr-route">${opts}</select></label>` +
    `<button type="button" class="ac-cta ac-cta-sm" data-dr-start>Начать</button></div>` +
    `<p class="ac-form-err" data-dr-msg role="status"></p>` +
    `<ul class="ac-exams" data-dr-exams></ul></section>` +
    `<section class="ac-card" data-dr-run hidden aria-live="polite" tabindex="-1"></section>` +
    `<script type="application/json" id="academyBank">${JSON.stringify(bank).replace(/</g, '\\u003c')}</script></div>`;
}

function renderQuiz(m, index) {
  const questions = m.quiz.map((q, qi) => {
    const name = `q-${q.id}`;
    const choices = q.choices.map((ch, i) =>
      `<label class="ac-choice" for="${esc(name)}-${i}"><input type="radio" id="${esc(name)}-${i}" name="${esc(name)}" value="${i}"><span>${esc(ch)}</span></label>`
    ).join('');
    const src = q.checked ? guides().get(q.sourceSlug) : null;
    const checked = src ? `<p class="ac-q-src">Источник: <a href="${guideHref(q.sourceSlug)}">«${esc(src.title)}»</a>, ${esc(q.checked)}.</p>` : '';
    return `<fieldset class="ac-q" data-academy-question="${esc(q.id)}" data-correct="${q.correctIndex}">` +
      `<legend><span class="ac-q-num">Вопрос ${qi + 1} из ${m.quiz.length}.</span> ${esc(q.prompt)}</legend>` +
      `<div class="ac-choices">${choices}</div>` +
      `<div class="ac-q-feedback" data-academy-feedback hidden><p class="ac-q-verdict" data-academy-verdict></p><p class="ac-q-expl"><b>Объяснение:</b> ${esc(q.explanation)}</p>${checked}</div>` +
      `</fieldset>`;
  }).join('');
  return `<form class="ac-quiz" data-academy-quiz="${esc(m.id)}" aria-labelledby="quiz-${esc(m.id)}-title" novalidate>` +
    `<p class="ac-h" id="quiz-${esc(m.id)}-title">Мини-тест: ${m.quiz.length}&nbsp;${plural(m.quiz.length, 'вопрос', 'вопроса', 'вопросов')}</p>` +
    `<p class="ac-quiz-hint">Проверка не ограничивает маршрут: можно отвечать сколько угодно раз и читать дальше при любом результате.</p>` +
    questions +
    `<div class="ac-quiz-actions"><button type="submit" class="btn ac-btn">Проверить ответы</button><button type="button" class="btn ghost ac-btn" data-academy-retry hidden>Пройти ещё раз</button></div>` +
    `<p class="ac-quiz-result" data-academy-result aria-live="polite"></p>` +
    `<p class="ac-quiz-best" data-academy-best></p>` +
    `</form>`;
}

module.exports = { renderLanding, renderCourse, renderIndex, renderMatchPage, renderPracticePage, practiceBank, validateCourses, courseSteps };
