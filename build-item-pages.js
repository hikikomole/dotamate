#!/usr/bin/env node
// Generates static, SEO-indexable pages for real Dota 2 items under deploy/item/<slug>/index.html
// Data source: OpenDota /api/constants/items (mirrors Valve's dotaconstants), which carries
// real ability descriptions, attributes and lore text — richer than what the live client
// modal shows without an extra async Valve-datafeed call, so no such call is needed here.

const fs = require('fs');
const path = require('path');

// Заранее сгенерированные русские meta description (tools/gen-item-meta.py).
// Раньше описание склеивалось из цены и сырого текста OpenDota — то есть на
// русскоязычном сайте в выдачу уходил английский абзац, обрезанный по 300
// символов на полуслове. Склейка ниже оставлена запасным путём на случай,
// если у предмета нет заготовленного описания.
const seoDesc = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'item-descriptions.json'), 'utf8')); }
  catch { return {}; }
})();

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function itemImage(key,img){
  const p=img||"";
  if(p.startsWith("http"))return p;
  if(p.startsWith("/"))return `https://cdn.cloudflare.steamstatic.com${p.split("?")[0]}`;
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${itemSlug(key)}.png`;
}
const qualLabels={component:'Компонент',consumable:'Расходник','consumable;laning':'Расходник',rare:'Редкий',epic:'Эпический',artifact:'Артефакт',common:'Обычный',secret_shop:'Магазин загадок',legendary:'Легендарный'};
function qualLabel(x){return qualLabels[x?.qual]||'Предмет';}

// Same curated exclusion as js/app.js's isRealCatalogItem() -- keep the two in
// sync. Without this, OpenDota's raw constants/items dump a courier, seven
// cosmetic Diretide river-coloring vials, two standalone ward sub-entries
// that duplicate the one real shop "Wards" item, and ~140 hidden internal
// objects Valve uses to represent hero innates/talent bonuses (this is what
// generated the broken "Ancient Guardian" page) straight into the SEO'd
// static item pages -- indexable nonsense is worse than an internal list
// glitch, since it's what a search result would actually show someone.
// EXCLUDED_ITEM_INTERNAL_IDS is a point-in-time snapshot of that hidden-
// internal bucket; refresh it against a fresh constants/items pull if a
// future patch's item pages start looking similarly broken.
const EXCLUDED_ITEM_INTERNAL_IDS=new Set([212,215,287,288,289,290,291,293,294,295,297,298,300,301,302,304,306,307,309,310,311,312,313,325,327,330,334,335,336,349,354,355,356,357,358,360,361,362,363,364,365,366,367,368,369,372,374,375,376,378,379,381,571,573,589,638,676,677,678,680,686,825,828,829,834,835,838,849,939,946,949,990,1000,1028,1029,1030,1090,1124,1156,1157,1158,1159,1160,1161,1167,1440,1441,1576,1577,1581,1583,1584,1585,1586,1587,1588,1589,1590,1591,1592,1593,1594,1595,1596,1597,1600,1602,1607,1608,1639,1641,1645,1647,1648,1649,1650,1651,1652,1803,1849,1850,1865,1866,1867,1869,1870,1871,1874,1875,2091,2092,2093,2094,2095,2096,2192,2193,4300,4301,4302]);
function isRealCatalogItem(key,x){
  const k=String(key||'').toLowerCase();
  if(k.startsWith('recipe_'))return false;
  if(k==='courier'||k==='flying_courier')return false;
  if(k.startsWith('river_painter'))return false;
  if(k==='ward_observer'||k==='ward_sentry')return false;
  if(EXCLUDED_ITEM_INTERNAL_IDS.has(Number(x?.id)))return false;
  return true;
}

function attribLine(a){
  if(a.display)return escapeHtml(a.display.replace('{value}',a.value));
  return escapeHtml(`${a.key}: ${a.value}`);
}

async function main(){
  const res=await fetch('https://api.opendota.com/api/constants/items');
  if(!res.ok) throw new Error('OpenDota constants/items failed: '+res.status);
  const data=await res.json();

  const entries=Object.entries(data).filter(([key,x])=>{
    if(!x||!x.dname||!x.id) return false;
    if(!isRealCatalogItem(key,x)) return false;
    const hasContent=(Array.isArray(x.abilities)&&x.abilities.length)||x.lore||( Array.isArray(x.attrib)&&x.attrib.length)||x.notes;
    return Boolean(hasContent);
  });

  const slugByKey={};
  for(const [key] of entries) slugByKey[key]=itemSlug(key);

  const outRoot=path.join(__dirname,'deploy','item');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(const [key,x] of entries){
    const slug=slugByKey[key];
    if(!slug) continue;
    const dir=path.join(outRoot,slug);
    fs.mkdirSync(dir,{recursive:true});

    const img=itemImage(key,x.img);
    const cat=qualLabel(x);
    const title=`${x.dname} — предмет Dota 2: характеристики и описание | Dota 2 Companion`;
    const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
    const abilitiesText=clean((x.abilities||[]).map(a=>a.description).filter(Boolean).join(' '));
    const descSource=abilitiesText||clean(x.notes)||clean(x.lore)||'';
    const fallbackDesc=clean(`${x.dname}: цена ${x.cost||'—'} золота. ${descSource}`).slice(0,300);
    const storedDesc=seoDesc[slug];
    const desc=(typeof storedDesc==='string'&&storedDesc.includes(x.dname))?storedDesc:fallbackDesc;
    const canonical=`https://dotamate.ru/item/${slug}/`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Предметы","item":"https://dotamate.ru/#items"},{"@type":"ListItem","position":3,"name":x.dname,"item":canonical}]});

    const abilitiesHtml=(x.abilities||[]).filter(a=>a.description).map(a=>`<div class="ability-card"><div><b>${escapeHtml(a.title||'Способность')}</b><p>${escapeHtml(a.description)}</p></div></div>`).join('');
    const attribHtml=(x.attrib||[]).filter(a=>a.value!==undefined).map(a=>`<div><small>${attribLine(a)}</small></div>`).join('');
    const componentsHtml=(x.components||[]).map(c=>{
      const cs=slugByKey[c];
      const cname=data[c]?.dname||c;
      return cs?`<a href="/item/${cs}/"><img src="${itemImage(c,data[c]?.img)}" alt="${escapeHtml(cname)}">${escapeHtml(cname)}<span>→</span></a>`:`<div><span>${escapeHtml(cname)}</span></div>`;
    }).join('');
    const meta=[
      `<span>💰 ${x.cost?x.cost+' gold':'Стоимость не указана'}</span>`,
      `<span>ID ${x.id}</span>`,
      x.cd?`<span>⏱ КД ${x.cd}с</span>`:'',
      x.mc?`<span>💧 ${x.mc} маны</span>`:''
    ].filter(Boolean).join('');

    const html=`<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" href="/assets/dota2-companion-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<script type="application/ld+json">${ldjson}</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->
</head>
<body id="top">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota 2 Companion">
      <span class="brand-mark brand-mark-image" aria-hidden="true"><img src="/assets/dota2-companion-icon.png" alt=""></span>
      <span>Dota 2 <b>Companion</b></span>
    </a>
    <nav id="navMenu"><a href="/#top">Главная</a><a href="/#heroes">Герои</a><a href="/#items">Предметы</a><a href="/#stats">Статистика</a><a href="/#guides">Гайды</a><a href="/#about">О сайте</a><a href="/#profile">Профиль</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container" style="padding-top:24px;padding-bottom:48px;">
  <nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;">
    <a href="/">Главная</a> / <a href="/#items">Предметы</a> / ${escapeHtml(x.dname)}
  </nav>
  <div class="item-profile-v3">
    <div class="item-profile-top">
      <div class="item-profile-art"><img src="${img}" alt="${escapeHtml(x.dname)}"><span>${escapeHtml(cat)}</span></div>
      <div class="item-profile-title">
        <div class="eyebrow">ITEM PROFILE</div>
        <h1>${escapeHtml(x.dname)}</h1>
        <div class="item-profile-meta">${meta}</div>
        <p class="item-profile-sub">Официальные данные предмета Dota 2 — способности, характеристики и лор.</p>
        <div class="item-profile-actions">
          <a class="btn red" href="/?openItem=${encodeURIComponent(key)}#items">Открыть в интерактивном профиле →</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.dota2.com/datafeed/itemdata?language=russian&item_id=${encodeURIComponent(x.id)}">Valve Datafeed ↗</a>
        </div>
      </div>
    </div>
    ${abilitiesHtml?`<section class="item-profile-panel" style="margin-top:18px;"><div class="item-panel-head"><div><span>ABILITIES</span><h3>Способности</h3></div></div><div class="ability-grid">${abilitiesHtml}</div></section>`:''}
    ${attribHtml?`<section class="item-profile-panel" style="margin-top:18px;"><div class="item-panel-head"><div><span>ATTRIBUTES</span><h3>Характеристики</h3></div></div><div class="detail-stats" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));">${attribHtml}</div></section>`:''}
    ${x.lore?`<section class="item-profile-panel item-why-panel" style="margin-top:18px;"><div class="item-panel-head"><div><span>LORE</span><h3>История предмета</h3></div></div><p style="font-style:italic;">${escapeHtml(x.lore)}</p></section>`:''}
    ${componentsHtml?`<section class="item-profile-panel" style="margin-top:18px;"><div class="item-panel-head"><div><span>RECIPE</span><h3>Собирается из</h3></div></div><div class="linked-list">${componentsHtml}</div></section>`:''}
  </div>
</main>
<footer><div class="container">Dota 2 Companion · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
</body>
</html>
`;

    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:x.dname});
  }

  fs.writeFileSync(path.join(__dirname,'item-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} item pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
