# Учебный центр v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить Учебный центр в формат «этап — четыре шага» (Прочитай / Разбери ситуацию / Проверь себя / Сыграй и запиши) с ситуационными задачами, чек-листом практики и дневником, по утверждённым макетам.

**Architecture:** Разметка по-прежнему рисуется на сборке (`tools/academy-render.js` из `academy-content.js`), без JS всё содержимое видно. Логика состояния выносится в отдельный модуль `js/academy-store.js` (чистые функции: загрузка, перенос v1→v2, валидация, расчёт прогресса и следующего шага), интерфейс — в `js/academy.js`. Стили — `css/academy.css`, перенос утверждённого макета.

**Tech Stack:** Node.js-сборщики, статический HTML, vanilla JS (ES5-стиль, как в текущем `js/academy.js`), CSS; Playwright (`/opt/node-tools/node_modules/playwright`, Chromium предустановлен) для проверок вне репозитория.

**Spec:** `docs/superpowers/specs/2026-10-11-uchebny-tsentr-v2-design.md` (основа — `docs/superpowers/specs/2026-10-11-uchebny-tsentr-design.md`).

**Макеты (утверждены владельцем):** `docs/superpowers/mockups/academy-v2/` — `landing.html`, `course.html`, `mock.css`, снимки `m1…m7.jpg`. Классы `mx-*` в макете — образец вида; в коде используются классы `ac-*` (таблица соответствия в Task 5).

## Global Constraints

- Стек сайта: статический HTML, vanilla JavaScript, CSS; без фреймворков, без новых зависимостей, без сервера и учётных записей.
- ID курсов, этапов, уроков и вопросов тестов не меняются.
- Прогресс только в браузере: ключ `dotamate.academy.progress.v2`; ключ `dotamate.academy.progress.v1` читается для переноса и не удаляется. На сервер ничего не отправляется, нового отслеживания нет.
- Дневник: до 500 символов на запись, не более 30 записей на маршрут, вывод только через `textContent`.
- Без JS всё содержимое (уроки, ситуации с разбором, тесты, задания) видно; разбор ситуации — в `<details>` «Показать разбор».
- Меню, другие страницы сайта и `css/theme-dark.css` не меняются; новых адресов нет.
- Сгенерированные `academy/**`, `deploy/academy/**` — только через `node build-pages.js`; руками не править. Другие сгенерированные файлы в коммит не попадают (после сборки откатывать `data/live-items.json` и любые не-academy изменения).
- Не запускать `tools/daily-update.js`, `tools/server-update.js`, `tools/deploy-hostiman.js`, `tools/push-server.js`, `tools/sync-deploy.js`; не сливать PR, не публиковать сайт.
- Автотесты в репозиторий не добавляются (решение плана MVP): проверки — Playwright-скрипты в каталоге сессии `$E2E` (см. ниже).
- Стиль: новые файлы — читаемый код; правки в `build-pages.js` — в компактном стиле файла. Коммиты на русском, с трейлерами сессии.

**Каталог проверок:** `E2E=/tmp/claude-0/-home-user-dotamate/5b6481ca-dacb-5b0a-b50c-ca99ef4f6a80/scratchpad/e2e-v2` (создать в Task 1). Превью-сервер: `node preview-server.js` из корня проекта, `http://127.0.0.1:4173`; внешние запросы в Playwright блокируются, кроме `fonts.googleapis.com`/`fonts.gstatic.com`.

## Review Focus

1. Посетитель с прогрессом v1 (отметки и тесты MVP) открывает v2 — всё перенесено, ничего не потеряно, v1 не тронут.
2. Дневник с текстом `<img src=x onerror=alert(1)>` и переводами строк — выводится буквально, ничего не исполняется; 31-я запись вытесняет самую старую с уведомлением.
3. Ссылка `#lesson-<id>` из старых закладок/лендинга — открывает нужный этап и вкладку «Прочитай», урок виден (не скрыт в свёрнутом этапе или неактивной вкладке).
4. Узкий экран 360px с длинными названиями этапов и уроков — нет горизонтальной прокрутки, вкладки шагов читаемы, лента этапов прокручивается сама по себе.
5. Хранилище запрещено/переполнено во время сохранения дневника — текст не теряется молча: поле не очищается, показывается предупреждение.

Каждый пункт закреплён проверкой в задаче-владельце (Task 3 — п.1, Task 4 — п.2, п.3, п.5, Task 5 — п.4).

---

## Карта файлов

- `academy-content.js` — добавить `scenarios` (по 2 на этап, 20 всего). Остальное без изменений.
- `tools/academy-render.js` — валидация ситуаций; новая разметка страниц; расширенный справочник `#academyIndex`.
- `js/academy-store.js` — **новый**: состояние, перенос, валидация, расчёт прогресса. Экспорт `window.DMAcademyStore`.
- `js/academy.js` — переписать: интерфейс поверх `DMAcademyStore`.
- `css/academy.css` — переписать по макету.
- `build-pages.js` — подключить `/js/academy-store.js` перед `/js/academy.js` на трёх страницах; числа уроков в description — из данных.
- Сгенерированные: `academy/index.html`, `academy/beginner/index.html`, `academy/rank-up/index.html` и копии в `deploy/academy/`.

---

### Task 1: Ситуации в данных курса и их проверка при сборке

**Files:**
- Modify: `academy-content.js` (добавить `scenarios` в каждый из 10 этапов)
- Modify: `tools/academy-render.js` (`validateCourse`)
- Create: `$E2E/validate.js` (проверка вне репозитория)

**Interfaces:**
- Produces: у каждого этапа `scenarios: Array<{ id: string, context: string, prompt: string, options: Array<{ text: string, feedback: string }> (ровно 3), bestIndex: 0|1|2, sources: string[] (1–2 slug), checked?: string }>`; ровно 2 ситуации, `id` = `<moduleId>-s1` / `<moduleId>-s2`.
- Produces: `validateCourses(courses)` бросает `Error` с текстом `Учебный центр: курс «…», этап «…», ситуация «…»: <причина>`.

- [ ] **Step 1: Написать проверку**

```bash
mkdir -p "$E2E"
```

