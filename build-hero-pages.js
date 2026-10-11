#!/usr/bin/env node
// Generates static, SEO-indexable pages for every hero under deploy/hero/<slug>/index.html
// Logic ported from js/app.js (heroStats, roleSuggestions),
// made deterministic (no Math.random() tiebreaker) so builds are reproducible.

const siteNav = require('./tools/site-nav');
const fs = require('fs');
const path = require('path');
// Карта слагов и помощники общие с build-hero-guides.js — см. tools/hero-common.js
const {escapeHtml,slugForHero,imageUrl,roleText,attrInfo,officialHeroUrl,heroStats}=require('./tools/hero-common.js');
// Те же реальные данные, что и у гайдов (tools/fetch-hero-guide-data.js):
// русские описания способностей, матчапы и покупки. Если файла нет, страница
// собирается как раньше — без этих блоков, но без падения.
const guideStore = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'hero-guide-data.json'), 'utf8')); }
  catch { return { heroes: {} }; }
})();
// Контрпики — один расчёт на весь сайт (tools/build-hero-counters.js,
// своя база рейтинговых матчей). Нет файла — блоки показывают заглушку.
const heroItems=JSON.parse(fs.readFileSync(path.join(__dirname,'data','hero-items.json'),'utf8'));
const heroStatTiles=require('./tools/hero-stat-tiles.js');
const valveHero=require('./tools/valve-hero-stats.js');
// Своя статистика героев (tools/build-stats.js). Нет файла — паспорт без цифр, плиток нет.
const heroStatsAll=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','stats.json'),'utf8'));}catch(e){console.warn('stats.json не прочитан:',e.message);return null;}})();
const heroCounters = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hero-counters.json'), 'utf8')); }
  catch { return { heroes: {} }; }
})();
const matchWord = n => { const a=Math.abs(n)%100,b=a%10; if(a>10&&a<20)return n+' матчей'; if(b===1)return n+' матч'; if(b>=2&&b<=4)return n+' матча'; return n+' матчей'; };
const cleanAbilityText = t => String(t||'').replace(/<\s*br\s*\/?\s*>/gi,' ').replace(/\\n/g,' ').replace(/<[^>]*>/g,'').replace(/%%/g,'%').replace(/\s+/g,' ').trim();

// Заранее сгенерированные уникальные meta description (tools/gen-hero-meta.py).
// Раньше всем героям подставлялся один шаблон с заменой имени — поисковик
// склеивает такие дубли. Шаблон оставлен запасным путём: если описания для
// слага нет или Valve переименовала героя, страница соберётся со старым
// текстом, а не с чужим именем в описании.
// Пять позиций Dota 2 и их статистика (Stratz). Снимок обновляется
// скриптом fetch-hero-positions.js; в проде поверх него Worker раз в сутки
// подтягивает свежие числа. Нет файла — страница собирается без строки ролей.
const heroRoles = require('./js/hero-roles.js');
const heroBuilds = require('./js/hero-builds.js');
// Справочник способностей и талантов (id -> внутреннее имя и название),
// собирается вместе с билдами: fetch-hero-builds.js
// Русские названия талантов (tools/fetch-talent-names-ru.js): у талантов нет
// иконки в игре, поэтому в интерфейсе они текстовые — и текст должен быть русским.
// Точные последовательности прокачки (fetch-skill-chains.js, OpenDota).
// Выборка отличается от Stratz — на странице это подписано явным текстом.
// Названия талантов из полного дерева (tools/build-talent-tree.js) — нужны и
// плиткам в полосе прокачки, где талант может встретиться на 10-м уровне.
const talentTitles = (() => {
  try {
    const tree = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'talent-tree.json'), 'utf8')).heroes;
    const out = {};
    for (const lv of Object.values(tree)) for (const arr of Object.values(lv)) for (const t of arr) {
      if (t.abilityId != null) out[t.abilityId] = t.title;
    }
    return out;
  } catch { return {}; }
})();
const skillChains = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'skill-chains.json'), 'utf8')).heroes; }
  catch { return {}; }
})();
const talentNames = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'talents-ru.json'), 'utf8')).byAbilityId; }
  catch { return {}; }
})();
const abilityIndex = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ability-index.json'), 'utf8')).abilities; }
  catch { return {}; }
})();
const positionSnapshot = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hero-positions.json'), 'utf8')); }
  catch { return { heroes: {} }; }
})();

