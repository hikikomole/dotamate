#!/usr/bin/env node
// Гайд по каждому герою: deploy/hero/<slug>/guide/index.html
//
// Всё содержимое выводится из реальных данных, собранных
// tools/fetch-hero-guide-data.js (см. комментарий в нём об источниках).
// Ничего не додумывается: если выборка по паре героев меньше 15 матчей, пара
// в таблицу не попадает, а если матчапов нет совсем — раздел честно говорит,
// что данных мало.
//
// Порядок сборки: tools/fetch-hero-guide-data.js -> build-hero-guides.js.
// Запуск: node build-hero-guides.js

const siteNav = require('./tools/site-nav');
const fs = require('fs');
const path = require('path');
const { escapeHtml, slugForHero, imageUrl, roleText, attrInfo, officialHeroUrl, heroStats } = require('./tools/hero-common.js');

const ORIGIN = 'https://dotamate.ru';
const DATA = path.join(__dirname, 'seo', 'hero-guide-data.json');

const analytics = `
<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->`;

// Покупки — data/hero-items.json (tools/build-hero-items.js), тот же расчёт,
// что в карточке героя и на странице героя. Ключ фазы — поле в hero-items.json.
const PHASES = [
  ['start', 'Старт · до 0:00', 'что покупают до выхода на линию'],
  ['early', 'Ранняя · 0–10', 'первые покупки на линии'],
  ['mid', 'Середина · 10–25', 'ключевые предметы средней стадии'],
  ['late', 'Поздняя · 25–40', 'во что герой собирается к концу'],
  ['vlate', 'Финал · 40+', 'что докупают в затяжной игре'],
];

// Контрпики — один расчёт на весь сайт (tools/build-hero-counters.js,
// своя база рейтинговых матчей). Нет файла — блоки показывают заглушку.
const heroItems = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hero-items.json'), 'utf8'));
const heroCounters = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hero-counters.json'), 'utf8')); }
  catch { return { heroes: {} }; }
})();
const num = n => Number(n || 0).toLocaleString('ru-RU');
const pct = (w, g) => g ? (w / g * 100).toFixed(1).replace('.', ',') + '%' : '—';

// Склонение: «15 матчей», «21 матч», «32 матча».
function matches(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return n + ' матчей';
  if (b === 1) return n + ' матч';
  if (b >= 2 && b <= 4) return n + ' матча';
  return n + ' матчей';
}

function complexity(h) {
  const legs = Number(h.legs);
  const abilities = Number(h.abilityCount || 0);
  return null; // Valve не отдаёт сложность через OpenDota — не выдумываем.
}

