#!/usr/bin/env node
// Generates static, SEO-indexable pages for every hero under deploy/hero/<slug>/index.html
// Logic ported from js/app.js (heroStats, heroBuild, counterCandidates, roleSuggestions),
// made deterministic (no Math.random() tiebreaker) so builds are reproducible.

const fs = require('fs');
const path = require('path');

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
    const title=`${h.localized_name} — гайд, статы и контрпики | Dota 2 Companion`;
    const desc=`${h.localized_name}: базовые характеристики, роли (${roleText(h)}), рекомендуемый билд и контрпики. Актуальные данные Dota 2.`;
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
<script type="application/ld+json">${ldjson}</script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->
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
<main class="container" style="padding-top:24px;padding-bottom:48px;">
  <nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;">
    <a href="/">Главная</a> / <a href="/#heroes">Герои</a> / ${escapeHtml(h.localized_name)}
  </nav>
  <div class="hero-detail">
    <div class="hero-cover">
      <img src="${img}" alt="${escapeHtml(h.localized_name)}">
      <div>
        <div class="eyebrow">HERO PROFILE</div>
        <h1>${escapeHtml(h.localized_name)}</h1>
        <p>${a[0]} ${a[1]} · ${escapeHtml(h.attack_type||'Тип атаки')} · ${escapeHtml(roleText(h))}</p>
        <div class="hero-detail-actions">
          <a class="btn red" href="/?openHero=${h.id}#heroes">Открыть в интерактивном профиле →</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="${officialHeroUrl(h)}">Официальная страница ↗</a>
        </div>
      </div>
    </div>
    <p style="max-width:70ch;line-height:1.6;margin:16px 0;color:#c7cbd4;">${introParagraph(h)}</p>
    <div class="detail-stats">${stats.map(x=>`<div><small>${x.k}</small><strong>${x.v}</strong></div>`).join('')}</div>
    <div class="detail-columns">
      <div>
        <h2>Контрпики</h2>
        <div class="linked-list">${counters.map(x=>`<a href="/hero/${slugForHero(x)}/"><img src="${imageUrl(x)}" alt="${escapeHtml(x.localized_name)}">${escapeHtml(x.localized_name)}<span>→</span></a>`).join('')}</div>
      </div>
      <div>
        <h2>Рекомендуемый билд</h2>
        <div class="build-list">${build.map((x,i)=>`<div><span>${i+1}</span>${escapeHtml(x)}</div>`).join('')}</div>
      </div>
    </div>
  </div>
</main>
<footer><div class="container">Dota 2 Companion · неофициальный проект</div></footer>
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
