#!/usr/bin/env node
// Generates static, SEO-indexable pages for every hero under deploy/hero/<slug>/index.html
// Logic ported from js/app.js (heroStats, heroBuild, counterCandidates, roleSuggestions),
// made deterministic (no Math.random() tiebreaker) so builds are reproducible.

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

function heroBuild(h){const role=(h.roles||[]).includes('Support')?'Support':(h.roles||[]).includes('Carry')?'Carry':(h.roles||[]).includes('Initiator')?'Offlane':'Mid';return roleSuggestions[role]||roleSuggestions.Mid;}
function counterCandidates(h,heroes){const banned=new Set([h.id]);const score=x=>{let s=0;if(x.id===h.id)return -999;if(x.primary_attr!==h.primary_attr)s+=1;if((x.roles||[]).includes('Disabler'))s+=2;if((x.roles||[]).includes('Nuker'))s+=1;if((h.roles||[]).includes('Carry')&&(x.roles||[]).includes('Escape'))s+=2;if(h.attack_type==='Ranged'&&x.attack_type==='Melee')s+=1;return s;};return heroes.filter(x=>!banned.has(x.id)).sort((a,b)=>{const d=score(b)-score(a);return d!==0?d:a.id-b.id;}).slice(0,3);}

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
  const CDN_RENDER='https://cdn.steamstatic.com/apps/dota2/videos/dota_react/heroes/renders/';
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

  const outRoot=path.join(__dirname,'deploy','hero');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(const h of heroes){
    const slug=slugForHero(h);
    if(!slug) continue;
    const dir=path.join(outRoot,slug);
    fs.mkdirSync(dir,{recursive:true});

    const stats=heroStats(h);
    const counters=counterCandidates(h,heroes);
    const build=heroBuild(h);
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
      roleIcon:key=>heroRoles.icon(key)
    }):'';

    // --- блоки из реальных данных (см. guideStore выше) ---
    const gd=guideStore.heroes?.[String(h.id)]||null;
    const abilityText={};
    for(const ab of (gd?.abilities||[])){const t=cleanAbilityText(ab.desc);if(t)abilityText[ab.key]=t.length>240?t.slice(0,240).replace(/\s+\S*$/,'')+'…':t;}
    const matchRow=m=>{const o=byId.get(Number(m.id));if(!o)return '';return `<a href="/hero/${slugForHero(o)}/"><img loading="lazy" src="${imageUrl(o)}" alt="${escapeHtml(o.localized_name)}"><b>${escapeHtml(o.localized_name)}</b><i>${(m.wins/m.games*100).toFixed(1).replace('.',',')}% · ${escapeHtml(matchWord(m.games))}</i><span>→</span></a>`;};
    const weakList=(gd?.weakAgainst||[]).slice(0,4).map(matchRow).filter(Boolean).join('');
    const strongList=(gd?.strongAgainst||[]).slice(0,4).map(matchRow).filter(Boolean).join('');
    const weakHtml=weakList?`<div class="hp-counters hp-matchups">${weakList}</div>`:'';
    const strongHtml=strongList?`<div class="hp-counters hp-matchups">${strongList}</div>`:'';
    // У OpenDota нет времени покупки — только счётчики по четырём фазам,
    // поэтому фазы сведены в две группы, а на карточке стоит число покупок.
    const buyGroups=[
      {keys:['start_game_items','early_game_items'],label:'Начало игры',note:'Старт и ранняя игра — сколько раз предмет купили в выборке'},
      {keys:['mid_game_items','late_game_items'],label:'Середина и поздняя игра',note:'Сколько раз предмет купили в выборке'}
    ];
    // Те же карточки, что и в блоке выше (.hb-sub/.hb-items/.hb-item):
    // на странице два среза покупок, и выглядеть они должны одинаково.
    const buyHtml=(()=>{
      if(!gd?.items)return '';
      return buyGroups.map(({keys,label,note})=>{
        const sum=new Map();
        for(const k of keys) for(const [id,c] of Object.entries(gd.items[k]||{})){
          const real=itemVariants[Number(id)]??Number(id);
          if(!itemById.has(real))continue;
          sum.set(real,(sum.get(real)||0)+(Number(c)||0));
        }
        const rows=[...sum.entries()].map(([id,c])=>({id,c})).sort((x,y)=>y.c-x.c).slice(0,9);
        if(!rows.length)return '';
        const cards=rows.map(r=>{const it=itemById.get(r.id);return `<a class="hb-item" href="/item/${it.slug}/" title="${escapeHtml(it.dname)} — куплен ${r.c} раз в выборке"><span class="hb-item-when">${r.c}</span><img loading="lazy" src="/assets/items/${it.slug}.png" alt="${escapeHtml(it.dname)}" onerror="this.style.visibility='hidden'"><b>${escapeHtml(it.dname)}</b></a>`;}).join('');
        return `<div class="hb-sub"><h3>${label}</h3><em>${note}</em><div class="hb-items">${cards}</div></div>`;
      }).filter(Boolean).join('');
    })();
    const title=`${h.localized_name} — гайд, статы и контрпики | Dota Mate`;
    const fallbackDesc=`${h.localized_name}: базовые характеристики, роли (${roleText(h)}), рекомендуемый билд и контрпики. Актуальные данные Dota 2.`;
    const storedDesc=seoDesc[slug];
    const desc=(typeof storedDesc==='string'&&storedDesc.includes(h.localized_name))?storedDesc:fallbackDesc;
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
<link rel="icon" type="image/png" href="/assets/dotamate-icon.png">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<script src="/js/hero-roles.js" defer></script>
<script src="/js/hero-builds.js" defer></script>
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
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/" aria-current="page" class="active">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/meta/">META</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main>
  <section class="hp-hero">
    <div class="hp-art">
      <video class="hp-render" autoplay loop muted playsinline poster="${CDN_RENDER}${valveSlug(h)}.png" preload="none">
        <source src="${CDN_RENDER}${valveSlug(h)}.webm" type="video/webm">
      </video>
      <span class="hp-art-fade"></span>
    </div>
    <div class="container hp-head">
      <nav aria-label="breadcrumb" class="hp-crumbs"><a href="/">Главная</a> <span>›</span> <a href="/heroes/">Герои</a> <span>›</span> <span aria-current="page">${escapeHtml(h.localized_name)}</span></nav>
      <div class="hp-attr">${a[0]} ${escapeHtml(a[1])}</div>
      <h1>${escapeHtml(h.localized_name)}</h1>
      <p class="hp-tagline">${escapeHtml(roleText(h))}</p>
      <p class="hp-lore">${introParagraph(h)}</p>
      <div class="hp-facts">
        <div><small>Тип атаки</small><b>${escapeHtml(h.attack_type==='Melee'?'Ближний бой':h.attack_type==='Ranged'?'Дальний бой':(h.attack_type||'—'))}</b></div>
        <div><small>Сложность</small><b class="hp-pips" aria-label="Сложность ${h.complexity||1} из 3">${[1,2,3].map(i=>`<i class="${(h.complexity||1)>=i?'on':''}"></i>`).join('')}</b></div>
      </div>
    </div>
  </section>

  <section class="hp-bars container"${rolesRow?` id="heroRoles" data-hero-id="${h.id}"`:''}>
    ${rolesRow}
    <div class="hp-statbar-grid">
      <div class="hs-label"><small>Базовые</small><strong>статы</strong></div>
      ${stats.map(x=>`<div><small>${escapeHtml(x.k)}</small><strong>${escapeHtml(String(x.v))}</strong></div>`).join('')}
    </div>
    ${rolesRow?`<p class="hr-note">${escapeHtml(heroRoles.sourceNote(positionSnapshot))}</p>`:''}
  </section>

  ${buildsHtml}

  ${buyHtml?`<section class="hp-buys container">
    <h2>Покупки по всем рангам</h2>
    <p class="hp-buys-note">Второй срез — OpenDota, публичные матчи всех рангов. Число на карточке — сколько раз предмет купили в выборке; времени покупки в этих данных нет. Выборка другая, поэтому предметы и цифры не обязаны совпадать с блоком выше.</p>
    ${buyHtml}
  </section>`:''}

  ${abilities.length?`<section class="hp-abilities container">
    <h2>Способности</h2>
    <div class="hp-ab-layout">
      <div class="hp-ab-stage">
        ${abilities.map((ab,i)=>`<video class="hp-ab-video${i===0?' on':''}" data-ab="${i}" ${i===0?'autoplay':''} loop muted playsinline preload="none" ${abilityIconExists(ab.key)?`poster="${CDN_IMG}${ab.key}.png"`:''}><source src="${CDN_VID}${valveSlug(h)}/${ab.key}.webm" type="video/webm"></video>`).join('')}
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
  </section>`:''}

  <section class="hp-links container">
    <div>
      <h2>Кто контрит ${escapeHtml(h.localized_name)}</h2>
      ${weakHtml||`<div class="hp-counters">${counters.map(x=>`<a href="/hero/${slugForHero(x)}/"><img loading="lazy" src="${imageUrl(x)}" alt="${escapeHtml(x.localized_name)}"><b>${escapeHtml(x.localized_name)}</b><span>→</span></a>`).join('')}</div>`}
    </div>
    <div>
      <h2>Кого контрит ${escapeHtml(h.localized_name)}</h2>
      ${strongHtml||`<div class="hp-build">${build.map((x,i)=>`<div><span>${i+1}</span>${escapeHtml(x)}</div>`).join('')}</div>`}
    </div>
  </section>


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
<footer><div class="container">DOTAMATE PROJECT · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
