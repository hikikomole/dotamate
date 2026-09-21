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
  { key: 'game',   href: '/game/',   label: 'Игра' },
];

const PAGES = [
  {
    key: 'home', dir: '',
    title: 'Dota 2 Companion — герои, предметы, статистика и гайды',
    desc: 'Живая база Dota 2: 127 героев, 263 предмета и 83 рецепта, pro-статистика с OpenDota и гайды. Всё связано между собой — без десятка открытых вкладок перед игрой.',
    sections: ['home-hero', 'home-cards', 'featuredHeroes', 'globalSearchSection'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
    scripts: ['/js/home-bg.js'],
  },
  {
    key: 'heroes', dir: 'heroes',
    title: 'Все герои Dota 2 — характеристики, роли и контрпики | Dota 2 Companion',
    desc: 'Каталог всех героев Dota 2 с поиском и фильтром по атрибутам. У каждого героя роли, характеристики, рекомендуемый билд и контрпики по живым данным OpenDota.',
    sections: ['heroes', 'featuredHeroes'],
    // Тёмное оформление включено на всех шести разделах и на статических
    // страницах героев и предметов — светлой темы на сайте не осталось.
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'items', dir: 'items',
    title: 'Все предметы Dota 2 — цены, эффекты и сборка | Dota 2 Companion',
    desc: 'Каталог предметов Dota 2 с фильтрами по цене и категориям: магазин, компоненты, расходники, нейтральные, рецепты. Официальные описания Valve и связи с героями.',
    sections: ['items'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'stats', dir: 'stats',
    title: 'Статистика героев Dota 2 — winrate, пики и баны | Dota 2 Companion',
    desc: 'Таблица героев Dota 2 по профессиональному winrate, пикам и банам. Сортировка по скорости, атаке и атрибутам, сравнение двух героев и аналитика покупок.',
    sections: ['stats'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'guides', dir: 'guides',
    title: 'Гайды по Dota 2 — роли, драфт, итемизация | Dota 2 Companion',
    desc: 'Практические гайды по Dota 2: роли на линиях, контроль карты, выбор предметов и драфт. Каждый гайд связан с героями и предметами из базы сайта.',
    sections: ['guides'],
    styles: ['/css/theme-dark.css'],
    bodyClass: 'd2-dark',
  },
  {
    key: 'game', dir: 'game',
    title: 'Hook & Hit — мини-игра по Dota 2 в браузере | Dota 2 Companion',
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
      <a class="home-card" href="/game/"><span class="home-card-icon">🎮</span><strong>Мини-игра</strong><p>Hook &amp; Hit — уклоняйся от хуков прямо в браузере.</p><b>Открыть →</b></a>
      <a class="home-card" href="/glossary/"><span class="home-card-icon">🔤</span><strong>Глоссарий</strong><p>Термины Dota 2 простыми словами.</p><b>Открыть →</b></a>
    </div>
  </div>
</section>`;

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
  const label = NAV.find(n => n.key === page.key).label;
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

function build() {
  const shell = fs.readFileSync(path.join(ROOT, 'page-shell.html'), 'utf8');
  const sections = readSections();
  const urls = [];

  for (const page of PAGES) {
    const missing = page.sections.filter(id => !sections[id]);
    if (missing.length) throw new Error(`нет секций ${missing.join(', ')} для страницы ${page.key}`);

    const canonical = page.dir ? `${ORIGIN}/${page.dir}/` : `${ORIGIN}/`;
    const content = page.sections.map(id => sections[id]).join('\n\n');
    const scripts = (page.scripts || []).map(s => `<script src="${s}"></script>`).join('\n');
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
      .replace('{{BODY_CLASS}}', bodyClass);

    for (const base of [ROOT, path.join(ROOT, 'deploy')]) {
      const dir = page.dir ? path.join(base, page.dir) : base;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);
    }
    urls.push({ loc: canonical, name: page.title.split('—')[0].trim() });
    console.log(`${page.dir || '/'} — ${page.sections.length} секц., ${(html.length / 1024).toFixed(1)} КБ`);
  }

  fs.writeFileSync(path.join(ROOT, 'page-urls.json'), JSON.stringify(urls, null, 1));
  console.log(`\nГотово: ${PAGES.length} страниц, page-urls.json обновлён.`);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

build();