```js
// $E2E/validate.js — запуск: node "$E2E/validate.js" (из корня проекта)
const path = require('path');
const ROOT = process.cwd();
const { COURSES } = require(path.join(ROOT, 'academy-content.js'));
const { validateCourses } = require(path.join(ROOT, 'tools/academy-render.js'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const clone = x => JSON.parse(JSON.stringify(x));
const expectError = (mutate, re, label) => {
  const c = clone(COURSES); mutate(c);
  try { validateCourses(c); ok(false, label + ' (ошибки нет)'); }
  catch (e) { ok(re.test(e.message), label + ': ' + e.message); }
};
ok((() => { try { validateCourses(COURSES); return true; } catch (e) { console.log(e.message); return false; } })(), 'реальные данные проходят');
for (const c of COURSES) for (const m of c.modules) {
  ok(Array.isArray(m.scenarios) && m.scenarios.length === 2, `${c.id}/${m.id}: 2 ситуации`);
  (m.scenarios || []).forEach((s, i) => ok(s.id === `${m.id}-s${i + 1}`, `id ${s.id}`));
}
const best = COURSES.flatMap(c => c.modules.flatMap(m => (m.scenarios || []).map(s => s.bestIndex)));
ok([0, 1, 2].every(v => best.filter(b => b === v).length >= 5), 'лучшие ответы разнесены по A/B/C (каждая позиция ≥ 5 раз): ' + best.join(''));
expectError(c => { c[0].modules[0].scenarios[0].sources = ['nope']; }, /ситуация «getting-started-s1».*nope/, 'несуществующий гайд');
expectError(c => { c[0].modules[0].scenarios[0].options.pop(); }, /ситуация .*три варианта/, '2 варианта');
expectError(c => { c[0].modules[0].scenarios[0].bestIndex = 3; }, /bestIndex/, 'bestIndex вне 0–2');
expectError(c => { c[0].modules[0].scenarios[1].id = c[0].modules[0].scenarios[0].id; }, /повторяется/, 'повтор id');
expectError(c => { c[0].modules[0].scenarios[0].options[1].feedback = ' '; }, /пуст/, 'пустой разбор');
expectError(c => { c[0].modules[0].scenarios = []; }, /ситуац/, 'нет ситуаций');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Запустить — должно падать**

Run: `node "$E2E/validate.js"`
Expected: FAIL на «2 ситуации» и на ожидаемых ошибках валидации (их пока нет).

- [ ] **Step 3: Валидация ситуаций в `tools/academy-render.js`**

В `validateCourse`, внутри цикла по этапам, после проверки `quiz`, добавить (переменная `questionIds` уже есть — завести рядом `scenarioIds = new Set()` перед циклом этапов):

```js
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
```

- [ ] **Step 4: Написать 20 ситуаций в `academy-content.js`**

Правила текста (из спецификации): лучший вариант и все разборы следуют из текста гайдов-источников (сверить с `guide-content.js` перед записью); неверные варианты — правдоподобные ошибки игроков, а не очевидные глупости; разбор каждого варианта 1–2 предложения, на «ты»; `context` — короткая строка «минута · место · роль»; патч-зависимые числа — только с `checked: CHECKED` (константа уже есть в файле). Позиция лучшего ответа задана ниже (A=0, B=1, C=2) — так ответы разнесены.

Добавить поле `scenarios` в каждый этап после `quiz`. Содержание:

| id | context | Ситуация | Лучший (позиция) | Неверные варианты | sources | checked |
|---|---|---|---|---|---|---|
| getting-started-s1 | «первый день · клиент игры» | Только установил игру и хочешь сразу играть рейтинг | B: 3–5 матчей с ботами, потом обычный All Pick | A: сразу рейтинг — «так быстрее научусь»; C: только Turbo, пока не наберёшь сотню матчей | beginner-start, game-modes | — |
| getting-started-s2 | «первые матчи · линия» | Забываешь денаить: для этого надо жать атаку и кликать по своему крипу | C: включить денай правой кнопкой | A: перестать денаить — «это не моё золото»; B: включить быстрое применение сразу для всех способностей | settings-for-beginners, last-hitting-denying | — |
| choose-role-and-hero-s1 | «пик · ты выбираешь последним» | У вас уже керри и мидер, в составе нет ни одного героя с контролем | A: герой с контролем/инициацией на свободную роль | B: ещё один керри — «урона много не бывает»; C: самый популярный герой патча, неважно какой роли | hero-picking-basics, roles-explained | — |
| choose-role-and-hero-s2 | «10-й матч · ты новичок» | Каждый матч берёшь нового героя и путаешься в способностях | B: 3–4 простых героя (сложность 1) на разные роли | A: продолжать пробовать всех, чтобы найти «своего»; C: сразу учить самых сложных — «потом будет легче» | best-heroes-for-beginners, beginner-start | — |
| win-the-lane-s1 | «3:40 · лёгкая линия · ты керри» | Вражеский саппорт бьёт тебя у своей волны, когда идёшь добивать; полздоровья, есть Tango и Healing Salve | B: встать за свою волну, добивать оттуда, бить саппорта, когда он без крипов; лечиться Salve на безопасном расстоянии | A: ответить атакой у его крипов (агро); C: уйти на базу лечиться | laning-stage, creep-aggro | — |
| win-the-lane-s2 | «2:10 · линия · ты керри» | Твой крип почти без здоровья, рядом стоит вражеский керри и ждёт его добить | A: заденаить крипа | B: не трогать — своё золото за него не получишь; C: ударить вражеского героя, пока он отвлёкся (под его крипами) | last-hitting-denying | — |
| farm-and-read-map-s1 | «9:00 · линия · нужен предмет с базы» | Твоя волна у тебя, нужно уйти на базу | C: сначала выпушить волну к башне противника, потом уходить | A: уйти сразу — волна подождёт; B: заморозить волну у своей башни и уйти | wave-management | — |
| farm-and-read-map-s2 | «14:00 · свой лес · ты фармишь» | На миникарте пропали трое противников | B: отойти ближе к союзникам/в зону обзора и пингануть пропавших | A: доделать лагерь — до тебя не дойдут; C: пойти одному искать их в лес противника | minimap-awareness, farming-efficiency | — |
| fight-and-improve-s1 | «22:00 · перед дракой · ты керри» | Драка вот-вот начнётся, у противника не потрачен контроль | A: держаться за инициатором и войти, когда контроль потратят | B: зайти первым, чтобы нанести больше урона; C: стоять в узком проходе рядом с союзниками | teamfight-positioning | — |
| fight-and-improve-s2 | «после матча · 9 смертей» | Хочешь понять, почему матч проигран | C: открыть каждую свою смерть и отмотать на 20–30 секунд назад | A: пересмотреть весь матч подряд; B: вместо своей записи посмотреть матч профессионалов на этом герое | replay-analysis | — |
| build-improvement-loop-s1 | «вечер · 3 поражения подряд» | Хочется сразу сыграть ещё, чтобы отыграться | A: остановиться по заранее заданному правилу и сделать перерыв | B: сыграть ещё одну — «следующая точно наша»; C: продолжать, но писать союзникам, что им делать | mmr-climbing-mindset, tilt-control | — |
| build-improvement-loop-s2 | «выбор героя в пул» | У героя высокий винрейт в публичных матчах, хочешь сразу взять его в рейтинг | B: посмотреть винрейт на своей роли вместе с частотой пиков и уровнем матчей и сначала опробовать в обычных | A: брать сразу — винрейт всё доказал; C: игнорировать статистику целиком | reading-hero-stats | — |
| pick-role-and-pool-s1 | «драфт · последний пик» | Ваш план — поздняя игра: все герои сильны к 35–40 минуте | C: взять героя, сильного в начале игры, чтобы закрыть ранее окно | A: ещё одного позднего героя — усилить план; B: героя, очень сильного только в одном узком сценарии | draft-fundamentals | — |
| pick-role-and-pool-s2 | «рейтинг · роль саппорт» | В пуле 15 героев на всех позициях, результаты нестабильные | A: сузить пул до 5–10 героев основной роли | B: расширять пул под каждую новую мету; C: играть каждую игру на новой позиции, чтобы «понимать всех» | mmr-climbing-mindset, hero-picking-basics | — |
| lane-and-economy-s1 | «18:00 · ты собираешься в лес противника без обзора» | У тебя много ненадёжного золота, копишь на дорогой предмет | B: потратить золото на компонент перед выходом | A: идти с золотом — до предмета немного; C: стоять на базе, пока не накопишь | gold-and-experience | `checked: CHECKED` |
| lane-and-economy-s2 | «4:00 · линия · ты керри» | Офлейнер противника явно сильнее тебя на линии | C: фриз — держать волну у своей башни | A: пушить волну к его башне; B: уйти с линии фармить лес соперника | wave-management, laning-stage | — |
| read-map-and-tempo-s1 | «5:40 · мид» | Через 20 секунд на реке появится руна силы | A: заранее подготовить волну и встать у точки руны | B: дофармить волну и пойти, когда руна появится; C: не ходить — руны не важны | match-timings | `checked: CHECKED` |
| read-map-and-tempo-s2 | «24:00 · команда идёт на Рошана» | Противник мог поставить варды у активной ямы | B: сначала снять вражеские варды у ямы и закрыть обзор | A: идти сразу — быстрее убьём; C: поставить обзорный вард в своём лесу | warding-map-control, map-objectives-741 | `checked: CHECKED` |
| teamfight-decisions-s1 | «36:00 · ты керри» | Золота хватает на крупный предмет, но после покупки не останется на выкуп | A: убедиться, что золото на выкуп останется, или отложить покупку | B: купить — предмет важнее выкупа; C: купить и надеяться не умереть | buyback-decisions | — |
| teamfight-decisions-s2 | «20:00 · голосовой чат» | Союзник оскорбляет тебя и мешает сосредоточиться | C: заглушить его голос и текст, оставить пинги | A: ответить и объяснить, кто прав; B: заглушить всех полностью, включая пинги | team-communication | — |

Итог по позициям лучшего ответа: A — 7, B — 7, C — 6.

- [ ] **Step 5: Запустить проверку и сборку**

Run: `node "$E2E/validate.js" && node build-pages.js > /dev/null && git checkout -- data/live-items.json 2>/dev/null; git status --short`
Expected: `ALL PASS`; сборка без ошибок; изменены только `academy-content.js`, `tools/academy-render.js` (и сгенерированные academy-страницы не меняются, т.к. разметка ещё не выводит ситуации — допускается, если не изменились).

- [ ] **Step 6: Commit**

```bash
git add academy-content.js tools/academy-render.js
git commit -m "Учебный центр v2: 20 игровых ситуаций и их проверка при сборке"
```

---

### Task 2: Новая разметка страниц (работает без JS)

**Files:**
- Modify: `tools/academy-render.js` (`renderIndex`, `renderLanding`, `renderCourse`, новые `renderScenario`, `renderPractice`, `renderStageNav`)
- Modify: `build-pages.js` (скрипт `/js/academy-store.js`; description из данных)
- Create: `$E2E/markup.js`

**Interfaces:**
- Consumes: `scenarios` из Task 1.
- Produces — справочник `<script type="application/json" id="academyIndex">`:
  `{ version: 2, courses: { [courseId]: { title, href, modules: [{ id, title, lessons: [{ id, title }], scenarios: [id], quiz: true }] } } }`
  (задания практики = уроки этапа, отдельного списка нет: ID задания = ID урока).
- Produces — атрибуты разметки, на которые опирается JS (Task 4):
  - корень маршрута: `.ac-course[data-academy-course]`; лендинг: `.ac-landing`, карточка `.ac-route[data-academy-course]`;
  - шапка: `[data-academy-ring]` (svg-кольцо, круг прогресса `circle.ac-ring-fill`), `[data-academy-percent]`, `[data-academy-summary]`, `a[data-academy-continue]` с `[data-academy-continue-sub]`, `button[data-academy-reset]`, `[data-academy-storage]`;
  - навигация: `nav.ac-side` и `nav.ac-chiprow`, элементы `a[data-academy-nav="<moduleId>"]` с `[data-academy-nav-state]` и `.ac-dot`; `[data-academy-diary-count]`;
  - этап: `details.ac-stage[data-academy-module][id="module-<id>"]` (атрибут `open` у всех на сборке), в `summary` — `[data-academy-stat="read|scenario|quiz|practice"]` и `[data-academy-stage-badge]`;
  - вкладки: `div.ac-steps[role=tablist]` с `button.ac-step[role=tab][data-academy-step="read|scenario|quiz|practice"][aria-controls="<moduleId>-<step>"]`, панели `section.ac-panel[role=tabpanel][id="<moduleId>-<step>"][data-academy-panel="…"]`;
  - урок: `li.ac-lesson[id="lesson-<id>"][data-academy-lesson]`, `input[data-academy-done]`, `a[data-academy-open]`;
  - ситуация: `article.ac-sit[data-academy-scenario="<id>"][data-best="<n>"]`, варианты `button.ac-opt[data-academy-choice="<n>"][aria-pressed=false]`, разбор каждого варианта `[data-academy-feedback="<n>"]` внутри `details.ac-sit-reveal` (без JS — «Показать разбор»), область `[data-academy-sit-live][aria-live=polite]`, навигация `button[data-academy-sit-go="prev|next"]`, ссылка `a[data-academy-to-quiz]`;
  - тест — без изменений (`form.ac-quiz[data-academy-quiz]`);
  - практика: `li.ac-task` с `input[data-academy-task="<lessonId>"]`; дневник: `form.ac-diary[data-academy-diary="<moduleId>"]`, `textarea[name=text][maxlength=500]`, `[data-academy-diary-count-chars]`, `ol[data-academy-diary-list]`, `.ac-nojs` с текстом «Дневник и отметки работают при включённом JavaScript».

- [ ] **Step 1: Написать проверку разметки (без JS)**

```js
// $E2E/markup.js — node "$E2E/markup.js"; нужен запущенный preview-server
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const B = 'http://127.0.0.1:4173';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ javaScriptEnabled: false });
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => r.abort());
  const p = await ctx.newPage();
  for (const [u, lessons] of [['/academy/beginner/', 18], ['/academy/rank-up/', 19]]) {
    await p.goto(B + u);
    ok(await p.locator('details.ac-stage[open]').count() === 5, u + ': 5 этапов раскрыты без JS');
    ok(await p.locator('[data-academy-lesson]').count() === lessons, u + ': уроков ' + lessons);
    ok(await p.locator('[data-academy-scenario]').count() === 10, u + ': 10 ситуаций');
    ok(await p.locator('[data-academy-task]').count() === lessons, u + ': заданий практики = уроков');
    ok(await p.locator('.ac-panel').count() === 20, u + ': 20 панелей шагов');
    ok(await p.locator('.ac-panel:visible').count() === 20, u + ': все панели видны без JS');
    ok(await p.locator('details.ac-sit-reveal').count() === 10, u + ': разборы в «Показать разбор»');
    ok(await p.locator('.ac-nojs:visible').count() >= 5, u + ': пояснение «нужен JavaScript» видно');
    const idx = JSON.parse(await p.locator('#academyIndex').textContent());
    ok(idx.version === 2 && Object.keys(idx.courses).length === 2 && idx.courses.beginner.modules[0].scenarios.length === 2, u + ': справочник v2');
    ok(await p.locator('a[data-academy-nav]').count() === 10, u + ': навигация этапов (боковая + лента)');
    const sit = await p.locator('[data-academy-scenario="win-the-lane-s1"]').count() + await p.locator('[data-academy-scenario="lane-and-economy-s1"]').count();
    ok(sit === 1, u + ': ситуации своего маршрута');
  }
  await p.goto(B + '/academy/');
  ok(await p.locator('.ac-route').count() === 2, 'лендинг: 2 маршрута');
  ok(await p.locator('.ac-how li').count() === 4, 'лендинг: 4 плитки «как устроено»');
  ok(await p.locator('.ac-track > span').count() === 10, 'лендинг: по 5 сегментов на маршрут');
  ok(await p.locator('[data-academy-resume]').isHidden(), 'лендинг: панель «Продолжить» скрыта без прогресса');
  ok(/51 шаг/.test(await p.locator('.ac-route').first().textContent()), 'лендинг: «С нуля» — 51 шаг');
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Запустить — должно падать**

