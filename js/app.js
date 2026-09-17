const OFFICIAL_HERO_LIST="https://www.dota2.com/datafeed/herolist?language=english";
const OFFICIAL_ITEM_LIST="https://www.dota2.com/datafeed/itemlist?language=english";
const OPENDOTA_HEROES="https://api.opendota.com/api/heroStats";
const OPENDOTA_ITEMS="https://api.opendota.com/api/constants/items";
const STATIC_HEROES="https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json";
const STATIC_ITEMS="https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";
const CDN="https://cdn.cloudflare.steamstatic.com";
const OPENDOTA_ITEM_POPULARITY="https://api.opendota.com/api/heroes/";
const LOCAL_MODE=location.protocol==="file:";
const FALLBACK_IMG="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 125"><rect width="100" height="125" fill="#ececf2"/><text x="50" y="66" font-size="12" fill="#777" text-anchor="middle" font-family="sans-serif">DOTA</text></svg>');
let heroes=[],items=[],filter="all",itemFilter="all",guideFilter="all",lastFocusedEl=null,spotlightHeroId=null,spotlightTimer=null;
const ruRoles={Carry:"Керри",Support:"Поддержка",Nuker:"Нюкер",Disabler:"Дизейблер",Jungler:"Лесник",Durable:"Танк",Escape:"Эскейп",Pusher:"Пушер",Initiator:"Инициация"};
const attrs={str:["💪","Сила"],agi:["🏹","Ловкость"],int:["🧠","Интеллект"],all:["✦","Универсальный"],universal:["✦","Универсальный"]};
const guideData=[
 {cat:"heroes",icon:"🎯",tag:"GAMEPLAY",title:"Как выбирать героя под матч",text:"Смотри на роль, задачи состава, тип атаки и ограничения противников — а не только на то, кем удобнее играть.",slug:"hero-picking-basics"},
 {cat:"gameplay",icon:"⚔",tag:"GAMEPLAY",title:"Ласт-хит и денай: основа фарма в Dota 2",text:"Золото и опыт в Dota 2 не начисляются просто за нахождение рядом с крипами — их нужно добивать точным последним ударом.",slug:"last-hitting-denying"},
 {cat:"gameplay",icon:"🗺",tag:"MAP",title:"Вард и контроль карты",text:"Вард — не просто предмет: это привычка планировать следующий безопасный участок карты, а не реагировать постфактум.",slug:"warding-map-control"},
 {cat:"items",icon:"◈",tag:"ITEMS",title:"Как читать предметы: основы итемизации",text:"Смотри не только на стоимость: важны характеристики, активные способности и то, под какую конкретно проблему матча собирается предмет.",slug:"itemization-basics"},
 {cat:"items",icon:"💠",tag:"ITEMS",title:"Магический и физический урон: во что упаковываться",text:"Разные типы урона контрятся разными предметами — защита, которая хорошо работает против одного, почти бесполезна против другого.",slug:"magic-vs-physical-resistance"},
 {cat:"heroes",icon:"👁",tag:"HEROES",title:"Как играть против невидимости",text:"Невидимость пугает новичков сильнее, чем должна — против неё есть предсказуемые и надёжные инструменты.",slug:"countering-invisibility"},
 {cat:"heroes",icon:"📊",tag:"HERO DATA",title:"Роли в Dota 2: кто за что отвечает в команде",text:"Роль — это ориентир, а не жёсткая клетка. Но понимание пяти классических ролей помогает быстрее находить своё место в команде.",slug:"roles-explained"},
 {cat:"gameplay",icon:"🧠",tag:"GAMEPLAY",title:"Основы драфта: игра начинается до первого крипа",text:"Пик героев определяет сильные и слабые стороны команды задолго до того, как на карте появится первый крипу.",slug:"draft-fundamentals"},
 {cat:"heroes",icon:"📈",tag:"HERO DATA",title:"Как читать статистику героев",text:"Pro picks показывают популярность на профессиональной сцене, а Pro win — победы именно среди этих матчей. Это разные метрики.",slug:"reading-hero-stats"},
 {cat:"gameplay",icon:"🧮",tag:"MMR",title:"Путь к повышению MMR: как тренироваться осознанно",text:"Калькулятор MMR показывает математический ориентир, а не гарантированный результат — реальный рост даёт осознанная практика.",slug:"mmr-climbing-mindset"},
 {cat:"heroes",icon:"⚔",tag:"BUILD",title:"Билд на керри: порядок покупок по этапам игры",text:"Керри слаб в начале и становится главной угрозой к поздней игре — билд должен закрывать именно эту кривую силы.",slug:"build-carry"},
 {cat:"heroes",icon:"🧠",tag:"BUILD",title:"Билд на мидера: универсальные приоритеты",text:"Мидер играет один на один и получает больше всего раннего опыта — итемизация должна реализовать это преимущество как можно раньше.",slug:"build-mid"},
 {cat:"heroes",icon:"🛡",tag:"BUILD",title:"Билд на оффлейн: выживание и инициация",text:"Оффлейнер играет в невыгодных условиях линии — итемизация здесь про выживание и пространство для команды, а не чистый фарм.",slug:"build-offlane"},
 {cat:"heroes",icon:"🔮",tag:"BUILD",title:"Билд на софт-саппорта",text:"Софт-саппорт жертвует частью фарма ради обзора и контроля, но обычно фармит немного больше хард-саппорта.",slug:"build-soft-support"},
 {cat:"heroes",icon:"💚",tag:"BUILD",title:"Билд на хард-саппорта",text:"Хард-саппорт почти не фармит — его золото почти целиком уходит на обзор карты и спасение союзников.",slug:"build-hard-support"},
 {cat:"items",icon:"👢",tag:"COMPARE",title:"Ботинки в Dota 2: какие выбрать",text:"Все герои начинают с одинаковых Boots of Speed, но апгрейд ботинок — одно из первых решений, которое сильно зависит от роли и героя.",slug:"boots-comparison"},
 {cat:"items",icon:"🛡",tag:"COMPARE",title:"Защитные предметы: что от чего спасает",text:"Разные защитные предметы решают разные угрозы — контроль, магический урон, физический урон или конкретное точечное заклинание.",slug:"defensive-items-comparison"},
 {cat:"gameplay",icon:"📖",tag:"СЛОВАРЬ",title:"Словарь терминов Dota 2",text:"Что значат ластхит, денай, ганк, керри, MMR и другие термины — короткие объяснения с ссылками на подробные гайды.",slug:"glossary"}
];
const heroSlug={"Anti-Mage":"antimage","Ancient Apparition":"ancient_apparition","Arc Warden":"arc_warden","Batrider":"batrider","Beastmaster":"beastmaster","Bloodseeker":"bloodseeker","Bounty Hunter":"bounty_hunter","Brewmaster":"brewmaster","Bristleback":"bristleback","Broodmother":"broodmother","Centaur Warrunner":"centaur","Chaos Knight":"chaos_knight","Clockwerk":"rattletrap","Crystal Maiden":"crystal_maiden","Dawnbreaker":"dawnbreaker","Death Prophet":"death_prophet","Dragon Knight":"dragon_knight","Drow Ranger":"drow_ranger","Earth Spirit":"earth_spirit","Earthshaker":"earthshaker","Elder Titan":"elder_titan","Ember Spirit":"ember_spirit","Enchantress":"enchantress","Faceless Void":"faceless_void","Grimstroke":"grimstroke","Gyrocopter":"gyrocopter","Hoodwink":"hoodwink","Huskar":"huskar","Invoker":"invoker","Io":"wisp","Jakiro":"jakiro","Juggernaut":"juggernaut","Keeper of the Light":"keeper_of_the_light","Kez":"kez","Kunkka":"kunkka","Largo":"largo","Legion Commander":"legion_commander","Leshrac":"leshrac","Lich":"lich","Lifestealer":"life_stealer","Lina":"lina","Lion":"lion","Lone Druid":"lone_druid","Luna":"luna","Lycan":"lycan","Magnus":"magnataur","Marci":"marci","Mars":"mars","Medusa":"medusa","Meepo":"meepo","Mirana":"mirana","Monkey King":"monkey_king","Morphling":"morphling","Muerta":"muerta","Naga Siren":"naga_siren","Nature's Prophet":"furion","Necrophos":"necrolyte","Night Stalker":"night_stalker","Nyx Assassin":"nyx_assassin","Ogre Magi":"ogre_magi","Omniknight":"omniknight","Oracle":"oracle","Outworld Destroyer":"obsidian_destroyer","Pangolier":"pangolier","Phantom Assassin":"phantom_assassin","Phantom Lancer":"phantom_lancer","Phoenix":"phoenix","Primal Beast":"primal_beast","Puck":"puck","Pudge":"pudge","Pugna":"pugna","Queen of Pain":"queenofpain","Razor":"razor","Riki":"riki","Ringmaster":"ringmaster","Rubick":"rubick","Sand King":"sand_king","Shadow Demon":"shadow_demon","Shadow Fiend":"nevermore","Shadow Shaman":"shadow_shaman","Silencer":"silencer","Skywrath Mage":"skywrath_mage","Slardar":"slardar","Slark":"slark","Snapfire":"snapfire","Sniper":"sniper","Spectre":"spectre","Spirit Breaker":"spirit_breaker","Storm Spirit":"storm_spirit","Sven":"sven","Techies":"techies","Templar Assassin":"templar_assassin","Terrorblade":"terrorblade","Tidehunter":"tidehunter","Timbersaw":"shredder","Tinker":"tinker","Tiny":"tiny","Treant Protector":"treant","Troll Warlord":"troll_warlord","Tusk":"tusk","Underlord":"abyssal_underlord","Undying":"undying","Ursa":"ursa","Vengeful Spirit":"vengeful_spirit","Venomancer":"venomancer","Viper":"viper","Visage":"visage","Void Spirit":"void_spirit","Warlock":"warlock","Weaver":"weaver","Windranger":"windrunner","Winter Wyvern":"winter_wyvern","Witch Doctor":"witch_doctor","Wraith King":"skeleton_king","Zeus":"zuus"};
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function slugForHero(h){const raw=String(h?.name||h?.localized_name||"").replace(/^npc_dota_hero_/,'');return heroSlug[h?.localized_name]||heroSlug[h?.name]||raw||"";}
function imageUrl(h){const slug=slugForHero(h);const p=h?.img||"";if(p.startsWith("http"))return p;if(p.startsWith("/"))return `https://cdn.cloudflare.steamstatic.com${p.split("?")[0]}`;return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${slug}.png`;}
function imageCandidates(h){const slug=slugForHero(h);const p=h?.img||"";return d2hImageCandidates('heroes',slug,p);}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function itemImage(x){const p=x?.img||"";if(p.startsWith("http"))return p;if(p.startsWith("/"))return `https://cdn.cloudflare.steamstatic.com${p.split("?")[0]}`;return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${itemSlug(x?.name||x)}.png`;}
function itemImageCandidates(x){return d2hImageCandidates('items',itemSlug(x?.name||x),x?.img||"");}
function roleText(h){return (h.roles||[]).map(x=>ruRoles[x]||x).join(" / ")||"Герой";}
function attrInfo(a){return attrs[a]||attrs.all;}
function officialHeroUrl(h){return "https://www.dota2.com/hero/"+slugForHero(h).replace(/_/g,'');}
function winrate(h){return h.pro_pick?Number(h.pro_win||0)/Number(h.pro_pick)*100:0;}
function go(id){document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});}
function normalizeHeroes(list){return (list||[]).map(h=>{const raw=String(h.name||'').replace(/^npc_dota_hero_/,'');const reverse=Object.entries(heroSlug).find(([,slug])=>slug===raw);const loc=reverse?.[0]||h.localized_name||h.name_loc||h.name_english_loc||raw.replace(/_/g,' ');const clean={...h,localized_name:loc};if(h.primary_attr===0)clean.primary_attr='str';else if(h.primary_attr===1)clean.primary_attr='agi';else if(h.primary_attr===2)clean.primary_attr='int';else if(h.primary_attr===3)clean.primary_attr='universal';else if(h.primary_attr==='all')clean.primary_attr='universal';clean.img=h.img||`/apps/dota2/images/dota_react/heroes/${raw}.png`;return clean;}).filter(h=>h.localized_name).sort((a,b)=>a.localized_name.localeCompare(b.localized_name));}
function unwrapHeroes(data){if(Array.isArray(data))return data;if(data?.result?.data?.heroes)return data.result.data.heroes;if(data?.data?.heroes)return data.data.heroes;if(data?.result?.heroes)return data.result.heroes;if(data?.heroes)return data.heroes;if(data&&typeof data==='object')return Object.values(data).filter(x=>x&&x.name&&(x.localized_name||x.name_loc));return [];}
function unwrapItems(data){
  if(Array.isArray(data))return data;
  const candidates=[data?.result?.data?.itemabilities,data?.result?.data?.items,data?.data?.itemabilities,data?.data?.items,data?.result?.items,data?.items];
  for(const c of candidates)if(Array.isArray(c))return c;
  if(data&&typeof data==='object'){
    // OpenDota /api/constants/items and dotaconstants items.json are keyed maps
    // like {"blink":{"id":1,"dname":"Blink Dagger",...}} — the internal item
    // name only exists as the object KEY, not as a "name" field on the value.
    // normalizeItems() requires .name, so keep the key as a fallback name.
    const vals=Object.entries(data).map(([key,val])=>(val&&typeof val==='object')?{...val,name:val.name||key}:val);
    if(vals.length&&vals.some(x=>x&&typeof x==='object'&&(x.name||x.dname||x.name_loc)))return vals;
  }
  return [];
}
function normalizeItems(list){
  const out=[],seen=new Set();
  for(const raw of list||[]){
    if(!raw||!raw.id||!raw.name)continue;
    const x={...raw,id:Number(raw.id),dname:raw.dname||raw.name_loc||raw.name_english_loc||raw.name};
    if(seen.has(x.id))continue;seen.add(x.id);out.push(x);
  }
  return out.sort((a,b)=>String(a.dname).localeCompare(String(b.dname)));
}
// Pro-stat enrichment: some hero-list sources in the loadHeroes() race (Valve's
// official datafeed, the dotaconstants GitHub mirror) don't include pro_pick/
// pro_win/pro_ban at all — only OpenDota's heroStats endpoint has them. If one
// of those lighter sources wins the race, the stats table would otherwise show
// every hero as 0 picks / 0 bans / — winrate. This always tops up whichever
// hero list is currently loaded with OpenDota's live pro stats, without
// blocking the initial paint and without breaking the race's resilience.
async function enrichProStats(){
  try{
    const data=await d2hFetchJSON(OPENDOTA_HEROES,{timeout:8000});
    const list=unwrapHeroes(data);
    if(!Array.isArray(list)||!list.length||!heroes.length)return;
    const byId=new Map(list.map(h=>[Number(h.id),h]));
    let changed=false;
    heroes=heroes.map(h=>{
      const src=byId.get(Number(h.id));
      if(!src)return h;
      if(src.pro_pick==null&&src.pro_win==null&&src.pro_ban==null)return h;
      changed=true;
      return {...h,
        pro_pick:src.pro_pick??h.pro_pick,
        pro_win:src.pro_win??h.pro_win,
        pro_ban:src.pro_ban??h.pro_ban,
        move_speed:h.move_speed??src.move_speed,
        base_attack_min:h.base_attack_min??src.base_attack_min,
        base_attack_max:h.base_attack_max??src.base_attack_max
      };
    });
    if(changed){
      d2hWriteCache('heroes',heroes);
      renderStats();renderFeaturedHeroes();quickPrepOptions();
    }
  }catch(err){console.warn('Pro stats enrich:',err);}
}
async function loadHeroes(force=false){
  const status=document.getElementById('status');
  try{
    if(typeof localHeroes==='function'){heroes=normalizeHeroes(localHeroes());updateHeroUI('резервная база');}
    const data=await d2hFirstSuccessful([
      ()=>d2hFetchJSON(OFFICIAL_HERO_LIST),
      ()=>d2hFetchJSON(OPENDOTA_HEROES),
      ()=>d2hFetchJSON(STATIC_HEROES)
    ]);
    const list=unwrapHeroes(data);
    if(list.length>=100){heroes=normalizeHeroes(list);d2hWriteCache('heroes',heroes);updateHeroUI('актуальный источник');enrichProStats();return;}
    const cached=d2hReadCache('heroes');if(cached?.length){heroes=normalizeHeroes(cached);updateHeroUI('кэш');}
  }catch(err){
    console.warn('Hero loader:',err);
    const cached=d2hReadCache('heroes');if(cached?.length){heroes=normalizeHeroes(cached);updateHeroUI('кэш');}
  }
  if(status&&heroes.length)status.textContent=`Загружено ${heroes.length} героев`;
  enrichProStats();
}
function updateItemCounters(){document.getElementById('quickItemCount').textContent=items.length;document.getElementById('itemCountHero').textContent=items.length;document.getElementById('itemCountHero2')?.replaceChildren(document.createTextNode(items.length));}
async function loadItems(force=false){
  const status=document.getElementById('itemStatus');
  try{
    if(typeof localItems==='function'){items=normalizeItems(localItems());renderItems();updateItemCounters();if(status)status.textContent='Получаем актуальную базу предметов…';}
    const data=await d2hFirstSuccessful([
      ()=>d2hFetchJSON(OFFICIAL_ITEM_LIST),
      ()=>d2hFetchJSON(OPENDOTA_ITEMS),
      ()=>d2hFetchJSON(STATIC_ITEMS)
    ]);
    const online=normalizeItems(unwrapItems(data));
    if(online.length>=100){items=online;d2hWriteCache('items',items);renderItems();updateItemCounters();if(status)status.textContent=`Загружено ${items.length} предметов · актуальная база`;return;}
    const cached=d2hReadCache('items');
    if(cached?.length){items=normalizeItems(cached);renderItems();updateItemCounters();if(status)status.textContent=`Загружено ${items.length} предметов · кэш`;}
  }catch(err){
    console.warn('Item loader:',err);
    const cached=d2hReadCache('items');
    if(cached?.length){items=normalizeItems(cached);renderItems();updateItemCounters();if(status)status.textContent=`Загружено ${items.length} предметов · кэш`;}
    else if(status&&items.length)status.textContent=`Загружено ${items.length} предметов · резервная база`;
  }
}
function itemCategory(x){
  const n=String(x?.name||'').toLowerCase();
  const type=String(x?.item_type||x?.itemType||x?.category||'').toLowerCase();
  if(n.startsWith('item_recipe_')||n.startsWith('recipe_')||type.includes('recipe'))return 'recipe';
  const tier=x?.neutral_item_tier;
  if(tier!==undefined&&tier!==null&&Number(tier)>=0)return 'neutral';
  if(type.includes('consum'))return 'consumable';
  if(type.includes('component')||type.includes('basic'))return 'component';
  return 'item';
}
function itemCategoryLabel(x){const c=itemCategory(x);return ({item:'Предмет',component:'Компонент',consumable:'Расходник',neutral:'Нейтральный',recipe:'Рецепт'})[c]||'Предмет';}
function itemDescriptionPreview(x){
  const cached=readOfficialItemCache(x.id);
  const d=cached?.data?.desc_loc||cached?.data?.description||x?.desc_loc||'';
  const clean=cleanOfficialHtml(d);
  if(!clean||/Откройте онлайн|актуальных характеристик|open online|current data/i.test(clean))return '';
  return clean.length>105?clean.slice(0,105).trim()+'…':clean;
}
function renderItems(){
  const q=(document.getElementById('itemSearch')?.value||'').trim().toLowerCase();
  const category=window.itemCategoryFilter||'all';
  const list=items.filter(x=>{
    const c=Number(x.cost||0);
    const priceOk=itemFilter==='all'||(itemFilter==='cheap'&&c<1000)||(itemFilter==='mid'&&c>=1000&&c<=2500)||(itemFilter==='expensive'&&c>2500);
    const cat=itemCategory(x);
    const catOk=category==='all'||cat===category||(category==='shop'&&cat==='item');
    const text=String(x.dname||'')+' '+String(x.description||'')+' '+String(x.desc_loc||'');
    return priceOk&&catOk&&text.toLowerCase().includes(q);
  });
  const grid=document.getElementById('itemsGrid');
  if(!grid)return;
  grid.innerHTML=list.length?list.map(x=>{
    const preview=itemDescriptionPreview(x);
    const cat=itemCategory(x);
    return `<button class="item-card item-card-v2" data-item="${escapeHtml(x.name)}" aria-label="Открыть ${escapeHtml(x.dname)}">
      <div class="item-card-art"><img loading="lazy" data-d2h-image="item" data-d2h-slug="${escapeHtml(itemSlug(x.name))}" src="${itemImage(x)}" alt="${escapeHtml(x.dname)}"><span class="item-card-cat">${itemCategoryLabel(x)}</span><span class="item-card-open">Открыть ↗</span></div>
      <div class="item-card-body"><div class="item-card-title"><strong>${escapeHtml(x.dname)}</strong><span>${x.cost?statValue(x.cost)+' G':'—'}</span></div>${preview?`<p>${escapeHtml(preview)}</p>`:'<p class="item-card-muted">Открыть профиль для официального описания Valve</p>'}<div class="item-card-foot"><small>${x.id?`ID ${escapeHtml(x.id)}`:'Dota 2 item'}</small><b>Подробнее →</b></div></div>
    </button>`;
  }).join(''):'<div class="empty item-empty-state"><strong>Предмет не найден</strong><span>Измени запрос или фильтр.</span></div>';
  const counter=document.getElementById('itemVisibleCount');if(counter)counter.textContent=statValue(list.length);
}
function statValue(v){return Number(v||0).toLocaleString('ru-RU');}
function updateHeroUI(source){heroes=heroes.filter(Boolean);document.getElementById('heroCount').textContent=heroes.length;document.getElementById('quickHeroCount').textContent=heroes.length;document.getElementById('heroRoleCount').textContent=new Set(heroes.flatMap(h=>h.roles||[])).size||'—';document.getElementById('status').textContent=`Загружено ${heroes.length} героев · ${source}`;const fb=document.getElementById('freshBadge');if(fb)fb.textContent=`🟢 Live · ${heroes.length} героев из OpenDota`;renderHeroSpotlight();renderHeroes();renderFeaturedHeroes();renderStats();quickPrepOptions();}
function renderHeroSpotlight(){const el=document.getElementById('featured');if(!el||!heroes.length)return;let pool=heroes.filter(h=>h&&h.localized_name);if(pool.length>1&&spotlightHeroId!=null)pool=pool.filter(h=>Number(h.id)!==Number(spotlightHeroId));const h=pool[Math.floor(Math.random()*pool.length)]||heroes[0];spotlightHeroId=h.id;el.innerHTML=`<img src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}"><div class="ftext"><small>HERO SPOTLIGHT · СЛУЧАЙНЫЙ ГЕРОЙ</small><h3>${escapeHtml(h.localized_name)}</h3><p>${escapeHtml(roleText(h))} · ${escapeHtml(h.attack_type||'Dota 2 герой')} · открыть полный профиль →</p></div>`;el.onclick=()=>openHero(h.id);el.style.cursor='pointer';if(spotlightTimer)clearTimeout(spotlightTimer);spotlightTimer=setTimeout(()=>renderHeroSpotlight(),15000);}
function heroCard(h,mini=false){const a=attrInfo(h.primary_attr),name=escapeHtml(h.localized_name);return `<article class="hero-card ${mini?'mini-hero-card':''}" tabindex="0" role="button" aria-label="${name}" data-id="${h.id}"><img loading="lazy" data-d2h-image="hero" data-d2h-slug="${escapeHtml(slugForHero(h))}" src="${imageUrl(h)}" alt="${name}"><div class="hero-info"><div class="hero-name">${name}</div><div class="hero-role">${escapeHtml(roleText(h))}</div><span class="attr">${a[0]} ${escapeHtml(a[1])}</span></div></article>`;}
function renderHeroes(){const q=(document.getElementById('search')?.value||'').trim().toLowerCase();const list=heroes.filter(h=>(filter==='all'||h.primary_attr===filter)&&(h.localized_name||'').toLowerCase().includes(q));document.getElementById('heroesGrid').innerHTML=list.length?list.map(h=>heroCard(h)).join(''):'<div class="empty">Герой не найден 😢</div>';}
function renderFeaturedHeroes(){const el=document.getElementById('featuredHeroesGrid');if(!el)return;const picks=heroes.filter(h=>h.pro_pick>0).sort((a,b)=>winrate(b)-winrate(a)).slice(0,4);const arr=picks.length?picks:heroes.slice(0,4);el.innerHTML=arr.map(h=>`<article class="featured-hero-card" data-id="${h.id}"><img src="${imageUrl(h)}" alt=""><div><b>${escapeHtml(h.localized_name)}</b><small>${escapeHtml(roleText(h))}</small><span>${h.pro_pick?winrate(h).toFixed(1)+'% pro WR':'Профиль героя'}</span></div></article>`).join('');}
async function buildItemAnalytics(limitHeroes=10){
  const pool=[...heroes].filter(h=>Number(h.pro_pick||0)>0).sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0)).slice(0,limitHeroes);
  for(let i=0;i<pool.length;i+=3){await Promise.all(pool.slice(i,i+3).map(h=>fetchHeroItemPopularity(h.id)));}
  const map=new Map();
  for(const [heroId,p] of heroItemPopularityCache.entries()){
    const hero=heroes.find(h=>Number(h.id)===Number(heroId)); if(!hero)continue;
    for(const [phase,arr] of Object.entries(p||{})){for(const row of arr||[]){const item=findItemById(row.itemId);if(!item||!row.games)continue;const k=Number(row.itemId);if(!map.has(k))map.set(k,{item,games:0,wins:0,heroes:0,phases:{start:0,early:0,mid:0,late:0},users:[]});const x=map.get(k);x.games+=Number(row.games||0);x.wins+=Number(row.wins||0);x.phases[phase]=(x.phases[phase]||0)+Number(row.games||0);x.users.push({hero,games:Number(row.games||0),phase});}}
  }
  return [...map.values()].map(x=>({...x,winrate:x.games?x.wins/x.games*100:0,heroes:new Set(x.users.map(u=>u.hero.id)).size,bestPhase:Object.entries(x.phases).sort((a,b)=>b[1]-a[1])[0]?.[0]||'mid'})).sort((a,b)=>b.games-a.games).slice(0,12);
}
function renderItemAnalytics(rows){
  const el=document.getElementById('itemAnalytics');if(!el)return;
  const phases={start:'Старт',early:'Ранняя',mid:'Середина',late:'Поздняя'};
  el.innerHTML=`<div class="stats-item-analytics"><div class="stats-analytics-head"><div><span>ITEM ANALYTICS</span><h3>📦 Самые покупаемые предметы</h3><p>Реальные агрегированные покупки OpenDota среди популярных героев.</p></div><small>Выборка: ${rows.length} предметов</small></div><div class="stats-item-table">${rows.map((r,i)=>`<button data-item-analytics="${escapeHtml(r.item.name)}"><span class="rank">${i+1}</span><img src="${itemImage(r.item)}"><span class="item-a-name"><b>${escapeHtml(r.item.dname)}</b><small>${r.heroes} героев · чаще: ${phases[r.bestPhase]}</small></span><strong>${statValue(r.games)}</strong><em>${r.winrate.toFixed(1)}% WR</em></button>`).join('')}</div></div>`;
  el.querySelectorAll('[data-item-analytics]').forEach(b=>b.onclick=()=>openItem(b.dataset.itemAnalytics));
}
async function loadItemAnalytics(){
  const el=document.getElementById('itemAnalytics');if(!el||!heroes.length)return;
  el.innerHTML='<div class="stats-analytics-loading">Загружаем реальные связи герой ↔ предмет…</div>';
  try{const rows=await buildItemAnalytics(10);renderItemAnalytics(rows);}catch(e){el.innerHTML='<div class="stats-analytics-loading">Дополнительная аналитика временно недоступна. Основная статистика продолжает работать.</div>';}
}
function renderStats(){
  const q=(document.getElementById('statsSearch')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('statsSort')?.value||'winrate';
  const attr=document.getElementById('statsAttr')?.value||'all';
  const atk=document.getElementById('statsAttack')?.value||'all';
  const role=document.getElementById('statsRole')?.value||'all';
  let list=heroes.filter(h=>(h.localized_name||'').toLowerCase().includes(q)
    &&(attr==='all'||h.primary_attr===attr)
    &&(atk==='all'||h.attack_type===atk)
    &&(role==='all'||(h.roles||[]).includes(role)));
  const wr=h=>Number(h.pro_pick||0)>=5?winrate(h):-1;
  list.sort((a,b)=>sort==='name'?a.localized_name.localeCompare(b.localized_name)
    :sort==='move'?Number(b.move_speed||0)-Number(a.move_speed||0)
    :sort==='attack'?Number(b.base_attack_min||0)-Number(a.base_attack_min||0)
    :sort==='pro_pick'?Number(b.pro_pick||0)-Number(a.pro_pick||0)
    :sort==='pro_ban'?Number(b.pro_ban||0)-Number(a.pro_ban||0)
    :wr(b)-wr(a));
  const body=document.getElementById('statsBody');
  if(body) body.innerHTML=list.map(h=>`<tr data-id="${h.id}"><td><div class="table-hero"><img src="${imageUrl(h)}" alt=""><b>${escapeHtml(h.localized_name)}</b></div></td><td>${attrInfo(h.primary_attr)[0]} ${escapeHtml(attrInfo(h.primary_attr)[1])}</td><td>${escapeHtml(roleText(h))}</td><td>${statValue(h.pro_pick)}</td><td>${statValue(h.pro_win)}</td><td>${h.pro_pick?winrate(h).toFixed(1)+'%':'—'}</td><td>${statValue(h.pro_ban)}</td><td>${h.move_speed||'—'}</td><td>${h.base_attack_min!=null?`${h.base_attack_min}–${h.base_attack_max}`:'—'}</td></tr>`).join('');
  const withPro=heroes.filter(h=>Number(h.pro_pick||0)>0);
  const reliable=withPro.filter(h=>Number(h.pro_pick||0)>=20);
  const best=[...reliable].sort((a,b)=>winrate(b)-winrate(a))[0];
  const mostPicked=[...withPro].sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0))[0];
  const mostBanned=[...heroes].sort((a,b)=>Number(b.pro_ban||0)-Number(a.pro_ban||0))[0];
  const bestEl=document.getElementById('bestWinrate');if(bestEl)bestEl.textContent=best?winrate(best).toFixed(1)+'%':'—';
  const pp=document.getElementById('proPicks');if(pp)pp.textContent=heroes.reduce((s,h)=>s+Number(h.pro_pick||0),0).toLocaleString('ru-RU');
  const avg=Math.round(heroes.reduce((s,h)=>s+Number(h.move_speed||0),0)/Math.max(1,heroes.length));
  const ranged=heroes.filter(h=>h.attack_type==='Ranged').length;
  const uni=heroes.filter(h=>h.primary_attr==='universal'||h.primary_attr==='all').length;
  const el=document.getElementById('statsExtra');
  if(el) el.innerHTML=`<div class="stats-insight-grid">
    <article><small>Средняя скорость</small><strong>${avg}</strong><span>по всей базе</span></article>
    <article><small>Дальние атаки</small><strong>${ranged}</strong><span>из ${heroes.length}</span></article>
    <article><small>Универсальные</small><strong>${uni}</strong><span>героев</span></article>
    <article><small>Лучший pro WR</small><strong>${best?winrate(best).toFixed(1)+'%':'—'}</strong><span>${best?escapeHtml(best.localized_name):'нет данных'}</span></article>
  </div><div class="stats-highlights">
    <div><b>Самые популярные в Pro</b>${[...withPro].sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0)).slice(0,5).map(h=>`<button data-id="${h.id}"><img src="${imageUrl(h)}">${escapeHtml(h.localized_name)}<strong>${statValue(h.pro_pick)}</strong></button>`).join('')}</div>
    <div><b>Чаще всего банят</b>${[...heroes].sort((a,b)=>Number(b.pro_ban||0)-Number(a.pro_ban||0)).slice(0,5).map(h=>`<button data-id="${h.id}"><img src="${imageUrl(h)}">${escapeHtml(h.localized_name)}<strong>${statValue(h.pro_ban)}</strong></button>`).join('')}</div>
  </div><div class="stats-source-note">Источник профессиональных показателей: OpenDota Hero Stats. Winrate считается как Pro Wins / Pro Picks; герои с менее чем 20 pro picks не используются для карточки «лучший winrate».</div>`;
  if(document.getElementById('itemAnalytics') && !document.getElementById('itemAnalytics').dataset.loaded){document.getElementById('itemAnalytics').dataset.loaded='1';loadItemAnalytics();}
}
function renderGuides(){const list=guideData.filter(g=>guideFilter==='all'||g.cat===guideFilter);document.getElementById('guidesGrid').innerHTML=list.map(g=>`<article class="guide-card guide-rich-card"><div class="guide-art">${g.icon}</div><div><span>${g.tag}</span><h3><a href="/guide/${g.slug}/" style="color:inherit;text-decoration:none;">${g.title}</a></h3><p>${g.text}</p><a class="btn ghost guide-open" href="/guide/${g.slug}/">Читать гайд →</a></div><b>↗</b></article>`).join('');}
function randomHero(){if(!heroes.length)return;const h=heroes[Math.floor(Math.random()*heroes.length)];const rt=document.getElementById('randomToolText');if(rt)rt.textContent=`Сегодня судьба выбрала ${h.localized_name}. ${roleText(h)}.`;openHero(h.id);}
function heroStats(h){return [{k:'HP',v:h.base_health!=null?h.base_health:(h.base_str||0)*22+120},{k:'Mana',v:h.base_mana!=null?h.base_mana:(h.base_int||0)*12+75},{k:'Armor',v:h.base_agi!=null?(h.base_agi/6).toFixed(1):'—'},{k:'Damage',v:h.base_attack_min!=null?`${h.base_attack_min}–${h.base_attack_max}`:'—'},{k:'Move Speed',v:h.move_speed||'—'}];}
const roleSuggestions={Carry:['Black King Bar','Manta Style','Satanic'],Mid:['Black King Bar','Orchid Malevolence','Aghanim’s Scepter'],Offlane:['Blink Dagger','Pipe of Insight','Crimson Guard'],Support:['Glimmer Cape','Force Staff','Lotus Orb'],HardSupport:['Arcane Boots','Glimmer Cape','Mekansm']};
function heroBuild(h){const role=(h.roles||[]).includes('Support')?'Support':(h.roles||[]).includes('Carry')?'Carry':(h.roles||[]).includes('Initiator')?'Offlane':'Mid';return roleSuggestions[role]||roleSuggestions.Mid;}
function counterCandidates(h){const banned=new Set([h.id]);const score=x=>{let s=0;if(x.id===h.id)return -999;if(x.primary_attr!==h.primary_attr)s+=1;if((x.roles||[]).includes('Disabler'))s+=2;if((x.roles||[]).includes('Nuker'))s+=1;if((h.roles||[]).includes('Carry')&&(x.roles||[]).includes('Escape'))s+=2;if(h.attack_type==='Ranged'&&x.attack_type==='Melee')s+=1;return s+Math.random()*.25};return heroes.filter(x=>!banned.has(x.id)).sort((a,b)=>score(b)-score(a)).slice(0,3);}

