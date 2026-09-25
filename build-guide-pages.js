#!/usr/bin/env node
// Generates static, SEO-indexable articles under deploy/guide/<slug>/index.html
// from the hand-written, evergreen content in guide-content.js.

const fs = require('fs');
const path = require('path');
const guides = require('./guide-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
// Раздел «Инструменты» удалён в сессии 5 — гайды, которые на него ссылались,
// отправляем в «Гайды».
const actionLabels={heroes:"Герои",items:"Предметы",stats:"Статистика",guides:"Гайды"};
const actionHref=a=>({heroes:"/heroes/",items:"/items/",stats:"/stats/",guides:"/guides/"}[a]||"/guides/");

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->\n<!-- Yandex.RTB --><script>window.yaContextCb=window.yaContextCb||[]</script><script src="https://yandex.ru/ads/system/context.js" async></script><!-- End Yandex.RTB -->\n<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->`;

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
    const title=`${g.title} | Гайд Dota Mate`;
    const ldjson=JSON.stringify({
      "@context":"https://schema.org","@type":"Article",
      "headline":g.title,"description":g.excerpt,
      "mainEntityOfPage":canonical,
      ...(g.published?{"datePublished":g.published}:{}),
      ...(g.updated?{"dateModified":g.updated}:{}),
      "author":{"@type":"Organization","name":"Dota Mate"}
    });
    const breadcrumbJson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/guides/"},{"@type":"ListItem","position":3,"name":g.title,"item":canonical}]});

    // Раздел статьи умеет три блока: абзацы (p), маркированный список (list)
    // и таблицу (table: {head:[], rows:[[]]}). Таблица оборачивается в контейнер
    // с горизонтальной прокруткой, иначе на телефоне она растягивает страницу.
    const renderTable=t=>`<div style="overflow-x:auto;margin:16px 0;"><table><thead><tr>${t.head.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map((c,ci)=>`<td>${ci===0?`<b style="color:#e8ecf3;">${escapeHtml(c)}</b>`:escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note?`<p style="font-size:13px;color:#8b919c;margin:6px 0 0;">${escapeHtml(t.note)}</p>`:''}</div>`;
    const bodyHtml=g.sections.map(sec=>{
      const parts=[];
      (sec.p||[]).forEach(par=>parts.push(`<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(par)}</p>`));
      if(sec.table) parts.push(renderTable(sec.table));
      if(sec.list) parts.push(`<ul style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${sec.list.map(li=>`<li>${escapeHtml(li)}</li>`).join('')}</ul>`);
      (sec.after||[]).forEach(par=>parts.push(`<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(par)}</p>`));
      return `<section class="detail-section"><h2>${escapeHtml(sec.h)}</h2>${parts.join('')}</section>`;
    }).join('');

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
<link rel="icon" type="image/png" href="/assets/dotamate-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="https://dotamate.ru/assets/dotamate-og.jpg">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
<script type="application/ld+json">${breadcrumbJson}</script>
${analyticsSnippet}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/" aria-current="page" class="active">Гайды</a><a href="/meta/">META</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:820px;">
  <nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;">
    <a href="/">Главная</a> / <a href="/guides/">Гайды</a> / ${escapeHtml(g.title)}
  </nav>
  <div class="eyebrow">${escapeHtml(g.tag)}</div>
  <h1 style="margin:6px 0 20px;">${escapeHtml(g.title)}</h1>
  <p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 28px;">${escapeHtml(g.excerpt)}</p>
  ${bodyHtml}
  <div class="ad-slot ad-active" id="yandex_rtb_R-A-20064201-1" data-ad-slot="guide-article-mid"></div>
<script>window.yaContextCb.push(()=>{Ya.Context.AdvManager.render({"blockId":"R-A-20064201-1","renderTo":"yandex_rtb_R-A-20064201-1"})})</script>
  <div class="hero-detail-actions" style="margin-top:26px;">
    <a class="btn red" href="${actionHref(g.action)}">Открыть раздел «${escapeHtml(actionLabels[g.action]||"Гайды")}» →</a>
  </div>
  <div class="detail-section" style="margin-top:34px;">
    <h3>Другие гайды</h3>
    <div class="linked-list">${relatedHtml}</div>
  </div>
</main>
<footer><div class="container">Dota Mate · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