Run: `(pgrep -f preview-server.js >/dev/null || (nohup node preview-server.js >/dev/null 2>&1 &)); sleep 2; node "$E2E/markup.js"`
Expected: FAIL (`details.ac-stage` и прочих элементов ещё нет).

- [ ] **Step 3: Переписать функции разметки в `tools/academy-render.js`**

Сохранить: `esc`, `wordsIn`, `plural`, `guides`, `validateCourse(s)`, `guideHref`, `lessonMinutes`, `courseLessons`, `courseMinutes`, `courseHref`, `lessonAnchor`, `duration`, `renderQuiz` (без изменений поведения). Добавить и заменить:

```js
const STEPS = [
  { key: 'read', label: 'Прочитай' },
  { key: 'scenario', label: 'Разбери ситуацию' },
  { key: 'quiz', label: 'Проверь себя' },
  { key: 'practice', label: 'Сыграй и запиши' },
];
const LETTERS = ['A', 'B', 'C'];

// Шаги маршрута: уроки + ситуации + по тесту на этап + задания (= уроки).
function courseSteps(course) {
  return course.modules.reduce((s, m) => s + m.lessons.length * 2 + m.scenarios.length + 1, 0);
}

function renderIndex(courses) {
  const data = { version: 2, courses: {} };
  for (const c of validateCourses(courses)) {
    data.courses[c.id] = {
      title: c.title, href: courseHref(c),
      modules: c.modules.map(m => ({
        id: m.id, title: m.title,
        lessons: m.lessons.map(l => ({ id: l.id, title: l.title })),
        scenarios: m.scenarios.map(s => s.id), quiz: true,
      })),
    };
  }
  return `<script type="application/json" id="academyIndex">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function ring(size) {
  // r=27 → длина окружности 169.65; заполнение задаёт JS через stroke-dashoffset.
  return `<svg class="ac-ring" data-academy-ring width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">` +
    `<circle cx="32" cy="32" r="27" class="ac-ring-bg"/><circle cx="32" cy="32" r="27" class="ac-ring-fill" stroke-dasharray="169.65" stroke-dashoffset="169.65" transform="rotate(-90 32 32)"/></svg>`;
}

function renderStageNav(course) {
  const items = course.modules.map((m, i) =>
    `<li><a href="#module-${esc(m.id)}" data-academy-nav="${esc(m.id)}"><span class="ac-dot">${i + 1}</span>` +
    `<span><strong>${esc(m.title)}</strong><small data-academy-nav-state>${m.lessons.length}&nbsp;${plural(m.lessons.length, 'урок', 'урока', 'уроков')}</small></span></a></li>`).join('');
  const chips = course.modules.map((m, i) =>
    `<a href="#module-${esc(m.id)}" data-academy-nav="${esc(m.id)}"><span class="ac-dot">${i + 1}</span>${esc(m.title)}</a>`).join('');
  return {
    side: `<nav class="ac-side" aria-label="Этапы маршрута"><p class="ac-h">Этапы маршрута</p><ol>${items}</ol>` +
      `<p class="ac-side-foot">📓 <span data-academy-diary-count>Дневник пока пуст</span></p></nav>`,
    chips: `<nav class="ac-chiprow" aria-label="Этапы маршрута">${chips}</nav>`,
  };
}

