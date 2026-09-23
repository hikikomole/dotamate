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
  const itemById=new Map();
  try{
    const itemsRaw=await grab('https://api.opendota.com/api/constants/items');
    for(const [key,v] of Object.entries(itemsRaw||{})){
      if(!v||!v.id||!v.dname)continue;
      const slug=String(key).replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
      itemById.set(Number(v.id),{slug,dname:v.dname});
    }
  }catch{}

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

    // --- блоки из реальных данных (см. guideStore выше) ---
    const gd=guideStore.heroes?.[String(h.id)]||null;
    const abilityText={};
    for(const ab of (gd?.abilities||[])){const t=cleanAbilityText(ab.desc);if(t)abilityText[ab.key]=t.length>240?t.slice(0,240).replace(/\s+\S*$/,'')+'…':t;}
    const matchRow=m=>{const o=byId.get(Number(m.id));if(!o)return '';return `<a href="/hero/${slugForHero(o)}/"><img loading="lazy" src="${imageUrl(o)}" alt="${escapeHtml(o.localized_name)}"><b>${escapeHtml(o.localized_name)}</b><i>${(m.wins/m.games*100).toFixed(1).replace('.',',')}% · ${escapeHtml(matchWord(m.games))}</i><span>→</span></a>`;};
    const weakList=(gd?.weakAgainst||[]).slice(0,4).map(matchRow).filter(Boolean).join('');
    const strongList=(gd?.strongAgainst||[]).slice(0,4).map(matchRow).filter(Boolean).join('');
    const weakHtml=weakList?`<div class="hp-counters hp-matchups">${weakList}</div>`:'';
    const strongHtml=strongList?`<div class="hp-counters hp-matchups">${strongList}</div>`:'';
    const buyPhases=[['early_game_items','Ранняя игра'],['mid_game_items','Середина игры'],['late_game_items','Поздняя игра']];
    const buyHtml=(()=>{
      if(!gd?.items)return '';
      const cols=buyPhases.map(([k,label])=>{
        const rows=Object.entries(gd.items[k]||{}).map(([id,c])=>({id:Number(id),c:Number(c)||0}))
          .filter(r=>itemById.has(r.id)).sort((x,y)=>y.c-x.c).slice(0,4);
        if(!rows.length)return '';
        return `<div class="hp-buy-col"><h3>${label}</h3>${rows.map(r=>{const it=itemById.get(r.id);return `<a href="/item/${it.slug}/"><img loading="lazy" src="/assets/items/${it.slug}.png" alt=""><b>${escapeHtml(it.dname)}</b><i>${r.c}</i></a>`;}).join('')}</div>`;
      }).filter(Boolean).join('');
      return cols?`<div class="hp-buy-grid">${cols}</div>`:'';
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
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/" aria-current="page" class="active">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/game/">Игра</a></nav>
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
      <div class="hp-actions">
        <a class="hp-btn" href="/heroes/">← Все герои</a>
        <a class="hp-btn ghost" target="_blank" rel="noopener" href="${officialHeroUrl(h)}">Официальная страница ↗</a>
      </div>
    </div>
  </section>

  <section class="hp-statbar">
    <div class="container hp-statbar-grid">
      ${stats.map(x=>`<div><small>${escapeHtml(x.k)}</small><strong>${escapeHtml(String(x.v))}</strong></div>`).join('')}
    </div>
  </section>

  ${abilities.length?`<section class="hp-abilities container">
    <h2>Способности</h2>
    <div class="hp-ab-layout">
      <div class="hp-ab-stage">
        ${abilities.map((ab,i)=>`<video class="hp-ab-video${i===0?' on':''}" data-ab="${i}" ${i===0?'autoplay':''} loop muted playsinline preload="none" poster="${CDN_IMG}${ab.key}.png"><source src="${CDN_VID}${valveSlug(h)}/${ab.key}.webm" type="video/webm"></video>`).join('')}
      </div>
      <div class="hp-ab-side">
        <div class="hp-ab-icons" role="tablist" aria-label="Способности героя">
          ${abilities.map((ab,i)=>`<button type="button" role="tab" class="hp-ab-icon${i===0?' on':''}" data-ab="${i}" aria-selected="${i===0?'true':'false'}" title="${escapeHtml(ab.name)}"><img loading="lazy" src="${CDN_IMG}${ab.key}.png" alt="${escapeHtml(ab.name)}"></button>`).join('')}
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
      <h2>Кто контрит</h2>
      ${weakHtml||`<div class="hp-counters">${counters.map(x=>`<a href="/hero/${slugForHero(x)}/"><img loading="lazy" src="${imageUrl(x)}" alt="${escapeHtml(x.localized_name)}"><b>${escapeHtml(x.localized_name)}</b><span>→</span></a>`).join('')}</div>`}
    </div>
    <div>
      <h2>Кого контрит</h2>
      ${strongHtml||`<div class="hp-build">${build.map((x,i)=>`<div><span>${i+1}</span>${escapeHtml(x)}</div>`).join('')}</div>`}
    </div>
  </section>

  ${buyHtml?`<section class="hp-buys container">
    <h2>Что покупают</h2>
    <p class="hp-buys-note">Реальные покупки за этого героя по данным OpenDota. Число — сколько раз предмет куплен в выборке.</p>
    ${buyHtml}
  </section>`:''}

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
<footer><div class="container">Dota Mate · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
