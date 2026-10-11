# Учебный центр Dota 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить на DOTAMATE учебный центр с маршрутами «С нуля» и «Поднять рейтинг», уроками, мини-тестами и локальным прогрессом.

**Architecture:** Три статически генерируемые страницы `/academy/`, `/academy/beginner/` и `/academy/rank-up/` используют существующую оболочку сайта. Данные курсов хранятся отдельно от HTML; сборщик вставляет ссылки и вопросы в индексируемую разметку, а небольшой vanilla JS управляет тестами и состоянием в `localStorage`.

**Tech Stack:** Node.js build scripts, static HTML, vanilla JavaScript, CSS, `localStorage`; без новых зависимостей, backend или учётных записей.

**Spec:** `docs/superpowers/specs/2026-10-11-uchebny-tsentr-design.md`

## Global Constraints

- Следовать текущему стеку: статический HTML, vanilla JavaScript, CSS.
- Не добавлять фронтенд-фреймворк или серверную базу ради локального прогресса.
- Не копировать опубликованные статьи целиком; связывать уроки с существующими `/guide/<slug>/`.
- Использовать версионированный ключ `localStorage`, валидировать сохранённые данные и безопасно обрабатывать повреждённое или недоступное хранилище.
- Не вводить новое отслеживание поведения; прогресс не отправлять на сервер.
- Не править сгенерированные файлы в `deploy/` вручную.
- Не открывать и не выводить `.env`, `secrets/*`, `github.pat.txt`, `stratz.capi.txt` и другие секреты.
- Не запускать `tools/daily-update.js`, `tools/server-update.js` или `Обновить всё.cmd`: проектная ежедневная процедура может выложить изменения на живой сайт.
- Не сливать изменения и не публиковать сайт; закончить reviewable изменениями в cloud branch/PR.

## Review Focus

1. `localStorage` запрещён, повреждён или содержит неизвестные ID: страница продолжает работать и показывает пустой сохранённый прогресс.
2. Сброс маршрута: очищается только выбранный маршрут, второй маршрут сохраняет отметки.
3. Тест отправлен без ответа, пройден повторно или дан неверный ответ: интерфейс показывает обратную связь, не зависает и не блокирует чтение.
4. Текст урока или guide slug некорректен: HTML не ломается, а сборка выдаёт понятную ошибку для несуществующего гайда.
5. Мобильное меню, длинный заголовок и клавиатурная навигация: страницы остаются читаемыми, действия доступны с клавиатуры, горизонтального переполнения нет.

---

## Карта файлов

- `academy-content.js` — постоянные ID, названия, цели, ссылки и задания двух маршрутов.
- `tools/academy-render.js` — проверка course data и генерация безопасного индексируемого HTML.
- `page-sections.html` — общий исходный section для страниц Учебного центра.
- `build-pages.js` — записи страниц, homepage card, вызов course renderer и включение маршрутов в `page-urls.json`.
- `tools/site-nav.js` — единый пункт меню «Учебный центр».
- `js/academy.js` — тесты, отметки уроков и сохранение прогресса в браузере.
- `css/academy.css` — стили маршрутов, уроков, тестов и прогресс-индикаторов.
- `build-sitemap.js` — существующий генератор sitemap уже читает `page-urls.json`; менять его контракт не требуется.
- `deploy/**` и `page-urls.json` — сборочный результат, который создаёт `build-pages.js`; не редактировать вручную.

## Task 1: Define course data and static renderer

**Files:**

- Create: `academy-content.js`
- Create: `tools/academy-render.js`
- Read: `guide-content.js`

**Interfaces:**

- `academy-content.js` exports `COURSES`, an array of two course objects with fields `id`, `slug`, `title`, `description`, and `modules`.
- A module has `id`, `title`, `intro`, `lessons`, and `quiz`.
- A lesson has stable `id`, `title`, `summary`, `guideSlug`, and `practice`.
- A quiz question has stable `id`, `prompt`, `choices` (three strings), `correctIndex` (0–2), and `explanation`.
- `tools/academy-render.js` exports `renderLanding(courses)` and `renderCourse(course)`; both return escaped HTML strings. Landing cards expose each course's ordered lesson IDs so the browser can choose a resume destination without another data request.