function renderLessonRow(l) {
  const g = guides().get(l.guideSlug);
  const a = lessonAnchor(l);
  return `<li class="ac-lesson" id="${esc(a)}" data-academy-lesson="${esc(l.id)}">` +
    `<label class="ac-check-wrap"><input type="checkbox" class="ac-check" data-academy-done aria-labelledby="${esc(a)}-title"><span class="hm-sr">Урок пройден</span></label>` +
    `<div class="ac-lesson-main"><strong id="${esc(a)}-title">${esc(l.title)}</strong><span class="ac-tag" data-academy-badge></span>` +
    `<span class="ac-lesson-sum">${esc(l.summary)}</span></div>` +
    `<span class="ac-time">${lessonMinutes(l)}&nbsp;мин</span>` +
    `<a class="ac-open" href="${guideHref(l.guideSlug)}" data-academy-open>Открыть<span class="ac-sr">: ${esc(g.title)}</span></a>` +
    `</li>`;
}

function renderScenario(s, i, total) {
  const opts = s.options.map((o, n) =>
    `<button type="button" class="ac-opt" data-academy-choice="${n}" aria-pressed="false"><i>${LETTERS[n]}</i><span class="ac-opt-text">${esc(o.text)}</span>` +
    `<span class="ac-opt-fb" data-academy-opt-fb hidden></span></button>`).join('');
  const reveal = s.options.map((o, n) =>
    `<li data-academy-feedback="${n}"><b>${LETTERS[n]}${n === s.bestIndex ? ' — лучший вариант' : ''}.</b> ${esc(o.feedback)}</li>`).join('');
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
    `<a class="btn ac-btn" href="#" data-academy-to-quiz>К тесту →</a></div>` +
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
    `<button type="submit" class="btn ac-btn">Сохранить запись</button></div>` +
    `<ol class="ac-entries" data-academy-diary-list></ol>` +
    `</form></div>`;
}

function renderStage(course, m, i) {
  const panels = {
    read: `<ol class="ac-lessons">${m.lessons.map(renderLessonRow).join('')}</ol>`,
    scenario: m.scenarios.map((s, n) => renderScenario(s, n, m.scenarios.length)).join(''),
    quiz: renderQuiz(m, i),
    practice: renderPractice(m),
  };
  const tabs = STEPS.map((st, n) =>
    `<button type="button" class="ac-step" role="tab" id="${esc(m.id)}-${st.key}-tab" data-academy-step="${st.key}" aria-controls="${esc(m.id)}-${st.key}" aria-selected="false">` +
    `<i>${n + 1}</i><span>${st.label}<small data-academy-step-count></small></span></button>`).join('');
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
  const scen = course.modules.reduce((s, m) => s + m.scenarios.length, 0);
  const steps = courseSteps(course);
  const nav = renderStageNav(course);
  const patch = opts.patch && text(opts.patch.version)
    ? ` Изменения последнего патча — на странице <a href="/patch/${encodeURIComponent(opts.patch.version)}/">«Патч ${esc(opts.patch.version)}»</a>.` : '';
  return `<div class="ac-course" data-academy-course="${esc(course.id)}">` +
    `<section class="ac-hero"><div>` +
    `<p class="ac-kicker"><a href="/academy/">Учебный центр</a> · маршрут</p>` +
    `<h1 class="page-title">${esc(course.title)}</h1>` +
    `<p class="ac-lead">${esc(course.description)}</p><p class="ac-for">${esc(course.audience)}</p>` +
    `<ul class="ac-facts"><li>${course.modules.length}&nbsp;${plural(course.modules.length, 'этап', 'этапа', 'этапов')}</li>` +
    `<li>${lessons.length}&nbsp;${plural(lessons.length, 'урок', 'урока', 'уроков')}</li>` +
    `<li>${scen}&nbsp;${plural(scen, 'ситуация', 'ситуации', 'ситуаций')}</li><li>${duration(courseMinutes(course))}</li></ul>` +
    `</div><div class="ac-next">` +
    `<div class="ac-ring-row">${ring(64)}<div><b data-academy-percent>0%</b><span data-academy-summary>0 из ${steps} шагов</span></div></div>` +
    `<a class="ac-cta" href="#module-${esc(course.modules[0].id)}" data-academy-continue>Начать маршрут<small data-academy-continue-sub>Этап 1 · Прочитай</small></a>` +
    `<button type="button" class="ac-reset" data-academy-reset>Сбросить прогресс маршрута</button>` +
    `<p class="ac-note" data-academy-storage hidden></p>` +
    `</div></section>` +
    nav.chips +
    `<div class="ac-grid">${nav.side}<div class="ac-stages">${course.modules.map((m, i) => renderStage(course, m, i)).join('')}` +
    `<p class="ac-src">Уроки ведут на гайды DOTAMATE; ситуации и тесты составлены по ним. Числа, которые меняются с патчами, помечены датой проверки.${patch}</p>` +
    `</div></div></div>`;
}

function renderLanding(courses) {
  validateCourses(courses);
  const AUD = { beginner: ['Для новичков', 'ac-green'], 'rank-up': ['Для рейтинговых игр', 'ac-gold'] };
  const cards = courses.map(c => {
    const lessons = courseLessons(c);
    const scen = c.modules.reduce((s, m) => s + m.scenarios.length, 0);
    const steps = courseSteps(c);
    const [aud, cls] = AUD[c.id] || ['', ''];
    const track = c.modules.map(m => `<span data-academy-track="${esc(m.id)}" title="${esc(m.title)}"></span>`).join('');
    const labels = c.modules.map(m => `<span>${esc(m.title)}</span>`).join('');
    return `<article class="ac-route ${cls}" data-academy-course="${esc(c.id)}" aria-labelledby="ac-route-${esc(c.id)}">` +
      `<p class="ac-kicker ac-aud">${esc(aud)}</p>` +
      `<h2 class="page-title ac-route-title" id="ac-route-${esc(c.id)}"><a href="${courseHref(c)}">${esc(c.title)}</a></h2>` +
      `<p class="ac-route-desc">${esc(c.description)}</p>` +
      `<div class="ac-track" aria-hidden="true">${track}</div><div class="ac-track-labels" aria-hidden="true">${labels}</div>` +
      `<p class="ac-meta" data-academy-route-meta>${c.modules.length}&nbsp;этапов · ${lessons.length}&nbsp;уроков · ${scen}&nbsp;ситуаций · ${steps}&nbsp;${plural(steps, 'шаг', 'шага', 'шагов')} · ${duration(courseMinutes(c))}</p>` +
      `<a class="ac-cta ac-cta-ghost" href="${courseHref(c)}" data-academy-continue>Начать маршрут</a>` +
      `</article>`;
  }).join('');
  return `<div class="ac-landing">` +
    `<h1 class="page-title">Учебный центр Dota&nbsp;2</h1>` +
    `<p class="ac-lead">Два маршрута по гайдам DOTAMATE. В каждом этапе — уроки, игровые ситуации, короткий тест и задания на реальный матч. Прогресс и дневник хранятся только в этом браузере, без регистрации.</p>` +
    `<p class="ac-note" data-academy-storage hidden></p>` +
    `<div class="ac-resume" data-academy-resume hidden>${ring(54)}<div><b data-academy-resume-title></b><span data-academy-resume-sub></span></div>` +
    `<a class="ac-cta" href="#" data-academy-resume-go>Продолжить →</a></div>` +
    `<ol class="ac-how">` +
    `<li><b><i aria-hidden="true">📖</i>Читай</b><span>Короткие уроки ведут на подробные гайды сайта.</span></li>` +
    `<li><b><i aria-hidden="true">🧭</i>Разбирай</b><span>Игровые ситуации: выбери решение и узнай, почему оно сработает.</span></li>` +
    `<li><b><i aria-hidden="true">✅</i>Проверяй</b><span>Тест из трёх вопросов с объяснением каждого ответа.</span></li>` +
    `<li><b><i aria-hidden="true">🎮</i>Играй</b><span>Задания на матч и дневник: что получилось, что нет.</span></li></ol>` +
    `<div class="ac-routes">${cards}</div></div>`;
}

