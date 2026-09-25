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

const NAV = [
  { key: 'home',   href: '/',        label: 'Главная' },
  { key: 'heroes', href: '/heroes/', label: 'Герои' },
  { key: 'items',  href: '/items/',  label: 'Предметы' },
  { key: 'stats',  href: '/stats/',  label: 'Статистика' },
  { key: 'guides', href: '/guides/', label: 'Гайды' },
  { key: 'meta',   href: '/meta/',   label: 'META' },
];

const PAGES = [
  {
    key: 'home', dir: '',
    title: 'Dota Mate — герои, предметы, статистика и гайды',
    desc: 'Драфт Dota 2 по числам: синергия, контрпики и расклад по линиям на 8001 паре героев из матчей Divine и Immortal. 127 героев, 253 предмета, сборки и гайды.',
    // draftTool идёт сразу за первым экраном — как на живой главной.
    // Раньше секции тут не было, и запуск сборщика стирал инструмент драфта
    // из index.html: разметка жила только в собранном файле.
    sections: ['home-hero', 'draftTool', 'home-cards', 'featuredHeroes'],
    styles: ['/css/theme-dark.css', '/css/home-hero.css', '/css/draft-tool.css'],
    bodyClass: 'd2-dark',
    // defer у draft-tool.js сохраняет прежний порядок выполнения: скрипт
    // отрабатывает после v43-features.js, как было при ручной правке.
    scripts: [{ src: '/js/draft-tool.js', defer: true }, { src: '/js/home-draft.js', defer: true }],
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
    desc: 'Статистика Dota 2 по своей базе рейтинговых матчей до 4500 MMR: тир-лист героев, винрейт по рангам и позициям, связки и контрпики, популярные предметы, длительность матчей, линии и динамика по дням.',
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
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'meta', dir: 'meta',
    title: 'META — необычные сборки Dota 2 и нишевые герои | Dota Mate',
    desc: 'Редкие сборки предметов Dota 2 в рейтинговых матчах до 4500 MMR: оценка необычности каждой сборки, фильтры по герою и роли, нишевые герои по позициям.',
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
    key: 'game', dir: 'game', crumb: 'Игра',
    title: 'Hook & Hit — мини-игра по Dota 2 в браузере | Dota Mate',
    desc: 'Браузерная мини-игра по мотивам Dota 2: уклоняйся от хуков, добивай крипов, отбивай красные хуки атакой. Два режима, рекорд сохраняется, установка не нужна.',
    sections: ['game'],
    scripts: ['/js/game.js'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
];

// Карточки-входы в разделы: на главной вместо самих каталогов.
const HOME_CARDS = `<section class="section" id="home-cards">
  <div class="container">
    <div class="section-head companion-section-head">
      <div><div class="eyebrow">РАЗДЕЛЫ</div><h2>Что есть на сайте</h2><p>Каждый раздел — отдельная страница с собственным поиском и фильтрами.</p></div>
    </div>
    <div class="home-cards-grid">
      <a class="home-card" href="/heroes/"><span class="home-card-icon">⚔</span><strong>Герои</strong><p>Все герои Dota 2 с ролями, характеристиками и контрпиками.</p><b>Открыть →</b></a>
      <a class="home-card" href="/items/"><span class="home-card-icon">◈</span><strong>Предметы</strong><p>Каталог предметов с ценами, эффектами и сборкой.</p><b>Открыть →</b></a>
      <a class="home-card" href="/stats/"><span class="home-card-icon">📈</span><strong>Статистика</strong><p>Winrate, пики и баны героев в профессиональных матчах.</p><b>Открыть →</b></a>
      <a class="home-card" href="/guides/"><span class="home-card-icon">📘</span><strong>Гайды</strong><p>Роли, драфт, итемизация и контроль карты.</p><b>Открыть →</b></a>
      <a class="home-card" href="/meta/"><span class="home-card-icon">✦</span><strong>META</strong><p>Необычные сборки и нишевые герои в матчах до 4500 MMR.</p><b>Открыть →</b></a>
      <a class="home-card" href="/glossary/"><span class="home-card-icon">🔤</span><strong>Глоссарий</strong><p>Термины Dota 2 простыми словами.</p><b>Открыть →</b></a>
    </div>
  </div>
</section>`;

// --- Первый экран главной: три списка меты, счётчики каталога и штамп среза.
// Всё это рисуется НА СБОРКЕ, а не в браузере. Причин две. Первая: ссылки на
// героев должны лежать в HTML, иначе робот их не увидит и вся глубина обхода
// пропадёт. Вторая: первый экран не должен прыгать, пока грузятся данные.
// Числа берём из data/home-meta.json (tools/fetch-home-meta.js) и из тех же
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
    `<span class="hm-row-name">${esc(h.name)}</span>` +
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
    metaColumn('Банят на про', 'банов · и сколько раз взяли', banned, '/stats/', 'Про-сцена целиком');

  const articles = countOf('guide-urls.json') + countOf('role-guide-urls.json');
  const heroGuides = countOf('hero-guide-urls.json');
  let pairs = 0;
  try { pairs = require(path.join(ROOT, 'data', 'draft-matrix.json')).pairCount || 0; } catch (e) {}
  const counter = (href, num, text) =>
    `<a class="hm-counter" href="${href}"><b>${ru(num)}</b><span>${text}</span></a>`;
  const counters =
    counter('/heroes/', countOf('hero-urls.json'), 'героев') +
    counter('/items/', countOf('item-urls.json'), plural(countOf('item-urls.json'), 'предмет', 'предмета', 'предметов')) +
    counter('/guides/', articles, `${plural(articles, 'статья', 'статьи', 'статей')} и ${ru(heroGuides)} гайдов по героям`) +
    counter('#draftTool', pairs, plural(pairs, 'пара', 'пары', 'пар') + ' героев в матрице');

  const d = new Date(m.fetchedAt);
  const stamp = `Срез ${esc(m.source.split(' ')[0])} · ` +
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

function navHtml(activeKey) {
  const links = NAV.map(n => {
    const current = n.key === activeKey ? ' aria-current="page" class="active"' : '';
    return `<a href="${n.href}"${current}>${n.label}</a>`;
  }).join('');
  return `<nav id="navMenu">${links}</nav>`;
}

function breadcrumbs(page) {
  if (page.key === 'home') return '';
  const nav = NAV.find(n => n.key === page.key);
  const label = page.crumb || (nav ? nav.label : ('Патч ' + (patchData() || {}).version));
  const url = `${ORIGIN}/${page.dir}/`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: label, item: url },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n` +
    `<div class="container breadcrumbs"><a href="/">Главная</a> <span>›</span> <span aria-current="page">${label}</span></div>`;
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

function build() {
  const shell = fs.readFileSync(path.join(ROOT, 'page-shell.html'), 'utf8');
  const sections = readSections();
  const urls = [];

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
      .replace('{{HERO_COUNT}}', meta.heroCount);
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
      .replace('{{PATCH_CHIP}}', meta.patchChip);

    for (const base of [ROOT, path.join(ROOT, 'deploy')]) {
      const dir = page.dir ? path.join(base, page.dir) : base;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);
    }
    if (!page.noSitemap) urls.push({ loc: canonical, name: page.title.split('—')[0].trim() });
    console.log(`${page.dir || '/'} — ${page.sections.length} секц., ${(html.length / 1024).toFixed(1)} КБ`);
  }

  fs.writeFileSync(path.join(ROOT, 'page-urls.json'), JSON.stringify(urls, null, 1));
  console.log(`\nГотово: ${PAGES.length} страниц, page-urls.json обновлён.`);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

build();
