#!/usr/bin/env node
// Generates static, SEO-indexable pages for every hero under deploy/hero/<slug>/index.html
// Logic ported from js/app.js (heroStats, heroBuild, counterCandidates, roleSuggestions),
// made deterministic (no Math.random() tiebreaker) so builds are reproducible.

const fs = require('fs');
const path = require('path');

// Заранее сгенерированные уникальные meta description (tools/gen-hero-meta.py).
// Раньше всем героям подставлялся один шаблон с заменой имени — поисковик
// склеивает такие дубли. Шаблон оставлен запасным путём: если описания для
// слага нет или Valve переименовала героя, страница соберётся со старым
// текстом, а не с чужим именем в описании.
const seoDesc = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'hero-descriptions.json'), 'utf8')); }
  catch { return {}; }
})();

const heroSlug={"Anti-Mage":"antimage","Ancient Apparition":"ancient_apparition","Arc Warden":"arc_warden","Batrider":"batrider","Beastmaster":"beastmaster","Bloodseeker":"bloodseeker","Bounty Hunter":"bounty_hunter","Brewmaster":"brewmaster","Bristleback":"bristleback","Broodmother":"broodmother","Centaur Warrunner":"centaur","Chaos Knight":"chaos_knight","Clockwerk":"rattletrap","Crystal Maiden":"crystal_maiden","Dawnbreaker":"dawnbreaker","Death Prophet":"death_prophet","Dragon Knight":"dragon_knight","Drow Ranger":"drow_ranger","Earth Spirit":"earth_spirit","Earthshaker":"earthshaker","Elder Titan":"elder_titan","Ember Spirit":"ember_spirit","Enchantress":"enchantress","Faceless Void":"faceless_void","Grimstroke":"grimstroke","Gyrocopter":"gyrocopter","Hoodwink":"hoodwink","Huskar":"huskar","Invoker":"invoker","Io":"wisp","Jakiro":"jakiro","Juggernaut":"juggernaut","Keeper of the Light":"keeper_of_the_light","Kez":"kez","Kunkka":"kunkka","Largo":"largo","Legion Commander":"legion_commander","Leshrac":"leshrac","Lich":"lich","Lifestealer":"life_stealer","Lina":"lina","Lion":"lion","Lone Druid":"lone_druid","Luna":"luna","Lycan":"lycan","Magnus":"magnataur","Marci":"marci","Mars":"mars","Medusa":"medusa","Meepo":"meepo","Mirana":"mirana","Monkey King":"monkey_king","Morphling":"morphling","Muerta":"muerta","Naga Siren":"naga_siren","Nature's Prophet":"furion","Necrophos":"necrolyte","Night Stalker":"night_stalker","Nyx Assassin":"nyx_assassin","Ogre Magi":"ogre_magi","Omniknight":"omniknight","Oracle":"oracle","Outworld Destroyer":"obsidian_destroyer","Pangolier":"pangolier","Phantom Assassin":"phantom_assassin","Phantom Lancer":"phantom_lancer","Phoenix":"phoenix","Primal Beast":"primal_beast","Puck":"puck","Pudge":"pudge","Pugna":"pugna","Queen of Pain":"queenofpain","Razor":"razor","Riki":"riki","Ringmaster":"ringmaster","Rubick":"rubick","Sand King":"sand_king","Shadow Demon":"shadow_demon","Shadow Fiend":"nevermore","Shadow Shaman":"shadow_shaman","Silencer":"silencer","Skywrath Mage":"skywrath_mage","Slardar":"slardar","Slark":"slark","Snapfire":"snapfire","Sniper":"sniper","Spectre":"spectre","Spirit Breaker":"spirit_breaker","Storm Spirit":"storm_spirit","Sven":"sven","Techies":"techies","Templar Assassin":"templar_assassin","Terrorblade":"terrorblade","Tidehunter":"tidehunter","Timbersaw":"shredder","Tinker":"tinker","Tiny":"tiny","Treant Protector":"treant","Troll Warlord":"troll_warlord","Tusk":"tusk","Underlord":"abyssal_underlord","Undying":"undying","Ursa":"ursa","Vengeful Spirit":"vengeful_spirit","Venomancer":"venomancer","Viper":"viper","Visage":"visage","Void Spirit":"void_spirit","Warlock":"warlock","Weaver":"weaver","Windranger":"windrunner","Winter Wyvern":"winter_wyvern","Witch Doctor":"witch_doctor","Wraith King":"skeleton_king","Zeus":"zuus"};