- [ ] **Step 1: Add the beginner course outline** in `academy-content.js` with these five module IDs and guide links:

  - `getting-started`: `beginner-start`, `game-modes`, `settings-for-beginners`, `hotkeys-binds`.
  - `choose-role-and-hero`: `roles-explained`, `best-heroes-for-beginners`, `hero-picking-basics`.
  - `win-the-lane`: `last-hitting-denying`, `laning-stage`, `creep-aggro`.
  - `farm-and-read-map`: `wave-management`, `farming-efficiency`, `minimap-awareness`, `warding-map-control`, `itemization-basics`.
  - `fight-and-improve`: `teamfight-positioning`, `map-objectives-741`, `replay-analysis`.

- [ ] **Step 2: Add the rank improvement course** with these five module IDs and guide links:

  - `build-improvement-loop`: `mmr-climbing-mindset`, `replay-analysis`, `reading-hero-stats`.
  - `pick-role-and-pool`: `roles-explained`, `hero-picking-basics`, `draft-fundamentals`.
  - `lane-and-economy`: `laning-stage`, `wave-management`, `farming-efficiency`, `gold-and-experience`.
  - `read-map-and-tempo`: `minimap-awareness`, `warding-map-control`, `match-timings`, `map-objectives-741`.
  - `teamfight-decisions`: `teamfight-positioning`, `itemization-basics`, `buyback-decisions`, `tilt-control`, `team-communication`.

- [ ] **Step 3: Write three original quiz questions for each module.** Derive answers from linked guide content already in `guide-content.js`; give each choice feedback through one explanation, use original wording, and do not put patch-changing values in a question unless that question links to the dated patch guide.

- [ ] **Step 4: Implement renderer validation.** `renderLanding(courses)` renders the two course cards. `renderCourse(course)` renders ordered module/lesson markup, quiz forms, and data attributes for `course.id`, `module.id`, and `lesson.id`. Escape every editorial string; construct article links only as `/guide/${encodeURIComponent(guideSlug)}/`.

- [ ] **Step 5: Validate guide references at build time.** Load known slugs from `guide-content.js`; if any `lesson.guideSlug` is missing, throw an error naming the course, module, and slug before writing pages.

## Task 2: Add generated pages, navigation, homepage entry and SEO URLs

**Files:**

- Modify: `page-sections.html`
- Modify: `build-pages.js`
- Modify: `tools/site-nav.js`

**Interfaces:**

- Add one top-level source section with `id="academy"` and a `{{ACADEMY_CONTENT}}` placeholder.
- Add three `PAGES` records with `key: 'academy'`, directories `academy`, `academy/beginner`, and `academy/rank-up`, and renderer views `landing`, `beginner`, and `rank-up`.
- `build-pages.js` calls `renderLanding(COURSES)` for the landing route and `renderCourse(course)` for each track before saving the page shell.
- All three records use `/css/academy.css` and deferred `/js/academy.js`.

- [ ] **Step 1: Add the source section** to `page-sections.html`. Keep the section at the top level so `readSections()` can parse it, and place `{{ACADEMY_CONTENT}}` inside it.

- [ ] **Step 2: Register the central nav item** in `tools/site-nav.js`: `{ key: 'academy', href: '/academy/', label: 'Учебный центр' }`. Put it adjacent to `guides`.

- [ ] **Step 3: Add route metadata and shared academy rendering** to the `PAGES` array in `build-pages.js`. Set unique title and description text for each URL, use route crumbs «Учебный центр», «С нуля», and «Поднять рейтинг», and select the correct renderer view for each page.

- [ ] **Step 4: Add an academy card** to `HOME_CARDS` linking to `/academy/`, with a short description of the two learning paths.

- [ ] **Step 5: Replace the academy placeholder per page** in the existing page-generation loop. The ordinary guide and section pages must not change their content. The three academy pages must be included in `page-urls.json` through the existing `PAGES` URL collection.

## Task 3: Implement browser progress and quiz interactions

**Files:**

- Create: `js/academy.js`
- Modify: `tools/academy-render.js`

**Interfaces:**