module.exports = { renderLanding, renderCourse, renderIndex, validateCourses, courseSteps };
```

Удалить старые `progressBlock` и прежние версии `renderLanding`/`renderCourse`/`renderIndex`. В `renderQuiz` заменить заголовок `<h3 class="ac-quiz-title" …>Мини-тест: этап ${index + 1}</h3>` на `<p class="ac-h" id="quiz-${esc(m.id)}-title">Мини-тест: 3 вопроса</p>` (заголовок шага уже даёт `h3` панели).

- [ ] **Step 4: `build-pages.js` — скрипт и описания из данных**

В трёх записях `PAGES` с `key: 'academy'` заменить `scripts: [{ src: '/js/academy.js', defer: true }]` на `scripts: [{ src: '/js/academy-store.js', defer: true }, { src: '/js/academy.js', defer: true }]`.

Вписанные «18 уроков» / «19 уроков» в `desc` заменить на подсчёт: после `const { COURSES } = require('./academy-content');` добавить

```js
const acLessons = id => COURSES.find(c => c.id === id).modules.reduce((s, m) => s + m.lessons.length, 0);
```

и в описаниях использовать `` `…драки и разбор реплеев. ${acLessons('beginner')} уроков, игровые ситуации, мини-тесты и задания на матч.` `` и `` `…выкуп и контроль тильта. ${acLessons('rank-up')} уроков, игровые ситуации, мини-тесты и задания на матч.` `` (обе строки — шаблонные литералы).

- [ ] **Step 5: Собрать и проверить**

Run: `node build-pages.js > /dev/null && git checkout -- data/live-items.json 2>/dev/null; node "$E2E/markup.js"`
Expected: `ALL PASS`. `git status --short` — изменены только `tools/academy-render.js`, `build-pages.js`, `academy/**`, `deploy/academy/**`.

- [ ] **Step 6: Commit**

```bash
git add tools/academy-render.js build-pages.js academy deploy/academy
git commit -m "Учебный центр v2: разметка этапов из четырёх шагов, ситуации, практика и дневник"
```

---

### Task 3: Модуль состояния `js/academy-store.js`

**Files:**
- Create: `js/academy-store.js`
- Create: `$E2E/store.js`

**Interfaces:**
- Consumes: справочник `#academyIndex` v2 (Task 2).
- Produces: `window.DMAcademyStore = { KEY, KEY_V1, MAX_TEXT, MAX_DIARY, load(index) → { state, storageOk, migrated }, save(state) → boolean, emptyCourse(), sanitize(raw, index) → state, migrateV1(raw, index) → state|null, compute(index, state, courseId) → Summary, mutate(index, fn) → { state, ok } }`.
  - `Summary = { stepsDone, stepsTotal, percent, modulesDone, modules: [{ id, title, index, read:{done,total}, scenario:{done,total}, quizTaken:boolean, bestScore:number|null, practice:{done,total}, complete:boolean, step:'read'|'scenario'|'quiz'|'practice'|null }], next: { moduleId, moduleIndex, step, itemId, label } | null, diaryCount }`
  - `next.label` — строка вида `Этап 3 · Разбери ситуацию`; `next = null`, когда маршрут пройден.
  - `mutate(index, fn)`: перечитывает хранилище (если доступно), вызывает `fn(state)`, проставляет `updatedAt = Date.now()` изменённому курсу (fn возвращает id курса), сохраняет; `ok=false`, если запись не удалась (состояние в памяти всё равно обновлено и возвращается).

- [ ] **Step 1: Написать проверку**

```js
// $E2E/store.js — node "$E2E/store.js"; нужен preview-server и собранные страницы Task 2
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const B = 'http://127.0.0.1:4173';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  // 1. перенос v1
  await p.goto(B + '/academy/beginner/');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('dotamate.academy.progress.v1', JSON.stringify({ version: 1, courses: { beginner: { completedLessons: ['beginner-start', 'game-modes', 'nope'], bestScores: { 'getting-started': 67, nope: 5 }, lastLessonId: 'game-modes' } } })); });
  await p.reload();
  const r = await p.evaluate(() => { const S = window.DMAcademyStore; const idx = JSON.parse(document.getElementById('academyIndex').textContent); const L = S.load(idx); return { L, sum: S.compute(idx, L.state, 'beginner'), v1: localStorage.getItem(S.KEY_V1), v2: localStorage.getItem(S.KEY) }; });
  ok(r.L.migrated === true, 'перенос v1 отмечен');
  ok(JSON.stringify(r.L.state.courses.beginner.completedLessons) === '["beginner-start","game-modes"]', 'уроки перенесены, неизвестный отброшен');
  ok(r.L.state.courses.beginner.bestScores['getting-started'] === 67 && !('nope' in r.L.state.courses.beginner.bestScores), 'тест перенесён');
  ok(r.v1 !== null, 'ключ v1 не удалён');
  // 2. расчёт
  ok(r.sum.stepsTotal === 51, 'С нуля: 51 шаг (получено ' + r.sum.stepsTotal + ')');
  ok(r.sum.stepsDone === 3, '2 урока + 1 тест = 3 шага (получено ' + r.sum.stepsDone + ')');
  ok(r.sum.next && r.sum.next.moduleId === 'getting-started' && r.sum.next.step === 'read' && r.sum.next.itemId === 'settings-for-beginners', 'следующий шаг — третий урок этапа 1');
  ok(r.sum.next.label === 'Этап 1 · Прочитай', 'подпись следующего шага');
  // 3. порядок шагов и завершение этапа
  const s2 = await p.evaluate(() => {
    const S = window.DMAcademyStore; const idx = JSON.parse(document.getElementById('academyIndex').textContent);
    const st = S.load(idx).state; const c = st.courses.beginner; const m = idx.courses.beginner.modules[0];
    c.completedLessons = m.lessons.map(l => l.id); const a = S.compute(idx, st, 'beginner').next;
    c.scenarioChoices[m.scenarios[0]] = 2; c.scenarioChoices[m.scenarios[1]] = 0; const b2 = S.compute(idx, st, 'beginner').next;
    c.bestScores[m.id] = 0; const c3 = S.compute(idx, st, 'beginner').next;
    c.practiceDone = m.lessons.map(l => l.id); const d = S.compute(idx, st, 'beginner');
    return { a, b2, c3, d };
  });
  ok(s2.a.step === 'scenario' && s2.a.itemId === 'getting-started-s1', 'после уроков — ситуация');
  ok(s2.b2.step === 'quiz', 'после ситуаций (любой выбор) — тест');
  ok(s2.c3.step === 'practice', 'после теста с 0% — практика');
  ok(s2.d.modules[0].complete === true && s2.d.modulesDone === 1 && s2.d.next.moduleId === 'choose-role-and-hero', 'этап 1 завершён, дальше этап 2');
  // 4. мусор и чужие версии
  for (const bad of ['{x', '{"version":3,"courses":{}}', JSON.stringify({ version: 2, courses: { beginner: { completedLessons: 'x', bestScores: { 'getting-started': Infinity }, scenarioChoices: { 'getting-started-s1': 5, 'win-the-lane-s1': 1, zzz: 1 }, practiceDone: ['game-modes', 7], diary: [{ id: 'a', moduleId: 'nope', date: 1, text: 'x' }, { id: 'b', moduleId: 'win-the-lane', date: 1, text: 'ok' }, { id: 'c', moduleId: 'win-the-lane', date: 1, text: 5 }], updatedAt: 'x' }, ghost: {} } })]) {
    const res = await p.evaluate(v => { localStorage.setItem(window.DMAcademyStore.KEY, v); const idx = JSON.parse(document.getElementById('academyIndex').textContent); return window.DMAcademyStore.load(idx).state; }, bad);
    const c = res.courses.beginner;
    const okv = bad.startsWith('{"version":2') ? (c.completedLessons.length === 0 && JSON.stringify(c.scenarioChoices) === '{"win-the-lane-s1":1}' && JSON.stringify(c.practiceDone) === '["game-modes"]' && c.diary.length === 1 && c.diary[0].text === 'ok' && !res.courses.ghost && Object.keys(c.bestScores).length === 0)
      : (c.completedLessons.length === 0 && Object.keys(c.scenarioChoices).length === 0);
    ok(okv, 'мусор отфильтрован: ' + bad.slice(0, 24));
  }
  // 5. запись недоступна
  const ctx2 = await b.newContext(); await ctx2.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => r.abort());
  await ctx2.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); }; });
  const q = await ctx2.newPage(); q.on('pageerror', e => errors.push(e.message)); await q.goto(B + '/academy/beginner/');
  const m2 = await q.evaluate(() => { const S = window.DMAcademyStore; const idx = JSON.parse(document.getElementById('academyIndex').textContent); return S.mutate(idx, st => { st.courses.beginner.completedLessons.push('beginner-start'); return 'beginner'; }); });
  ok(m2.ok === false && m2.state.courses.beginner.completedLessons[0] === 'beginner-start', 'запись не удалась — состояние в памяти обновлено, ok=false');
  ok(errors.length === 0, 'нет ошибок JS: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Запустить — должно падать**

Run: `node "$E2E/store.js"`
Expected: падение на `window.DMAcademyStore` (не определён).

- [ ] **Step 3: Реализовать `js/academy-store.js`**

```js
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
```

- [ ] **Step 4: Запустить проверку**

Run: `node --check js/academy-store.js && node "$E2E/store.js"`
Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add js/academy-store.js
git commit -m "Учебный центр v2: модуль состояния — хранение v2, перенос с v1, расчёт шагов"
```

---

### Task 4: Интерфейс `js/academy.js`

**Files:**
- Modify (переписать целиком): `js/academy.js`
- Create: `$E2E/ui.js`

**Interfaces:**
- Consumes: `window.DMAcademyStore` (Task 3), атрибуты разметки (Task 2).
- Produces: поведение страниц; глобальных имён не добавляет.

Поведение (всё — из спецификации):
- **Инициализация.** Нет `#academyIndex` или `DMAcademyStore` — выход без ошибок. `document.documentElement.classList.add('ac-js')` (CSS скрывает `.ac-nojs` и `details.ac-sit-reveal` только при `.ac-js`).
- **Этапы.** На странице маршрута все `details.ac-stage` закрываются, кроме этапа следующего шага (или первого, если маршрут пройден). Если в адресе `#lesson-<id>` или `#module-<id>` — открыть этот этап (для урока — вкладку `read`) и прокрутить к элементу. Клик по `a[data-academy-nav]` — открыть этап, прокрутить, `history.replaceState` с хешем.
- **Вкладки.** В каждом этапе активна вкладка его текущего шага (`mod.step`, для завершённого — `read`); у остальных `section.ac-panel` — `hidden`. Клик/Enter/Space по вкладке — активировать; стрелки ←/→ — соседняя вкладка с фокусом; `aria-selected`, `tabindex` (0 у активной, −1 у остальных). Счётчики `[data-academy-step-count]`: «3 из 3» / «1 из 2» / «3 вопроса» или «лучший 67%» / «0 из 3»; у выполненного шага класс `is-done` (значок ✓ через CSS).
- **Уроки.** Чекбокс → `mutate`, отметка в `completedLessons`. Клик/auxclick по `a[data-academy-open]` → `lastLessonId`. Следующий урок — класс `is-next`, `[data-academy-badge]` = «Следующий»; пройденный — `is-done`, бейдж пустой.
- **Ситуации.** В этапе показывается одна ситуация (остальные `hidden`); начальная — первая неразобранная, иначе первая. Клик по варианту → сохранить `scenarioChoices[id]=n`; отметить выбранный `aria-pressed=true`; выбранному показать разбор в `[data-academy-opt-fb]` с меткой «Твой выбор» (класс `is-wrong`, если не лучший) или «Лучше» (если лучший); лучшему — «Лучше» и разбор; в `[data-academy-sit-live]` — «Ответ сохранён. Лучший вариант — B.»; повторный клик по другому варианту меняет выбор. Тексты разборов JS берёт из `details.ac-sit-reveal li[data-academy-feedback="n"]` (без префикса `<b>`). Кнопки «← Предыдущая»/«Следующая →» переключают ситуацию (неактивные — `disabled`); «К тесту →» — активирует вкладку `quiz`.
- **Тест.** Поведение MVP (проверка, разбор, «Пройти ещё раз», лучший результат) — перенести функции `clearQuizFeedback`, `gradeQuiz` без изменений, сохранение через `mutate` (`bestScores[m] = max`).
- **Практика.** Чекбокс `data-academy-task` → `practiceDone`.
- **Дневник.** Ввод → счётчик «N / 500 · только в этом браузере». Отправка: пустой текст → сообщение в счётчике «Запись пустая», фокус в поле; иначе `mutate`: `diary.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), moduleId, date: Date.now(), text: text.slice(0, 500) })`; при длине > 30 удалить самую старую и показать в счётчике «Сохранено. Самая старая запись удалена: в дневнике хранится до 30 записей.». Если `mutate().ok === false` — поле НЕ очищать, показать предупреждение хранилища; иначе очистить поле. Список `[data-academy-diary-list]` — записи этого этапа, новые сверху: `<li>` с `<time>` (дата `toLocaleDateString('ru-RU', { day:'numeric', month:'long' })`), текст через `textContent` (с сохранением переводов строк через CSS `white-space:pre-line`) и кнопкой «Удалить» (`aria-label="Удалить запись от <дата>"`), удаление без подтверждения.
- **Шапка маршрута.** Кольцо: `stroke-dashoffset = 169.65 * (1 - percent/100)`; `[data-academy-percent]` = «34%»; `[data-academy-summary]` = «N из M шагов · этапов завершено K»; кнопка: нет прогресса — «Начать маршрут», есть — «Следующий шаг», пройден — «Маршрут пройден»; подпись `[data-academy-continue-sub]` = `next.label` или «Вернуться к началу»; `href` = `#module-<id>`; клик — открыть этап, активировать вкладку `next.step`, прокрутить к нему, для урока/ситуации/задания — сфокусировать элемент.
- **Навигация этапов.** У `a[data-academy-nav]`: `.ac-dot` — «✓» и класс `is-done` для завершённого, класс `is-cur` для этапа следующего шага; `[data-academy-nav-state]` = «Завершён» / «Шаг N из 4 · <шаг строчными>» / «M уроков»; `[data-academy-diary-count]` = «В дневнике N записей» (склонение) или «Дневник пока пуст».
- **Чипы этапа** в `summary`: «Чтение 2/3», «Ситуации 1/2», «Тест 67%» или «Тест —», «Практика 0/3»; выполненный тип — класс `ok`; завершённый этап — класс `is-done` у `details` и бейдж «✓ Завершён».
- **Лендинг.** Для каждой `.ac-route`: сегменты `[data-academy-track]` — `done` (этап завершён) / `half` (что-то сделано) / пусто; если в маршруте есть прогресс — `[data-academy-route-meta]` = «K из 5 этапов · N из M шагов · записей в дневнике D», кнопка — «Продолжить: <STEP_LABEL>» (класс `ac-cta-ghost` снять), `href` = `<href>#module-<id>`; пройден — «Маршрут пройден — повторить». Панель `[data-academy-resume]`: показать, если хоть у одного маршрута `updatedAt > 0`; берётся маршрут с наибольшим `updatedAt`; заголовок «Продолжить «<маршрут>»», подпись «<next.label> · пройдено N%» (или «Маршрут пройден»), кнопка — на `href#module-<id>`, кольцо — процент.
- **Сброс.** `confirm('Сбросить прогресс маршрута «<название>»? Удалятся отметки уроков и заданий, ответы в ситуациях, результаты тестов и записи дневника этого маршрута. Другой маршрут не изменится.')` → `change(st => { st.courses[id] = S.emptyCourse(); return null; })` — функция возвращает `null`, чтобы `mutate` не проставил `updatedAt` и сброшенный маршрут не попал в панель «Продолжить»; формы тестов сбросить; перерисовать.
- **Хранилище.** Если `load().storageOk === false` или любая `mutate().ok === false` — показать `[data-academy-storage]`: «Прогресс не сохранится: браузер не разрешает сайту хранить данные. Уроки, ситуации и тесты работают, но отметки и дневник пропадут после перезагрузки страницы.».
- **Синхронизация вкладок.** `window` `storage` с ключом `KEY` или `null` → перерисовать (без перестановки открытых этапов и вкладок).
- Перерисовка — одна функция `renderAll()`; она не меняет, какие этапы открыты и какая вкладка активна (это делает только инициализация и явные действия).

- [ ] **Step 1: Написать проверку интерфейса**

```js
// $E2E/ui.js — node "$E2E/ui.js"; нужен preview-server
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const B = 'http://127.0.0.1:4173', KEY = 'dotamate.academy.progress.v2';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const st = p => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => r.abort());
  const errors = []; const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(B + '/academy/beginner/'); await p.evaluate(() => localStorage.clear()); await p.reload();
  ok(await p.locator('details.ac-stage[open]').count() === 1 && await p.locator('#module-getting-started').getAttribute('open') !== null, 'открыт только этап 1');
  ok(await p.locator('#getting-started-read').isVisible() && await p.locator('#getting-started-scenario').isHidden(), 'активна вкладка «Прочитай»');
  ok((await p.textContent('[data-academy-continue]')).includes('Начать маршрут'), 'кнопка «Начать маршрут»');
  // уроки → ситуации
  for (const id of ['beginner-start', 'game-modes', 'settings-for-beginners', 'hotkeys-binds']) await p.check(`#lesson-${id} [data-academy-done]`);
  ok((await p.textContent('[data-academy-continue-sub]')) === 'Этап 1 · Разбери ситуацию', 'следующий шаг — ситуация');
  ok((await p.textContent('#module-getting-started [data-academy-stat="read"]')).includes('4/4'), 'чип «Чтение 4/4»');
  await p.click('[data-academy-continue]');
  ok(await p.locator('#getting-started-scenario').isVisible(), 'кнопка открыла вкладку ситуаций');
  const sit = p.locator('[data-academy-scenario="getting-started-s1"]');
  ok(await sit.isVisible() && await p.locator('[data-academy-scenario="getting-started-s2"]').isHidden(), 'показана одна ситуация');
  await sit.locator('[data-academy-choice="0"]').click(); // неверный (лучший — B=1)
  ok(await sit.locator('[data-academy-choice="0"]').getAttribute('aria-pressed') === 'true', 'выбор отмечен');
  ok((await sit.locator('[data-academy-choice="0"] [data-academy-opt-fb]').textContent()).includes('Твой выбор') && await sit.locator('[data-academy-choice="1"] [data-academy-opt-fb]').isVisible(), 'разбор выбранного и лучшего');
  ok((await sit.locator('[data-academy-sit-live]').textContent()).includes('B'), 'живой регион называет лучший вариант');
  await sit.locator('[data-academy-choice="1"]').click();
  ok((await st(p)).courses.beginner.scenarioChoices['getting-started-s1'] === 1, 'выбор можно изменить');
  await sit.locator('[data-academy-sit-go="next"]').click();
  ok(await p.locator('[data-academy-scenario="getting-started-s2"]').isVisible(), '«Следующая» переключает ситуацию');
  await p.locator('[data-academy-scenario="getting-started-s2"] [data-academy-choice="2"]').click();
  await p.locator('[data-academy-scenario="getting-started-s2"] [data-academy-to-quiz]').click();
  ok(await p.locator('#getting-started-quiz').isVisible(), '«К тесту» открывает вкладку теста');
  // вкладки с клавиатуры
  await p.focus('#getting-started-quiz-tab'); await p.keyboard.press('ArrowRight');
  ok(await p.evaluate(() => document.activeElement.id) === 'getting-started-practice-tab' && await p.locator('#getting-started-practice').isVisible(), 'стрелка → переключает вкладку');
  // дневник: XSS, пустой, сохранение
  const f = p.locator('[data-academy-diary="getting-started"]');
  await f.locator('button[type=submit]').click();
  ok((await f.locator('[data-academy-diary-count-chars]').textContent()).includes('пустая'), 'пустая запись не сохраняется');
  await f.locator('textarea').fill('<img src=x onerror="window.__x=1">\nвторая строка');
  await f.locator('button[type=submit]').click();
  ok(await f.locator('[data-academy-diary-list] li').count() === 1 && (await f.locator('[data-academy-diary-list] li').textContent()).includes('<img src=x'), 'запись выведена текстом');
  ok(await p.evaluate(() => window.__x === undefined && !document.querySelector('.ac-entries img')), 'HTML из дневника не исполнен');
  ok((await f.locator('textarea').inputValue()) === '', 'поле очищено после сохранения');
  // предел 30
  await p.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); for (let i = 0; i < 29; i++) s.courses.beginner.diary.push({ id: 'z' + i, moduleId: 'getting-started', date: 1000 + i, text: 'старая ' + i }); localStorage.setItem(k, JSON.stringify(s)); }, KEY);
  await p.reload(); await p.click('#module-getting-started [data-academy-step="practice"]');
  await f.locator('textarea').fill('тридцать первая'); await f.locator('button[type=submit]').click();
  const s30 = await st(p);
  ok(s30.courses.beginner.diary.length === 30 && !s30.courses.beginner.diary.some(e => e.id === 'z0'), 'хранится 30, самая старая удалена');
  ok((await f.locator('[data-academy-diary-count-chars]').textContent()).includes('Самая старая'), 'уведомление об удалении старой записи');
  // практика и завершение этапа
  await p.click('#module-getting-started [data-academy-step="quiz"]');
  for (const [q, a] of [[1, 0], [2, 1], [3, 2]]) await p.check(`#q-getting-started-${q}-${a}`);
  await p.click('[data-academy-quiz="getting-started"] button[type=submit]');
  await p.click('#module-getting-started [data-academy-step="practice"]');
  for (const box of await p.$$('#module-getting-started [data-academy-task]')) await box.check();
  ok((await p.textContent('#module-getting-started [data-academy-stage-badge]')).includes('Завершён'), 'этап 1 завершён');
  ok((await p.textContent('a[data-academy-nav="getting-started"] .ac-dot')) === '✓', 'кружок этапа — ✓');
  // старые ссылки на урок
  await p.goto(B + '/academy/beginner/#lesson-wave-management');
  ok(await p.locator('#module-farm-and-read-map').getAttribute('open') !== null && await p.locator('#lesson-wave-management').isVisible(), '#lesson-… открывает этап и урок');
  // сброс одного маршрута
  await p.goto(B + '/academy/rank-up/'); await p.check('#lesson-mmr-climbing-mindset [data-academy-done]');
  await p.goto(B + '/academy/beginner/'); p.once('dialog', d => d.accept()); await p.click('[data-academy-reset]');
  const sr = await st(p);
  ok(sr.courses.beginner.diary.length === 0 && sr.courses.beginner.completedLessons.length === 0 && sr.courses['rank-up'].completedLessons.length === 1, 'сброс очистил только «С нуля», включая дневник');
  // лендинг
  await p.goto(B + '/academy/');
  ok(await p.locator('[data-academy-resume]').isVisible() && (await p.textContent('[data-academy-resume-title]')).includes('Поднять рейтинг'), 'панель «Продолжить» — последний изменённый маршрут');
  ok(await p.locator('.ac-route[data-academy-course="rank-up"] [data-academy-track].half').count() === 1, 'полоса этапов: этап начат');
  // запись дневника при запрете хранилища — текст не теряется
  const c2 = await b.newContext(); await c2.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => r.abort());
  await c2.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Quota'); }; });
  const q = await c2.newPage(); q.on('pageerror', e => errors.push(e.message)); await q.goto(B + '/academy/beginner/');
  await q.click('#module-getting-started [data-academy-step="practice"]');
  const fq = q.locator('[data-academy-diary="getting-started"]'); await fq.locator('textarea').fill('важная заметка'); await fq.locator('button[type=submit]').click();
  ok((await fq.locator('textarea').inputValue()) === 'важная заметка' && await q.locator('[data-academy-storage]').isVisible(), 'хранилище недоступно: текст не стёрт, предупреждение показано');
  ok(errors.length === 0, 'нет ошибок JS: ' + errors.join(' | '));
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Запустить — должно падать**

Run: `node "$E2E/ui.js"`
Expected: FAIL (старый `js/academy.js` не знает новой разметки).

- [ ] **Step 3: Переписать `js/academy.js` по описанному поведению**

Структура файла (ES5, IIFE, `'use strict'`): константы и ссылки на `S = window.DMAcademyStore`, `INDEX`; `state()` → `S.current(INDEX).state`; `change(fn)` → `S.mutate(INDEX, fn)`, при `ok === false` — `showStorageNote()`, затем `renderAll()`; функции `openStage(moduleId)`, `selectTab(stageEl, step, focus)`, `showScenario(stageEl, n)`, `renderScenarioState(sitEl, choice)`, `renderCourse(root, sum, c)`, `renderLanding()`, `renderAll()`; перенесённые из MVP `clearQuizFeedback`, `gradeQuiz` (сохранение лучшего результата через `change`); обработчики `change`, `click`, `auxclick`, `submit`, `input`, `keydown` (делегированные на `document`) и `storage` на `window`; инициализация `init()` (класс `ac-js`, начальное состояние этапов, вкладок и ситуаций, хеш). Склонение — `plural(n, one, few, many)` как в MVP.

- [ ] **Step 4: Запустить проверки**

Run: `node --check js/academy.js && node "$E2E/ui.js" && node "$E2E/store.js"`
Expected: оба `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add js/academy.js
git commit -m "Учебный центр v2: вкладки шагов, ситуации, практика, дневник, следующий шаг и панель «Продолжить»"
```

---

### Task 5: Оформление по макету `css/academy.css`

**Files:**
- Modify (переписать целиком): `css/academy.css`
- Create: `$E2E/layout.js`

**Interfaces:**
- Consumes: классы разметки Task 2 и состояния Task 4 (`is-done`, `is-next`, `is-cur`, `ok`, `is-wrong`, `ac-js`, `half`, `done`).
- Produces: вид по `docs/superpowers/mockups/academy-v2/mock.css`.

Соответствие классов макета и кода: `mx-hero→ac-hero`, `mx-next→ac-next`, `mx-ring→ac-ring-row`, `mx-btn→ac-cta` (`.ghost→ac-cta-ghost`), `mx-reset→ac-reset`, `mx-grid→ac-grid`, `mx-side→ac-side`, `mx-dot→ac-dot` (`done→is-done`, `cur→is-cur`), `mx-chiprow→ac-chiprow`, `mx-stage→ac-stage`, `mx-num→ac-num`, `mx-stats/mx-stat→ac-stats/ac-stat`, `mx-badge→ac-stage-badge`, `mx-chev→ac-chev`, `mx-body→ac-stage-body`, `mx-intro→ac-intro`, `mx-steps/mx-step→ac-steps/ac-step` (`is-on→[aria-selected=true]`, `ok→is-done`), `mx-h→ac-h`, `mx-lessons/mx-lesson→ac-lessons/ac-lesson` (`done→is-done`, `next→is-next`), `mx-check→ac-check` (нативный чекбокс со стилем `appearance:none`), `mx-time→ac-time`, `mx-open→ac-open`, `mx-tag→ac-tag`, `mx-sit→ac-sit`, `mx-sit-head→ac-sit-head`, `mx-opts/mx-opt→ac-opts/ac-opt` (`best→is-best`, `wrong→is-wrong`), `mx-src→ac-src`, `mx-pager→ac-sit-nav`, `mx-two/mx-box→ac-two/ac-box`, `mx-task→ac-task`, `mx-ta→.ac-diary textarea`, `mx-row→ac-row`, `mx-entry→.ac-entries li`, `mx-resume→ac-resume`, `mx-how→ac-how`, `mx-routes/mx-route→ac-routes/ac-route` (`ac-green`/`ac-gold` — фон-градиент), `mx-track→ac-track` (`span.done`, `span.half`), `mx-tl→ac-track-labels`, `mx-meta→ac-meta`.

Дополнительно к макету:
- `.ac-js .ac-nojs{display:none}`; `.ac-js details.ac-sit-reveal{display:none}`; без `.ac-js` — `.ac-diary textarea, .ac-diary button, .ac-check{display:none}` не делать: элементы остаются видимыми, просто неактивны.
- `.ac-panel[hidden]{display:none}`, `.ac-sit[hidden]{display:none}`; без `.ac-js` у `.ac-steps` — `display:none` (вкладки без JS не нужны: все панели видны подряд с заголовками `ac-panel-title`); с `.ac-js` заголовок `ac-panel-title` визуально скрыт (`.ac-sr`-правило), но остаётся для читалок.
- Отметки: `.ac-check` — 22–24px, `appearance:none`, рамка; `:checked` — зелёный фон и тёмная жирная галочка `✓` (через `::after`, `color:#0b1a0b; font-weight:900`) — правка с макета.
- Фокус: `:focus-visible` у ссылок, кнопок, вкладок, чекбоксов, `summary` — `outline:2px solid var(--d2-gold); outline-offset:3px`.
- Кнопки `.ac-cta`, `.ac-btn` — с `!important` там, где их перебивает `.btn` светлой темы (как в MVP).
- Дневник: `.ac-entries li{white-space:pre-line;overflow-wrap:anywhere}`.
- Телефон (≤ 560px): плитки `.ac-how` — одна строка из четырёх значков с подписью без пояснения (`grid-template-columns:repeat(4,1fr)`, `span{display:none}`, текст по центру); `.ac-resume` — сетка `auto 1fr` (кольцо рядом с текстом), кнопка на всю ширину отдельной строкой; `summary` этапа — номер над заголовком (как исправлено в макете); `.ac-stat` — 11.5px.
- ≤ 980px: `.ac-side{display:none}`, `.ac-chiprow{display:flex;overflow-x:auto;max-width:100%}` (без отрицательных полей — из-за них было +4px переполнения в макете), `.ac-hero` и `.ac-grid` в одну колонку, `.ac-steps` 2×2, `.ac-two` в одну колонку, `.ac-routes` в одну колонку.
- `@media(prefers-reduced-motion:reduce)` — без переходов.

- [ ] **Step 1: Написать проверку раскладки**

```js
// $E2E/layout.js — node "$E2E/layout.js"; preview-server; шрифты Google разрешены
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const B = 'http://127.0.0.1:4173', OUT = __dirname;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  for (const w of [360, 390, 768, 1024, 1280]) {
    const c = await b.newContext({ viewport: { width: w, height: 900 } });
    await c.route(/^(?!http:\/\/127\.0\.0\.1).*/, r => /fonts\.(googleapis|gstatic)\.com/.test(r.request().url()) ? r.continue() : r.abort());
    const p = await c.newPage();
    for (const u of ['/academy/', '/academy/beginner/', '/academy/rank-up/']) {
      await p.goto(B + u); await p.waitForTimeout(1500);
      if (u !== '/academy/') await p.evaluate(() => { document.querySelectorAll('details.ac-stage').forEach(d => { d.open = true; }); });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= w, `${u} @${w}: нет горизонтальной прокрутки (${sw})`);
    }
    await p.goto(B + '/academy/beginner/'); await p.waitForTimeout(1500);
    const side = await p.locator('.ac-side').isVisible(), chips = await p.locator('.ac-chiprow').isVisible();
    ok(w > 980 ? side && !chips : !side && chips, `@${w}: ${w > 980 ? 'боковая панель' : 'лента этапов'}`);
    const fo = await p.evaluate(() => { const e = document.querySelector('.ac-step'); e.focus(); return getComputedStyle(e).outlineStyle; });
    ok(fo !== 'none', `@${w}: видимый фокус на вкладке`);
    await c.close();
  }
  await b.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Запустить — должно падать**