const seoDesc = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'hero-descriptions.json'), 'utf8')); }
  catch { return {}; }
})();

const roleSuggestions={Carry:['Black King Bar','Manta Style','Satanic'],Mid:['Black King Bar','Orchid Malevolence',"Aghanim's Scepter"],Offlane:['Blink Dagger','Pipe of Insight','Crimson Guard'],Support:['Glimmer Cape','Force Staff','Lotus Orb'],HardSupport:['Arcane Boots','Glimmer Cape','Mekansm']};


function introParagraph(h){
  const a=attrInfo(h.primary_attr);
  const atk=h.attack_type==='Melee'?'ближнего боя':'дальнего боя';
  return `${escapeHtml(h.localized_name)} — герой ${a[1].toLowerCase()} атрибута и ${atk} в Dota 2. Основные роли: ${escapeHtml(roleText(h))}. Базовая скорость передвижения — ${h.move_speed||'—'}, урон атаки — ${h.base_attack_min}–${h.base_attack_max}.`;
}

async function main(){
  const res=await fetch('https://api.opendota.com/api/heroStats');
  if(!res.ok) throw new Error('OpenDota heroStats failed: '+res.status);
  const heroes=await res.json();
  // OpenDota не отдаёт complexity (шкалу сложности 1–3) — она есть только в
  // datafeed Valve и лежит в нашей data/heroes.json. Без этого слияния код
  // `h.complexity||1` рисовал единицу ВСЕМ героям, включая Invoker и Meepo.
  (()=>{
    try{
      const local=JSON.parse(fs.readFileSync(path.join(__dirname,'data','heroes.json'),'utf8')).heroes;
      const byId=new Map(local.map(x=>[Number(x.id),x]));
      for(const h of heroes){
        const l=byId.get(Number(h.id));
        if(l&&l.complexity) h.complexity=l.complexity;
      }
    }catch(e){ console.warn('Сложность не подмешана:',e.message); }
  })();

  // Способности: ключи по героям и их названия. Иконки и ролики лежат на том
  // же Steam CDN, откуда сайт уже берёт портреты, и собираются по ключу.
  async function grab(url){const r=await fetch(url);if(!r.ok)throw new Error(url+' -> '+r.status);return r.json();}
  const heroAbilities=await grab('https://api.opendota.com/api/constants/hero_abilities');
  const abilityMeta=await grab('https://api.opendota.com/api/constants/abilities');
  const RU_BEHAVIOR={'Passive':'Пассивная','No Target':'Без цели','Unit Target':'По цели','Point Target':'В точку','AOE':'По площади','Channeled':'Прерываемая','Toggle':'Переключаемая','Aura':'Аура','Autocast':'Автокаст','Hidden':'Скрытая'};
  const RU_DMG={'Physical':'физический','Magical':'магический','Pure':'чистый'};
  const CDN_IMG='/assets/abilities/';
  // Ролики Valve остаются на CDN: это сотни мегабайт видео, хостить их у себя
  // незачем. Все картинки — локальные.
  const CDN_VID='https://cdn.steamstatic.com/apps/dota2/videos/dota_react/abilities/';
  // Каталожный слаг и слаг Valve расходятся (Anti-Mage -> antimage, но
  // Outworld Destroyer -> obsidian_destroyer), поэтому для ссылок на CDN
  // берём внутреннее имя героя, а не наш слаг.
  const valveSlug=h=>String(h.name||'').replace(/^npc_dota_hero_/,'');
  function abilitiesOf(h){
    const raw=(heroAbilities[h.name]||{}).abilities||[];
    const flat=[];
    for(const a of raw) flat.push(...(Array.isArray(a)?a:[a]));
    return flat.filter(k=>typeof k==='string'&&!k.startsWith('generic')&&!k.endsWith('_empty'))
      .map(k=>{const m=abilityMeta[k]||{};const beh=[].concat(m.behavior||[]).map(b=>RU_BEHAVIOR[b]).filter(Boolean);
        return {key:k,name:m.dname||k,behavior:beh,dmg:RU_DMG[m.dmg_type]||''};})
      .filter(a=>a.name).slice(0,6);
  }

  // Справочники для блоков с реальными данными: герой по id (для матчапов) и
  // предмет по id (для покупок). Слаг предмета считаем так же, как
  // build-item-pages.js, чтобы ссылки совпадали со страницами.
  const byId=new Map(heroes.map(x=>[Number(x.id),x]));
  // Билды ссылаются и на уровни предметов (Dagon 2–5 — это id 201–204), а
  // страницы у них больше нет: карточка теперь одна. Сводим такие id к
  // базовому предмету, иначе ссылка вела бы в никуда.
  const itemVariants=(()=>{
    try{
      const V=require('./js/item-variants.js');
      const cat=JSON.parse(fs.readFileSync(path.join(__dirname,'data','items-ru.json'),'utf8')).items;
      return V.buildVariantMaps(cat).byId;
    }catch{ return {}; }
  })();
  const itemById=new Map();
  try{
    const itemsRaw=await grab('https://api.opendota.com/api/constants/items');
    // Ссылаемся только на предметы, у которых РЕАЛЬНО есть наша страница:
    // у OpenDota справочник шире нашего каталога, и страницы героев вели на
    // несуществующие /item/harpoon/ и /item/shadow_amulet/ — 17 ссылок в 404.
    const havePage=new Set();
    try{
      for(const u of JSON.parse(fs.readFileSync(path.join(__dirname,'item-urls.json'),'utf8')))
        havePage.add(String(u.loc).replace(/^https:\/\/dotamate\.ru\/item\/|\/$/g,''));
    }catch{}
    for(const [key,v] of Object.entries(itemsRaw||{})){
      if(!v||!v.id||!v.dname)continue;
      const slug=String(key).replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
      if(havePage.size&&!havePage.has(slug))continue;
      itemById.set(Number(v.id),{slug,dname:v.dname});
    }
  }catch{}

  // Часть врождённых способностей и фасетов Valve не публикует вообще — 41
  // иконка. Раньше страница всё равно запрашивала их файл и получала 404.
  // Проверяем наличие файла заранее и просто не ставим ссылку.
  const abilityIconExists=(()=>{
    let have=new Set();
    try{ have=new Set(fs.readdirSync(path.join(__dirname,'assets','abilities')).map(f=>f.replace(/\.png$/,''))); }catch{}
    return key=>have.has(String(key));
  })();

  // Характеристики 1-го уровня — официальный datafeed Valve (tools/valve-hero-stats.js).
  const valveStats=await valveHero.load(heroes.map(x=>x.id));
  const outRoot=path.join(__dirname,'deploy','hero');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(const h of heroes){
    const slug=slugForHero(h);
    if(!slug) continue;
    const dir=path.join(outRoot,slug);
    fs.mkdirSync(dir,{recursive:true});

    const stats=valveHero.cells(valveStats[h.id]);
    const a=attrInfo(h.primary_attr);
    const abilities=abilitiesOf(h);
    const rolesEntry=positionSnapshot.heroes?.[String(h.id)]||null;
    if(rolesEntry) h.mainPositions=rolesEntry.mainPositions||[];
    const rolesRow=heroRoles.rowHtml(rolesEntry,{escapeHtml});
    const buildData=(()=>{
      try { return JSON.parse(fs.readFileSync(path.join(__dirname,'data','builds',h.id+'.json'),'utf8')); }
      catch { return null; }
    })();
    const buildsHtml=buildData?heroBuilds.sectionsHtml(buildData,{
      escapeHtml,
      abilities:abilityIndex,
      talentNames:null, // русские названия готовы в data/talents-ru.json — включаются заменой на talentNames
      chains:skillChains[h.id]||null,
      talentTitles,
      hasAbilityIcon:abilityIconExists,
      itemVariants,
      items:Object.fromEntries([...itemById.entries()].map(([id,v])=>[id,v])),
      roleIcon:key=>heroRoles.icon(key),
      // Ситуативные предметы Stratz повторяют блок «Что покупают по ходу игры» — на странице только порядок основных.
      coreOnly:true
    }):'';

    // --- блоки из реальных данных (см. guideStore выше) ---
    const gd=guideStore.heroes?.[String(h.id)]||null;
    const abilityText={};
    for(const ab of (gd?.abilities||[])){const t=cleanAbilityText(ab.desc);if(t)abilityText[ab.key]=t.length>240?t.slice(0,240).replace(/\s+\S*$/,'')+'…':t;}
    // Паспорт, плитки статистики, матчапы и покупки — tools/hero-stat-tiles.js
    const hx=heroStatTiles.render(h,{S:heroStatsAll,counters:heroCounters,heroItems,byId,itemById,itemVariants,escapeHtml,slugForHero,imageUrl,minRole:heroItems.minRole||80});
    const title=`${h.localized_name} — билд, гайд и контрпики | Dota Mate`;
    const fallbackDesc=`${h.localized_name}: базовые характеристики, роли (${roleText(h)}), рекомендуемый билд и контрпики. Актуальные данные Dota 2.`;
    const storedDesc=seoDesc[slug];
    const descBody=typeof storedDesc==='string'&&storedDesc.includes(h.localized_name)?(storedDesc.split(/(?<=[.!])\s+/).slice(0,-1).join(' ')||storedDesc):'';const desc=descBody?`Билд на ${h.localized_name} и контрпики. ${descBody}`:fallbackDesc; // «билд» в начало, CTA-фраза из seo/hero-descriptions.json отбрасывается
    const canonical=`https://dotamate.ru/hero/${slug}/`;
    const img=imageUrl(h);
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Герои","item":"https://dotamate.ru/#heroes"},{"@type":"ListItem","position":3,"name":h.localized_name,"item":canonical}]});

    const html=`<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional" media="print" onload="this.media='all'"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<script src="/js/hero-roles.js" defer></script>
<script src="/js/hero-builds.js" defer></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    ${siteNav.navHtml('heroes')}
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main>
  ${hx.passport}
  <section class="container hx-rows">${hx.rows}</section>

  <details class="container hx-more" open><summary><h2>Билд</h2></summary>

  <section class="hp-bars container"${rolesRow?` id="heroRoles" data-hero-id="${h.id}"`:''}>
    ${rolesRow?`<p class="hb-hint">Роли героя: доля матчей и винрейт на каждой позиции. Нажмите на роль — прокачка, таланты и покупки ниже переключатся на неё. Затемнённая роль включится сама, когда на ней наберётся достаточно матчей.</p>`:''}
    ${rolesRow}
    ${stats.length?`<div class="hp-statbar-grid">
      <div class="hs-label"><small>На 1-м</small><strong>уровне</strong></div>
      ${stats.map(x=>`<div><small>${escapeHtml(x.k)}</small><strong>${escapeHtml(String(x.v))}</strong></div>`).join('')}
    </div>`:''}
    ${rolesRow?`<p class="hr-note">${escapeHtml(heroRoles.sourceNote(positionSnapshot))}</p>`:''}
  </section>

  ${buildsHtml}
  </details>


  ${abilities.length?`<details class="container hx-more"><summary><h2>Способности</h2></summary><section class="hp-abilities">
    <div class="hp-ab-layout">
      <div class="hp-ab-stage">
        ${abilities.map((ab,i)=>`<video class="hp-ab-video${i===0?' on':''}" data-ab="${i}" loop muted playsinline preload="none" ${abilityIconExists(ab.key)?`poster="${CDN_IMG}${ab.key}.png"`:''}><source src="${CDN_VID}${valveSlug(h)}/${ab.key}.webm" type="video/webm"></video>`).join('')}
      </div>
      <div class="hp-ab-side">
        <div class="hp-ab-icons" role="tablist" aria-label="Способности героя">
          ${abilities.map((ab,i)=>`<button type="button" role="tab" class="hp-ab-icon${i===0?' on':''}" data-ab="${i}" aria-selected="${i===0?'true':'false'}" title="${escapeHtml(ab.name)}">${abilityIconExists(ab.key)?`<img loading="lazy" src="${CDN_IMG}${ab.key}.png" alt="${escapeHtml(ab.name)}" onerror="this.closest('.hp-ab-icon').classList.add('no-icon');this.remove()">`:''}<span class="hp-ab-abbr">${escapeHtml(ab.name.slice(0,2).toUpperCase())}</span></button>`).join('')}
        </div>
        ${abilities.map((ab,i)=>`<div class="hp-ab-text${i===0?' on':''}" data-ab="${i}">
          <h3>${escapeHtml(ab.name)}</h3>
          <div class="hp-ab-tags">${ab.behavior.map(b=>`<span>${escapeHtml(b)}</span>`).join('')}${ab.dmg?`<span class="dmg">${escapeHtml(ab.dmg)} урон</span>`:''}</div>
          ${abilityText[ab.key]?`<p class="hp-ab-desc">${escapeHtml(abilityText[ab.key])}</p>`:''}
        </div>`).join('')}
      </div>
    </div>
  </section></details>`:''}



  <section class="hp-guide-cta container">
    <div>
      <b>Полный гайд по ${escapeHtml(h.localized_name)}</b>
      <small>Как играть, особенности, варианты закупов и обе таблицы матчапов целиком.</small>
    </div>
    <a class="btn red" href="/hero/${slug}/guide/">Открыть гайд →</a>
  </section>
<script>
// Переключение способностей: одна активная пара «ролик + подпись».
// Ролики грузятся лениво, поэтому у неактивных preload="none" — иначе
// страница тянула бы с CDN пять видео сразу.
(function(){
  var root=document.querySelector('.hp-abilities'); if(!root) return;
  var icons=root.querySelectorAll('.hp-ab-icon');
  function show(n){
    root.querySelectorAll('[data-ab]').forEach(function(el){
      var on=el.dataset.ab===String(n);
      el.classList.toggle('on',on);
      if(el.tagName==='BUTTON') el.setAttribute('aria-selected',on?'true':'false');
      if(el.tagName==='VIDEO'){ if(on){ el.play().catch(function(){}); } else { el.pause(); } }
    });
  }
  // Компьютер: блок «Способности» раскрыт и первый ролик играет сразу.
  // Телефон: свёрнут и без автозапуска — не тратим мобильный трафик.
  if(window.matchMedia&&window.matchMedia('(min-width: 761px)').matches){
    var det=root.closest('details'); if(det) det.open=true;
    show(0);
  }
  icons.forEach(function(b){
    b.addEventListener('click',function(){show(b.dataset.ab);});
    b.addEventListener('keydown',function(e){
      if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return;
      e.preventDefault();
      var i=[].indexOf.call(icons,b), n=(i+(e.key==='ArrowRight'?1:icons.length-1))%icons.length;
      icons[n].focus(); show(icons[n].dataset.ab);
    });
  });
})();
</script>
</main>
<footer><div class="container footer-row"><span class="footer-brand">© 2026 DotaMate.ru. Dota 2 и логотип Dota 2 являются зарегистрированными товарными знаками корпорации Valve.</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="https://t.me/Dotamate_ru" target="_blank" rel="noopener">Telegram-канал</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
</body>
</html>
`;

    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:h.localized_name});
  }

  fs.writeFileSync(path.join(__dirname,'hero-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} hero pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