// --- Quick Prep: "60 секунд до пика" ---
function quickPrepOptions(){const dl=document.getElementById('quickPrepHeroes');if(dl)dl.innerHTML=heroes.map(h=>`<option value="${escapeHtml(h.localized_name)}">`).join('');const chipsEl=document.getElementById('quickPrepChips');if(chipsEl){const top=[...heroes].filter(h=>Number(h.pro_pick||0)>0).sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0)).slice(0,5);const arr=top.length?top:heroes.slice(0,5);chipsEl.innerHTML=`<small>Попробуй:</small>`+arr.map(h=>`<button type="button" class="chip" data-quick-hero="${h.id}">${escapeHtml(h.localized_name)}</button>`).join('');}}
function renderQuickPrep(h){const el=document.getElementById('quickPrepResult');if(!el)return;if(!h){el.innerHTML='<div class="quick-prep-empty">Выбери героя выше или нажми на одну из подсказок — покажем контрпики, билд и pro winrate за секунду.</div>';return;}const counters=counterCandidates(h);const build=heroBuild(h);const proLine=h.pro_pick?`${winrate(h).toFixed(1)}% pro WR · ${statValue(h.pro_pick)} picks · ${statValue(h.pro_ban)} banов`:'Нет pro-данных по этому герою — пока играют реже в топ-матчах';el.innerHTML=`<div class="qp-hero"><img src="${imageUrl(h)}" alt=""><div><b>${escapeHtml(h.localized_name)}</b><small>${escapeHtml(roleText(h))}</small><span>${proLine}</span></div></div><div class="qp-cols"><div><h4>Контрпики</h4><div class="linked-list">${counters.map(x=>`<button data-hero-open="${x.id}"><img src="${imageUrl(x)}">${escapeHtml(x.localized_name)}<span>→</span></button>`).join('')}</div></div><div><h4>Рекомендуемый билд</h4><div class="build-list">${build.map((x,i)=>`<button data-item-by-name="${escapeHtml(x)}"><span>${i+1}</span>${escapeHtml(x)}</button>`).join('')}</div></div></div><button class="btn ghost qp-full" data-hero-open="${h.id}">Открыть полный профиль →</button>`;}
function quickPrepSelectByName(name){const q=String(name||'').trim().toLowerCase();if(!q){renderQuickPrep(null);return;}const h=heroes.find(x=>x.localized_name.toLowerCase()===q);if(h)renderQuickPrep(h);}

