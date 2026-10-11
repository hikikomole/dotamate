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
  const moduleIds = new Set(), lessonIds = new Set(), questionIds = new Set();
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

// Справочник ID для js/academy.js: по нему браузер проверяет сохранённый
// прогресс (неизвестные ID отбрасываются) и находит следующий урок. Кладётся на
// все страницы центра, чтобы сохранение с одной страницы не стирало прогресс
// другого маршрута.
function renderIndex(courses) {
  const data = { version: 1, courses: {} };
  for (const c of validateCourses(courses)) {
    data.courses[c.id] = {
      title: c.title,
      href: courseHref(c),
      modules: c.modules.map(m => m.id),
      lessons: courseLessons(c).map(l => ({ id: l.id, title: l.title })),
    };
  }
  return `<script type="application/json" id="academyIndex">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function progressBlock(course, total) {
  return `<div class="ac-progress" data-academy-progress>` +
    `<div class="ac-bar" role="progressbar" aria-label="Пройдено уроков маршрута «${esc(course.title)}»" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0"><span class="ac-bar-fill"></span></div>` +
    `<p class="ac-progress-text" data-academy-progress-text>Отмечено 0 из ${total} ${plural(total, 'урока', 'уроков', 'уроков')}</p>` +
    `</div>`;
}

function renderLanding(courses) {
  validateCourses(courses);
  const cards = courses.map(c => {
    const lessons = courseLessons(c);
    const first = lessons[0];
    const modules = c.modules.map(m => `<li>${esc(m.title)}</li>`).join('');
    return `<article class="ac-route" data-academy-course="${esc(c.id)}" data-academy-lessons="${esc(lessons.map(l => l.id).join(' '))}" aria-labelledby="ac-route-${esc(c.id)}">` +
      `<h2 class="ac-route-title" id="ac-route-${esc(c.id)}"><a href="${courseHref(c)}">${esc(c.title)}</a></h2>` +
      `<p class="ac-route-for">${esc(c.audience)}</p>` +
      `<p class="ac-route-desc">${esc(c.description)}</p>` +
      `<ul class="ac-facts"><li>${c.modules.length}&nbsp;${plural(c.modules.length, 'этап', 'этапа', 'этапов')}</li><li>${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')}</li><li>${duration(courseMinutes(c))}</li></ul>` +
      `<ol class="ac-route-modules">${modules}</ol>` +
      progressBlock(c, lessons.length) +
      `<div class="ac-route-actions">` +
      `<a class="btn ac-btn ac-continue" href="${courseHref(c)}#${lessonAnchor(first)}" data-academy-continue>Начать маршрут</a>` +
      `<a class="ac-link" href="${courseHref(c)}">Все уроки маршрута</a>` +
      `</div>` +
      `</article>`;
  }).join('');
  return `<div class="ac-landing">` +
    `<header class="ac-head">` +
    `<h1 class="page-title">Учебный центр Dota 2</h1>` +
    `<p class="ac-lead">Два маршрута по гайдам DOTAMATE: уроки идут по порядку, у каждого есть задание для практики, а в конце этапа — короткий тест с объяснениями. Отметки и результаты сохраняются только в этом браузере, без регистрации.</p>` +
    `<p class="ac-note" data-academy-storage hidden></p>` +
    `</header>` +
    `<div class="ac-routes">${cards}</div>` +
    `</div>`;
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
    `<h3 class="ac-quiz-title" id="quiz-${esc(m.id)}-title">Мини-тест: этап ${index + 1}</h3>` +
    `<p class="ac-quiz-hint">Проверка не ограничивает маршрут: можно отвечать сколько угодно раз и читать дальше при любом результате.</p>` +
    questions +
    `<div class="ac-quiz-actions"><button type="submit" class="btn ac-btn">Проверить ответы</button><button type="button" class="btn ghost ac-btn" data-academy-retry hidden>Пройти ещё раз</button></div>` +
    `<p class="ac-quiz-result" data-academy-result aria-live="polite"></p>` +
    `<p class="ac-quiz-best" data-academy-best></p>` +
    `</form>`;
}

