#!/usr/bin/env node
// Статические страницы предметов: deploy/item/<slug>/index.html.
//
// Источник данных — data/items-ru.json (собирает tools/build-items-ru.py из
// официального русского datafeed Valve). Сеть здесь больше не нужна: и текст,
// и числа, и картинки лежат в репозитории, поэтому страница предмета, карточка
// в каталоге и модалка показывают ровно одно и то же.
//
// Рецепты своей страницы не получают: их карточка ведёт на собираемый предмет.

const fs = require('fs');
const path = require('path');

// Заранее сгенерированные русские meta description (tools/gen-item-meta.py):
// у них выверена длина под выдачу. Если для предмета такого нет — режем
// начало русского описания.
const seoDesc = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'item-descriptions.json'), 'utf8')); }
  catch { return {}; }
})();

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function descText(x){return (x.desc||[]).map(b=>[b.h,b.t].filter(Boolean).join('. ')).join(' ').replace(/\s+/g,' ').trim();}
function trimTo(s,n){const t=String(s||'').trim();if(t.length<=n)return t;const cut=t.slice(0,n);const sp=cut.lastIndexOf(' ');return (sp>60?cut.slice(0,sp):cut).replace(/[\s,.;:—-]+$/,'')+'…';}

async function main(){
  const store=JSON.parse(fs.readFileSync(path.join(__dirname,'data','items-ru.json'),'utf8')).items;
  const usage=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-heroes.json'),'utf8')).items;}catch{return {};}})();
  // Общее правило каталога: рецепты и повторные уровни одного предмета
  // (Dagon 2–5, Necronomicon 2–3) своей страницы не получают — иначе в
  // выдаче пять одинаковых «Dagon». Данные о них остаются в items-ru.json,
  // а старые адреса переадресуются на базовый предмет в deploy/worker.js.
  const V=require('./js/item-variants.js');
  const variantMaps=V.buildVariantMaps(store);
  const entries=Object.entries(store).filter(([key,x])=>
    x.dname && !x.recipeFor && !variantMaps.byKey[key]);

  // Герои нужны, чтобы к именам в блоке покупок добавить иконку и ссылку.
  const {slugForHero}=require('./tools/hero-common.js');
  const heroById=new Map();
  try{
    for(const h of JSON.parse(fs.readFileSync(path.join(__dirname,'data','heroes.json'),'utf8')).heroes)
      heroById.set(Number(h.id),h);
  }catch{}

  const outRoot=path.join(__dirname,'deploy','item');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(const [key,x] of entries){
    const slug=itemSlug(key);
    if(!slug) continue;
    const dir=path.join(outRoot,slug);
    fs.mkdirSync(dir,{recursive:true});

    const img=x.img||`/assets/items/${slug}.png`;
    const ogImage=`https://dotamate.ru${img}`;
    const title=`${x.dname} — предмет Dota 2: характеристики и описание | Dota Mate`;
    const storedDesc=seoDesc[slug];
    const desc=(typeof storedDesc==='string'&&storedDesc.includes(x.dname))?storedDesc:trimTo(`${x.dname}. ${descText(x)}`,300);
    const lead=trimTo(descText(x),150);
    const canonical=`https://dotamate.ru/item/${slug}/`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Предметы","item":"https://dotamate.ru/items/"},{"@type":"ListItem","position":3,"name":x.dname,"item":canonical}]});

    const descHtml=(x.desc||[]).map(b=>`<div class="ip-block">${b.h?`<h3>${escapeHtml(b.h)}</h3>`:''}${String(b.t||'').split('\n').filter(Boolean).map(t=>`<p>${escapeHtml(t)}</p>`).join('')}</div>`).join('');
    const notesHtml=(x.notes||[]).map(n=>`<p>• ${escapeHtml(n)}</p>`).join('');
    const attribHtml=(x.attr||[]).map(t=>`<div><small>${escapeHtml(t)}</small></div>`).join('');
    // Ссылки «собирается из» и «входит в сборку». Рецепт ведёт на свой
    // предмет, уровень — на базовый (иначе Necronomicon ссылался бы на
    // собственный второй уровень, у которого страницы уже нет), ссылка на
    // самого себя отбрасывается.
    const link=k=>{
      const it=store[k];
      if(!it)return '';
      const target=variantMaps.byKey[it.recipeFor||k]||it.recipeFor||k;
      if(target===key)return '';
      const dest=store[target];
      return dest?`<a href="/item/${itemSlug(target)}/"><img src="${dest.img}" alt="${escapeHtml(dest.dname)}">${escapeHtml(dest.dname)}<span>→</span></a>`:'';
    };
    const componentsHtml=(x.comp||[]).map(link).filter(Boolean).join('');
    const intoHtml=(x.into||[]).map(link).filter(Boolean).join('');
    // Уровни улучшения — только у предметов, у которых они есть
    const levels=V.levelsOf(key,store);
    const levelsHtml=levels.length?`<div class="item-levels-grid">${levels.map(l=>
      `<div class="item-level"><b>${l.level}</b><span>${Number(l.cost).toLocaleString('ru-RU')} G</span><i>${l.step?'+'+Number(l.step).toLocaleString('ru-RU')+' G за улучшение':'базовый'}</i></div>`
    ).join('')}</div>`:'';
    const use=usage[String(x.id)];
    // Список героев с иконками и ссылкой на страницу героя: имя одно читается
    // тяжелее, а иконка узнаётся мгновенно. Слаг и картинка берутся из того же
    // справочника героев, что и остальной сайт; если героя в нём нет,
    // показываем строку без иконки, но не ломаем блок.
    const heroesHtml=(use&&use.heroes||[]).map(r=>{
      const h=heroById.get(Number(r.h));
      const slug=h?slugForHero(h):'';
      const icon=slug?`<img loading="lazy" src="/assets/heroes/${slug}.png" alt="">`:'';
      const inner=`${icon}<span><b>${escapeHtml(r.n)}</b><i>${r.g} покупок · чаще: ${escapeHtml(r.p)}</i></span>`;
      return slug?`<li><a href="/hero/${slug}/">${inner}</a></li>`:`<li>${inner}</li>`;
    }).join('');
    const meta=[
      x.cost?`<span>💰 ${x.cost} золота</span>`:(x.cat==='neutral'?`<span>Нейтральный${x.tier?` · тир ${x.tier}`:''}</span>`:''),
      x.cat==='neutral'?'':`<span>${escapeHtml(x.catRu||'Предмет')}</span>`,
      x.cd?`<span>⏱ КД ${x.cd} сек</span>`:'',
      x.mc?`<span>💧 ${x.mc} маны</span>`:'',
      x.charges?`<span>Зарядов: ${x.charges}</span>`:''
    ].filter(Boolean).join('');

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
<meta property="og:image" content="${ogImage}">
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
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><img class="brand-logo" src="/assets/dotamate-logo.png" alt="Dota Mate" width="621" height="120"></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/">Герои</a><a href="/items/" aria-current="page" class="active">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/game/">Игра</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container ip-main">
  <nav aria-label="breadcrumb" class="ip-crumbs"><a href="/">Главная</a> <span>›</span> <a href="/items/">Предметы</a> <span>›</span> <span aria-current="page">${escapeHtml(x.dname)}</span></nav>
  <section class="ip-top">
    <div class="ip-art"><img src="${img}" alt="${escapeHtml(x.dname)}"><span class="ip-qual">${escapeHtml(x.catRu||'Предмет')}</span></div>
    <div class="ip-head">
      <div class="eyebrow">ПРЕДМЕТ DOTA 2</div>
      <h1>${escapeHtml(x.dname)}</h1>
      ${lead?`<p class="ip-lead">${escapeHtml(lead)}</p>`:''}
      <div class="ip-chips">${meta}</div>
    </div>
  </section>
  ${descHtml?`<section class="ip-panel"><div class="ip-panel-head"><span>ОПИСАНИЕ</span><h2>Что делает предмет</h2></div><div class="ip-desc">${descHtml}</div>${notesHtml?`<div class="ip-notes"><h3>Примечания</h3>${notesHtml}</div>`:''}</section>`:''}
  ${attribHtml?`<section class="ip-panel"><div class="ip-panel-head"><span>ХАРАКТЕРИСТИКИ</span><h2>Что даёт в цифрах</h2></div><div class="ip-attrib">${attribHtml}</div></section>`:''}
  ${levelsHtml?`<section class="ip-panel item-levels"><div class="ip-panel-head"><span>УЛУЧШЕНИЕ</span><h2>Уровни улучшения</h2></div>
    <p class="item-levels-note">Предмет улучшается прямо в инвентаре: каждый следующий уровень покупается отдельно и усиливает все его показатели. Числа в характеристиках выше перечислены по уровням — от первого к последнему.</p>
    ${levelsHtml}</section>`:''}

  ${componentsHtml?`<section class="ip-panel"><div class="ip-panel-head"><span>СБОРКА</span><h2>Собирается из</h2></div><div class="linked-list ip-recipe">${componentsHtml}</div></section>`:''}
  ${intoHtml?`<section class="ip-panel"><div class="ip-panel-head"><span>ДАЛЬШЕ</span><h2>Входит в сборку</h2></div><div class="linked-list ip-recipe">${intoHtml}</div></section>`:''}
  ${heroesHtml?`<section class="ip-panel"><div class="ip-panel-head"><span>ГЕРОИ</span><h2>Кто покупает этот предмет</h2></div><ul class="ip-heroes">${heroesHtml}</ul></section>`:''}
  ${x.lore?`<section class="ip-panel ip-lore"><div class="ip-panel-head"><span>ИСТОРИЯ</span><h2>История предмета</h2></div><p>${escapeHtml(x.lore)}</p></section>`:''}
</main>
<footer><div class="container">Dota Mate · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