function popularityStorageKey(heroId){return `d2h_item_popularity_${heroId}`;}
function normalizePopularityPayload(data){
  const out={start:[],early:[],mid:[],late:[]};
  const aliases={start:['start_game_items','start','starting'],early:['early_game_items','early'],mid:['mid_game_items','mid'],late:['late_game_items','late']};
  Object.entries(aliases).forEach(([phase,keys])=>{
    let raw=null; for(const k of keys){if(data&&data[k]!=null){raw=data[k];break;}}
    if(!raw)return;
    if(Array.isArray(raw)) out[phase]=raw.map(x=>({itemId:Number(x.item_id??x.id??x.itemId),games:Number(x.games??x.count??x.popularity??0),wins:Number(x.wins??0)})).filter(x=>Number.isFinite(x.itemId)&&x.itemId>0);
    else if(raw&&typeof raw==='object') out[phase]=Object.entries(raw).map(([id,v])=>({itemId:Number(id),games:Number(typeof v==='object'?(v.games??v.count??v.popularity):v)||0,wins:Number(typeof v==='object'?(v.wins??0):0)})).filter(x=>Number.isFinite(x.itemId)&&x.itemId>0);
  });
  return out;
}
function popularityTotal(p){return (p?.start||[]).concat(p?.early||[],p?.mid||[],p?.late||[]);}
function findItemById(id){return items.find(i=>Number(i.id)===Number(id));}
function phaseTitle(k){return ({start:'Старт',early:'Ранняя игра',mid:'Середина игры',late:'Поздняя игра'})[k]||k;}
function phaseItems(p,limit=6){return Object.entries(p||{}).map(([phase,arr])=>({phase,items:[...arr].sort((a,b)=>b.games-a.games).slice(0,limit)}));}
function popularityCard(phase,arr){
  const rows=arr.map(x=>{const item=findItemById(x.itemId);if(!item)return '';const pct=x.games>0&&x.wins>=0?(x.wins/x.games*100):null;return `<button class="item-pop-row" data-item-pop="${escapeHtml(item.name)}"><img src="${itemImage(item)}" alt=""><span><b>${escapeHtml(item.dname)}</b><small>${statValue(x.games)} игр${pct!=null?` · ${pct.toFixed(1)}% побед`:''}</small></span></button>`;}).filter(Boolean).join('');
  return `<div class="item-pop-phase"><h4>${phaseTitle(phase)}</h4>${rows||'<p class="muted">Нет данных</p>'}</div>`;
}
function renderHeroItemPopularity(heroId,payload,state='online'){
  const box=document.getElementById('heroItemPopularity');if(!box)return;
  const sections=phaseItems(payload,5).map(x=>popularityCard(x.phase,x.items)).join('');
  box.innerHTML=`<div class="item-pop-head"><div><h3>📦 Реальные покупки предметов</h3><p>OpenDota · данные по играм героя · ${state==='cache'?'резерв из кэша':'актуальный ответ API'}</p></div></div><div class="item-pop-grid">${sections}</div>`;
  box.querySelectorAll('[data-item-pop]').forEach(b=>b.onclick=()=>openItem(b.dataset.itemPop));
}
async function fetchHeroItemPopularity(heroId){
  const urls=[`/api/dota/hero/${encodeURIComponent(heroId)}/items`,`${OPENDOTA_ITEM_POPULARITY}${encodeURIComponent(heroId)}/itemPopularity`];
  try{
    const data=normalizePopularityPayload(await d2hFetchJSON(urls[0],{timeout:7000}));
    if(popularityTotal(data).length){heroItemPopularityCache.set(Number(heroId),data);try{localStorage.setItem(popularityStorageKey(heroId),JSON.stringify({ts:Date.now(),data}));}catch{}return data;}
  }catch{}
  try{const data=normalizePopularityPayload(await d2hFetchJSON(urls[1],{timeout:7000}));if(popularityTotal(data).length){heroItemPopularityCache.set(Number(heroId),data);try{localStorage.setItem(popularityStorageKey(heroId),JSON.stringify({ts:Date.now(),data}));}catch{}return data;}}catch{}
  try{const cached=JSON.parse(localStorage.getItem(popularityStorageKey(heroId))||'null');if(cached?.data&&popularityTotal(cached.data).length){heroItemPopularityCache.set(Number(heroId),cached.data);return cached.data;}}catch{}
  return null;
}
async function loadHeroItemPopularity(heroId){
  const box=document.getElementById('heroItemPopularity');if(!box)return;
  box.innerHTML='<div class="item-pop-loading">Загружаем реальные покупки предметов…</div>';
  const data=await fetchHeroItemPopularity(heroId);
  if(data) renderHeroItemPopularity(heroId,data,'online');
  else box.innerHTML='<div class="item-pop-loading">Статистика покупок временно недоступна. Профиль героя и база предметов продолжают работать.</div>';
}
async function loadHeroAbilities(h){
  const box=document.getElementById('heroAbilities');if(!box)return;
  try{
    const r=await fetch(`/api/dota/hero/${encodeURIComponent(h.name)}/abilities`,{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const list=await r.json();
    if(!Array.isArray(list)||!list.length){box.innerHTML='<div class="item-pop-loading">Способности героя временно недоступны.</div>';return;}
    box.innerHTML=list.map((x,i)=>`<article class="ability-card"><div class="ability-art"><img src="${imageUrl(h)}" alt=""><span>${i+1}</span></div><div><b>${escapeHtml(x.dname)}</b><p>${escapeHtml(x.desc||'Описание пока недоступно.')}</p></div></article>`).join('');
  }catch(e){
    box.innerHTML='<div class="item-pop-loading">Способности героя временно недоступны. Профиль героя продолжает работать.</div>';
  }
}
function cachedItemUsers(itemId){
  const out=[];
  for(const [heroId,p] of heroItemPopularityCache.entries()){
    const phases=[['start',p?.start||[]],['early',p?.early||[]],['mid',p?.mid||[]],['late',p?.late||[]]];
    const hits=phases.flatMap(([phase,arr])=>arr.filter(x=>x.itemId===Number(itemId)).map(x=>({...x,phase})));
    if(!hits.length)continue;
    const games=hits.reduce((s,x)=>s+x.games,0), wins=hits.reduce((s,x)=>s+x.wins,0);
    const bestPhase=[...hits].sort((a,b)=>b.games-a.games)[0]?.phase||'mid';
    out.push({hero:heroes.find(h=>Number(h.id)===Number(heroId)),games,wins,bestPhase,phases:hits});
  }
  return out.filter(x=>x.hero).sort((a,b)=>b.games-a.games);
}
async function loadReverseItemPopularity(itemId){
  let rows=cachedItemUsers(itemId);
  if(rows.length>=5)return rows;
  const candidates=[...heroes].sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0)).slice(0,12).filter(h=>!heroItemPopularityCache.has(Number(h.id)));
  const concurrency=3; for(let i=0;i<candidates.length;i+=concurrency){await Promise.all(candidates.slice(i,i+concurrency).map(h=>fetchHeroItemPopularity(h.id))); rows=cachedItemUsers(itemId); if(rows.length>=5)break;}
  return rows;
}
function renderItemHeroLinks(itemId,rows,status='real'){
  const box=document.getElementById('itemHeroPopularity');if(!box)return;
  const phaseNames={start:'Старт',early:'Ранняя',mid:'Середина',late:'Поздняя'};
  box.innerHTML=`<div class="item-pop-head"><div><h3>👥 Популярен у героев</h3><p>OpenDota · ${status==='real'?'реальные игровые данные':'данные из локального сеанса'} · покупки по фазам</p></div></div>${rows.length?`<div class="item-hero-links">${rows.slice(0,8).map(r=>`<button data-hero-open="${r.hero.id}"><img src="${imageUrl(r.hero)}"><span><b>${escapeHtml(r.hero.localized_name)}</b><small>${statValue(r.games)} покупок${r.wins>0?` · ${((r.wins/r.games)*100).toFixed(1)}% побед`:''} · чаще: ${phaseNames[r.bestPhase]||r.bestPhase}</small></span></button>`).join('')}</div><div class="item-phase-bars">${['start','early','mid','late'].map(ph=>{const n=rows.reduce((s,r)=>s+(r.phases||[]).filter(x=>x.phase===ph).reduce((a,x)=>a+x.games,0),0);return `<div><span>${phaseNames[ph]}</span><b>${statValue(n)}</b></div>`}).join('')}</div>`:'<div class="item-pop-loading">Пока не найдено достаточно реальных данных для этого предмета.</div>'}`;
  box.querySelectorAll('[data-hero-open]').forEach(b=>b.onclick=()=>openHero(Number(b.dataset.heroOpen)));
}