function renderCourse(course, opts = {}) {
  validateCourse(course);
  const lessons = courseLessons(course);
  const toc = course.modules.map((m, i) =>
    `<li><a href="#module-${esc(m.id)}"><span class="ac-step">Этап ${i + 1}</span> ${esc(m.title)}</a></li>`).join('');
  const modules = course.modules.map((m, i) => {
    const items = m.lessons.map(l => {
      const g = guides().get(l.guideSlug);
      return `<li class="ac-lesson" id="${esc(lessonAnchor(l))}" data-academy-lesson="${esc(l.id)}">` +
        `<div class="ac-lesson-head"><h3 class="ac-lesson-title" id="${esc(lessonAnchor(l))}-title">${esc(l.title)}</h3><span class="ac-badge" data-academy-badge></span></div>` +
        `<p class="ac-lesson-sum">${esc(l.summary)}</p>` +
        `<p class="ac-practice"><b>Практика:</b> ${esc(l.practice)}</p>` +
        `<div class="ac-lesson-actions">` +
        `<a class="btn ghost ac-btn" href="${guideHref(l.guideSlug)}" data-academy-open>Открыть материал<span class="hm-sr">: ${esc(g.title)}</span></a>` +
        `<span class="ac-min">«${esc(g.title)}» · ${lessonMinutes(l)}&nbsp;мин</span>` +
        `<label class="ac-done"><input type="checkbox" data-academy-done aria-describedby="${esc(lessonAnchor(l))}-title"> Пройдено</label>` +
        `</div>` +
        `</li>`;
    }).join('');
    return `<section class="ac-module" id="module-${esc(m.id)}" data-academy-module="${esc(m.id)}" aria-labelledby="module-${esc(m.id)}-title">` +
      `<h2 class="ac-module-title" id="module-${esc(m.id)}-title"><span class="ac-step">Этап ${i + 1}</span> ${esc(m.title)}</h2>` +
      `<p class="ac-module-intro">${esc(m.intro)}</p>` +
      `<ol class="ac-lessons">${items}</ol>` +
      renderQuiz(m, i) +
      `</section>`;
  }).join('');
  const patch = opts.patch && text(opts.patch.version)
    ? ` Изменения последнего патча — на странице <a href="/patch/${encodeURIComponent(opts.patch.version)}/">«Патч ${esc(opts.patch.version)}»</a>.`
    : '';
  return `<div class="ac-course" data-academy-course="${esc(course.id)}" data-academy-lessons="${esc(lessons.map(l => l.id).join(' '))}">` +
    `<header class="ac-head">` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · маршрут</p>` +
    `<h1 class="page-title">${esc(course.title)}</h1>` +
    `<p class="ac-lead">${esc(course.description)}</p>` +
    `<p class="ac-route-for">${esc(course.audience)}</p>` +
    `<ul class="ac-facts"><li>${course.modules.length}&nbsp;${plural(course.modules.length, 'этап', 'этапа', 'этапов')}</li><li>${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')}</li><li>${duration(courseMinutes(course))}</li></ul>` +
    progressBlock(course, lessons.length) +
    `<div class="ac-head-actions">` +
    `<a class="btn ac-btn ac-continue" href="#${esc(lessonAnchor(lessons[0]))}" data-academy-continue>Начать: ${esc(lessons[0].title)}</a>` +
    `<button type="button" class="btn ghost ac-btn" data-academy-reset>Сбросить прогресс маршрута</button>` +
    `</div>` +
    `<p class="ac-note" data-academy-storage hidden></p>` +
    `<p class="ac-src">Уроки ведут на гайды DOTAMATE. Числа, которые меняются с патчами, в тестах помечены датой проверки.${patch}</p>` +
    `</header>` +
    `<nav class="ac-toc" aria-label="Этапы маршрута"><ol>${toc}</ol></nav>` +
    modules +
    `</div>`;
}

module.exports = { renderLanding, renderCourse, renderIndex, validateCourses };