function itemName(id, itemsById) { const it = itemsById.get(Number(id)); return it ? it.dname : null; }
function itemSlugOf(key) { return String(key || '').replace(/^item_/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }

async function main() {
  if (!fs.existsSync(DATA)) { console.error('Нет seo/hero-guide-data.json — сначала tools/fetch-hero-guide-data.js'); process.exit(1); }
  const store = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const guideData = store.heroes || {};

  // OpenDota с сервера сайта отвечает нестабильно: при сбое — локальные снимки (data/heroes.json, data/items-ru.json).
  const odota = async (url, fallback) => {
    try { if(process.argv.includes('--offline')) throw new Error('offline'); if (!await require('./tools/lib/api-quota').take('opendota', { priority: 'normal' })) throw new Error('QUOTA'); const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (!j || typeof j !== 'object') throw new Error('пустой ответ'); return j; }
    catch (e) { console.warn('OpenDota недоступна (' + url.replace(/^.*\/api\//, '') + ': ' + e.message + ') — локальный снимок'); return fallback(); }
  };
  const heroes = await odota('https://api.opendota.com/api/heroStats', () => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'heroes.json'), 'utf8')).heroes);
  const byId = new Map(heroes.map(h => [Number(h.id), h]));
  // Характеристики 1-го уровня — официальный datafeed Valve (tools/valve-hero-stats.js).
  const valveHero = require('./tools/valve-hero-stats.js');
  const valveStats = process.argv.includes('--offline')
    ? JSON.parse(fs.readFileSync(valveHero.CACHE, 'utf8')).heroes
    : await valveHero.load(heroes.map(x => x.id));
  const itemsRaw = await odota('https://api.opendota.com/api/constants/items', () => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'items-ru.json'), 'utf8')).items).map(([k, v]) => [k, { id: v.id, dname: v.dname }])));
  // Справочник предметов OpenDota шире нашего каталога: там есть
  // ward_observer, ward_sentry, harpoon и shadow_amulet, а страниц у них нет.
  // Раньше гайды ссылались на них — 63 битых адреса на 63 страницах. Берём
  // только те предметы, у которых страница реально собрана, а уровни
  // (Dagon 2–5) сводим к базовому предмету.
  const havePage = new Set();
  try {
    for (const u of JSON.parse(fs.readFileSync(path.join(__dirname, 'item-urls.json'), 'utf8')))
      havePage.add(String(u.loc).replace(/^https:\/\/dotamate\.ru\/item\/|\/$/g, ''));
  } catch {}
  const variantById = (() => {
    try {
      const V = require('./js/item-variants.js');
      const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'items-ru.json'), 'utf8')).items;
      return V.buildVariantMaps(cat).byId;
    } catch { return {}; }
  })();

  const itemsById = new Map();
  const itemKeyById = new Map();
  for (const [key, v] of Object.entries(itemsRaw)) {
    if (!v || !v.id) continue;
    const slug = itemSlugOf(key);
    if (havePage.size && !havePage.has(slug)) continue;
    itemsById.set(Number(v.id), v);
    itemKeyById.set(Number(v.id), key);
  }

  const abilityIconExists = (() => {
    let have = new Set();
    try { have = new Set(fs.readdirSync(path.join(__dirname, 'assets', 'abilities')).map(f => f.replace(/\.png$/, ''))); } catch {}
    return key => have.has(String(key));
  })();

  // Ранги героев по скорости и дальности атаки — для фраз «быстрее X% героев» (те же данные Valve, что в плитках).
  const vsAll = heroes.map(o => ({ o, v: valveStats[o.id] })).filter(x => x.v);
  const shareBelow = (val, list) => list.length ? Math.round(list.filter(x => x < val).length / list.length * 100) : null;
  const msList = vsAll.map(x => Number(x.v.ms)).filter(Number.isFinite);
  const rangedList = vsAll.filter(x => x.o.attack_type !== 'Melee').map(x => Number(x.v.range)).filter(Number.isFinite);
  const pp = d => Math.abs(d).toFixed(1).replace('.', ',');
  const mt = n => matches(n).replace(/^\d+/, num(n)); // «9 584 матча»
  // Цена предмета — из своего каталога (data/items-ru.json): во вводной называем только крупный предмет, не расходник.
  const costById = new Map(Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'items-ru.json'), 'utf8')).items).map(v => [Number(v.id), Number(v.cost) || 0]));
  const wr = w => Number(w).toFixed(1).replace('.', ',') + '%';

  const pagesRoot = path.join(__dirname, 'deploy', 'hero');
  const urls = [];
  let made = 0, thin = 0;

  for (const h of heroes) {
    const g = guideData[String(h.id)];
    if (!g) { thin++; continue; }
    const slug = slugForHero(h);
    const dir = path.join(pagesRoot, slug, 'guide');
    fs.mkdirSync(dir, { recursive: true });

    const a = attrInfo(h.primary_attr);
    const roles = roleText(h);
    const atk = h.attack_type === 'Melee' ? 'ближнего боя' : 'дальнего боя';
    const canonical = `${ORIGIN}/hero/${slug}/guide/`;
    // Заголовок до 70 знаков (дальше поисковики обрезают): длинное имя — без «как играть».
    const title = [`Гайд по ${h.localized_name} в Dota 2: как играть, закупы и контрпики | Dota Mate`, `Гайд по ${h.localized_name} в Dota 2: закупы и контрпики | Dota Mate`, `Гайд по ${h.localized_name} в Dota 2 | Dota Mate`].find(t => t.length <= 70) || `Гайд по ${h.localized_name} | Dota Mate`;

    // --- разделы ---
    const vs = valveStats[h.id] || null;
    const stats = valveHero.cells(vs);
    const statsHtml = stats.map(s => `<div><small>${escapeHtml(s.k)}</small><strong>${escapeHtml(String(s.v))}</strong></div>`).join('');

    const abilitiesHtml = (g.abilities || []).map((ab, i) => {
      const paras = String(ab.desc || '').replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/\\n/g, '\n').replace(/<[^>]*>/g, '').replace(/%%/g, '%').split('\n').map(x => x.trim()).filter(Boolean);
      const body = paras.length ? paras.map(x => `<p>${escapeHtml(x)}</p>`).join('') : '<p>Официального русского описания у Valve для этой способности нет.</p>';
      return `<article class="hg-ability"><div class="hg-ability-art${abilityIconExists(ab.key) ? '' : ' no-icon'}">${abilityIconExists(ab.key) ? `<img loading="lazy" src="/assets/abilities/${encodeURIComponent(ab.key)}.png" alt="">` : `<u>${escapeHtml(String(ab.name || '').slice(0, 2).toUpperCase())}</u>`}<span>${i + 1}</span></div><div><b>${escapeHtml(ab.dname || ab.key)}</b>${body}</div></article>`;
    }).join('');

    const phaseHtml = PHASES.map(([key, label, hint]) => {
      const rec = (heroItems.heroes || {})[String(h.id)] || {};
      const n = Number(rec.n) || 0;
      const rows = (rec[key] || [])
        .map(r => ({ id: variantById[Number(r.i)] ?? Number(r.i), count: Number(r.g) || 0 }))
        .filter(r => itemName(r.id, itemsById));
      if (!rows.length) return '';
      const li = rows.map(r => {
        const key2 = itemKeyById.get(r.id);
        const s = itemSlugOf(key2);
        const name = escapeHtml(itemName(r.id, itemsById));
        const img = `/assets/items/${s}.png`;
        return `<a href="/item/${s}/"><img loading="lazy" src="${img}" alt=""><b>${name}</b><small>${n ? Math.round(r.count / n * 100) + '% · ' + num(r.count) + ' из ' + num(n) : num(r.count) + ' покупок'}</small></a>`;
      }).join('');
      const top = rows[0];
      const topHint = n ? `${hint}; чаще всего — ${escapeHtml(itemName(top.id, itemsById))} (${Math.round(top.count / n * 100)}%)` : hint;
      return `<div class="hg-phase"><h3>${label}</h3><p class="hg-hint">${topHint}</p><div class="hg-items">${li}</div></div>`;
    }).filter(Boolean).join('');

    const hc = (heroCounters.heroes || {})[String(h.id)] || {};
    const dfmt = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1).replace('.', ',');
    const row = m => {
      const o = byId.get(Number(m.id)); if (!o) return '';
      return `<tr><td><a href="/hero/${slugForHero(o)}/"><img loading="lazy" src="${imageUrl(o)}" alt="">${escapeHtml(o.localized_name)}</a><span class="hr-badges" data-hero-badges="${o.id}"></span></td><td>${matches(m.g)}</td><td><b>${m.w.toFixed(1).replace('.', ',')}%</b></td><td>${dfmt(m.d)}</td></tr>`;
    };
    const strongRows = (hc.good || []).map(row).filter(Boolean).join('');
    const weakRows = (hc.against || []).map(row).filter(Boolean).join('');
    const tableHead = '<thead><tr><th>Герой</th><th>Выборка</th><th>Winrate</th><th>К ожидаемому, п.п.</th></tr></thead>';
    const noData = `<p class="hg-nodata">Пар, сыгранных хотя бы ${heroCounters.minGames || 300} раз, для этого героя в нашей базе пока не набралось — поэтому таблицу не показываем.</p>`;

    // «Что дальше»: ссылки только на существующие гайды; данные — те же контрпики
    // и роли Valve, что на странице, без новых расчётов.
    const hasGuide = o => o && guideData[String(o.id)];
    const card = (o, note) => `<a href="/hero/${slugForHero(o)}/guide/"><img loading="lazy" src="${imageUrl(o)}" alt="">${escapeHtml(o.localized_name)}<small style="opacity:.7;margin-left:6px;">${escapeHtml(note)}</small><span>→</span></a>`;
    const pickGuides = list => (list || []).map(m => byId.get(Number(m.id))).filter(hasGuide).slice(0, 3);
    const nextCounters = pickGuides(hc.against).map(o => card(o, 'контрит ' + h.localized_name));
    const nextTargets = pickGuides(hc.good).map(o => card(o, 'проигрывает ' + h.localized_name));
    const myRoles = new Set(h.roles || []);
    const similar = heroes.filter(o => o.id !== h.id && o.primary_attr === h.primary_attr && hasGuide(o))
      .map(o => ({ o, k: (o.roles || []).filter(r => myRoles.has(r)).length }))
      .filter(x => x.k > 0).sort((x, y) => y.k - x.k || x.o.id - y.o.id).slice(0, 3)
      .map(x => card(x.o, 'похожие роли'));
    const nextHtml = [...nextCounters, ...nextTargets, ...similar].join('') +
      `<a href="/#draft=${h.id}----_----_"><img loading="lazy" src="${imageUrl(h)}" alt="">Собрать драфт с ${escapeHtml(h.localized_name)} в DraftMate<span>→</span></a>` +
      `<a href="/guide/counter-picks/">Как работают контрпики<span>→</span></a>`;

    // Вводная — только из цифр этого героя (покупки и матчапы своей базы), чтобы 127 гайдов не начинались одинаково.
    const recH = (heroItems.heroes || {})[String(h.id)] || {};
    const nH = Number(recH.n) || 0;
    const coreItem = (() => {
      for (const [ph, when] of [['late', 'к 25–40 минуте'], ['mid', 'к 10–25 минуте'], ['vlate', 'после 40 минуты']]) {
        const r = (recH[ph] || []).map(x => ({ id: variantById[Number(x.i)] ?? Number(x.i), g: Number(x.g) || 0 })).find(x => itemName(x.id, itemsById) && (costById.get(x.id) || 0) >= 2000);
        if (r && nH) return { name: itemName(r.id, itemsById), p: Math.round(r.g / nH * 100), when };
      }
      return null;
    })();
    const best = (hc.good || []).map(m => ({ m, o: byId.get(Number(m.id)) })).find(x => x.o);
    const worst = (hc.against || []).map(m => ({ m, o: byId.get(Number(m.id)) })).find(x => x.o);
    const leadParts = [`${h.localized_name} — герой ${atk}, основной атрибут — «${a[1].toLowerCase()}».`];
    if (coreItem) leadParts.push(`Главная крупная покупка ${coreItem.when} — ${coreItem.name}: её берут в ${coreItem.p}% матчей героя (выборка — ${mt(nH)}).`);
    if (best && worst) leadParts.push(`По матчапам лучше ожидаемого выходит против ${best.o.localized_name} (+${pp(best.m.d)} п. п.), хуже всего — против ${worst.o.localized_name} (−${pp(worst.m.d)} п. п.).`);
    else if (!coreItem) leadParts.push('Ниже — его способности, реальные покупки по стадиям игры и результаты против конкретных героев.');
    const lead = leadParts.join(' ');
    const msBelow = vs ? shareBelow(Number(vs.ms), msList) : null;
    const msAbove = vs && msList.length ? Math.round(msList.filter(x => x > Number(vs.ms)).length / msList.length * 100) : null;
    const msPhrase = msBelow == null ? '' : msBelow >= 50 ? `: это больше, чем у ${msBelow}% героев` : msAbove >= 50 ? `: это меньше, чем у ${msAbove}% героев` : ': это средняя скорость среди героев';
    const rangeShare = vs && h.attack_type !== 'Melee' ? shareBelow(Number(vs.range), rangedList) : null;

    const ldjson = JSON.stringify({
      "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": `${ORIGIN}/` },
        { "@type": "ListItem", "position": 2, "name": "Герои", "item": `${ORIGIN}/heroes/` },
        { "@type": "ListItem", "position": 3, "name": h.localized_name, "item": `${ORIGIN}/hero/${slug}/` },
        { "@type": "ListItem", "position": 4, "name": "Гайд", "item": canonical }]
    });

    // Описание до ~160 знаков. Закупы и контрпики — своя база матчей сайта (hero-items.json, hero-counters.json), не OpenDota.
    const desc = [`Гайд по ${h.localized_name}: роли (${roles}), способности, закупы по стадиям игры, кого контрит и кто контрит — по своей базе матчей.`,
      `Гайд по ${h.localized_name}: способности, закупы по стадиям игры, кого контрит и кто контрит — по своей базе матчей.`].find(t => t.length <= 160) || `Гайд по ${h.localized_name}: способности, закупы и контрпики по своей базе матчей.`;

    const html = `<!doctype html>
<html lang="ru">
<head>
<script>try{document.documentElement.dataset.theme=localStorage.getItem('dotamate-theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${imageUrl(h)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/assets/fonts/inter-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<link rel="stylesheet" href="/css/tokens.css"><script src="/js/theme.js" defer></script>
<script type="application/ld+json">${ldjson}</script>
${analytics}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    ${siteNav.navHtml('heroes')}
    <div class="nav-spacer"></div><button class="theme-toggle" type="button" aria-label="???????? ??????? ????" aria-pressed="false">?</button>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main hg-main" style="padding-top:26px;padding-bottom:60px;max-width:960px;">
  <nav aria-label="breadcrumb"> / <a href="/heroes/">Герои</a> / <a href="/hero/${slug}/">${escapeHtml(h.localized_name)}</a> / Гайд</nav>
  <div class="hg-head">
    <img class="hg-portrait" src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}">
    <div>
      <h1>${escapeHtml(h.localized_name)}</h1>
      <p class="hg-lead">${escapeHtml(lead)}</p>
      <div class="hero-detail-actions">
        <a class="btn red" href="/hero/${slug}/">Страница героя →</a>
      </div>
    </div>
  </div>

  <nav class="hg-toc" aria-label="Разделы гайда">
    <a href="#kak-igrat">Как играть</a><a href="#osobennosti">Особенности</a><a href="#zakupy">Варианты закупов</a><a href="#kogo-kontrit">Кого контрит</a><a href="#kto-kontrit">Кто контрит</a><a href="#dalshe">Что дальше</a>
  </nav>

  <section id="kak-igrat">
    <h2>Как играть</h2>
    <p>${escapeHtml(h.localized_name)} — ${atk === 'ближнего боя' ? 'герой ближнего боя' : 'герой дальнего боя'}, основной атрибут — ${escapeHtml(a[1].toLowerCase())}. Valve относит его к ролям: ${escapeHtml(roles.toLowerCase())}. Роль задаёт, чего от героя ждёт команда: ${escapeHtml(rolePlain(h))}</p>
    ${vs ? `<p>Скорость передвижения ${escapeHtml(h.localized_name)} — ${escapeHtml(String(vs.ms))}${msPhrase}. Урон атаки на первом уровне — ${escapeHtml(`${vs.dmin}–${vs.dmax}`)}, дальность атаки — ${escapeHtml(String(vs.range))}${rangeShare != null ? ` (дальше, чем у ${rangeShare}% героев дальнего боя)` : ''}.</p>` : ''}
    ${statsHtml ? `<div class="hg-stats">${statsHtml}</div>` : ''}
  </section>

  <section id="osobennosti">
    <h2>Особенности</h2>
    ${abilitiesHtml ? `<div class="hg-abilities">${abilitiesHtml}</div>` : '<p class="hg-nodata">Официальные русские описания способностей для этого героя пока недоступны.</p>'}
  </section>

  <section id="zakupy">
    <h2>Варианты закупов</h2>
    <p>${nH ? `Выборка — ${mt(nH)} с ${escapeHtml(h.localized_name)} из нашей базы рейтинговых матчей текущего патча` : 'Покупки посчитаны по нашей базе рейтинговых матчей текущего патча'} (вся база — ${mt(Number(heroItems.matchesUsed) || 0)}, обновлено ${String(heroItems.builtAt).slice(0, 10).split('-').reverse().join('.')}). Процент у предмета — доля матчей ${escapeHtml(h.localized_name)}, в которых его купили в этой фазе.</p>
    ${phaseHtml ? `<div class="hg-phases">${phaseHtml}</div>` : '<p class="hg-nodata">Данных о покупках для этого героя в открытой статистике сейчас нет.</p>'}
  </section>

  <section id="kogo-kontrit">
    <h2>Кого контрит ${escapeHtml(h.localized_name)}</h2>
    <p>${best ? `Лучший результат у ${escapeHtml(h.localized_name)} — против ${escapeHtml(best.o.localized_name)}: ${wr(best.m.w)} побед в ${mt(best.m.g)}, на ${pp(best.m.d)} п. п. выше, чем ожидалось бы по общей силе обоих героев.` : `Соперники, против которых ${escapeHtml(h.localized_name)} выигрывает заметно чаще ожидаемого.`}</p>
    ${strongRows ? `<div style="overflow-x:auto;"><table class="hg-table">${tableHead}<tbody>${strongRows}</tbody></table></div>` : noData}
  </section>

  <section id="kto-kontrit">
    <h2>Кто контрит ${escapeHtml(h.localized_name)}</h2>
    <p>${worst ? `Самый неудобный соперник — ${escapeHtml(worst.o.localized_name)}: против него ${escapeHtml(h.localized_name)} выигрывает ${wr(worst.m.w)} из ${num(worst.m.g)} матчей, на ${pp(worst.m.d)} п. п. меньше, чем ожидалось бы по общей силе героев.` : `Соперники, против которых у ${escapeHtml(h.localized_name)} статистика хуже всего.`}</p>
    ${weakRows ? `<div style="overflow-x:auto;"><table class="hg-table">${tableHead}<tbody>${weakRows}</tbody></table></div>` : noData}
    <p class="hg-source">Источник матчапов: наша база публичных рейтинговых матчей (${escapeHtml(String(heroCounters.slice || ''))}, ${escapeHtml(num(heroCounters.matchesUsed || 0))} матчей), обновлена ${escapeHtml(String(heroCounters.dataAt || '').slice(0, 10))}; пары, сыгранные меньше ${heroCounters.minGames || 300} раз, отброшены. «К ожидаемому» — на сколько процентных пунктов доля побед в паре выше или ниже той, что ожидалась бы по общим винрейтам обоих героев. Таблица для всех героев — в <a href="/guide/counter-picks/">статье про контрпики</a>.</p>
  </section>

  <section id="dalshe">
    <h2>Что дальше</h2>
    <p>${worst ? `Разберите, как играет ${escapeHtml(worst.o.localized_name)} — самый неудобный для ${escapeHtml(h.localized_name)} соперник, — а также` : 'Ниже —'} гайды по героям из таблиц выше, герои с похожими ролями и драфт с ${escapeHtml(h.localized_name)} в DraftMate.</p>
    <div class="linked-list">${nextHtml}</div>
  </section>
</main>
<footer><div class="container footer-row"><span class="footer-brand">© 2026 DotaMate.ru. Dota 2 и логотип Dota 2 являются зарегистрированными товарными знаками корпорации Valve.</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="https://t.me/Dotamate_ru" target="_blank" rel="noopener">Telegram-канал</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
<script src="/js/hero-roles.js" defer></script>
</body>
</html>
`;
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    urls.push({ loc: canonical, name: `Гайд по ${h.localized_name}` });
    made++;
  }

  fs.writeFileSync(path.join(__dirname, 'hero-guide-urls.json'), JSON.stringify(urls, null, 2), 'utf8');
  console.log(`Сгенерировано ${made} гайдов по героям${thin ? `, пропущено без данных: ${thin}` : ''}.`);
}

// Что роль значит на практике — формулировки общие и верные для роли, без
// выдуманных утверждений про конкретного героя.
const ROLE_PLAIN = {
  Carry: 'керри нужен фарм и время, его сила приходит с предметами',
  Support: 'поддержка тратит золото на команду — варды, расходники, спасающие предметы',
  Nuker: 'нюкер бьёт способностями коротко и больно, важна мана и тайминги',
  Disabler: 'дизейблер отключает цель — от его контроля зависит размен в драке',
  Initiator: 'инициатор начинает бой и должен заходить в удобный момент',
  Durable: 'танк держит урон на себе и выживает в драке дольше остальных',
  Escape: 'эскейп умеет выходить из боя, поэтому может рисковать сильнее',
  Pusher: 'пушер давит линии и берёт строения быстрее прочих',
  Jungler: 'лесник может фармить лес и освобождать линию союзнику',
};
function rolePlain(h) {
  const list = (h.roles || []).map(r => ROLE_PLAIN[r]).filter(Boolean);
  if (!list.length) return 'универсальный герой без выраженной специализации по классификации Valve.';
  return list.slice(0, 3).join('; ') + '.';
}

main().catch(e => { console.error(e); process.exit(1); });