function openHero(id){const h=heroes.find(x=>Number(x.id)===Number(id));if(!h)return;lastFocusedEl=document.activeElement;const a=attrInfo(h.primary_attr),stats=heroStats(h),counters=counterCandidates(h),build=heroBuild(h);document.getElementById('modalContent').innerHTML=`<div class="hero-detail"><div class="hero-cover"><img src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}"><div><div class="eyebrow">HERO PROFILE</div><h2>${escapeHtml(h.localized_name)}</h2><p>${a[0]} ${a[1]} · ${escapeHtml(h.attack_type||'Тип атаки')} · ${escapeHtml(roleText(h))}</p><div class="hero-detail-actions"><a class="btn ghost" target="_blank" rel="noopener" href="${officialHeroUrl(h)}">Официальная страница ↗</a></div></div></div><div class="detail-stats">${stats.map(x=>`<div><small>${x.k}</small><strong>${x.v}</strong></div>`).join('')}</div><div class="detail-section"><h3>Способности</h3><div class="ability-grid" id="heroAbilities"><div class="item-pop-loading">Загружаем реальные способности героя…</div></div></div><div class="detail-columns"><div><h3>Контрпики</h3><div class="linked-list">${counters.map(x=>`<button data-hero-open="${x.id}"><img src="${imageUrl(x)}">${escapeHtml(x.localized_name)}<span>→</span></button>`).join('')}</div></div><div><h3>Рекомендуемый билд</h3><div class="build-list">${build.map((x,i)=>`<button data-item-by-name="${escapeHtml(x)}"><span>${i+1}</span>${escapeHtml(x)}</button>`).join('')}</div></div></div><div class="detail-section item-popularity-section" id="heroItemPopularity"><div class="item-pop-loading">Загружаем реальные покупки предметов…</div></div><div class="detail-section"><h3>Гайды</h3><div class="guide-mini-grid">${guideData.slice(0,3).map(g=>`<article><span>${g.icon} ${g.tag}</span><b>${g.title}</b><button data-go="guides">Открыть →</button></article>`).join('')}</div></div></div>`;document.getElementById('modal').classList.add('show');document.getElementById('close').focus();document.querySelectorAll('[data-hero-open]').forEach(b=>b.onclick=()=>openHero(Number(b.dataset.heroOpen)));document.querySelectorAll('[data-item-by-name]').forEach(b=>b.onclick=()=>{const term=b.dataset.itemByName.toLowerCase();const x=items.find(i=>String(i.dname).toLowerCase().includes(term.split(' ')[0]));if(x)openItem(x.name);});loadHeroItemPopularity(h.id);loadHeroAbilities(h);}
function closeModal(){document.getElementById('modal').classList.remove('show');if(lastFocusedEl?.focus)lastFocusedEl.focus();}
const OFFICIAL_ITEM_CACHE_TTL=1000*60*60*24*30;
function officialItemCacheKey(itemId){return `d2h_official_item_v2_${itemId}`;}
function readOfficialItemCache(itemId){
  try{
    const raw=localStorage.getItem(officialItemCacheKey(itemId));
    const x=raw?JSON.parse(raw):null;
    return x?.data?x:null;
  }catch(e){return null;}
}
function writeOfficialItemCache(itemId,data){
  try{localStorage.setItem(officialItemCacheKey(itemId),JSON.stringify({ts:Date.now(),data}));}catch(e){}
}
function extractOfficialItemData(j){
  const candidates=[
    j?.result?.data?.items,
    j?.result?.data?.item_abilities,
    j?.result?.data?.itemabilities,
    j?.result?.data?.item,
    j?.data?.items,
    j?.data?.item_abilities,
    j?.data?.itemabilities,
    j?.data?.item
  ];
  for(const c of candidates){
    if(Array.isArray(c)&&c.length)return c[0];
    if(c&&typeof c==='object'&&!Array.isArray(c))return c;
  }
  return null;
}
async function refreshOfficialItemData(itemId){
  const urls=[
    `/api/dota/item/${encodeURIComponent(itemId)}`,
    `https://www.dota2.com/datafeed/itemdata?language=english&item_id=${encodeURIComponent(itemId)}`,
    `https://www.dota2.com/datafeed/itemdata?item_id=${encodeURIComponent(itemId)}&language=english`
  ];
  for(const url of urls){
    try{
      const c=new AbortController();const t=setTimeout(()=>c.abort(),6500);
      const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{Accept:'application/json'}});clearTimeout(t);
      if(!r.ok)continue;
      const payload=await r.json();
      const d=url.startsWith('/api/')?(payload?.data||payload?.item||payload):extractOfficialItemData(payload);
      if(d){writeOfficialItemCache(itemId,d);return d;}
    }catch(e){}
  }
  return null;
}
async function fetchOfficialItemData(itemId){
  const cached=readOfficialItemCache(itemId);
  if(cached?.data){
    // Cache-first: show the saved official text immediately. If it is old,
    // refresh silently in the background for the next visit.
    if(Date.now()-Number(cached.ts||0)>OFFICIAL_ITEM_CACHE_TTL){
      refreshOfficialItemData(itemId).catch(()=>{});
    }
    return cached.data;
  }
  return refreshOfficialItemData(itemId);
}
function cleanOfficialHtml(v){return String(v||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();}
function officialItemFacts(d){
  if(!d)return [];
  const out=[];
  const push=(label,val)=>{if(val!==undefined&&val!==null&&String(val)!=='')out.push(`<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(val))}</strong></div>`)};
  push('Стоимость',d.item_cost??d.cost);
  if(Array.isArray(d.cooldowns)&&d.cooldowns.length)push('Перезарядка',d.cooldowns.join(' / ')+' сек');
  if(Array.isArray(d.mana_costs)&&d.mana_costs.length)push('Мана',d.mana_costs.join(' / '));
  if(Array.isArray(d.cast_ranges)&&d.cast_ranges.length)push('Дальность',d.cast_ranges.join(' / '));
  if(Array.isArray(d.special_values)) d.special_values.forEach(v=>{const vals=Array.isArray(v.values_float)?v.values_float.join(' / '):(Array.isArray(v.values)?v.values.join(' / '):''); if(v.heading_loc&&vals)push(cleanOfficialHtml(v.heading_loc),vals+(v.is_percentage?'%':''));});
  return out;
}
function itemOfficialUseFlags(d){
  if(!d)return [];
  const flags=[]; if(d.is_pregame_suggested)flags.push('Рекомендуется на старте'); if(d.is_earlygame_suggested)flags.push('Рекомендуется для ранней игры'); if(d.is_lategame_suggested)flags.push('Рекомендуется для поздней игры');
  if(d.neutral_item_tier!==undefined && d.neutral_item_tier>=0 && d.neutral_item_tier<10)flags.push(`Нейтральный предмет · тир ${Number(d.neutral_item_tier)+1}`);
  return flags;
}
async function openItem(name){
  const x=items.find(i=>i.name===name);if(!x)return;
  lastFocusedEl=document.activeElement;
  const cached=readOfficialItemCache(x.id);
  const initial= cached?.data ? cached.data : null;
  const cachedDesc=cleanOfficialHtml(initial?.desc_loc||initial?.description||'');
  const localDesc=cleanOfficialHtml(x?.desc_loc||x?.description||'');
  const safeLocal=localDesc&&!/Откройте онлайн|актуальных характеристик|open online|current data/i.test(localDesc)?localDesc:'';
  const description=cachedDesc||safeLocal||'Официальное описание загружается…';
  const cat=itemCategoryLabel(x);
  const cacheAge=cached?.ts?Math.max(0,Math.floor((Date.now()-cached.ts)/86400000)):null;
  document.getElementById('modalContent').innerHTML=`
    <div class="item-profile-v3">
      <div class="item-profile-top">
        <div class="item-profile-art"><img src="${itemImage(x)}" alt="${escapeHtml(x.dname)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'"><span>${escapeHtml(cat)}</span></div>
        <div class="item-profile-title">
          <div class="eyebrow">ITEM PROFILE</div>
          <h2>${escapeHtml(x.dname)}</h2>
          <div class="item-profile-meta"><span>💰 ${x.cost?statValue(x.cost)+' gold':'Стоимость не указана'}</span><span>ID ${x.id??'—'}</span>${cached?'<span class="item-cache-badge">✓ Valve cache</span>':''}</div>
          <p class="item-profile-sub">Официальные данные предмета + реальные данные о его покупках. Ничего не добавляем от себя.</p>
          <div class="item-profile-actions"><a class="btn red" target="_blank" rel="noopener" href="https://www.dota2.com/datafeed/itemdata?language=english&item_id=${encodeURIComponent(x.id)}">Valve Datafeed ↗</a><button class="btn ghost" id="itemRefreshBtn">↻ Обновить данные</button></div>
        </div>
      </div>
      <div class="item-profile-grid">
        <section class="item-profile-panel item-profile-description">
          <div class="item-panel-head"><div><span>OFFICIAL</span><h3>Описание предмета</h3></div><small id="itemCacheAge">${cached?(cacheAge===0?'кэш сохранён сегодня':`кэш ${cacheAge} дн. назад`):'данные ещё не сохранены'}</small></div>
          <p id="officialItemDesc">${escapeHtml(description)}</p>
        </section>
        <section class="item-profile-panel" id="officialItemDetails"><div class="item-pop-loading">${cached?'Проверяем свежесть официальных данных…':'Получаем официальные данные…'}</div></section>
      </div>
      <section class="item-profile-panel item-use-panel" id="itemPurchaseUse"><div class="item-pop-loading">Загружаем реальные связи предмета с героями…</div></section>
      <section class="item-profile-panel item-why-panel">
        <div class="item-panel-head"><div><span>HOW TO READ</span><h3>Для чего этот предмет</h3></div></div>
        <p>Здесь мы не придумываем назначение предмета. Ориентиром служит официальное описание и реальные покупки игроков. Конкретные герои ниже — это статистическая связь, а не субъективная рекомендация сайта.</p>
      </section>
    </div>`;
  document.getElementById('modal').classList.add('show');document.getElementById('close').focus();
  document.getElementById('itemRefreshBtn')?.addEventListener('click',async()=>{try{localStorage.removeItem(officialItemCacheKey(x.id));}catch(e){} openItem(name);});
  const official=await fetchOfficialItemData(x.id);
  if(!document.getElementById('officialItemDesc'))return;
  if(official){
    const desc=cleanOfficialHtml(official.desc_loc||official.description||official.name_loc||'Описание отсутствует в официальном feed.');
    document.getElementById('officialItemDesc').textContent=desc||'Описание отсутствует в официальном feed.';
    const facts=officialItemFacts(official),flags=itemOfficialUseFlags(official);
    const notes=Array.isArray(official.notes_loc)?official.notes_loc:[];
    document.getElementById('officialItemDetails').innerHTML=`
      <div class="item-panel-head"><div><span>VALVE DATAFEED</span><h3>Официальные характеристики</h3></div><span class="item-source-badge">✓ Valve</span></div>
      ${flags.length?`<div class="item-official-flags">${flags.map(f=>`<span>${escapeHtml(f)}</span>`).join('')}</div>`:''}
      ${facts.length?`<div class="item-official-facts">${facts.join('')}</div>`:'<p class="muted">Для этого объекта Valve не вернул дополнительные числовые поля.</p>'}
      ${official.lore_loc?`<div class="item-lore"><small>LORE</small><p>${escapeHtml(cleanOfficialHtml(official.lore_loc))}</p></div>`:''}
      ${notes.length?`<div class="item-notes"><h4>Примечания Valve</h4>${notes.map(n=>`<p>• ${escapeHtml(cleanOfficialHtml(n))}</p>`).join('')}</div>`:''}`;
  }else{
    document.getElementById('officialItemDetails').innerHTML='<div class="item-pop-loading">Valve Datafeed сейчас недоступен. Кэш или локальные данные остаются без подмены выдуманным описанием.</div>';
  }
  const rows=await loadReverseItemPopularity(x.id);
  renderItemHeroLinks(x.id,rows,'real');
}

function compareHeroes(){const names=prompt('Введи двух героев через запятую, например: Invoker, Lina');if(!names)return;const [aName,bName]=names.split(',').map(x=>x.trim().toLowerCase());const a=heroes.find(h=>h.localized_name.toLowerCase()===aName)||heroes.find(h=>h.localized_name.toLowerCase().includes(aName));const b=heroes.find(h=>h.localized_name.toLowerCase()===bName)||heroes.find(h=>h.localized_name.toLowerCase().includes(bName));if(!a||!b){alert('Не удалось найти обоих героев.');return;}const rows=[['Атрибут',attrInfo(a.primary_attr)[1],attrInfo(b.primary_attr)[1]],['Move Speed',a.move_speed||'—',b.move_speed||'—'],['Damage',a.base_attack_min!=null?`${a.base_attack_min}–${a.base_attack_max}`:'—',b.base_attack_min!=null?`${b.base_attack_min}–${b.base_attack_max}`:'—'],['Pro Winrate',a.pro_pick?winrate(a).toFixed(1)+'%':'—',b.pro_pick?winrate(b).toFixed(1)+'%':'—'],['Pro Picks',statValue(a.pro_pick),statValue(b.pro_pick)]];document.getElementById('modalContent').innerHTML=`<div class="compare-detail"><div class="compare-head"><div><img src="${imageUrl(a)}"><h2>${escapeHtml(a.localized_name)}</h2></div><strong>VS</strong><div><img src="${imageUrl(b)}"><h2>${escapeHtml(b.localized_name)}</h2></div></div><table class="compare-table"><tbody>${rows.map(r=>`<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`;document.getElementById('modal').classList.add('show');document.getElementById('close').focus();}
// Надёжная загрузка изображений: если CDN не отвечает, автоматически меняем домен.
document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement))return;const src=img.currentSrc||img.src;if(!/(?:dota2\.com|steamstatic\.com)\/apps\/dota2\/images\/dota_react\//i.test(src)||img.dataset.d2hFinal)return;const tried=Number(img.dataset.d2hTry||0);const domains=['cdn.cloudflare.steamstatic.com','cdn.akamai.steamstatic.com','cdn.steamstatic.com','cdn.dota2.com'];const current=domains.findIndex(d=>src.includes(d));const next=domains[current+1]||domains[tried+1];if(next){img.dataset.d2hTry=String(tried+1);img.src=src.replace(/cdn\.(?:dota2|cloudflare\.steamstatic|akamai\.steamstatic|steamstatic)\.com/,next);return;}img.dataset.d2hFinal='1';img.onerror=null;img.src=FALLBACK_IMG;},true);

// DATA BOOT: render guaranteed local data before optional UI event wiring.
// This keeps file:// preview usable even if a non-critical control is missing.
try{
  renderGuides();
  const heroBootPromise=loadHeroes();
  const itemBootPromise=loadItems();
  // SEO deep link: static hero pages (/hero/<slug>/) link back here with ?openHero=<id>
  // so visitors coming from search results land straight on the interactive profile.
  const openHeroParam=new URLSearchParams(location.search).get("openHero");
  if(openHeroParam){heroBootPromise.then(()=>{const id=Number(openHeroParam);if(heroes.some(h=>Number(h.id)===id))openHero(id);});}
  // Same deep link for static item pages (/item/<slug>/) via ?openItem=<internal_name>
  const openItemParam=new URLSearchParams(location.search).get("openItem");
  if(openItemParam){itemBootPromise.then(()=>{if(items.some(i=>i.name===openItemParam))openItem(openItemParam);});}
}catch(err){
  console.error('Dota 2 Companion boot error:',err);
  try{
    if(typeof localHeroes==='function'){heroes=normalizeHeroes(localHeroes());updateHeroUI('локальная база');}
    if(typeof localItems==='function'){items=localItems();renderItems();updateItemCounters();}
  }catch(fallbackErr){console.error('Fallback boot error:',fallbackErr);}
}

// Events — defensive wiring: one missing optional widget must never stop the rest of the app.
const $=id=>document.getElementById(id);
const on=(id,event,handler)=>{const el=$(id);if(el)el.addEventListener(event,handler);return el;};
const click=(id,handler)=>{const el=$(id);if(el)el.onclick=handler;return el;};
on('search','input',renderHeroes);
document.querySelectorAll('.chip[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('.chip[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHeroes();}));
click('resetChip',()=>{filter='all';if($('search'))$('search').value='';document.querySelectorAll('.chip[data-filter]').forEach(x=>x.classList.remove('active'));document.querySelector('[data-filter="all"]')?.classList.add('active');renderHeroes();});
on('statsSearch','input',renderStats);on('statsSort','change',renderStats);on('statsAttr','change',renderStats);on('statsAttack','change',renderStats);on('statsRole','change',renderStats);
click('statsRefresh',()=>{d2hClearCache();loadHeroes(true);loadItems(true);});click('compareBtn',compareHeroes);
on('itemSearch','input',renderItems);
document.querySelectorAll('.item-filter').forEach(b=>b.addEventListener('click',()=>{itemFilter=b.dataset.itemFilter;document.querySelectorAll('.item-filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderItems();}));
document.querySelectorAll('.item-category').forEach(b=>b.addEventListener('click',()=>{window.itemCategoryFilter=b.dataset.itemCategory;document.querySelectorAll('.item-category').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderItems();}));
document.querySelectorAll('.guide-filter').forEach(b=>b.addEventListener('click',()=>{guideFilter=b.dataset.guideFilter;document.querySelectorAll('.guide-filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderGuides();}));
on('heroesGrid','click',e=>{const c=e.target.closest('.hero-card');if(c)openHero(Number(c.dataset.id));});
on('heroesGrid','keydown',e=>{const c=e.target.closest('.hero-card');if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openHero(Number(c.dataset.id));}});
on('featuredHeroesGrid','click',e=>{const c=e.target.closest('.featured-hero-card');if(c)openHero(Number(c.dataset.id));});
on('statsBody','click',e=>{const tr=e.target.closest('tr[data-id]');if(tr)openHero(Number(tr.dataset.id));});
on('statsExtra','click',e=>{const b=e.target.closest('button[data-id]');if(b)openHero(Number(b.dataset.id));});
on('itemsGrid','click',e=>{const c=e.target.closest('[data-item]');if(c)openItem(c.dataset.item);});
on('quickPrepInput','input',e=>quickPrepSelectByName(e.target.value));
on('quickPrepChips','click',e=>{const b=e.target.closest('[data-quick-hero]');if(!b)return;const h=heroes.find(x=>Number(x.id)===Number(b.dataset.quickHero));if(h){const inp=document.getElementById('quickPrepInput');if(inp)inp.value=h.localized_name;renderQuickPrep(h);}});
on('quickPrepResult','click',e=>{const hb=e.target.closest('[data-hero-open]');if(hb){openHero(Number(hb.dataset.heroOpen));return;}const ib=e.target.closest('[data-item-by-name]');if(ib){const term=ib.dataset.itemByName.toLowerCase();const x=items.find(i=>String(i.dname).toLowerCase().includes(term.split(' ')[0]));if(x)openItem(x.name);}});
on('guidesGrid','click',e=>{const b=e.target.closest('[data-go]');if(b){closeModal();go(b.dataset.go);}});
on('modalContent','click',e=>{const b=e.target.closest('[data-go]');if(b){closeModal();go(b.dataset.go);}});
click('randomBtn',randomHero);
click('close',closeModal);click('modalBg',closeModal);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('modal')?.classList.contains('show'))closeModal();});
const menuBtn=$('menu'),navMenu=$('navMenu');
function setMenuOpen(o){if(!navMenu||!menuBtn)return;navMenu.classList.toggle('open',o);menuBtn.setAttribute('aria-expanded',String(o));}
if(menuBtn&&navMenu){menuBtn.onclick=()=>setMenuOpen(!navMenu.classList.contains('open'));navMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenuOpen(false)));}
window.addEventListener('resize',()=>{if(innerWidth>760)setMenuOpen(false);});
// Initial data boot is performed before event wiring.