const ruRoles={Carry:"Керри",Support:"Поддержка",Nuker:"Нюкер",Disabler:"Дизейблер",Jungler:"Лесник",Durable:"Танк",Escape:"Эскейп",Pusher:"Пушер",Initiator:"Инициация"};
const attrs={str:["💪","Сила"],agi:["🏹","Ловкость"],int:["🧠","Интеллект"],all:["✦","Универсальный"],universal:["✦","Универсальный"]};
const roleSuggestions={Carry:['Black King Bar','Manta Style','Satanic'],Mid:['Black King Bar','Orchid Malevolence',"Aghanim's Scepter"],Offlane:['Blink Dagger','Pipe of Insight','Crimson Guard'],Support:['Glimmer Cape','Force Staff','Lotus Orb'],HardSupport:['Arcane Boots','Glimmer Cape','Mekansm']};

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function slugForHero(h){const raw=String(h?.name||h?.localized_name||"").replace(/^npc_dota_hero_/,'');return heroSlug[h?.localized_name]||heroSlug[h?.name]||raw||"";}
function imageUrl(h){const slug=slugForHero(h);const p=h?.img||"";if(p.startsWith("http"))return p;if(p.startsWith("/"))return `https://cdn.cloudflare.steamstatic.com${p.split("?")[0]}`;return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${slug}.png`;}
function roleText(h){return (h.roles||[]).map(x=>ruRoles[x]||x).join(" / ")||"Герой";}
function attrInfo(a){return attrs[a]||attrs.all;}
function officialHeroUrl(h){return "https://www.dota2.com/hero/"+slugForHero(h).replace(/_/g,'');}
function heroStats(h){return [{k:'HP',v:h.base_health!=null?h.base_health:(h.base_str||0)*22+120},{k:'Mana',v:h.base_mana!=null?h.base_mana:(h.base_int||0)*12+75},{k:'Armor',v:h.base_agi!=null?(h.base_agi/6).toFixed(1):'—'},{k:'Damage',v:h.base_attack_min!=null?`${h.base_attack_min}–${h.base_attack_max}`:'—'},{k:'Move Speed',v:h.move_speed||'—'}];}
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
  const CDN_IMG='https://cdn.steamstatic.com/apps/dota2/images/dota_react/abilities/';
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
    const title=`${h.localized_name} — гайд, статы и контрпики | Dota 2 Companion`;
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
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota 2 Companion">
      <span class="brand-mark brand-mark-image" aria-hidden="true"><img src="/assets/dota2-companion-icon.png" alt=""></span>
      <span>Dota 2 <b>Companion</b></span>
    </a>
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
        </div>`).join('')}
      </div>
    </div>
  </section>`:''}

  <section class="hp-links container">
    <div>
      <h2>Контрпики</h2>
      <div class="hp-counters">${counters.map(x=>`<a href="/hero/${slugForHero(x)}/"><img loading="lazy" src="${imageUrl(x)}" alt="${escapeHtml(x.localized_name)}"><b>${escapeHtml(x.localized_name)}</b><span>→</span></a>`).join('')}</div>
    </div>
    <div>
      <h2>Рекомендуемый билд</h2>
      <div class="hp-build">${build.map((x,i)=>`<div><span>${i+1}</span>${escapeHtml(x)}</div>`).join('')}</div>
    </div>
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
<footer><div class="container">Dota 2 Companion · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
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
