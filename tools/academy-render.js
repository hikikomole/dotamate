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
  return `<div class="ac-course" data-academy-course="${esc(course.id)}">` +
    `<section class="ac-hero"><div class="ac-hero-main">` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · маршрут</p>` +
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
    `<p class="ac-src ac-foot">Уроки ведут на гайды DOTAMATE; ситуации и тесты составлены по ним. Числа, которые меняются с патчами, помечены датой проверки.${patch}</p>` +
    `</div></div></div>`;
}

function renderLanding(courses) {
  validateCourses(courses);
  const AUD = { beginner: ['Для новичков', 'ac-green'], 'rank-up': ['Для рейтинговых игр', 'ac-gold'] };
  const cards = courses.map(c => {
    const lessons = courseLessons(c);
    const scen = courseScenarios(c);
    const steps = courseSteps(c);
    const [aud, cls] = AUD[c.id] || ['', ''];
    const track = c.modules.map(m => `<span data-academy-track="${esc(m.id)}" title="${esc(m.title)}"></span>`).join('');
    const labels = c.modules.map(m => `<span>${esc(m.title)}</span>`).join('');
    return `<article class="ac-route ${cls}" data-academy-course="${esc(c.id)}" aria-labelledby="ac-route-${esc(c.id)}">` +
      `<p class="ac-kicker ac-aud">${esc(aud)}</p>` +
      `<h2 class="page-title ac-route-title" id="ac-route-${esc(c.id)}"><a href="${courseHref(c)}">${esc(c.title)}</a></h2>` +
      `<p class="ac-route-desc">${esc(c.description)}</p>` +
      `<div class="ac-track" aria-hidden="true">${track}</div><div class="ac-track-labels" aria-hidden="true">${labels}</div>` +
      `<p class="ac-meta" data-academy-route-meta>${c.modules.length}&nbsp;этапов · ${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')} · ${scen}&nbsp;${plural(scen, 'ситуация', 'ситуации', 'ситуаций')} · ${steps}&nbsp;${plural(steps, 'шаг', 'шага', 'шагов')} · ${duration(courseMinutes(c))}</p>` +
      `<a class="ac-cta ac-cta-ghost" href="${courseHref(c)}" data-academy-continue>Начать маршрут</a>` +
      `</article>`;
  }).join('');
  return `<div class="ac-landing">` +
    `<h1 class="page-title">Учебный центр Dota&nbsp;2</h1>` +
    `<p class="ac-lead">Два маршрута по гайдам DOTAMATE. В каждом этапе — уроки, игровые ситуации, короткий тест и задания на реальный матч. Прогресс и дневник хранятся только в этом браузере, без регистрации.</p>` +
    `<p class="ac-note" data-academy-storage role="status" hidden></p>` +
    `<div class="ac-resume" data-academy-resume hidden>${ring(54)}<div class="ac-resume-text"><b data-academy-resume-title></b><span data-academy-resume-sub></span></div>` +
    `<a class="ac-cta" href="#" data-academy-resume-go>Продолжить →</a></div>` +
    `<ol class="ac-how">` +
    `<li><b><i aria-hidden="true">📖</i>Читай</b><span>Короткие уроки ведут на подробные гайды сайта.</span></li>` +
    `<li><b><i aria-hidden="true">🧭</i>Разбирай</b><span>Игровые ситуации: выбери решение и узнай, почему оно сработает.</span></li>` +
    `<li><b><i aria-hidden="true">✅</i>Проверяй</b><span>Тест из трёх вопросов с объяснением каждого ответа.</span></li>` +
    `<li><b><i aria-hidden="true">🎮</i>Играй</b><span>Задания на матч и дневник: что получилось, что нет.</span></li></ol>` +
    `<div class="ac-routes">${cards}</div></div>`;
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

module.exports = { renderLanding, renderCourse, renderIndex, validateCourses, courseSteps };
