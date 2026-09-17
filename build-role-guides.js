#!/usr/bin/env node
// Generates data-driven guide pages: role-specific build progressions and
// item comparisons, under deploy/guide/<slug>/index.html. Pulls real item
// cost/name/image data from OpenDota constants/items so figures never go
// stale, while the item choices themselves (curated in role-guide-content.js)
// are long-standing Dota 2 staples rather than one patch's exact numbers.

const fs = require('fs');
const path = require('path');
const data = require('./role-guide-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function itemImage(key,img){
  const p=img||"";
  if(p.startsWith("http"))return p;
  if(p.startsWith("/"))return `https://cdn.cloudflare.steamstatic.com${p.split("?")[0]}`;
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${itemSlug(key)}.png`;
}

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->`;

function pageShell({title,desc,canonical,ldjsonList,bodyHtml}){
  return `<!doctype html>
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
<meta property="og:image" content="https://dotamate.ru/assets/dota2-companion-icon.png">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
${ldjsonList.map(j=>`<script type="application/ld+json">${j}</script>`).join('\n')}
${analyticsSnippet}
</head>
<body id="top">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota 2 Companion">
      <span class="brand-mark brand-mark-image" aria-hidden="true"><img src="/assets/dota2-companion-icon.png" alt=""></span>
      <span>Dota 2 <b>Companion</b></span>
    </a>
    <nav id="navMenu"><a href="/#top">Главная</a><a href="/#heroes">Герои</a><a href="/#items">Предметы</a><a href="/#stats">Статистика</a><a href="/stream.html">Стримы</a><a href="/#guides">Гайды</a><a href="/#about">О сайте</a><a href="/#profile">Профиль</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container" style="padding-top:24px;padding-bottom:48px;max-width:900px;">
${bodyHtml}
</main>
<footer><div class="container">Dota 2 Companion · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
</body>
</html>
`;
}

function itemCard(key, items){
  const it = items[key];
  if(!it) return `<div><span>${escapeHtml(key)}</span></div>`;
  return `<a href="/item/${itemSlug(key)}/"><img src="${itemImage(key,it.img)}" alt="${escapeHtml(it.dname)}"><span style="display:block;">${escapeHtml(it.dname)}<br><small style="opacity:.65;">${it.cost?it.cost+' gold':''}</small></span></a>`;
}

async function main(){
  const res=await fetch('https://api.opendota.com/api/constants/items');
  if(!res.ok) throw new Error('OpenDota constants/items failed: '+res.status);
  const items=await res.json();

  const outRoot=path.join(__dirname,'deploy','guide');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  // Role build guides
  for(const r of data.roles){
    const dir=path.join(outRoot,r.slug);
    fs.mkdirSync(dir,{recursive:true});
    const canonical=`https://dotamate.ru/guide/${r.slug}/`;
    const title=`${r.title} | Гайд Dota 2 Companion`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":r.title,"description":r.excerpt,"mainEntityOfPage":canonical,"author":{"@type":"Organization","name":"Dota 2 Companion"}});
    const breadcrumb=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/#guides"},{"@type":"ListItem","position":3,"name":r.title,"item":canonical}]});

    const stagesHtml=r.stages.map(st=>`<section class="detail-section"><h2>${escapeHtml(st.name)}</h2><p style="line-height:1.7;color:#c7cbd4;margin:0 0 12px;">${escapeHtml(st.note)}</p><div class="linked-list" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));display:grid;gap:8px;">${st.items.map(k=>itemCard(k,items)).join('')}</div></section>`).join('');

    const otherRoles=data.roles.filter(x=>x.slug!==r.slug).slice(0,3);
    const relatedHtml=otherRoles.map(x=>`<a href="/guide/${x.slug}/"><span style="font-size:20px;">${x.icon}</span>${escapeHtml(x.title)}<span>→</span></a>`).join('');

    const bodyHtml=`<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/#guides">Гайды</a> / ${escapeHtml(r.title)}</nav>
<div class="eyebrow">${escapeHtml(r.tag)} · ${escapeHtml(r.role.toUpperCase())}</div>
<h1 style="margin:6px 0 20px;">${escapeHtml(r.title)}</h1>
<p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 16px;">${escapeHtml(r.excerpt)}</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 26px;">${escapeHtml(r.intro)}</p>
${stagesHtml}
<div class="ad-slot" id="ad-slot-role" data-ad-slot="guide-role-mid" aria-hidden="true"></div>
<div class="hero-detail-actions" style="margin-top:26px;"><a class="btn red" href="/#heroes">Подобрать героя на роль «${escapeHtml(r.role)}» →</a></div>
<div class="detail-section" style="margin-top:34px;"><h3>Другие роли</h3><div class="linked-list">${relatedHtml}</div></div>`;

    const html=pageShell({title,desc:r.excerpt,canonical,ldjsonList:[ldjson,breadcrumb],bodyHtml});
    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:r.title});
  }

  // Comparison guides
  for(const c of data.comparisons){
    const dir=path.join(outRoot,c.slug);
    fs.mkdirSync(dir,{recursive:true});
    const canonical=`https://dotamate.ru/guide/${c.slug}/`;
    const title=`${c.title} | Гайд Dota 2 Companion`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":c.title,"description":c.excerpt,"mainEntityOfPage":canonical,"author":{"@type":"Organization","name":"Dota 2 Companion"}});
    const breadcrumb=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/#guides"},{"@type":"ListItem","position":3,"name":c.title,"item":canonical}]});

    const rowsHtml=c.items.map(key=>{
      const it=items[key];
      if(!it) return '';
      return `<article style="display:grid;grid-template-columns:64px 1fr;gap:14px;padding:14px;border:1px solid rgba(95,85,150,.12);border-radius:16px;background:#fff;margin-bottom:10px;align-items:center;">
        <a href="/item/${itemSlug(key)}/"><img src="${itemImage(key,it.img)}" alt="${escapeHtml(it.dname)}" style="width:64px;height:36px;object-fit:cover;border-radius:8px;"></a>
        <div><a href="/item/${itemSlug(key)}/" style="color:#29243b;font-weight:800;text-decoration:none;">${escapeHtml(it.dname)}</a> <span style="opacity:.6;font-size:12px;">· ${it.cost?it.cost+' gold':''}</span><p style="margin:4px 0 0;color:#4f4a60;font-size:13px;line-height:1.55;">${escapeHtml(c.notes[key]||'')}</p></div>
      </article>`;
    }).join('');

    const otherComparisons=data.comparisons.filter(x=>x.slug!==c.slug);
    const relatedGuides=[...otherComparisons, ...data.roles.slice(0,2)];
    const relatedHtml=relatedGuides.map(x=>`<a href="/guide/${x.slug}/"><span style="font-size:20px;">${x.icon}</span>${escapeHtml(x.title)}<span>→</span></a>`).join('');

    const bodyHtml=`<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/#guides">Гайды</a> / ${escapeHtml(c.title)}</nav>
<div class="eyebrow">${escapeHtml(c.tag)}</div>
<h1 style="margin:6px 0 20px;">${escapeHtml(c.title)}</h1>
<p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 16px;">${escapeHtml(c.excerpt)}</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 26px;">${escapeHtml(c.intro)}</p>
<div class="item-profile-panel" style="background:transparent;border:0;padding:0;">${rowsHtml}</div>
<div class="ad-slot" id="ad-slot-compare" data-ad-slot="guide-compare-mid" aria-hidden="true"></div>
<div class="detail-section" style="margin-top:34px;"><h3>Другие гайды</h3><div class="linked-list">${relatedHtml}</div></div>`;

    const html=pageShell({title,desc:c.excerpt,canonical,ldjsonList:[ldjson,breadcrumb],bodyHtml});
    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:c.title});
  }

  fs.writeFileSync(path.join(__dirname,'role-guide-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} role/comparison guide pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