- The storage key is `dotamate.academy.progress.v1`.
- Persist this shape: `{ version: 1, courses: { [courseId]: { completedLessons: string[], bestScores: { [moduleId]: number }, lastLessonId: string | null } } }`.
- Internal functions: `loadProgress(courses)`, `saveProgress(progress)`, `setLessonComplete(courseId, lessonId, complete)`, `saveQuizScore(courseId, moduleId, score)`, and `resetCourse(courseId)`.
- Renderer controls expose `data-academy-course`, `data-academy-lesson`, and `data-academy-module` values that match the course data IDs.

- [ ] **Step 1: Add native accessible controls to rendered markup.** Use labeled checkboxes for lesson completion; use `<fieldset>`, `<legend>`, radio inputs and a submit button for each quiz. Put quiz feedback in an `aria-live="polite"` region.

- [ ] **Step 2: Implement safe state loading.** Wrap `localStorage` access and JSON parsing in `try/catch`. Accept only `version === 1`, known course/module/lesson IDs, valid string arrays, finite scores, and a `lastLessonId` that belongs to the course. Invalid state falls back to empty in-memory state without stopping page initialization.

- [ ] **Step 3: Implement lesson completion and resume.** A checkbox updates only its course's `completedLessons`, saves state, updates the progress count and bar, and recalculates the next incomplete lesson from the rendered lesson order. Record `lastLessonId` when a learner opens a guide. The landing card's «Продолжить» link targets the next incomplete lesson; for a new route it targets the first lesson, and for a completed route it targets the last opened lesson (or the first lesson if none was opened).

- [ ] **Step 4: Implement quizzes.** On submit, require one selected answer; show whether it is correct, the explanation, and the score. Permit another attempt. Save the best percentage for that module; a wrong answer never prevents lesson navigation.

- [ ] **Step 5: Implement reset and storage fallback.** Reset one course only after `window.confirm()`. If saving throws (including quota/security errors), keep interactions in memory and show a brief message that progress cannot be saved in this browser.

## Task 4: Style the learning experience

**Files:**

- Create: `css/academy.css`
- Modify: `build-pages.js` only if a route omitted the shared style/script entries in Task 2.

- [ ] **Step 1: Style the landing page** with two distinct route cards, descriptions and progress summaries, using the existing dark theme, spacing, borders and button conventions.

- [ ] **Step 2: Style course pages** with a readable course header, progress bar, ordered modules, lesson links, practice prompts, quiz fieldsets and clear completion states.

- [ ] **Step 3: Add responsive rules** for narrow screens: cards and controls stack, quiz options wrap, text remains readable, and no fixed-width element forces horizontal scrolling.

- [ ] **Step 4: Add visible focus and status styles** for checkboxes, radio choices, buttons, completed lessons, quiz feedback and the storage warning. Do not rely on color alone to communicate state.

## Task 5: Build static output and review the result without deployment

**Files:**

- Generated by `build-pages.js`: `academy/index.html`, `academy/beginner/index.html`, `academy/rank-up/index.html`, their `deploy/` copies, and `page-urls.json`.
- Generated by `build-sitemap.js`: `sitemap.xml` and `deploy/sitemap.xml`.

- [ ] **Step 1: Regenerate section pages locally** with `node build-pages.js`.

- [ ] **Step 2: Regenerate the sitemap locally** with `node build-sitemap.js`.

- [ ] **Step 3: Review generated HTML** to confirm all three canonical URLs, page titles, lesson links, course text and quiz text are present in source HTML and appear exactly once in sitemap.

- [ ] **Step 4: Inspect the local preview** at `/academy/`, `/academy/beginner/`, and `/academy/rank-up/` for page rendering, navigation, metadata, responsive layout, and generated lesson/quiz content.

- [ ] **Step 5: Review the diff** to confirm the change contains only this feature's source and generated page changes, then finish with a reviewable Cloud PR. Do not merge the PR or deploy to dotamate.ru.

## Cloud Session Handoff

The approved specification and this plan are local files and have not been pushed to GitHub. Start the Claude Code Cloud session on `hikikomole/dotamate` and include the approved MVP scope and this plan's task list in the task prompt. The local `master` is 18 commits ahead of `origin/master`; do not push that local branch as part of this task.

Do not add an automated test suite for this feature. Run only the two safe local build commands above, inspect their generated output, and review the final diff; do not run project update/deployment scripts.
