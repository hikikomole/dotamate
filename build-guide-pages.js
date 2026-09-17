#!/usr/bin/env node
// Generates static, SEO-indexable articles under deploy/guide/<slug>/index.html
// from the hand-written, evergreen content in guide-content.js.

const fs = require('fs');
const path = require('path');
const guides = require('./guide-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
const actionLabels={heroes:"Герои",items:"Предметы",stats:"Статистика",tools:"Инструменты"};

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->`;

async function main(){
  const outRoot=path.join(__dirname,'deploy','guide');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(let i=0;i<guides.length;i++){
    const g=guides[i];
    const dir=path.join(outRoot,g.slug);
    fs.mkdirSync(dir,{recursive:true});

    const canonical=`https://dotamate.ru/guide/${g.slug}/`;
    const desc=g.excerpt;
    const title=`${g.title} | Гайд Dota 2 Companion`;
    const ldjson=JSON.stringify({
      "@context":"https://schema.org","@type":"Article",
      "headline":g.title,"description":g.excerpt,
      "mainEntityOfPage":canonical,
      "author":{"@type":"Organization","name":"Dota 2 Companion"}
    });
    const breadcrumbJson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/#guides"},{"@type":"ListItem","position":3,"name":g.title,"item":canonical}]});

    const bodyHtml=g.sections.map(sec=>`<section class="detail-section"><h2>${escapeHtml(sec.h)}</h2>${sec.p.map(par=>`<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(par)}</p>`).join('')}</section>`).join('');

    // deterministic "related" picks: next three guides in list order, wrapping around
    const related=[];
    for(let k=1;k<=3;k++) related.push(guides[(i+k)%guides.length]);
    const relatedHtml=related.map(r=>`<a href="/guide/${r.slug}/"><span style="font-size:20px;">${r.icon}</span>${escapeHtml(r.title)}<span>→</span></a>`).join('');

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
<script type="application/ld+json">${ldjson}</script>
<script type="application/ld+json">${breadcrumbJson}</script>
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
<main class="container" style="padding-top:24px;padding-bottom:48px;max-width:820px;">
  <nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;">
    <a href="/">Главная</a> / <a href="/#guides">Гайды</a> / ${escapeHtml(g.title)}
  </nav>
  <div class="eyebrow">${escapeHtml(g.tag)}</div>
  <h1 style="margin:6px 0 20px;">${escapeHtml(g.title)}</h1>
  <p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 28px;">${escapeHtml(g.excerpt)}</p>
  ${bodyHtml}
  <div class="ad-slot" id="ad-slot-article" data-ad-slot="guide-article-mid" aria-hidden="true"></div>
  <div class="hero-detail-actions" style="margin-top:26px;">
    <a class="btn red" href="/#${g.action}">Открыть раздел «${escapeHtml(actionLabels[g.action]||g.action)}» →</a>
  </div>
  <div class="detail-section" style="margin-top:34px;">
    <h3>Другие гайды</h3>
    <div class="linked-list">${relatedHtml}</div>
  </div>
</main>
<footer><div class="container">Dota 2 Companion · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
</body>
</html>
`;

    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:g.title});
  }

  fs.writeFileSync(path.join(__dirname,'guide-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} guide pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