Run: `node "$E2E/layout.js"`
Expected: FAIL (старый CSS: нет `.ac-side`/`.ac-chiprow` правил, панель/лента видны неверно).

- [ ] **Step 3: Переписать `css/academy.css`** по макету и списку дополнений выше (шапка файла — комментарий, как в MVP: где разметка и поведение, что цвета — переменные тёмной темы, почему `!important` у кнопок).

- [ ] **Step 4: Проверки**

Run: `node "$E2E/layout.js" && node "$E2E/ui.js" && node "$E2E/markup.js"`
Expected: все три `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add css/academy.css
git commit -m "Учебный центр v2: оформление по утверждённому макету"
```

---

### Task 6: Сборка, скриншоты, ревью и обновление PR

**Files:**
- Generated: `academy/**`, `deploy/academy/**` (`node build-pages.js`).
- Create: `$E2E/shots.js` (скриншоты для владельца).

- [ ] **Step 1: Финальная сборка и чистота дерева**

Run: `node build-pages.js > /dev/null && git checkout -- data/live-items.json 2>/dev/null; node build-sitemap.js > /dev/null; git status --short`
Expected: изменения только в `academy/**`, `deploy/academy/**` (если разметка менялась после Task 2). `sitemap.xml` не должен меняться по сути (адреса те же); если меняется только `lastmod` — откатить `git checkout -- sitemap.xml deploy/sitemap.xml`.

