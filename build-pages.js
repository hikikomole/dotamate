#!/usr/bin/env node
// Собирает страницы разделов из общего каркаса (page-shell.html) и разметки
// секций (page-sections.html).
//
// Зачем: раньше весь сайт был одной страницей — шесть разделов подряд в
// index.html, переходы якорями. Для поиска это одна страница с одним
// <title>, и по запросу «предметы Dota 2» показать было нечего, кроме
// главной. Теперь у каждого раздела свой адрес, заголовок и описание.
//
// Страницы пишутся и в корень проекта (для preview-server), и в deploy/
// (то, что уходит на Cloudflare) — как это делают остальные сборщики.

const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://dotamate.ru';
const ROOT = __dirname;

const { NAV, navHtml } = require('./tools/site-nav');
const { COURSES } = require('./academy-content');
const acLessons = id => COURSES.find(c => c.id === id).modules.reduce((s, m) => s + m.lessons.length, 0);
const acItems = () => COURSES.reduce((s, c) => s + c.modules.reduce((x, m) => x + m.quiz.length + m.scenarios.length, 0), 0);
// Маршруты по ролям (academy-roles-content.js): страница на каждый, тексты описаний — из данных курса.
const ROLE_SEO = {
  carry: 'Как играть на керри в Dota 2 — маршрут обучения позиции 1',
  mid: 'Как играть на миде в Dota 2 — маршрут обучения позиции 2',
  offlane: 'Как играть на оффлейне в Dota 2 — маршрут обучения позиции 3',
  support: 'Как играть на саппорте в Dota 2 — маршрут обучения позиций 4 и 5',
};
const rolePages = () => COURSES.filter(c => c.group === 'role').map(c => ({
  key: 'academy', dir: `academy/${c.slug}`, academy: c.id, crumb: c.title, parent: { name: 'Учебный центр', dir: 'academy' },
  title: `${ROLE_SEO[c.id] || `${c.title} — маршрут обучения Dota 2`} | Dota Mate`,
  desc: `${c.description} ${acLessons(c.id)} уроков, игровые ситуации, мини-тесты и задания на матч.`,
  sections: ['academy'],
  styles: ['/css/theme-dark.css', '/css/academy.css'],
  bodyClass: 'd2-dark',
  scripts: [{ src: '/js/academy-store.js', defer: true }, { src: '/js/academy-records.js', defer: true }, { src: '/js/academy.js', defer: true }],
}));
const { renderLanding, renderCourse, renderIndex, renderMatchPage, renderPracticePage, validateCourses } = require('./tools/academy-render');

