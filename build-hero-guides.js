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

const fs = require('fs');
const path = require('path');
const { escapeHtml, slugForHero, imageUrl, roleText, attrInfo, officialHeroUrl, heroStats } = require('./tools/hero-common.js');

const ORIGIN = 'https://dotamate.ru';
const DATA = path.join(__dirname, 'seo', 'hero-guide-data.json');

const analytics = `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->`;

const PHASES = [
  ['start_game_items', 'Старт', 'что покупают до выхода на линию'],
  ['early_game_items', 'Ранняя игра', 'первые покупки на линии'],
  ['mid_game_items', 'Середина игры', 'ключевые предметы средней стадии'],
  ['late_game_items', 'Поздняя игра', 'во что герой собирается к концу'],
];

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

  const heroes = await (await fetch('https://api.opendota.com/api/heroStats')).json();
  const byId = new Map(heroes.map(h => [Number(h.id), h]));
  const itemsRaw = await (await fetch('https://api.opendota.com/api/constants/items')).json();
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
    const title = `Гайд по ${h.localized_name} в Dota 2: как играть, закупы и контрпики | Dota Mate`;

    // --- разделы ---
    const stats = heroStats(h);
    const statsHtml = stats.map(s => `<div><small>${escapeHtml(s.k)}</small><strong>${escapeHtml(String(s.v))}</strong></div>`).join('');

    const abilitiesHtml = (g.abilities || []).map((ab, i) => {
      const paras = String(ab.desc || '').replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/\\n/g, '\n').replace(/<[^>]*>/g, '').replace(/%%/g, '%').split('\n').map(x => x.trim()).filter(Boolean);
      const body = paras.length ? paras.map(x => `<p>${escapeHtml(x)}</p>`).join('') : '<p>Официального русского описания у Valve для этой способности нет.</p>';
      return `<article class="hg-ability"><div class="hg-ability-art${abilityIconExists(ab.key) ? '' : ' no-icon'}">${abilityIconExists(ab.key) ? `<img loading="lazy" src="/assets/abilities/${encodeURIComponent(ab.key)}.png" alt="">` : `<u>${escapeHtml(String(ab.name || '').slice(0, 2).toUpperCase())}</u>`}<span>${i + 1}</span></div><div><b>${escapeHtml(ab.dname || ab.key)}</b>${body}</div></article>`;
    }).join('');

    const phaseHtml = PHASES.map(([key, label, hint]) => {
      const raw = (g.items || {})[key] || {};
      const rows = Object.entries(raw)
        .map(([id, count]) => ({ id: variantById[Number(id)] ?? Number(id), count: Number(count) || 0 }))
        .filter(r => itemName(r.id, itemsById))
        .sort((x, y) => y.count - x.count).slice(0, 6);
      if (!rows.length) return '';
      const li = rows.map(r => {
        const key2 = itemKeyById.get(r.id);
        const s = itemSlugOf(key2);
        const name = escapeHtml(itemName(r.id, itemsById));
        const img = `/assets/items/${s}.png`;
        return `<a href="/item/${s}/"><img loading="lazy" src="${img}" alt=""><b>${name}</b><small>${num(r.count)} покупок</small></a>`;
      }).join('');
      return `<div class="hg-phase"><h3>${label}</h3><p class="hg-hint">${hint}</p><div class="hg-items">${li}</div></div>`;
    }).filter(Boolean).join('');

    const row = m => {
      const o = byId.get(m.id); if (!o) return '';
      return `<tr><td><a href="/hero/${slugForHero(o)}/"><img loading="lazy" src="${imageUrl(o)}" alt="">${escapeHtml(o.localized_name)}</a></td><td>${matches(m.games)}</td><td><b>${pct(m.wins, m.games)}</b></td></tr>`;
    };
    const strongRows = (g.strongAgainst || []).map(row).filter(Boolean).join('');
    const weakRows = (g.weakAgainst || []).map(row).filter(Boolean).join('');
    const tableHead = '<thead><tr><th>Герой</th><th>Выборка</th><th>Winrate</th></tr></thead>';
    const noData = '<p class="hg-nodata">Пар с выборкой хотя бы в 15 матчей в открытых данных OpenDota для этого героя не набралось — поэтому таблицу не показываем.</p>';

    const lead = `${h.localized_name} — герой ${atk} с основным атрибутом «${a[1].toLowerCase()}». Роли по классификации Valve: ${roles.toLowerCase()}. Ниже — то, что видно из открытой статистики: реальные покупки по стадиям игры и результаты против конкретных героев.`;

    const ldjson = JSON.stringify({
      "@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Главная", "item": `${ORIGIN}/` },
        { "@type": "ListItem", "position": 2, "name": "Герои", "item": `${ORIGIN}/heroes/` },
        { "@type": "ListItem", "position": 3, "name": h.localized_name, "item": `${ORIGIN}/hero/${slug}/` },
        { "@type": "ListItem", "position": 4, "name": "Гайд", "item": canonical }]
    });

    const desc = `Гайд по ${h.localized_name}: роли (${roles}), способности с официальными русскими описаниями, реальные закупы по стадиям игры и таблицы «кого контрит» и «кто контрит» по данным OpenDota.`.slice(0, 300);

    const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" href="/assets/dotamate-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${imageUrl(h)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
${analytics}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/" aria-current="page" class="active">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/meta/">META</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main hg-main" style="padding-top:26px;padding-bottom:60px;max-width:960px;">
  <nav aria-label="breadcrumb"><a href="/">Главная</a> / <a href="/heroes/">Герои</a> / <a href="/hero/${slug}/">${escapeHtml(h.localized_name)}</a> / Гайд</nav>
  <div class="hg-head">
    <img class="hg-portrait" src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}">
    <div>
      <div class="eyebrow">ГАЙД ПО ГЕРОЮ</div>
      <h1>${escapeHtml(h.localized_name)}</h1>
      <p class="hg-lead">${escapeHtml(lead)}</p>
      <div class="hero-detail-actions">
        <a class="btn red" href="/hero/${slug}/">Страница героя →</a>
      </div>
    </div>
  </div>

  <nav class="hg-toc" aria-label="Разделы гайда">
    <a href="#kak-igrat">Как играть</a><a href="#osobennosti">Особенности</a><a href="#zakupy">Варианты закупов</a><a href="#kogo-kontrit">Кого контрит</a><a href="#kto-kontrit">Кто контрит</a>
  </nav>

  <section id="kak-igrat">
    <h2>Как играть</h2>
    <p>${escapeHtml(h.localized_name)} — ${atk === 'ближнего боя' ? 'герой ближнего боя' : 'герой дальнего боя'}, основной атрибут — ${escapeHtml(a[1].toLowerCase())}. Valve относит его к ролям: ${escapeHtml(roles.toLowerCase())}. Роль задаёт, чего от героя ждёт команда: ${escapeHtml(rolePlain(h))}</p>
    <p>Базовая скорость передвижения — ${escapeHtml(String(h.move_speed || '—'))}, урон атаки на первом уровне — ${escapeHtml(h.base_attack_min != null ? `${h.base_attack_min}–${h.base_attack_max}` : '—')}, дальность атаки — ${escapeHtml(String(h.attack_range || '—'))}. Это те цифры, от которых зависит, как герой стоит на линии: на них опирайтесь, а не на общие советы.</p>
    <div class="hg-stats">${statsHtml}</div>
    <p class="hg-note">Дальше по разделам: способности с официальным русским текстом Valve, реальные покупки по стадиям игры и две таблицы матчапов.</p>
  </section>

  <section id="osobennosti">
    <h2>Особенности</h2>
    ${abilitiesHtml ? `<div class="hg-abilities">${abilitiesHtml}</div>` : '<p class="hg-nodata">Официальные русские описания способностей для этого героя пока недоступны.</p>'}
  </section>

  <section id="zakupy">
    <h2>Варианты закупов</h2>
    <p>Это не «правильная сборка», а то, что игроки действительно покупают за этого героя — агрегированные данные OpenDota по стадиям игры. Число рядом с предметом — сколько раз его купили в выборке.</p>
    ${phaseHtml ? `<div class="hg-phases">${phaseHtml}</div>` : '<p class="hg-nodata">Данных о покупках для этого героя в открытой статистике сейчас нет.</p>'}
  </section>

  <section id="kogo-kontrit">
    <h2>Кого контрит ${escapeHtml(h.localized_name)}</h2>
    <p>Пары, в которых у героя лучший результат. Выборка — матчи, где оба героя были в игре по разные стороны; пары меньше 15 матчей отброшены, порядок — по нижней границе доверительного интервала, чтобы наверх не вылезали пары с парой игр.</p>
    ${strongRows ? `<table class="hg-table">${tableHead}<tbody>${strongRows}</tbody></table>` : noData}
  </section>

  <section id="kto-kontrit">
    <h2>Кто контрит ${escapeHtml(h.localized_name)}</h2>
    <p>Обратная сторона той же выборки — против кого статистика у героя хуже всего.</p>
    ${weakRows ? `<table class="hg-table">${tableHead}<tbody>${weakRows}</tbody></table>` : noData}
    <p class="hg-source">Источник матчапов: OpenDota, публичный агрегат по матчам. Всего в выборке этого героя ${escapeHtml(matches(g.matchupGames || 0))}, пар с выборкой от 15 матчей — ${escapeHtml(String(g.matchupPairs || 0))}. Данные обновляются вместе с пересборкой сайта, последняя — ${escapeHtml(String(store.fetched || '').slice(0, 10))}.</p>
  </section>
</main>
<footer><div class="container">Dota Mate · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