- [ ] **Step 2: Полный прогон проверок**

Run: `for t in validate markup store ui layout; do node "$E2E/$t.js" | tail -1; done`
Expected: пять строк `ALL PASS`.

- [ ] **Step 3: Регрессия MVP-сценариев теста**

Run: `node /tmp/claude-0/-home-user-dotamate/5b6481ca-dacb-5b0a-b50c-ca99ef4f6a80/scratchpad/e2e/check.js | tail -3`
Expected: проверки теста (пустая отправка, неверный ответ, повтор, лучший результат) проходят; падения, связанные со старой разметкой (`.ac-progress-text`, «Отмечено 1 из 18»), ожидаемы — перечислить их в отчёте как устаревшие, а не чинить.

- [ ] **Step 4: Скриншоты для владельца**

Снять с загруженными шрифтами Google (как в `$E2E/layout.js`), закрепив шапку `.topbar{position:static!important}` для снимков элементов: лендинг с прогрессом (1280 и 390), шапка маршрута + боковая панель (1280), этап с ситуацией после ответа (1280 и 390), практика и дневник (1280), лента этапов (390). Сохранить в `$E2E/shots/`, отправить владельцу через SendUserFile.

- [ ] **Step 5: Финальное ревью ветки** — отдельным агентом на самом сильном доступном model, по `superpowers:requesting-code-review` (`code-reviewer.md`), диапазон от `4878cb7` до `HEAD`, с этим планом, спецификацией и Review Focus.

- [ ] **Step 6: Исправить Critical/Important** (каждое — падающая проверка → исправление → полный прогон), закоммитить, `git push -u origin claude/epic-hopper-4cutbo`.

- [ ] **Step 7: Обновить описание PR #1** — раздел «Учебный центр v2»: что добавлено, сколько ситуаций, что их тексты написал Claude по гайдам и их нужно просмотреть до публикации, проверки, отложенные мелочи. Не сливать, не публиковать.
