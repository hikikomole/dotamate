#!/usr/bin/env node
// Generates the terms glossary at deploy/glossary/index.html.
// Hand-curated content (glossary-content.js), reusing the same page shell
// as the other generated pages. Heavy internal linking to existing
// guide/item pages by design -- this page exists partly to strengthen
// that link graph for SEO.

const fs = require('fs');
const path = require('path');
const terms = require('./glossary-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->\n<!-- Yandex.RTB --><script>window.yaContextCb=window.yaContextCb||[]</script><script src="https://yandex.ru/ads/system/context.js" async></script><!-- End Yandex.RTB -->\n<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->`;

const title = 'Словарь терминов Dota 2 | Dota 2 Companion';
const desc = 'Что значат ластхит, денай, ганк, керри, MMR и другие термины Dota 2 — короткий словарь с понятными объяснениями и ссылками на подробные гайды.';
const canonical = 'https://dotamate.ru/glossary/';
const updated = new Date().toISOString().slice(0,10);

const ldjsonList = [
  JSON.stringify({
    "@context":"https://schema.org","@type":"DefinedTermSet","name":title,"description":desc,"url":canonical,
    "hasDefinedTerm": terms.map(t=>({"@type":"DefinedTerm","name":t.term,"description":t.def}))
  }),
  JSON.stringify({
    "@context":"https://schema.org","@type":"BreadcrumbList",
    "itemListElement":[
      {"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},
      {"@type":"ListItem","position":2,"name":"Словарь терминов","item":canonical}
    ]
  })
];

const termsHtml = terms.map(t => `<div class="detail-section" style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid rgba(95,85,150,.12);">
<h3 style="margin:0 0 6px;">${escapeHtml(t.term)}</h3>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 6px;">${escapeHtml(t.def)}</p>
${t.link ? `<a href="${t.link}" style="font-size:13px;font-weight:700;">${escapeHtml(t.linkText)} →</a>` : ''}
</div>`).join('');

const bodyHtml = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / Словарь терминов</nav>
<div class="eyebrow">СЛОВАРЬ</div>
<h1 style="margin:6px 0 8px;">Словарь терминов Dota 2</h1>
<p style="font-size:13px;opacity:.6;margin:0 0 20px;">Обновлено: ${updated}</p>
<p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 28px;">Короткие объяснения ${terms.length} терминов, которые чаще всего сбивают с толку новичков — от «ластхита» до MMR. Где нужно — ссылка на подробный гайд.</p>
${termsHtml}
<div class="ad-slot ad-active" id="yandex_rtb_R-A-20064201-1" data-ad-slot="glossary-mid"></div>
<script>window.yaContextCb.push(()=>{Ya.Context.AdvManager.render({"blockId":"R-A-20064201-1","renderTo":"yandex_rtb_R-A-20064201-1"})})</script>
<div class="hero-detail-actions" style="margin-top:26px;"><a class="btn red" href="/guides/">Смотреть все гайды →</a></div>
`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" href="/assets/dota2-companion-icon.png">
<meta property="og:type" content="website">
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
<link rel="stylesheet" href="/css/theme-dark.css">
${ldjsonList.map(j=>`<script type="application/ld+json">${j}</script>`).join('\n')}
${analyticsSnippet}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota 2 Companion">
      <span class="brand-mark brand-mark-image" aria-hidden="true"><img src="/assets/dota2-companion-icon.png" alt=""></span>
      <span>Dota 2 <b>Companion</b></span>
    </a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/" aria-current="page" class="active">Гайды</a><a href="/game/">Игра</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:820px;">
${bodyHtml}
</main>
<footer><div class="container">Dota 2 Companion · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
</body>
</html>
`;

const dir = path.join('deploy','glossary');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'index.html'), html, 'utf8');
fs.writeFileSync('glossary-urls.json', JSON.stringify([{loc:canonical,name:'Словарь терминов Dota 2'}],null,1));
console.log('Generated glossary page with', terms.length, 'terms.');
