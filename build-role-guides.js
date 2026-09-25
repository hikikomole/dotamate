#!/usr/bin/env node
// Гайды по ролям и сравнения предметов: deploy/guide/<slug>/index.html.
//
// Данные о предметах берутся из data/items-ru.json — той же локальной базы,
// что и каталог со страницами предметов (см. «Предметы: локальная русская
// база» в CLAUDE.md). Раньше сборщик ходил в OpenDota: названия приходили
// по-английски, картинки — с CDN Steam, а сборка падала, если API недоступен.
// Подборки предметов курируются руками в role-guide-content.js.

const fs = require('fs');
const path = require('path');
const data = require('./role-guide-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function itemImage(key,it){return (it&&it.img)||`/assets/items/${itemSlug(key)}.png`;}

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->\n<!-- Yandex.RTB --><script>window.yaContextCb=window.yaContextCb||[]</script><script type="text/plain" data-consent="ads" data-src="https://yandex.ru/ads/system/context.js"></script><!-- End Yandex.RTB -->\n<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->`;

function pageShell({title,desc,canonical,ldjsonList,bodyHtml}){
  return `<!doctype html>
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
${ldjsonList.map(j=>`<script type="application/ld+json">${j}</script>`).join('\n')}
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
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:900px;">
${bodyHtml}
</main>
<footer><div class="container footer-row"><span class="footer-brand">Dotamate by Hikikomole — фан-проект о Dota 2</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
</body>
</html>
`;
}

function itemCard(key, items){
  const it = items[key];
  if(!it) return `<div><span>${escapeHtml(key)}</span></div>`;
  return `<a href="/item/${itemSlug(key)}/"><img src="${itemImage(key,it)}" alt="${escapeHtml(it.dname)}"><span style="display:block;">${escapeHtml(it.dname)}<br><small style="opacity:.65;">${it.cost?it.cost+' золота':''}</small></span></a>`;
}

async function main(){
  const items=JSON.parse(fs.readFileSync(path.join(__dirname,'data','items-ru.json'),'utf8')).items;

  const outRoot=path.join(__dirname,'deploy','guide');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  // Role build guides
  for(const r of data.roles){
    const dir=path.join(outRoot,r.slug);
    fs.mkdirSync(dir,{recursive:true});
    const canonical=`https://dotamate.ru/guide/${r.slug}/`;
    const title=`${r.title} | Гайд Dota Mate`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":r.title,"description":r.excerpt,"mainEntityOfPage":canonical,"author":{"@type":"Organization","name":"Dota Mate"}});
    const breadcrumb=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/guides/"},{"@type":"ListItem","position":3,"name":r.title,"item":canonical}]});

    const stagesHtml=r.stages.map(st=>`<section class="detail-section"><h2>${escapeHtml(st.name)}</h2><p style="line-height:1.7;color:#c7cbd4;margin:0 0 12px;">${escapeHtml(st.note)}</p><div class="linked-list" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));display:grid;gap:8px;">${st.items.map(k=>itemCard(k,items)).join('')}</div></section>`).join('');

    const otherRoles=data.roles.filter(x=>x.slug!==r.slug).slice(0,3);
    const relatedHtml=otherRoles.map(x=>`<a href="/guide/${x.slug}/"><span style="font-size:20px;">${x.icon}</span>${escapeHtml(x.title)}<span>→</span></a>`).join('');

    const bodyHtml=`<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/guides/">Гайды</a> / ${escapeHtml(r.title)}</nav>
<div class="eyebrow">${escapeHtml(r.tag)} · ${escapeHtml(r.role.toUpperCase())}</div>
<h1 style="margin:6px 0 20px;">${escapeHtml(r.title)}</h1>
<p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 16px;">${escapeHtml(r.excerpt)}</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 26px;">${escapeHtml(r.intro)}</p>
${stagesHtml}
<div class="ad-slot ad-active" id="yandex_rtb_R-A-20064201-1" data-ad-slot="guide-role-mid"></div>
<script>window.yaContextCb.push(()=>{Ya.Context.AdvManager.render({"blockId":"R-A-20064201-1","renderTo":"yandex_rtb_R-A-20064201-1"})})</script>
<div class="hero-detail-actions" style="margin-top:26px;"><a class="btn red" href="/heroes/">Подобрать героя на роль «${escapeHtml(r.role)}» →</a></div>
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
    const title=`${c.title} | Гайд Dota Mate`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"Article","headline":c.title,"description":c.excerpt,"mainEntityOfPage":canonical,"author":{"@type":"Organization","name":"Dota Mate"}});
    const breadcrumb=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/guides/"},{"@type":"ListItem","position":3,"name":c.title,"item":canonical}]});

    const rowsHtml=c.items.map(key=>{
      const it=items[key];
      if(!it) return '';
      return `<article class="cmp-row">
        <a class="cmp-art" href="/item/${itemSlug(key)}/"><img src="${itemImage(key,it)}" alt="${escapeHtml(it.dname)}"></a>
        <div class="cmp-text"><a class="cmp-name" href="/item/${itemSlug(key)}/">${escapeHtml(it.dname)}</a><span class="cmp-cost">${it.cost?it.cost+' золота':''}</span><p>${escapeHtml(c.notes[key]||'')}</p></div>
      </article>`;
    }).join('');

    const otherComparisons=data.comparisons.filter(x=>x.slug!==c.slug);
    const relatedGuides=[...otherComparisons, ...data.roles.slice(0,2)];
    const relatedHtml=relatedGuides.map(x=>`<a href="/guide/${x.slug}/"><span style="font-size:20px;">${x.icon}</span>${escapeHtml(x.title)}<span>→</span></a>`).join('');

    const bodyHtml=`<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/guides/">Гайды</a> / ${escapeHtml(c.title)}</nav>
<div class="eyebrow">${escapeHtml(c.tag)}</div>
<h1 style="margin:6px 0 20px;">${escapeHtml(c.title)}</h1>
<p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 16px;">${escapeHtml(c.excerpt)}</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 26px;">${escapeHtml(c.intro)}</p>
<div class="cmp-list">${rowsHtml}</div>
<div class="ad-slot ad-active" id="yandex_rtb_R-A-20064201-1" data-ad-slot="guide-compare-mid"></div>
<script>window.yaContextCb.push(()=>{Ya.Context.AdvManager.render({"blockId":"R-A-20064201-1","renderTo":"yandex_rtb_R-A-20064201-1"})})</script>
<div class="detail-section" style="margin-top:34px;"><h3>Другие гайды</h3><div class="linked-list">${relatedHtml}</div></div>`;

    const html=pageShell({title,desc:c.excerpt,canonical,ldjsonList:[ldjson,breadcrumb],bodyHtml});
    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:c.title});
  }

  fs.writeFileSync(path.join(__dirname,'role-guide-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} role/comparison guide pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