const PAGES = [
  {
    key: 'home', dir: '',
    title: 'Dota Mate — герои, предметы, статистика и гайды',
    desc: 'DraftMate — драфт Dota 2 по числам: синергия, контрпики и расклад по линиям на 8001 паре героев из матчей Divine и Immortal. 127 героев, 253 предмета, сборки и гайды.',
    // draftTool идёт сразу за первым экраном — как на живой главной.
    // Раньше секции тут не было, и запуск сборщика стирал инструмент драфта
    // из index.html: разметка жила только в собранном файле.
    sections: ['home-hero', 'draftTool', 'homeDaily', 'home-cards', 'featuredHeroes'],
    styles: ['/css/theme-dark.css', '/css/home-hero.css', '/css/draft-tool.css'],
    bodyClass: 'd2-dark',
    // defer у draft-tool.js сохраняет прежний порядок выполнения: скрипт
    // отрабатывает после v43-features.js, как было при ручной правке.
    scripts: [{ src: '/js/draft-model.js', defer: true }, { src: '/js/draft-tool.js', defer: true }, { src: '/js/draft-items.js', defer: true }, { src: '/js/home-draft.js', defer: true }, { src: '/js/home-daily.js', defer: true }],
  },
  {
    key: 'heroes', dir: 'heroes',
    title: 'Все герои Dota 2 — характеристики, роли и контрпики | Dota Mate',
    desc: 'Каталог всех героев Dota 2 с поиском и фильтром по атрибутам. У каждого героя роли, характеристики, рекомендуемый билд и контрпики по живым данным OpenDota.',
    sections: ['heroes', 'featuredHeroes'],
    // Тёмное оформление включено на всех шести разделах и на статических
    // страницах героев и предметов — светлой темы на сайте не осталось.
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'items', dir: 'items',
    title: 'Все предметы Dota 2 — цены, эффекты и сборка | Dota Mate',
    desc: 'Каталог предметов Dota 2 с фильтрами по цене и категориям: магазин, компоненты, расходники, нейтральные, рецепты. Официальные описания Valve и связи с героями.',
    sections: ['items'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'stats', dir: 'stats',
    title: 'Статистика Dota 2: тир-лист героев, винрейт по рангам и позициям | Dota Mate',
    desc: 'Статистика Dota 2 по своей базе рейтинговых матчей всех рангов: тир-лист героев, винрейт по рангам и позициям, связки и контрпики, популярные предметы, длительность матчей, линии и динамика по дням.',
    sections: ['stats'],
    styles: ['/css/theme-dark.css', '/css/stats.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/stats.js', defer: true }],
  },
  {
    key: 'guides', dir: 'guides',
    title: 'Гайды по Dota 2 — роли, драфт, итемизация | Dota Mate',
    desc: 'Практические гайды по Dota 2: роли на линиях, контроль карты, выбор предметов и драфт. Каждый гайд связан с героями и предметами из базы сайта.',
    sections: ['guides'],
    styles: ['/css/theme-dark.css', '/css/home-hero.css', '/css/guides.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/guides.js', defer: true }],
  },
  // Учебный центр: маршруты обучения по гайдам (tools/academy-render.js, данные — academy-content.js).
  // Прогресс хранится только в браузере (js/academy-store.js, интерфейс — js/academy.js), на сервер не уходит.
  {
    key: 'academy', dir: 'academy', academy: 'landing',
    title: 'Учебный центр Dota 2 — обучение по ролям, разбор матча и тренировка | Dota Mate',
    desc: 'Учебный центр DOTAMATE: маршруты «С нуля», «Поднять рейтинг» и по ролям — керри, мид, оффлейн, поддержка. Разбор своего матча с рекомендациями, тренировка решений и экзамен, прогресс без регистрации.',
    sections: ['academy'],
    styles: ['/css/theme-dark.css', '/css/academy.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/academy-store.js', defer: true }, { src: '/js/academy-records.js', defer: true }, { src: '/js/academy.js', defer: true }],
  },
  {
    key: 'academy', dir: 'academy/match', academy: 'match', crumb: 'Разбор матча', parent: { name: 'Учебный центр', dir: 'academy' },
    title: 'Разбор матча Dota 2 по Steam ID — анализ игры и рекомендации | Dota Mate',
    desc: 'Бесплатный разбор матча Dota 2: выбери игру по Steam ID или введи цифры с табло. Сравнение с игроками на том же герое и позиции, сильные стороны, зоны роста, уроки и цели на следующий матч.',
    sections: ['academy'],
    styles: ['/css/theme-dark.css', '/css/academy.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/academy-records.js', defer: true }, { src: '/js/academy-analysis.js', defer: true }, { src: '/js/academy-match.js', defer: true }],
  },
  {
    key: 'academy', dir: 'academy/practice', academy: 'practice', crumb: 'Тренировка', parent: { name: 'Учебный центр', dir: 'academy' },
    title: 'Тренировка Dota 2 — вопросы, игровые ситуации и экзамен | Dota Mate',
    desc: `Тренировка решений в Dota 2: ${acItems()} вопросов и игровых ситуаций по линии, фарму, карте и дракам. Случайные подходы, работа над ошибками и экзамен по маршруту обучения.`,
    sections: ['academy'],
    styles: ['/css/theme-dark.css', '/css/academy.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/academy-records.js', defer: true }, { src: '/js/academy-practice.js', defer: true }],
  },
  {
    key: 'academy', dir: 'academy/beginner', academy: 'beginner', crumb: 'С нуля', parent: { name: 'Учебный центр', dir: 'academy' },
    title: 'Dota 2 с нуля — маршрут обучения для новичка: уроки и тесты | Dota Mate',
    desc: `Маршрут обучения Dota 2 с нуля: настройки и режимы, роли и простые герои, линия и добивание, фарм и карта, драки и разбор реплеев. ${acLessons('beginner')} уроков, игровые ситуации, мини-тесты и задания на матч.`,
    sections: ['academy'],
    styles: ['/css/theme-dark.css', '/css/academy.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/academy-store.js', defer: true }, { src: '/js/academy-records.js', defer: true }, { src: '/js/academy.js', defer: true }],
  },
  {
    key: 'academy', dir: 'academy/rank-up', academy: 'rank-up', crumb: 'Поднять рейтинг', parent: { name: 'Учебный центр', dir: 'academy' },
    title: 'Как поднять рейтинг в Dota 2 — маршрут тренировок: уроки и тесты | Dota Mate',
    desc: `Маршрут для роста MMR в Dota 2: разбор реплеев и статистики, пул героев и драфт, экономика линии, тайминги карты, выкуп и контроль тильта. ${acLessons('rank-up')} уроков, игровые ситуации, мини-тесты и задания на матч.`,
    sections: ['academy'],
    styles: ['/css/theme-dark.css', '/css/academy.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/academy-store.js', defer: true }, { src: '/js/academy-records.js', defer: true }, { src: '/js/academy.js', defer: true }],
  },
  {
    key: 'meta', dir: 'meta',
    title: 'META — необычные сборки Dota 2 и нишевые герои | Dota Mate',
    desc: 'Редкие сборки предметов Dota 2 в рейтинговых матчах Dota 2: оценка необычности каждой сборки, фильтры по герою и роли, нишевые герои по позициям.',
    sections: ['meta'],
    styles: ['/css/theme-dark.css', '/css/meta.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/meta.js', defer: true }],
  },
  {
    // Оболочка страницы матча: содержимое рисует js/meta.js по ?id=.
    // В sitemap не идёт — без номера матча страница пустая.
    key: 'meta', dir: 'meta/match', crumb: 'Матч', noSitemap: true,
    title: 'Матч — META | Dota Mate',
    desc: 'Разбор матча из раздела META: состав команд, предметы, капитал, прогноз драфта, линии и график преимущества по минутам.',
    sections: ['metaMatch'],
    styles: ['/css/theme-dark.css', '/css/meta.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/meta.js', defer: true }],
  },
  {
    key: 'live', dir: 'live',
    title: 'Эфир Dota 2 — повторы матчей круглосуточно | Dota Mate',
    desc: 'Круглосуточный эфир рейтинговых матчей Dota 2 по данным реплеев: позиции героев на карте, убийства, варды, разрушенные строения и капитал команд в реальном времени.',
    sections: ['live'],
    styles: ['/css/theme-dark.css', '/css/live.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/draft-model.js', defer: true }, { src: '/js/live-winprob.js', defer: true }, { src: '/js/live.js', defer: true }],
  },
  {
    // Итоги матча эфира: содержимое рисует js/live-match.js по ?id=. Не индексируется (решение владельца 09.10.2026):
    // десятки почти одинаковых страниц в день; про-матчи индексируются в /pro/match/<id>/.
    key: 'live', dir: 'live/match', crumb: 'Итоги матча', noSitemap: true, noindex: true,
    title: 'Итоги матча эфира | Dota Mate',
    desc: 'Итоги матча из эфира Dota Mate: графики капитала и опыта, ключевые моменты и насколько угадали прогнозы по драфту и по ходу игры.',
    sections: ['liveMatch'],
    styles: ['/css/theme-dark.css', '/css/live.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/draft-model.js', defer: true }, { src: '/js/live-winprob.js', defer: true }, { src: '/js/live-match.js', defer: true }],
  },
  {
    // Частые слова за всё время по чатам всех матчей эфира: js/live-words.js рисует облако по /api/live/words-all.
    key: 'words', dir: 'live/words', crumb: 'Частые слова',
    title: 'Частые слова в чате эфира Dota 2 | Dota Mate',
    desc: 'Самые частые слова из чата матчей эфира Dota Mate: общий счётчик по всем матчам, который копится со временем. Облако слов — чем чаще слово, тем крупнее круг.',
    sections: ['liveWords'],
    styles: ['/css/theme-dark.css', '/css/live.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/live-words.js', defer: true }],
  },
  {
    // Шаблон раздела /pro/: страницы рисует deploy/api/pro.php, подставляя содержимое между <!--PRO--> и <!--/PRO-->.
    key: 'pro', dir: 'pro', crumb: 'Про-матчи',
    title: 'Про-матчи Dota 2 — результаты, драфты и турниры | Dota Mate',
    desc: 'Результаты профессиональных матчей Dota 2: счёт, пики и баны, статистика игроков и ключевые моменты, обновление каждые полчаса.',
    sections: ['pro'],
    styles: ['/css/theme-dark.css', '/css/pro.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'game', dir: 'game', crumb: 'Игра',
    title: 'Hook & Hit — мини-игра по Dota 2 в браузере | Dota Mate',
    desc: 'Браузерная мини-игра по мотивам Dota 2: уклоняйся от хуков, добивай крипов, отбивай красные хуки атакой. Два режима, рекорд сохраняется, установка не нужна.',
    sections: ['game'],
    scripts: ['/js/game.js'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },  {
    // Профиль игрока по Steam Web API (/api/dota/player/<id>/matches).
    // Steam ID хранится только в браузере (localStorage dmSteamId).
    key: 'me', dir: 'me',
    title: 'Мой профиль Dota 2 — последние матчи и винрейт по героям | Dota Mate',
    desc: 'Последние 100 матчей Dota 2 по Steam ID: победы и поражения, K/D/A, GPM, ваши герои и сравнение вашего винрейта с общим винрейтом героя. Без входа и регистрации.',
    sections: ['me'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
    scripts: [{ src: '/js/me.js', defer: true }],
  },
];
// Маршруты по ролям — сразу после «Поднять рейтинг» (порядок влияет только на page-urls.json).
PAGES.splice(PAGES.findIndex(p => p.dir === 'academy/rank-up') + 1, 0, ...rolePages());

// Карточки-входы в разделы: на главной вместо самих каталогов.
const HOME_CARDS = `<section class="section" id="home-cards">
  <div class="container">
    <div class="section-head companion-section-head">
      <div><h2>Что есть на сайте</h2><p>Каждый раздел — отдельная страница с собственным поиском и фильтрами.</p></div>
    </div>
    <div class="home-cards-grid">
      <a class="home-card" href="/heroes/"><span class="home-card-icon">⚔</span><strong>Герои</strong><p>Все герои Dota 2 с ролями, характеристиками и контрпиками.</p><b>Открыть →</b></a>
      <a class="home-card" href="/items/"><span class="home-card-icon">◈</span><strong>Предметы</strong><p>Каталог предметов с ценами, эффектами и сборкой.</p><b>Открыть →</b></a>
      <a class="home-card" href="/stats/"><span class="home-card-icon">📈</span><strong>Статистика</strong><p>Тир-лист и винрейт героев по рангам, позициям и связкам — своя база рейтинговых матчей.</p><b>Открыть →</b></a>
      <a class="home-card" href="/guides/"><span class="home-card-icon">📘</span><strong>Гайды</strong><p>Роли, драфт, итемизация и контроль карты.</p><b>Открыть →</b></a>
      <a class="home-card" href="/academy/"><span class="home-card-icon">🎓</span><strong>Учебный центр</strong><p>Маршруты для новичков, для роста рейтинга и по ролям, разбор своего матча с рекомендациями и тренировка решений.</p><b>Открыть →</b></a>
      <a class="home-card" href="/meta/"><span class="home-card-icon">✦</span><strong>META</strong><p>Необычные сборки и нишевые герои в рейтинговых матчах.</p><b>Открыть →</b></a>
      <a class="home-card" href="/glossary/"><span class="home-card-icon">🔤</span><strong>Глоссарий</strong><p>Термины Dota 2 простыми словами.</p><b>Открыть →</b></a>
    </div>
  </div>
</section>`;

// --- Первый экран главной: три списка меты, счётчики каталога и штамп среза.
// Всё это рисуется НА СБОРКЕ, а не в браузере. Причин две. Первая: ссылки на
// героев должны лежать в HTML, иначе робот их не увидит и вся глубина обхода
// пропадёт. Вторая: первый экран не должен прыгать, пока грузятся данные.
// Числа берём из data/home-meta.json (tools/build-home-meta.js, из data/stats.json) и из тех же
// карт адресов, по которым собирается sitemap, — выдумывать тут нечего.
const HOME_META = path.join(ROOT, 'data', 'home-meta.json');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ru(n) {
  return Number(n).toLocaleString('ru-RU').replace(/ /g, '&nbsp;');
}
function pct(n) {
  return String(Number(n).toFixed(1)).replace('.', ',') + '&thinsp;%';
}
// Русские числительные: «21 281 матч», но «18 172 матча» и «6 686 матчей».
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function countOf(file) {
  try {
    const x = require(path.join(ROOT, file));
    return Array.isArray(x) ? x.length : Object.keys(x).length;
  } catch (e) { return 0; }
}
function metaRow(h, main, sub, bad) {
  return `<a class="hm-row" href="/hero/${esc(h.slug)}/">` +
    `<img src="${esc(h.img)}" alt="" width="34" height="34" loading="lazy" decoding="async">` +
    `<span class="hm-row-name">${esc(h.name)}<span class="hr-badges" data-hero-badges="${Number(h.id)}"></span></span>` +
    `<span class="hm-row-num"><b>${main}</b><small${bad ? ' class="hm-bad"' : ''}>${sub}</small></span></a>`;
}
function metaColumn(title, hint, rows, link, linkText) {
  return `<div class="hm-col"><div class="hm-col-head"><h2>${title}</h2><span>${hint}</span></div>` +
    rows.join('') +
    `<a class="hm-col-more" href="${link}">${linkText} →</a></div>`;
}
function homeMeta() {
  const m = JSON.parse(fs.readFileSync(HOME_META, 'utf8'));
  const carry = m.carry.map(h => metaRow(h, pct(h.wr),
    `${ru(h.matches)} ${plural(h.matches, 'матч', 'матча', 'матчей')}`));
  const picked = m.picked.map(h => metaRow(h, ru(h.matches),
    `винрейт ${pct(h.wr)}`, h.wr < 50));
  const banned = m.banned.map(h => metaRow(h, ru(h.bans),
    `взяли ${h.picks} ${plural(h.picks, 'раз', 'раза', 'раз')}`));

  const lists =
    metaColumn('Тащат', `винрейт · от ${ru(m.minMatches)} матчей`, carry, '/stats/', 'Весь список винрейта') +
    metaColumn('Берут чаще всего', 'матчей за срез', picked, '/heroes/', `Все ${countOf('hero-urls.json')} героев`) +
    metaColumn('Банят чаще всего', 'банов · и сколько раз взяли', banned, '/stats/', 'Вся статистика');

  const articles = countOf('guide-urls.json') + countOf('role-guide-urls.json');
  const heroGuides = countOf('hero-guide-urls.json');
  let pairs = 0;
  try { pairs = require(path.join(ROOT, 'data', 'our-matrix.json')).pairCount || 0; } catch (e) {}
  const counter = (href, num, text) =>
    `<a class="hm-counter" href="${href}"><b>${ru(num)}</b><span>${text}</span></a>`;
  const counters =
    counter('/heroes/', countOf('hero-urls.json'), 'героев') +
    counter('/items/', countOf('item-urls.json'), plural(countOf('item-urls.json'), 'предмет', 'предмета', 'предметов')) +
    counter('/guides/', articles, `${plural(articles, 'статья', 'статьи', 'статей')} и ${ru(heroGuides)} гайдов по героям`) +
    counter('#draftTool', pairs, plural(pairs, 'пара', 'пары', 'пар') + ' героев в матрице');

  const d = new Date(m.fetchedAt);
  const stamp = `Срез ${esc(m.stampLabel || m.source.split(' ')[0])} · ` +
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');

  // Чип ведёт на разбор патча, когда страница собрана; иначе остаётся меткой.
  const pn = patchData();
  const chipText = 'Патч ' + esc(m.patch || '');
  const patchChip = !m.patch ? ''
    : (pn && pn.version === m.patch
        ? '<a class="dm-patch" href="/patch/' + esc(pn.version) + '/">' + chipText + '</a>'
        : '<span class="dm-patch">' + chipText + '</span>');
  return { lists, counters, stamp, matches: ru(m.matchesApprox), pairs: ru(pairs), patchChip, heroCount: ru(countOf('hero-urls.json')) };
}


// --- Страница патча -------------------------------------------------------
// Текст изменений — русская локализация Valve с dota2.com/datafeed, свой
// пересказ тут не нужен и был бы хуже. Наше — имена и ссылки на страницы
// героев и предметов: в фиде только идентификаторы.
const PATCH_FILE = path.join(ROOT, 'data', 'patch-notes.json');

function patchData() {
  try { return JSON.parse(fs.readFileSync(PATCH_FILE, 'utf8')); } catch (e) { return null; }
}
// Вёрстка страницы патча живёт в отдельном модуле: у неё своя сотня строк,
// а этот сборщик и так большой.
const { patchSection } = require('./build-patch-section');

function readSections() {
  const raw = fs.readFileSync(path.join(ROOT, 'page-sections.html'), 'utf8');
  // Секции лежат друг за другом верхнего уровня, вложенных <section> нет,
  // поэтому режем по началу строки — разбирать HTML целиком незачем.
  const parts = raw.split(/\n(?=<section\b)/);
  const map = {};
  for (const part of parts) {
    const block = part.trim();
    if (!block.startsWith('<section')) continue;
    const m = block.match(/^<section[^>]*\bid="([^"]+)"/);
    if (!m) throw new Error('секция без id: ' + block.slice(0, 80));
    map[m[1]] = block;
  }
  map['home-cards'] = HOME_CARDS;
  const p = patchData();
  if (p) map['patch-notes'] = patchSection(p);
  return map;
}


function breadcrumbs(page) {
  if (page.key === 'home') return '';
  const nav = NAV.find(n => n.key === page.key);
  const label = page.crumb || (nav ? nav.label : ('Патч ' + (patchData() || {}).version));
  const url = `${ORIGIN}/${page.dir}/`;
  // parent — промежуточный уровень (Главная › Учебный центр › С нуля).
  const trail = [{ name: 'Главная', item: ORIGIN + '/' }]
    .concat(page.parent ? [{ name: page.parent.name, item: `${ORIGIN}/${page.parent.dir}/` }] : [], [{ name: label, item: url }]);
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.item })),
  };
  const mid = page.parent ? `<a href="/${page.parent.dir}/">${page.parent.name}</a> <span>›</span> ` : '';
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n` +
    `<div class="container breadcrumbs"><a href="/">Главная</a> <span>›</span> ${mid}<span aria-current="page">${label}</span></div>`;
}

// Страница патча добавляется к списку разделов, пока есть снимок заметок.
const PATCH = patchData();
if (PATCH) {
  PAGES.push({
    key: 'patch', dir: 'patch/' + PATCH.version,
    title: 'Патч Dota 2 ' + PATCH.version + ' — что изменилось у героев и предметов | Dota Mate',
    desc: 'Изменения патча ' + PATCH.version + ': ' + PATCH.counts.heroes + ' героев и ' + PATCH.counts.items +
      ' предметов. Официальные заметки Valve на русском, со ссылками на страницы героев и предметов.',
    sections: ['patch-notes'],
    styles: ['/css/theme-dark.css', '/css/patch.css'],
    bodyClass: 'd2-dark',
  });
}

// --- Каталог /guides/: карточки рисуются НА СБОРКЕ из guide-content.js,
// role-guide-content.js и словаря — ссылки лежат в HTML (их видит робот),
// а поиск и фильтры (js/guides.js) только скрывают/показывают готовые карточки.
// Раньше список дублировался руками в js/app.js (guideData) и расходился с контентом.
const GUIDE_GROUPS = [
  { key: 'novice',  name: 'Новичку',            tags: ['НОВИЧКУ', 'РЕЖИМЫ', 'ПОДПИСКА', 'СЛОВАРЬ'] },
  { key: 'roles',   name: 'Роли и драфт',       tags: ['РОЛИ', 'BUILD', 'КОНТРПИКИ', 'HEROES', 'GAMEPLAY'] },
  { key: 'heroes',  name: 'Герои', tags: ['ГЕРОИ'] },
  { key: 'mech',    name: 'Механики',    tags: ['МЕХАНИКИ', 'ЛИНИЯ', 'ЛЕС', 'ФАРМ', 'ЭКОНОМИКА'] },
  { key: 'map',     name: 'Карта и обзор',      tags: ['MAP', 'КАРТА', 'ОБЗОР', 'РОТАЦИИ', 'ОБЪЕКТЫ', 'ТАЙМИНГИ', 'ЛОГИСТИКА'] },
  { key: 'items',   name: 'Предметы',           tags: ['ITEMS', 'ПРЕДМЕТЫ', 'COMPARE'] },
  { key: 'team',    name: 'Командная игра',     tags: ['ДРАКИ', 'СТРАТЕГИЯ', 'ОБЩЕНИЕ'] },
  { key: 'rank',    name: 'Рейтинг',     tags: ['РЕЙТИНГ', 'MMR', 'ОБУЧЕНИЕ', 'ПОВЕДЕНИЕ', 'СТАТИСТИКА', 'HERO DATA'] },
  { key: 'patch',   name: 'Патчи',              tags: ['ПАТЧ'] },
  { key: 'esports', name: 'Киберспорт',         tags: ['КИБЕРСПОРТ'] },
  { key: 'settings',name: 'Настройки',          tags: ['НАСТРОЙКИ'] },
];
// Точечные исключения: тег не совпадает со смыслом статьи.
const GUIDE_GROUP_BY_SLUG = {
  'last-hitting-denying': 'mech', 'how-many-heroes': 'novice', 'best-heroes-for-beginners': 'novice',
  'roles-explained': 'roles', 'reading-hero-stats': 'rank', 'patch-741-overview': 'patch', 'playing-vs-illusions': 'roles',
};
// Подразделы темы «Предметы» (статей больше 60 — одним списком не найти).
const GUIDE_ITEM_SUBS = [
  { key: 'basics',  name: 'Основы и сравнения', slugs: ['itemization-basics','magic-vs-physical-resistance','heal-reduction-741','boots-comparison','defensive-items-comparison','which-boots-to-buy','neutral-items-madstone','aghanim-scepter-shard','starting-items','neutral-items-tier-1','neutral-items-tier-2','neutral-items-tier-3','neutral-items-tier-4','neutral-items-tier-5','neutral-enhancements','attack-speed-items','magic-resistance-items','armor-items','lifesteal-items','health-items','movement-speed-items','mana-items','most-expensive-items','cheap-items','item-recipes'] },
  { key: 'early',   name: 'Ранние и расходники', slugs: ['bottle','bracer-wraith-band-null-talisman','magic-wand','soul-ring','tp-scroll-usage','smoke-of-deceit','gem-of-true-sight','hand-of-midas','boots-of-travel','falcon-blade','orb-of-corrosion','dust-of-appearance'] },
  { key: 'damage',  name: 'Урон и фарм', slugs: ['battle-fury','radiance','desolator','daedalus','butterfly','maelstrom-mjollnir','echo-sabre','skull-basher-abyssal-blade','monkey-king-bar','divine-rapier','armlet','mask-of-madness','sange-yasha-kaya','satanic','diffusal-blade-disperser','dagon','parasma','phylactery-khanda','octarine-core','bloodstone','refresher-orb','witch-blade','revenants-brooch','dragon-lance','hydras-breath-specialists-array','moon-shard','meteor-hammer'] },
  { key: 'defense', name: 'Защита', slugs: ['black-king-bar','manta-style','linkens-sphere','blade-mail','heart-of-tarrasque','aeon-disk','vanguard-crimson-guard','shivas-guard','ghost-scepter-ethereal-blade','crellas-crozier','consecrated-wraps','mage-slayer'] },
  { key: 'control', name: 'Контроль и мобильность', slugs: ['blink-dagger','euls-wind-waker','force-staff-hurricane-pike','scythe-of-vyse','orchid-bloodthorn','rod-of-atos-gleipnir','nullifier','heavens-halberd','shadow-blade-silver-edge','blink-upgrades','aether-lens','helm-of-the-dominator'] },
  { key: 'team',    name: 'Для команды и саппорта', slugs: ['glimmer-cape','lotus-orb','pipe-of-insight','mekansm-guardian-greaves','solar-crest','assault-cuirass','drum-of-endurance','veil-of-discord','holy-locket','vladmirs-offering','pavise','essence-distiller'] },
];
const GUIDE_FEATURED = ['beginner-start', 'roles-explained', 'last-hitting-denying', 'warding-map-control'];
// Время чтения: слова всех текстов статьи / 180 слов в минуту (средняя скорость
// чтения русского текста про себя), вверх до целой минуты.
const READ_WPM = 180;
function wordsIn(x) {
  if (typeof x === 'string') return (x.match(/[0-9A-Za-zА-Яа-яЁё]+/g) || []).length;
  if (Array.isArray(x)) return x.reduce((s, v) => s + wordsIn(v), 0);
  if (x && typeof x === 'object') return Object.keys(x).filter(k => !['slug', 'icon', 'action', 'cat', 'role'].includes(k)).reduce((s, k) => s + wordsIn(x[k]), 0);
  return 0;
}
function headingsIn(x, out = []) {
  if (Array.isArray(x)) x.forEach(v => headingsIn(v, out));
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) { if ((k === 'h' || k === 'name' || k === 'title') && typeof x[k] === 'string') out.push(x[k]); else headingsIn(x[k], out); }
  return out;
}
function guidesCatalog() {
  const g = require(path.join(ROOT, 'guide-content.js'));
  const r = require(path.join(ROOT, 'role-guide-content.js'));
  const list = [
    ...g.map(x => ({ ...x, href: `/guide/${x.slug}/` })),
    ...r.roles.map(x => ({ ...x, href: `/guide/${x.slug}/` })),
    ...r.comparisons.map(x => ({ ...x, href: `/guide/${x.slug}/` })),
    { slug: 'glossary', href: '/glossary/', icon: '📖', tag: 'СЛОВАРЬ', title: 'Словарь терминов Dota 2',
      excerpt: 'Что значат ластхит, денай, ганк, керри, MMR и другие термины — короткие объяснения со ссылками на подробные гайды.', sections: [] },
  ];
  const tagGroup = {};
  GUIDE_GROUPS.forEach(gr => gr.tags.forEach(t => { tagGroup[t] = gr.key; }));
  const counts = {}, subCounts = {};
  // Русские синонимы предметов (data/search-aliases.json, официальные Valve + свои):
  // предмет из заголовка статьи → его синонимы идут в поиск («бф», «радик», «линка»).
  const itemDict = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'items-ru.json'), 'utf8')).items;
  const itemAliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'search-aliases.json'), 'utf8')).items || {};
  const itemNames = Object.entries(itemDict).filter(([, v]) => v && v.dname && v.cat !== 'recipe' && itemAliases)
    .map(([k, v]) => ({ k, n: v.dname.toLowerCase() })).sort((a, b) => b.n.length - a.n.length);
  const aliasesFor = title => {
    const t = title.toLowerCase(), out = [];
    for (const it of itemNames) if (t.includes(it.n)) out.push(...(itemAliases[it.k] || []));
    return [...new Set(out)];
  };
  const items = list.map(x => {
    const grp = GUIDE_GROUP_BY_SLUG[x.slug] || tagGroup[x.tag];
    if (!grp) throw new Error(`гайд ${x.slug}: тег «${x.tag}» не привязан к группе каталога (GUIDE_GROUPS)`);
    counts[grp] = (counts[grp] || 0) + 1;
    const words = wordsIn(x);
    const min = Math.max(1, Math.ceil(words / READ_WPM));
    let sub = '';
    if (grp === 'items') {
      const sb = GUIDE_ITEM_SUBS.find(z => z.slugs.includes(x.slug));
      if (!sb) throw new Error(`гайд о предмете ${x.slug} не привязан к подразделу (GUIDE_ITEM_SUBS)`);
      sub = sb.key; subCounts[sub] = (subCounts[sub] || 0) + 1;
    }
    return { x, grp, sub, min, heads: headingsIn(x.sections || x.stages || x.items || []).filter(h => h !== x.title).concat(aliasesFor(x.title)) };
  });
  const gname = k => GUIDE_GROUPS.find(gr => gr.key === k).name;
  const card = (it, featured) =>
    `<a class="gd-card${featured ? ' gd-card--feat' : ''}" href="${esc(it.x.href)}" data-grp="${it.grp}"${it.sub ? ` data-sub="${it.sub}"` : ''}` +
    ` data-t="${esc(it.x.title)}" data-h="${esc(it.heads.join(' · '))}" data-e="${esc(it.x.excerpt || '')}">` +
    `<span class="gd-ico" aria-hidden="true">${esc(it.x.icon || '📘')}</span>` +
    `<span class="gd-body"><span class="gd-meta"><b class="gd-grp gd-c-${it.grp}">${gname(it.grp)}</b><span>${it.min}&nbsp;мин</span></span>` +
    `<strong class="gd-title">${esc(it.x.title)}</strong>` +
    `<span class="gd-ex">${esc(it.x.excerpt || '')}</span></span></a>`;
  const feat = GUIDE_FEATURED.map(s => items.find(it => it.x.slug === s)).filter(Boolean);
  const chips = `<button type="button" class="gd-chip is-active" data-grp="all" aria-pressed="true">Все</button>` +
    GUIDE_GROUPS.filter(gr => counts[gr.key]).map(gr =>
      `<button type="button" class="gd-chip" data-grp="${gr.key}" aria-pressed="false"><span class="gd-dot gd-c-${gr.key}"></span>${gr.name}</button>`).join('');
  const subChips = `<button type="button" class="gd-sub is-active" data-sub="all" aria-pressed="true">Все предметы</button>` +
    GUIDE_ITEM_SUBS.filter(z => subCounts[z.key]).map(z =>
      `<button type="button" class="gd-sub" data-sub="${z.key}" aria-pressed="false">${z.name}</button>`).join('');
  // Список героев для блока «Гайды по героям» в поиске (id нужен для русских синонимов D2HSearch).
  const heroesAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
  const heroGuides = require(path.join(ROOT, 'hero-guide-urls.json')).map(u => {
    const n = u.name.replace(/^Гайд по /, '');
    const h = heroesAll.find(y => y.localized_name === n);
    if (!h) throw new Error(`гайд героя без героя в data/heroes.json: ${u.name}`);
    const short = h.name.replace(/^npc_dota_hero_/, '');
    return { id: h.id, localized_name: n, u: new URL(u.loc).pathname, img: `/assets/heroes/${short}.webp` };
  });
  return {
    total: items.length,
    heroCount: heroGuides.length,
    chips,
    subChips,
    featured: feat.map(it => card(it, true)).join(''),
    grid: items.map(it => card(it, false)).join(''),
    heroesJson: JSON.stringify(heroGuides).replace(/</g, '\\u003c'),
  };
}

function build() {
  const shell = fs.readFileSync(path.join(ROOT, 'page-shell.html'), 'utf8');
  const sections = readSections();
  const gc = guidesCatalog();
  const urls = [];
  // Учебный центр: данные проверяются до записи любой страницы — битая ссылка на гайд останавливает сборку.
  validateCourses(COURSES);
  const academyIndex = renderIndex(COURSES);
  const academyHtml = view => {
    if (view === 'landing') return renderLanding(COURSES) + academyIndex;
    if (view === 'match') return renderMatchPage(COURSES);
    if (view === 'practice') return renderPracticePage(COURSES);
    const course = COURSES.find(c => c.id === view);
    if (!course) throw new Error(`Учебный центр: нет курса «${view}»`);
    return renderCourse(course, { patch: PATCH }) + academyIndex;
  };

  for (const page of PAGES) {
    const missing = page.sections.filter(id => !sections[id]);
    if (missing.length) throw new Error(`нет секций ${missing.join(', ')} для страницы ${page.key}`);

    const canonical = page.dir ? `${ORIGIN}/${page.dir}/` : `${ORIGIN}/`;
    const meta = homeMeta();
    const content = page.sections.map(id => sections[id]).join('\n\n')
      .replace('{{HOME_META_LISTS}}', meta.lists)
      .replace('{{HOME_META_COUNTERS}}', meta.counters)
      .replace('{{META_STAMP}}', meta.stamp)
      .replace('{{META_MATCHES}}', meta.matches)
      .replace('{{PAIR_COUNT}}', meta.pairs)
      .replace('{{HERO_COUNT}}', meta.heroCount)
      .replace(/\{\{GUIDES_TOTAL\}\}/g, () => gc.total)
      .replace('{{GUIDES_HERO_COUNT}}', () => gc.heroCount)
      .replace('{{GUIDES_CHIPS}}', () => gc.chips)
      .replace('{{GUIDES_SUBCHIPS}}', () => gc.subChips)
      .replace('{{GUIDES_FEATURED}}', () => gc.featured)
      .replace('{{GUIDES_GRID}}', () => gc.grid)
      .replace('{{GUIDES_HEROES_JSON}}', () => gc.heroesJson)
      .replace('{{ACADEMY_CONTENT}}', () => page.academy ? academyHtml(page.academy) : '');
    const scripts = (page.scripts || []).map(s => {
      const { src, ...attrs } = typeof s === 'string' ? { src: s } : s;
      const extra = Object.keys(attrs).filter(k => attrs[k]).map(k => ` ${k}`).join('');
      return `<script src="${src}"${extra}></script>`;
    }).join('\n');
    const styles = (page.styles || []).map(s => `<link rel="stylesheet" href="${s}">`).join('\n');
    const bodyClass = page.bodyClass ? ` class="${page.bodyClass}"` : '';

    const html = shell
      .replace(/\{\{TITLE\}\}/g, escapeAttr(page.title))
      .replace(/\{\{DESC\}\}/g, escapeAttr(page.desc))
      .replace(/\{\{CANONICAL\}\}/g, canonical)
      .replace('{{NAV}}', navHtml(page.key))
      .replace('{{BREADCRUMBS}}', breadcrumbs(page))
      .replace('{{CONTENT}}', content)
      .replace('{{PAGE_SCRIPTS}}', scripts)
      .replace('{{PAGE_STYLES}}', styles)
      .replace('{{BODY_CLASS}}', bodyClass)
      .replace('{{PATCH_CHIP}}', meta.patchChip)
      .replace('<meta name="description"', page.noindex ? '<meta name="robots" content="noindex, follow">\n<meta name="description"' : '<meta name="description"');

    for (const base of [ROOT, path.join(ROOT, 'deploy')]) {
      const dir = page.dir ? path.join(base, page.dir) : base;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);
    }
    if (!page.noSitemap) urls.push({ loc: canonical, name: page.title.split('—')[0].trim() });
    console.log(`${page.dir || '/'} — ${page.sections.length} секц., ${(html.length / 1024).toFixed(1)} КБ`);
  }

  fs.writeFileSync(path.join(ROOT, 'page-urls.json'), JSON.stringify(urls, null, 1));
  console.log('data/live-items.json:', require('./tools/build-live-items').build(), 'предметов');
  console.log(`\nГотово: ${PAGES.length} страниц, page-urls.json обновлён.`);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

build();
