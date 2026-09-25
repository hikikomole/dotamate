// Про-показатели идут через свой воркер, а не напрямую в OpenDota: раньше
// туда ходил браузер каждого посетителя. Воркер держит суточный кеш и при
// недоступности OpenDota отдаёт снимок, так что сторонних запросов у сайта
// во время работы не остаётся вовсе.
const PRO_STATS_API="/api/dota/hero-stats";
// Разделы сайта разнесены по страницам, поэтому на любой из них часть
// элементов отсутствует. Эти два помощника пишут в DOM только если цель есть.
const d2hSetText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
const d2hSetHtml=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v;};
// Единственные источники данных о предметах — файлы в репозитории.
const ITEMS_LOCAL="/data/items-ru.json";
const ITEM_HEROES_LOCAL="/data/item-heroes.json";
const HERO_ITEMS_LOCAL="/data/hero-items.json";
// Настоящие матчапы для блока быстрой подготовки (tools/build-hero-counters.js).
// Раньше контрпики там считались формулой из тегов и атрибутов, со случайным
// слагаемым — выдумка, менявшаяся при каждом открытии страницы.
const HERO_COUNTERS_LOCAL="/data/hero-counters.json";
let heroCountersIndex=null,heroCountersPromise=null;
function loadHeroCounters(){
  if(heroCountersIndex)return Promise.resolve(heroCountersIndex);
  if(!heroCountersPromise){
    heroCountersPromise=fetch(HERO_COUNTERS_LOCAL)
      .then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(j=>{heroCountersIndex=(j&&j.heroes)||{};return heroCountersIndex;})
      .catch(()=>({}));
  }
  return heroCountersPromise;
}
const LOCAL_MODE=location.protocol==="file:";
const FALLBACK_IMG="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 125"><rect width="100" height="125" fill="#ececf2"/><text x="50" y="66" font-size="12" fill="#777" text-anchor="middle" font-family="sans-serif">DOTA</text></svg>');
let heroes=[],items=[],filter="all",itemFilter="all",guideFilter="all",lastFocusedEl=null,spotlightHeroId=null,spotlightTimer=null;
const ruRoles={Carry:"Керри",Support:"Поддержка",Nuker:"Нюкер",Disabler:"Дизейблер",Jungler:"Лесник",Durable:"Танк",Escape:"Эскейп",Pusher:"Пушер",Initiator:"Инициация"};
const attrs={str:["💪","Сила"],agi:["🏹","Ловкость"],int:["🧠","Интеллект"],all:["✦","Универсальный"],universal:["✦","Универсальный"]};
const guideData=[
 {cat:"heroes",icon:"🎯",tag:"GAMEPLAY",title:"Как выбирать героя под матч",text:"Смотри на роль, задачи состава, тип атаки и ограничения противников — а не только на то, кем удобнее играть.",slug:"hero-picking-basics"},
 {cat:"gameplay",icon:"⚔",tag:"GAMEPLAY",title:"Как добивать крипов: ласт-хит и денай",text:"Золото и опыт в Dota 2 не начисляются просто за нахождение рядом с крипами — их нужно добивать точным последним ударом.",slug:"last-hitting-denying"},
 {cat:"gameplay",icon:"🗺",tag:"MAP",title:"Вард и контроль карты",text:"Вард — не просто предмет: это привычка планировать следующий безопасный участок карты, а не реагировать постфактум.",slug:"warding-map-control"},
 {cat:"items",icon:"◈",tag:"ITEMS",title:"Как собирать предметы: основы айтем билда",text:"Смотри не только на стоимость: важны характеристики, активные способности и то, под какую конкретно проблему матча собирается предмет.",slug:"itemization-basics"},
 {cat:"items",icon:"💠",tag:"ITEMS",title:"Магический и физический урон: во что упаковываться",text:"Разные типы урона контрятся разными предметами — защита, которая хорошо работает против одного, почти бесполезна против другого.",slug:"magic-vs-physical-resistance"},
 {cat:"heroes",icon:"👁",tag:"HEROES",title:"Как играть против невидимости",text:"Невидимость пугает новичков сильнее, чем должна — против неё есть предсказуемые и надёжные инструменты.",slug:"countering-invisibility"},
 {cat:"heroes",icon:"📊",tag:"HERO DATA",title:"Роли в Dota 2: кто за что отвечает в команде",text:"Роль — это ориентир, а не жёсткая клетка. Но понимание пяти классических ролей помогает быстрее находить своё место в команде.",slug:"roles-explained"},
 {cat:"gameplay",icon:"🧠",tag:"GAMEPLAY",title:"Драфт: как выбирать героев под состав",text:"Пик героев определяет сильные и слабые стороны команды задолго до того, как на карте появится первый крипу.",slug:"draft-fundamentals"},
 {cat:"heroes",icon:"📈",tag:"HERO DATA",title:"Винрейт в Dota 2: как читать статистику героев",text:"Pro picks показывают популярность на профессиональной сцене, а Pro win — победы именно среди этих матчей. Это разные метрики.",slug:"reading-hero-stats"},
 {cat:"gameplay",icon:"🧮",tag:"MMR",title:"Путь к повышению MMR: как тренироваться осознанно",text:"Калькулятор MMR показывает математический ориентир, а не гарантированный результат — реальный рост даёт осознанная практика.",slug:"mmr-climbing-mindset"},
 {cat:"heroes",icon:"⚔",tag:"BUILD",title:"Билд на керри: порядок покупок по этапам игры",text:"Керри слаб в начале и становится главной угрозой к поздней игре — билд должен закрывать именно эту кривую силы.",slug:"build-carry"},
 {cat:"heroes",icon:"🧠",tag:"BUILD",title:"Билд на мидера: универсальные приоритеты",text:"Мидер играет один на один и получает больше всего раннего опыта — итемизация должна реализовать это преимущество как можно раньше.",slug:"build-mid"},
 {cat:"heroes",icon:"🛡",tag:"BUILD",title:"Билд на оффлейн: выживание и инициация",text:"Оффлейнер играет в невыгодных условиях линии — итемизация здесь про выживание и пространство для команды, а не чистый фарм.",slug:"build-offlane"},
 {cat:"heroes",icon:"🔮",tag:"BUILD",title:"Билд на софт-саппорта",text:"Софт-саппорт жертвует частью фарма ради обзора и контроля, но обычно фармит немного больше хард-саппорта.",slug:"build-soft-support"},
 {cat:"heroes",icon:"💚",tag:"BUILD",title:"Билд на хард-саппорта",text:"Хард-саппорт почти не фармит — его золото почти целиком уходит на обзор карты и спасение союзников.",slug:"build-hard-support"},
 {cat:"items",icon:"👢",tag:"COMPARE",title:"Ботинки в Dota 2: какие выбрать",text:"Все герои начинают с одинаковых Boots of Speed, но апгрейд ботинок — одно из первых решений, которое сильно зависит от роли и героя.",slug:"boots-comparison"},
 {cat:"items",icon:"🛡",tag:"COMPARE",title:"Защитные предметы: что от чего спасает",text:"Разные защитные предметы решают разные угрозы — контроль, магический урон, физический урон или конкретное точечное заклинание.",slug:"defensive-items-comparison"},
 {cat:"items",icon:"🛡",tag:"МЕХАНИКИ",title:"Как считается урон: броня, магсопротивление и блок",text:"Броня, сопротивление магии и блок работают по формулам. Сколько на самом деле даёт единица брони и почему 60% от BKB — это не 60%.",slug:"damage-armor-magic-resist"},
 {cat:"heroes",icon:"📐",tag:"МЕХАНИКИ",title:"Сила, ловкость и интеллект: что даёт одно очко",text:"Очко силы — это 22 здоровья, очко ловкости — 0.167 брони и +1 к скорости атаки. Переводим атрибуты в понятные числа.",slug:"attributes-explained"},
 {cat:"gameplay",icon:"🏰",tag:"КАРТА",title:"Объекты карты в 7.41: Рошан, Тормент, Шрайны и руны",text:"Рошан переезжает между двумя ямами, Тормент приходит с 15:00, руны мудрости заменили Шрайнами. Что где и когда.",slug:"map-objectives-741"},
 {cat:"gameplay",icon:"💰",tag:"ЭКОНОМИКА",title:"Золото и опыт: откуда берутся GPM и XPM",text:"Награда крипов, формула золота за убийство, потеря при смерти и цена выкупа — числа, по которым считается экономика матча.",slug:"gold-and-experience"},
 {cat:"gameplay",icon:"🏅",tag:"РЕЙТИНГ",title:"Ранги в Dota 2 и MMR",text:"Все 8 рангов, MMR для каждой звезды и сколько игроков в каждом ранге.",slug:"ranks-mmr"},
 {cat:"heroes",icon:"⚔",tag:"КОНТРПИКИ",title:"Таблица контрпиков",text:"Три самых неудобных соперника для каждого героя по 340 тысячам рейтинговых матчей.",slug:"counter-picks"},
 {cat:"gameplay",icon:"🤝",tag:"ПОВЕДЕНИЕ",title:"Порядочность: как поднять",text:"Что закрывает низкая порядочность, какие жалобы на неё влияют и как её поднять.",slug:"conduct-score"},
 {cat:"gameplay",icon:"⌨",tag:"НАСТРОЙКИ",title:"Консоль и FPS",text:"Как включить консоль, рабочие параметры запуска и настройки, которые поднимают FPS.",slug:"console-fps"},
 {cat:"gameplay",icon:"⏳",tag:"СТАТИСТИКА",title:"Сколько длится матч",text:"Медианная длительность рейтинга, обычных игр и Turbo по 500 тысячам матчей.",slug:"match-duration"},
 {cat:"gameplay",icon:"🏰",tag:"ЭКОНОМИКА",title:"Сколько золота даёт вышка",text:"Командная награда и золото за последний удар по тирам, денай башни и казармы — таблица на актуальный патч.",slug:"tower-gold"},
 {cat:"gameplay",icon:"⏱",tag:"ТАЙМИНГИ",title:"Тайминги матча: что происходит на карте по минутам",text:"Волны, руны, шрайны, Тормент и окно Рошана идут по расписанию. Полная таблица таймингов и как готовиться заранее.",slug:"match-timings"},
 {cat:"gameplay",icon:"📖",tag:"СЛОВАРЬ",title:"Словарь терминов Dota 2",text:"Что значат ластхит, денай, ганк, керри, MMR и другие термины — короткие объяснения с ссылками на подробные гайды.",slug:"glossary",href:"/glossary/"}
];
const heroSlug={"Anti-Mage":"antimage","Ancient Apparition":"ancient_apparition","Arc Warden":"arc_warden","Batrider":"batrider","Beastmaster":"beastmaster","Bloodseeker":"bloodseeker","Bounty Hunter":"bounty_hunter","Brewmaster":"brewmaster","Bristleback":"bristleback","Broodmother":"broodmother","Centaur Warrunner":"centaur","Chaos Knight":"chaos_knight","Clockwerk":"rattletrap","Crystal Maiden":"crystal_maiden","Dawnbreaker":"dawnbreaker","Death Prophet":"death_prophet","Dragon Knight":"dragon_knight","Drow Ranger":"drow_ranger","Earth Spirit":"earth_spirit","Earthshaker":"earthshaker","Elder Titan":"elder_titan","Ember Spirit":"ember_spirit","Enchantress":"enchantress","Faceless Void":"faceless_void","Grimstroke":"grimstroke","Gyrocopter":"gyrocopter","Hoodwink":"hoodwink","Huskar":"huskar","Invoker":"invoker","Io":"wisp","Jakiro":"jakiro","Juggernaut":"juggernaut","Keeper of the Light":"keeper_of_the_light","Kez":"kez","Kunkka":"kunkka","Largo":"largo","Legion Commander":"legion_commander","Leshrac":"leshrac","Lich":"lich","Lifestealer":"life_stealer","Lina":"lina","Lion":"lion","Lone Druid":"lone_druid","Luna":"luna","Lycan":"lycan","Magnus":"magnataur","Marci":"marci","Mars":"mars","Medusa":"medusa","Meepo":"meepo","Mirana":"mirana","Monkey King":"monkey_king","Morphling":"morphling","Muerta":"muerta","Naga Siren":"naga_siren","Nature's Prophet":"furion","Necrophos":"necrolyte","Night Stalker":"night_stalker","Nyx Assassin":"nyx_assassin","Ogre Magi":"ogre_magi","Omniknight":"omniknight","Oracle":"oracle","Outworld Destroyer":"obsidian_destroyer","Pangolier":"pangolier","Phantom Assassin":"phantom_assassin","Phantom Lancer":"phantom_lancer","Phoenix":"phoenix","Primal Beast":"primal_beast","Puck":"puck","Pudge":"pudge","Pugna":"pugna","Queen of Pain":"queenofpain","Razor":"razor","Riki":"riki","Ringmaster":"ringmaster","Rubick":"rubick","Sand King":"sand_king","Shadow Demon":"shadow_demon","Shadow Fiend":"nevermore","Shadow Shaman":"shadow_shaman","Silencer":"silencer","Skywrath Mage":"skywrath_mage","Slardar":"slardar","Slark":"slark","Snapfire":"snapfire","Sniper":"sniper","Spectre":"spectre","Spirit Breaker":"spirit_breaker","Storm Spirit":"storm_spirit","Sven":"sven","Techies":"techies","Templar Assassin":"templar_assassin","Terrorblade":"terrorblade","Tidehunter":"tidehunter","Timbersaw":"shredder","Tinker":"tinker","Tiny":"tiny","Treant Protector":"treant","Troll Warlord":"troll_warlord","Tusk":"tusk","Underlord":"abyssal_underlord","Undying":"undying","Ursa":"ursa","Vengeful Spirit":"vengeful_spirit","Venomancer":"venomancer","Viper":"viper","Visage":"visage","Void Spirit":"void_spirit","Warlock":"warlock","Weaver":"weaver","Windranger":"windrunner","Winter Wyvern":"winter_wyvern","Witch Doctor":"witch_doctor","Wraith King":"skeleton_king","Zeus":"zuus"};
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function slugForHero(h){const raw=String(h?.name||h?.localized_name||"").replace(/^npc_dota_hero_/,'');return heroSlug[h?.localized_name]||heroSlug[h?.name]||raw||"";}
// Портреты героев и иконки способностей лежат в репозитории (assets/heroes/,
// assets/abilities/) — на CDN Valve остаются только видеоролики, которые
// хостить у себя нецелесообразно.
function imageUrl(h){return `/assets/heroes/${slugForHero(h)}.png`;}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
// Иконки лежат в репозитории (assets/items/): путь приходит готовым из
// items-ru.json, у рецепта это иконка предмета, который из него собирается.
function itemImage(x){const p=String(x&&x.img||"");return p.startsWith("/assets/")?p:`/assets/items/${itemSlug(x&&x.name||x)}.png`;}
function roleText(h){return (typeof positionText==="function"&&positionText(h))||(h.roles||[]).map(x=>ruRoles[x]||x).join(" / ")||"Герой";}
function attrInfo(a){return attrs[a]||attrs.all;}
function officialHeroUrl(h){return "https://www.dota2.com/hero/"+slugForHero(h).replace(/_/g,'');}
function winrate(h){return h.pro_pick?Number(h.pro_win||0)/Number(h.pro_pick)*100:0;}
// Нижняя граница доверительного интервала Уилсона (95%) для доли побед.
// Нужна там, где герои сравниваются по winrate: у героя с одним пиком и одной
// победой формально 100%, и он вытеснял из подборки тех, кого реально играют.
// Показываем при этом настоящий процент — оценка влияет только на порядок.
function wrScore(h){const n=Number(h.pro_pick||0);if(!n)return -1;const p=Number(h.pro_win||0)/n,z=1.96,z2=z*z;return (p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/(1+z2/n);}
function go(id){document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});}
function normalizeHeroes(list){return (list||[]).map(h=>{const raw=String(h.name||'').replace(/^npc_dota_hero_/,'');const reverse=Object.entries(heroSlug).find(([,slug])=>slug===raw);const loc=reverse?.[0]||h.localized_name||h.name_loc||h.name_english_loc||raw.replace(/_/g,' ');const clean={...h,localized_name:loc};if(h.primary_attr===0)clean.primary_attr='str';else if(h.primary_attr===1)clean.primary_attr='agi';else if(h.primary_attr===2)clean.primary_attr='int';else if(h.primary_attr===3)clean.primary_attr='universal';else if(h.primary_attr==='all')clean.primary_attr='universal';clean.img=h.img||`/apps/dota2/images/dota_react/heroes/${raw}.png`;return clean;}).filter(h=>h.localized_name).sort((a,b)=>a.localized_name.localeCompare(b.localized_name));}
function unwrapHeroes(data){if(Array.isArray(data))return data;if(data?.result?.data?.heroes)return data.result.data.heroes;if(data?.data?.heroes)return data.data.heroes;if(data?.result?.heroes)return data.result.heroes;if(data?.heroes)return data.heroes;if(data&&typeof data==='object')return Object.values(data).filter(x=>x&&x.name&&(x.localized_name||x.name_loc));return [];}
// Резервный разбор списка предметов: включается только если data/items-ru.json
// почему-то не отдался и в дело идёт встроенная база js/local-preview.js.
// Both live sources this site loads from (Valve's own datafeed and OpenDota's
// constants/dotaconstants mirrors) lump a lot of non-shop entries in with the
// real, purchasable items: combine recipes (not a thing you "use"), the
// couriers (pet units, not hero gear), a handful of leftover Diretide river-
// coloring cosmetics, and -- the one that actually broke the item page
// earlier (the "Ancient Guardian" bug) -- ~140 hidden internal objects Valve
// represents as items in its data files for hero innates/talent bonuses that
// were never meant to be seen outside a tooltip lookup. None of that belongs
// in a database of "items players use", so it's filtered out here, once, for
// every consumer of the global items[] list (grid, counts, search, the item-
// counters feature) instead of patched per display.
//
// The name-based rules below stay correct on their own as new patches ship.
// EXCLUDED_ITEM_INTERNAL_IDS is a point-in-time snapshot (from OpenDota's
// constants/items, 140 ids) of that hidden-internal bucket specifically --
// it's the one part of this filter that isn't derivable from a stable rule,
// so a future patch introducing new hero innates of the same kind won't be
// caught automatically and this list would need refreshing against a fresh
// /api/constants/items pull.
//
// 21.09.2026 добавлены 1610 (miniboss_minion_summoner) и 1801 (caster_rapier):
// у обоих в OpenDota нет поля dname, то есть человеческого названия. Генератор
// страниц их и так отбрасывал (`if(!x.dname) return false`), а каталог — нет,
// потому что normalizeItems подставлял внутреннее имя. В итоге на /items/ было
// 265 карточек против 263 страниц, и две из них вели в никуда.
const EXCLUDED_ITEM_INTERNAL_IDS=new Set([212,215,287,288,289,290,291,293,294,295,297,298,300,301,302,304,306,307,309,310,311,312,313,325,327,330,334,335,336,349,354,355,356,357,358,360,361,362,363,364,365,366,367,368,369,372,374,375,376,378,379,381,571,573,589,638,676,677,678,680,686,825,828,829,834,835,838,849,939,946,949,990,1000,1028,1029,1030,1090,1124,1156,1157,1158,1159,1160,1161,1167,1440,1441,1576,1577,1581,1583,1584,1585,1586,1587,1588,1589,1590,1591,1592,1593,1594,1595,1596,1597,1600,1602,1607,1608,1610,1639,1641,1645,1647,1648,1649,1650,1651,1652,1801,1803,1849,1850,1865,1866,1867,1869,1870,1871,1874,1875,2091,2092,2093,2094,2095,2096,2192,2193,4300,4301,4302]);
function isRealCatalogItem(x){
  const key=String(x?.name||'').replace(/^item_/,'').toLowerCase();
  if(key==='courier'||key==='flying_courier')return false;
  if(key.startsWith('river_painter'))return false;
  if(key==='ward_observer'||key==='ward_sentry')return false;
  if(EXCLUDED_ITEM_INTERNAL_IDS.has(Number(x?.id)))return false;
  return true;
}
function normalizeItems(list){
  const out=[],seen=new Set();
  for(const raw of list||[]){
    if(!raw||!raw.id||!raw.name)continue;
    const x={...raw,id:Number(raw.id),dname:raw.dname||raw.name_loc||raw.name_english_loc||raw.name};
    if(seen.has(x.id))continue;
    if(!isRealCatalogItem(x))continue;
    seen.add(x.id);out.push(x);
  }
  // Рецепт оставляем только если предмет, который из него собирается, есть в
  // каталоге: иначе карточка вела бы на несуществующую страницу.
  const byKey=new Map(out.map(i=>[String(i.name||'').replace(/^item_/,''),i]));
  const keep=out.filter(i=>{const t=recipeTarget(i);return !t||byKey.has(t);});
  // Название рецепта берём от предмета: у OpenDota это либо английское
  // «X Recipe», либо (у трёх штук) вообще пусто, и тогда на карточку попадал
  // внутренний ключ вида recipe_wraith_pact.
  for(const i of keep){const t=recipeTarget(i);if(t)i.dname=`${byKey.get(t).dname} — рецепт`;}
  return keep.sort((a,b)=>String(a.dname).localeCompare(String(b.dname)));
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
    const data=await d2hFetchJSON(PRO_STATS_API,{timeout:8000});
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
// Список героев рисуется из локального снимка (data/heroes.json,
// tools/build-heroes-snapshot.py) — мгновенно и без сети. Живые про-показатели
// догружает enrichProStats() из OpenDota поверх снимка: они меняются каждый
// день, и держать их у себя смысла нет. Если OpenDota недоступна, сайт
// продолжает работать со снимком, просто цифры пиков будут от даты сборки.
const HEROES_LOCAL="/data/heroes.json";
// Пять позиций Dota 2 (керри / мид / оффлейн / поддержка / полная поддержка)
// и винрейт героя на каждой. Снимок Stratz лежит рядом с базой героев, а
// /api/dota/hero-positions отдаёт его же, но обновлённым раз в сутки.
// Позиции — это не то же самое, что теги OpenDota в h.roles: те описывают
// механику («эскейп», «нюкер»), а не линию, поэтому теги мы сохраняем.
const POSITIONS_LOCAL="/data/hero-positions.json";
const POSITIONS_API="/api/dota/hero-positions";
let heroPositions=null;
async function loadHeroPositions(){
  for(const url of [POSITIONS_API,POSITIONS_LOCAL]){
    try{
      const r=await fetch(url);
      if(!r.ok)continue;
      const j=await r.json();
      if(j&&j.heroes&&Object.keys(j.heroes).length){heroPositions=j;applyHeroPositions();return;}
    }catch(e){/* пробуем следующий источник */}
  }
}
function applyHeroPositions(){
  if(!heroPositions)return;
  for(const h of heroes){
    const e=heroPositions.heroes[String(h.id)];
    if(!e)continue;
    h.positions=e.positions;
    h.topPosition=e.topPosition;
    h.mainPositions=e.mainPositions||[];
  }
  renderStats();
}
// Роли героя словами: сначала позиции (если Stratz уже ответил),
// иначе теги OpenDota — чтобы строка никогда не оставалась пустой.
function positionText(h){
  const R=window.D2HRoles;
  if(!R||!h.mainPositions||!h.mainPositions.length)return '';
  return h.mainPositions.map(id=>(R.byId[id]||{}).ru).filter(Boolean).join(" / ");
}
async function loadHeroes(force=false){
  const status=document.getElementById('status');
  try{
    const r=await fetch(HEROES_LOCAL,force?{cache:'reload'}:undefined);
    if(!r.ok)throw new Error('heroes.json '+r.status);
    const j=await r.json();
    heroes=normalizeHeroes(j.heroes||[]);
    updateHeroUI('локальная база');
  }catch(err){
    console.warn('Hero loader:',err);
    if(typeof localHeroes==='function'){try{heroes=normalizeHeroes(localHeroes());updateHeroUI('резервная база');}catch(e){}}
    const cached=d2hReadCache('heroes');if(!heroes.length&&cached?.length){heroes=normalizeHeroes(cached);updateHeroUI('кэш');}
  }
  if(status&&heroes.length)status.textContent=`Загружено ${heroes.length} героев`;
  enrichProStats();
  loadHeroPositions();
}
function visibleItemCount(){
  const V=window.D2HItems;
  if(!V)return items.length;
  return items.filter(x=>!V.isHidden(x,itemCatalogByKey,itemVariantMaps.byKey)).length;
}
function updateItemCounters(){const n=visibleItemCount();d2hSetText('quickItemCount',n);d2hSetText('itemCountHero',n);document.getElementById('itemCountHero2')?.replaceChildren(document.createTextNode(n));}
// Каталог предметов целиком локальный. data/items-ru.json собирает
// tools/build-items-ru.py из официального русского datafeed Valve: названия,
// описания, история, примечания и бонусы уже на русском, числа подставлены.
// Никаких запросов к Valve/OpenDota в рантайме — поэтому каталог и модалка
// открываются мгновенно и одинаково на проде и в локальном превью.
let itemHeroIndex=null,heroItemIndex=null,heroItemMatches=0,itemsReadyResolve=null;
const itemsReady=new Promise(r=>{itemsReadyResolve=r;});
async function loadItems(force=false){
  const status=document.getElementById('itemStatus');
  try{
    const r=await fetch(ITEMS_LOCAL,force?{cache:'reload'}:undefined);
    if(!r.ok)throw new Error('items-ru.json '+r.status);
    const j=await r.json();
    items=Object.entries(j.items||{}).map(([name,v])=>({...v,name})).sort((a,b)=>String(a.dname).localeCompare(String(b.dname),'ru'));
    rebuildItemVariantMaps();renderItems();updateItemCounters();
    if(status)status.textContent=`Загружено ${items.length} предметов · русская база`;
  }catch(err){
    console.warn('Item loader:',err);
    if(typeof localItems==='function'){try{items=normalizeItems(localItems());rebuildItemVariantMaps();renderItems();updateItemCounters();}catch(e){}}
    if(status)status.textContent=items.length?`Загружено ${items.length} предметов · резервная база`:'База предметов не загрузилась.';
  }finally{if(itemsReadyResolve){itemsReadyResolve();itemsReadyResolve=null;}}
}
async function loadItemHeroIndex(){
  if(itemHeroIndex)return itemHeroIndex;
  try{const r=await fetch(ITEM_HEROES_LOCAL);itemHeroIndex=r.ok?((await r.json()).items||{}):{};}catch(e){itemHeroIndex={};}
  return itemHeroIndex;
}
async function loadHeroItemIndex(){
  if(heroItemIndex)return heroItemIndex;
  try{const r=await fetch(HERO_ITEMS_LOCAL);const j=r.ok?await r.json():{};heroItemIndex=j.heroes||{};heroItemMatches=Number(j.matchesUsed)||0;}catch(e){heroItemIndex={};}
  return heroItemIndex;
}
// Категория предмета. Раньше определялась по полю item_type из датафида
// Valve, которого в ответе OpenDota нет вовсе — поэтому на проде ВСЕ предметы
// попадали в «item», а фильтры «Компоненты», «Расходники», «Нейтральные» и
// «Рецепты» показывали пустую сетку. Теперь читаем те поля, которые реально
// приходят: qual, tier (уровень нейтрального) и префикс recipe_ в ключе.
function itemCategory(x){
  if(x&&x.cat)return x.cat;
  const n=String(x?.name||'').toLowerCase().replace(/^item_/,'');
  if(n.startsWith('recipe_'))return 'recipe';
  const tier=x?.tier??x?.neutral_item_tier;
  if(tier!==undefined&&tier!==null&&Number(tier)>0)return 'neutral';
  const q=String(x?.qual||'').toLowerCase();
  if(q.startsWith('consumable'))return 'consumable';
  if(q==='component')return 'component';
  const type=String(x?.item_type||x?.itemType||x?.category||'').toLowerCase();
  if(type.includes('consum'))return 'consumable';
  if(type.includes('component')||type.includes('basic'))return 'component';
  return 'item';
}
// Рецепт — отдельный покупаемый предмет, но собственной страницы у него нет:
// описывать там нечего, кроме цены. Поэтому карточка рецепта ведёт на предмет,
// который из него собирается: ключ рецепта — это ключ предмета с префиксом
// recipe_ (recipe_magic_wand -> magic_wand).
function recipeTarget(x){const n=String(x?.name||'').replace(/^item_/,'');return n.startsWith('recipe_')?n.slice(7):'';}
function itemHref(x){const t=recipeTarget(x);return '/item/'+itemSlug(t||x.name)+'/';}
// Dagon и Necronomicon лежат в каталоге как несколько записей с одинаковым
// названием — это уровни одного предмета. В сетке показываем одну карточку,
// а уровни расписываем здесь. Цены и шаг улучшения берутся из каталога.
function itemLevelsHtml(x){
  const V=window.D2HItems;
  if(!V)return '';
  const levels=V.levelsOf(V.bareKey(x),itemCatalogByKey);
  if(!levels.length)return '';
  const rows=levels.map(l=>`<div class="item-level"><b>${l.level}</b><span>${statValue(l.cost)} G</span><i>${l.step?'+'+statValue(l.step)+' G за улучшение':'базовый'}</i></div>`).join('');
  return `<div class="item-levels"><h4>Уровни улучшения</h4>
    <p class="item-levels-note">Предмет улучшается прямо в инвентаре: каждый следующий уровень покупается отдельно и усиливает все его показатели. Числа в характеристиках выше перечислены по уровням — от первого к последнему.</p>
    <div class="item-levels-grid">${rows}</div></div>`;
}
function itemCategoryLabel(x){const c=itemCategory(x);return ({item:'Предмет',component:'Компонент',consumable:'Расходник',neutral:'Нейтральный',recipe:'Рецепт'})[c]||'Предмет';}
// Текст на карточке каталога — первая строка русского описания из
// data/items-ru.json. Отдельный файл item-cards.json больше не нужен.
function itemDescriptionPreview(x){
  const t=itemDescriptionText(x);
  return t.length>105?t.slice(0,105).trim()+'…':t;
}
function renderItems(){
  const q=(document.getElementById('itemSearch')?.value||'').trim().toLowerCase();
  const category=window.itemCategoryFilter||'all';
  const V=window.D2HItems;
  const list=items.filter(x=>{
    // Рецепты и повторные уровни одного предмета в каталоге не показываем:
    // данные остаются в items-ru.json, но читателю они выглядят как дубли.
    if(V&&V.isHidden(x,itemCatalogByKey,itemVariantMaps.byKey))return false;
    const c=Number(x.cost||0);
    const priceOk=itemFilter==='all'||(itemFilter==='cheap'&&c<1000)||(itemFilter==='mid'&&c>=1000&&c<=2500)||(itemFilter==='expensive'&&c>2500);
    const cat=itemCategory(x);
    const catOk=category==='all'||cat===category||(category==='shop'&&cat==='item');
    const text=String(x.dname||'')+' '+itemDescriptionText(x)+' '+String(x.lore||'');
    return priceOk&&catOk&&text.toLowerCase().includes(q);
  });
  const grid=document.getElementById('itemsGrid');
  if(!grid)return;
  // Карточка ведёт на статическую страницу предмета — она проиндексирована
  // и показывает официальные данные Valve целиком, чего модалка не давала.
  grid.innerHTML=list.length?list.map(x=>{
    const preview=itemDescriptionPreview(x);
    const cat=itemCategory(x);
    return `<a class="item-card item-card-v2" href="${escapeHtml(itemHref(x))}" data-item="${escapeHtml(x.name)}">
      <div class="item-card-art"><img loading="lazy" src="${itemImage(x)}" alt="${escapeHtml(x.dname)}"></div>
      <div class="item-card-body"><div class="item-card-title"><strong>${escapeHtml(x.dname)}</strong><span>${x.cost?statValue(x.cost)+' G':'—'}</span></div>${preview?`<p>${escapeHtml(preview)}</p>`:''}<div class="item-card-foot"><small>${x.id?`ID ${escapeHtml(x.id)}`:'Dota 2 item'}</small><b>${recipeTarget(x)?'К предмету →':'Подробнее →'}</b></div></div>
    </a>`;
  }).join(''):'<div class="empty item-empty-state"><strong>Предмет не найден</strong><span>Измени запрос или фильтр.</span></div>';
  const counter=document.getElementById('itemVisibleCount');if(counter)counter.textContent=statValue(list.length);
}
function statValue(v){return Number(v||0).toLocaleString('ru-RU');}
function updateHeroUI(source){heroes=heroes.filter(Boolean);d2hSetText('heroCount',heroes.length);d2hSetText('quickHeroCount',heroes.length);d2hSetText('heroRoleCount',(window.D2HRoles?window.D2HRoles.ROLES.length:5));d2hSetText('status',`Загружено ${heroes.length} героев · ${source}`);const fb=document.getElementById('freshBadge');if(fb)fb.textContent=`🟢 Live · ${heroes.length} героев из OpenDota`;renderHeroSpotlight();renderHeroes();renderFeaturedHeroes();renderStats();quickPrepOptions();}
function renderHeroSpotlight(){const el=document.getElementById('featured');if(!el||!heroes.length)return;let pool=heroes.filter(h=>h&&h.localized_name);if(pool.length>1&&spotlightHeroId!=null)pool=pool.filter(h=>Number(h.id)!==Number(spotlightHeroId));const h=pool[Math.floor(Math.random()*pool.length)]||heroes[0];spotlightHeroId=h.id;el.innerHTML=`<img src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}"><div class="ftext"><small>HERO SPOTLIGHT · СЛУЧАЙНЫЙ ГЕРОЙ</small><h3>${escapeHtml(h.localized_name)}</h3><p>${escapeHtml(roleText(h))} · ${escapeHtml(h.attack_type||'Dota 2 герой')} · открыть полный профиль →</p></div>`;el.onclick=()=>{location.href='/hero/'+slugForHero(h)+'/';};el.style.cursor='pointer';if(spotlightTimer)clearTimeout(spotlightTimer);spotlightTimer=setTimeout(()=>renderHeroSpotlight(),15000);}
// Карточка ведёт на статическую страницу героя: она проиндексирована и
// содержит описание, а модальное окно этого не давало.
function heroCard(h,mini=false){const a=attrInfo(h.primary_attr),name=escapeHtml(h.localized_name);return `<a class="hero-card ${mini?'mini-hero-card':''}" href="/hero/${escapeHtml(slugForHero(h))}/" aria-label="${name}" data-id="${h.id}"><img loading="lazy" src="${imageUrl(h)}" alt="${name}"><div class="hero-info"><div class="hero-name">${name}<span class="hr-badges" data-hero-badges="${h.id}"></span></div><div class="hero-role">${escapeHtml(roleText(h))}</div><span class="attr">${a[0]} ${escapeHtml(a[1])}</span></div></a>`;}
function renderHeroes(){const q=(document.getElementById('search')?.value||'').trim().toLowerCase();const list=heroes.filter(h=>(filter==='all'||h.primary_attr===filter)&&(h.localized_name||'').toLowerCase().includes(q));d2hSetHtml('heroesGrid',list.length?list.map(h=>heroCard(h)).join(''):'<div class="empty">Герой не найден 😢</div>');}
function renderFeaturedHeroes(){const el=document.getElementById('featuredHeroesGrid');if(!el)return;const picks=heroes.filter(h=>h.pro_pick>0).sort((a,b)=>wrScore(b)-wrScore(a)).slice(0,4);const arr=picks.length?picks:heroes.slice(0,4);el.innerHTML=arr.map(h=>`<article class="featured-hero-card" data-id="${h.id}"><img src="${imageUrl(h)}" alt=""><div><b>${escapeHtml(h.localized_name)}</b><small>${escapeHtml(roleText(h))}</small><span>${h.pro_pick?winrate(h).toFixed(1)+'% pro WR · '+h.pro_pick+' пик.':'Профиль героя'}</span></div></article>`).join('');}
// Самые покупаемые предметы — из того же локального индекса. Раньше блок
// опрашивал OpenDota по десяти героям и на статике показывал «Выборка: 0».
function renderItemAnalytics(rows){
  const el=document.getElementById('itemAnalytics');if(!el)return;
  el.innerHTML=`<div class="stats-item-analytics"><div class="stats-analytics-head"><div><span>ITEM ANALYTICS</span><h3>📦 Самые покупаемые предметы</h3></div><small>Выборка: ${rows.length} предметов</small></div><div class="stats-item-table">${rows.map((r,i)=>`<button data-item-analytics="${escapeHtml(r.item.name)}"><span class="rank">${i+1}</span><img src="${itemImage(r.item)}" alt=""><span class="item-a-name"><b>${escapeHtml(r.item.dname)}</b><small>${r.heroes} героев · чаще: ${escapeHtml(r.bestPhase)}</small></span><strong>${statValue(r.games)}</strong></button>`).join('')}</div></div>`;
  el.querySelectorAll('[data-item-analytics]').forEach(b=>b.onclick=()=>openItem(b.dataset.itemAnalytics));
}
async function loadItemAnalytics(){
  const el=document.getElementById('itemAnalytics');if(!el)return;
  await itemsReady;
  const idx=await loadItemHeroIndex();
  const rows=Object.entries(idx).map(([id,r])=>({item:findItemById(id),games:Number(r.games||0),heroes:Number(r.heroCount||0),bestPhase:Object.entries(r.totals||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||'Середина'})).filter(r=>r.item&&r.games).sort((a,b)=>b.games-a.games).slice(0,12);
  if(rows.length)renderItemAnalytics(rows);
  else el.innerHTML='<div class="stats-analytics-loading">Данные о покупках не загрузились.</div>';
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
    &&(role==='all'||(role.startsWith('POSITION_')?(h.mainPositions||[]).includes(role):(h.roles||[]).includes(role))));
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
// Адрес гайда — /guide/<slug>/, кроме карточек со своим href: словарь терминов
// живёт на /glossary/, и без этого ссылка вела на несуществующий /guide/glossary/.
function guideHref(g){return g.href||`/guide/${g.slug}/`;}
function renderGuides(){const list=guideData.filter(g=>guideFilter==='all'||g.cat===guideFilter);d2hSetHtml('guidesGrid',list.map(g=>`<article class="guide-card guide-rich-card"><div class="guide-art">${g.icon}</div><div><span>${g.tag}</span><h3><a href="${guideHref(g)}" style="color:inherit;text-decoration:none;">${g.title}</a></h3><p>${g.text}</p><a class="btn ghost guide-open" href="${guideHref(g)}">Читать гайд →</a></div><b>↗</b></article>`).join(''));}
function randomHero(){if(!heroes.length)return;const h=heroes[Math.floor(Math.random()*heroes.length)];const rt=document.getElementById('randomToolText');if(rt)rt.textContent=`Сегодня судьба выбрала ${h.localized_name}. ${roleText(h)}.`;openHero(h.id);}
// Строка пяти позиций в карточке героя. Пусто, пока снимок не загружен —
// показывать рамку без чисел хуже, чем не показывать ничего.
// Роли и базовые статы — один блок с общей сеткой колонок, как на странице
// героя. Если снимок позиций ещё не пришёл, показываем одни статы: пустая
// рамка вместо чисел хуже, чем её отсутствие.
function heroRolesRowHtml(h,stats){
  const R=window.D2HRoles;
  const e=(R&&heroPositions)?heroPositions.heroes[String(h.id)]:null;
  const row=e?R.rowHtml(e,{escapeHtml}):'';
  const statCells=(stats||[]).map(x=>`<div><small>${escapeHtml(String(x.k))}</small><strong>${escapeHtml(String(x.v))}</strong></div>`).join('');
  const note=(row&&R)?`<p class="hr-note">${escapeHtml(R.sourceNote(heroPositions))}</p>`:'';
  return `<section class="hp-bars detail-bars">${row}<div class="hp-statbar-grid"><div class="hs-label"><small>Базовые</small><strong>статы</strong></div>${statCells}</div>${note}</section>`;
}
function heroStats(h){return [{k:'HP',v:h.base_health!=null?h.base_health:(h.base_str||0)*22+120},{k:'Mana',v:h.base_mana!=null?h.base_mana:(h.base_int||0)*12+75},{k:'Armor',v:h.base_agi!=null?(h.base_agi/6).toFixed(1):'—'},{k:'Damage',v:h.base_attack_min!=null?`${h.base_attack_min}–${h.base_attack_max}`:'—'},{k:'Move Speed',v:h.move_speed||'—'}];}

// --- Quick Prep: "60 секунд до пика" ---
function quickPrepOptions(){const dl=document.getElementById('quickPrepHeroes');if(dl)dl.innerHTML=heroes.map(h=>`<option value="${escapeHtml(h.localized_name)}">`).join('');const chipsEl=document.getElementById('quickPrepChips');if(chipsEl){const top=[...heroes].filter(h=>Number(h.pro_pick||0)>0).sort((a,b)=>Number(b.pro_pick||0)-Number(a.pro_pick||0)).slice(0,5);const arr=top.length?top:heroes.slice(0,5);chipsEl.innerHTML=`<small>Попробуй:</small>`+arr.map(h=>`<button type="button" class="chip" data-quick-hero="${h.id}">${escapeHtml(h.localized_name)}</button>`).join('');}}
function renderQuickPrep(h){
  const el=document.getElementById('quickPrepResult');if(!el)return;
  if(!h){el.innerHTML='<div class="quick-prep-empty">Выбери героя выше или нажми на одну из подсказок — покажем контрпики, реальные покупки и pro winrate за секунду.</div>';return;}
  const proLine=h.pro_pick?`${winrate(h).toFixed(1)}% pro WR · ${statValue(h.pro_pick)} picks · ${statValue(h.pro_ban)} banов`:'Нет pro-данных по этому герою — пока играют реже в топ-матчах';
  el.innerHTML=`<button type="button" class="qp-hero" data-hero-open="${h.id}"><img src="${imageUrl(h)}" alt=""><div><b>${escapeHtml(h.localized_name)}</b><small>${escapeHtml(roleText(h))}</small><span>${proLine}</span></div><i class="qp-hero-go" aria-hidden="true">→</i></button>
  <div class="qp-cols">
    <div><h4>Кто контрит ${escapeHtml(h.localized_name)}</h4><div class="qp-list" id="qpCounters"><p class="muted">Загружаем матчапы…</p></div></div>
    <div><h4>Что покупают на ${escapeHtml(h.localized_name)}</h4><div class="qp-list" id="qpBuild"><p class="muted">Загружаем покупки…</p></div></div>
  </div>`;
  fillQuickPrepCounters(h);
  fillQuickPrepBuild(h);
}

/**
 * Контрпики из настоящих матчапов: герои, против которых этот герой
 * выигрывает реже всего. Рядом — его винрейт против них и число матчей,
 * чтобы было видно, на чём основана цифра.
 */
/**
 * Контрпики в карточке героя — те же настоящие матчапы, но КНОПКАМИ:
 * клик открывает соседнего героя в том же окне. Карточка существует ровно
 * для того, чтобы смотреть героев не уходя с формы, и ссылка здесь этот
 * смысл ломала бы. В быстрой подготовке наоборот — там ссылки уместны.
 */
async function fillHeroCounters(h){ return renderCountersInto('heroCounters', h, {asLinks:false}); }

async function fillQuickPrepCounters(h){ return renderCountersInto('qpCounters', h, {asLinks:false}); }

async function renderCountersInto(boxId, h, opts){
  const box=document.getElementById(boxId);if(!box)return;
  const asLinks=!opts||opts.asLinks!==false;
  const idx=await loadHeroCounters();
  const rec=idx[String(h.id)];
  const rows=(rec&&rec.against||[]).slice(0,8);
  if(!rows.length){box.innerHTML='<p class="muted">По этому герою пока мало матчей для надёжных матчапов.</p>';return;}
  box.innerHTML=rows.map(r=>{
    const x=heroes.find(z=>Number(z.id)===Number(r.id));
    if(!x)return '';
    const inner=`<img loading="lazy" src="${imageUrl(x)}" alt=""><span><b>${escapeHtml(x.localized_name)}<span class="hr-badges" data-hero-badges="${x.id}"></span></b><i>${r.w.toFixed(1).replace('.',',')}% побед вместо ожидаемых ${(r.e!=null?r.e:r.w).toFixed(1).replace('.',',')}% · ${statValue(r.g)} матчей</i></span>`;
    return asLinks
      ? `<a class="qp-row" href="/hero/${escapeHtml(slugForHero(x))}/">${inner}</a>`
      : `<button type="button" class="qp-row" data-hero-open="${x.id}">${inner}</button>`;
  }).filter(Boolean).join('');
  // Контрпики подгружаются уже после отрисовки карточки, поэтому обработчики
  // вешаем здесь, а не один раз при открытии окна.
  if(!asLinks){
    box.querySelectorAll('[data-hero-open]').forEach(b=>b.onclick=()=>openHero(Number(b.dataset.heroOpen)));
  }
}

/**
 * Покупки из data/hero-items.json — своя база матчей (tools/build-hero-items.js),
 * разложенная по стадиям игры. Раньше здесь стоял список из трёх
 * предметов, захардкоженный на роль: у всех керри он был одинаковый.
 */
async function fillQuickPrepBuild(h){
  const box=document.getElementById('qpBuild');if(!box)return;
  const rec=(await loadHeroItemIndex())[String(h.id)];
  if(!rec){box.innerHTML='<p class="muted">По этому герою нет данных о покупках.</p>';return;}
  const phases=[['start','Старт'],['early','Ранняя'],['mid','Середина'],['late','Поздняя'],['vlate','После 40 мин']];
  const html=phases.map(([k,label])=>{
    const rows=(rec[k]||[]).slice(0,5).map(r=>{
      const it=findItemById(r.i);
      if(!it)return '';
      // кнопка, а не ссылка: клик открывает форму предмета, не уводя со страницы
      return `<button type="button" class="qp-item" data-item-open="${escapeHtml(it.name)}" title="${escapeHtml(it.dname)} · ${statValue(r.g)} покупок"><img loading="lazy" src="${itemImage(it)}" alt="${escapeHtml(it.dname)}"><em>${statValue(r.g)}</em></button>`;
    }).filter(Boolean).join('');
    return rows?`<div class="qp-phase"><h5>${label}</h5><div class="qp-items">${rows}</div></div>`:'';
  }).filter(Boolean).join('');
  box.innerHTML=html||'<p class="muted">По этому герою нет данных о покупках.</p>';
}

function quickPrepSelectByName(name){const q=String(name||'').trim().toLowerCase();if(!q){renderQuickPrep(null);return;}const h=heroes.find(x=>x.localized_name.toLowerCase()===q);if(h)renderQuickPrep(h);}

// Карты «уровень предмета -> базовый предмет». Строятся один раз по
// загруженному каталогу (js/item-variants.js), правилом, а не списком.
let itemVariantMaps={byKey:{},byId:{}};
function rebuildItemVariantMaps(){
  const V=window.D2HItems; if(!V)return;
  const cat={}; for(const it of items) cat[V.bareKey(it)]=it;
  itemCatalogByKey=cat;
  itemVariantMaps=V.buildVariantMaps(cat);
}
let itemCatalogByKey={};
// Билды и покупки ссылаются на предметы по id, в том числе на уровни
// (Dagon 2–5 — это id 201–204). Карточка теперь одна, поэтому такие id
// сводим к базовому предмету, иначе ссылка просто не найдётся.
function findItemById(id){
  const n=Number(id);
  const base=itemVariantMaps.byId[n];
  const want=base!=null?base:n;
  return items.find(i=>Number(i.id)===want);
}
function phaseTitle(k){return ({start:'Старт · до 0:00',early:'Ранняя · 0–10 мин',mid:'Середина · 10–25 мин',late:'Поздняя · 25–40 мин',vlate:'Финал · 40+ мин'})[k]||k;}
// Покупки предметов по фазам игры — data/hero-items.json, своя база матчей
// (tools/build-hero-items.js). n — матчи героя, g — в скольких куплен предмет.
// pos — 'all' или 'POSITION_n'. По роли: свой список из нашей базы, если у роли
// ≥ minRole матчей; иначе, если у Stratz есть билд этой роли, — его предметы
// (Divine/Immortal, среднее время покупки); иначе — все роли с пояснением.
const HERO_ROLE_RU={POSITION_1:'Керри',POSITION_2:'Мид',POSITION_3:'Оффлейн',POSITION_4:'Поддержка',POSITION_5:'Полная поддержка'};
const heroBuildCache={};
function loadHeroBuild(id){
  if(!heroBuildCache[id])heroBuildCache[id]=fetch(`/data/builds/${Number(id)}.json`).then(r=>r.ok?r.json():null).catch(()=>null);
  return heroBuildCache[id];
}
function itemPhasesHtml(rec){
  const n=Number(rec.n)||0;
  return ['start','early','mid','late','vlate'].filter(ph=>(rec[ph]||[]).length).map(ph=>{
    const rows=rec[ph].map(r=>{const it=findItemById(r.i);return it?`<button class="item-pop-row" data-item-pop="${escapeHtml(it.name)}"><img src="${itemImage(it)}" alt=""><span><b>${escapeHtml(it.dname)}</b><small>${n?`${Math.round(r.g/n*100)}% · ${statValue(r.g)} из ${statValue(n)}`:`${statValue(r.g)} игр`}</small></span></button>`:'';}).join('');
    return `<div class="item-pop-phase"><h4>${phaseTitle(ph)}</h4>${rows||'<p class="muted">Нет данных</p>'}</div>`;
  }).join('');
}
function stratzItemsHtml(items){
  const block=(title,list)=>{const rows=(list||[]).slice(0,6).map(r=>{const it=findItemById(r.itemId);return it?`<button class="item-pop-row" data-item-pop="${escapeHtml(it.name)}"><img src="${itemImage(it)}" alt=""><span><b>${escapeHtml(it.dname)}</b><small>~${r.avgMinute} мин · ${statValue(r.matches)} покупок</small></span></button>`:'';}).join('');return rows?`<div class="item-pop-phase"><h4>${title}</h4>${rows}</div>`:'';};
  return block('Основные',items&&items.core)+block('Ситуативные',items&&(items.situational||items.situation||items.luxury));
}
async function loadHeroItemPopularity(heroId,pos='all'){
  const box=document.getElementById('heroItemPopularity');if(!box)return;
  const rec=(await loadHeroItemIndex())[String(heroId)];
  if(!rec){box.innerHTML='<div class="item-pop-loading">По этому герою нет данных о покупках.</div>';return;}
  const p=pos==='all'?null:pos.replace('POSITION_','');
  const own=p&&rec.pos&&rec.pos[p];
  let head,body,note='';
  if(!p||own){
    const r=own||rec,n=Number(r.n)||0;
    head=`Своя база матчей текущего патча${p?` · роль «${HERO_ROLE_RU[pos]}»`:''} · матчей героя${p?' на роли':''}: ${statValue(n)}${!p&&heroItemMatches?` из ${statValue(heroItemMatches)}`:''} · % — доля его матчей с покупкой`;
    body=itemPhasesHtml(r);
  }else{
    const b=await loadHeroBuild(heroId);const v=b&&b.positions&&b.positions[pos];
    if(v&&v.items){head=`Роль «${HERO_ROLE_RU[pos]}»: в нашей базе ${statValue(rec.posN&&rec.posN[p]||0)} матчей на роли — мало для своего списка, поэтому предметы по данным Stratz (Divine/Immortal, ${statValue(v.matches)} матчей на роли): среднее время и число покупок`;body=stratzItemsHtml(v.items);}
    else{head=`Своя база · все роли · матчей героя: ${statValue(rec.n)}`;note=`<p class="muted">На роли «${HERO_ROLE_RU[pos]}» мало матчей — показаны покупки по всем ролям.</p>`;body=itemPhasesHtml(rec);}
  }
  box.innerHTML=`<div class="item-pop-head"><div><h3>📦 Реальные покупки предметов</h3><p>${head}</p>${note}</div></div><div class="item-pop-grid">${body}</div>`;
  box.querySelectorAll('[data-item-pop]').forEach(b=>b.onclick=()=>openItem(b.dataset.itemPop));
}
// Строка ролей в карточке: роль кликабельна, если для неё есть свой список
// покупок (≥ minRole матчей) или билд Stratz; клик меняет блок покупок.
async function bindHeroRoleSwitch(h){
  const R=window.D2HRoles;const row=document.querySelector('#modalContent [data-hero-roles]');
  if(!R||!R.bindSwitch||!row)return;
  const [idx,b]=await Promise.all([loadHeroItemIndex(),loadHeroBuild(h.id)]);
  if(!document.body.contains(row))return;
  const rec=idx[String(h.id)]||{};const avail={};
  for(const pos of Object.keys(HERO_ROLE_RU)){
    const p=pos.slice(-1);
    avail[pos]=(rec.pos&&rec.pos[p])||(b&&b.positions&&b.positions[pos])?true:`Мало матчей для своего билда: в нашей базе ${rec.posN&&rec.posN[p]||0}, у Stratz меньше 300 Divine/Immortal`;
  }
  R.bindSwitch(row,avail,pos=>loadHeroItemPopularity(h.id,pos));
}
// Иконка способности: имя файла совпадает с внутренним ключом способности.
function abilityIcon(key){return `/assets/abilities/${encodeURIComponent(key)}.png`;}
// В текстах Valve встречаются литералы \n, теги <br> и двойные %% — чистим их и режем текст на абзацы.
// Служебную строку «ТИП РАЗВЕИВАНИЯ: …» выносим из текста отдельной меткой, чтобы карточки читались ровнее.
function abilityParts(raw){const lines=String(raw||'').replace(/<\s*br\s*\/?\s*>/gi,'\n').replace(/\\n/g,'\n').replace(/<[^>]*>/g,'').replace(/%%/g,'%').replace(/[ \t]+/g,' ').split('\n').map(s=>s.trim()).filter(Boolean);let dispel='';if(lines.length){const m=lines[lines.length-1].match(/^ТИП\s+РАЗВЕИВАНИЯ\s*:\s*(.+)$/i);if(m){dispel=m[1];lines.pop();}}return{paras:lines,dispel};}
// Снимок способностей всех героев (tools/fetch-hero-abilities.js).
// Способности меняются только с патчами, поэтому обновляется раз в 90 дней,
// а карточка героя больше не ходит в сеть на каждое открытие.
const ABILITIES_LOCAL="/data/hero-abilities.json";
let heroAbilitiesSnapshot=null,heroAbilitiesPromise=null;
function loadAbilitiesSnapshot(){
  if(heroAbilitiesSnapshot)return Promise.resolve(heroAbilitiesSnapshot);
  if(!heroAbilitiesPromise){
    heroAbilitiesPromise=fetch(ABILITIES_LOCAL)
      .then(r=>r.ok?r.json():Promise.reject(new Error('HTTP '+r.status)))
      .then(j=>{heroAbilitiesSnapshot=j&&j.heroes?j.heroes:{};return heroAbilitiesSnapshot;})
      .catch(()=>({}));
  }
  return heroAbilitiesPromise;
}
async function loadHeroAbilities(h){
  const box=document.getElementById('heroAbilities');if(!box)return;
  try{
    const snap=await loadAbilitiesSnapshot();
    let list=snap[String(h.id)];
    // Запасной путь: герой появился после последнего снимка — берём живьём.
    if(!Array.isArray(list)||!list.length){
      const r=await fetch(`/api/dota/hero/${encodeURIComponent(h.name)}/abilities`);
      if(!r.ok)throw new Error('HTTP '+r.status);
      list=await r.json();
    }
    if(!Array.isArray(list)||!list.length){box.innerHTML='<div class="item-pop-loading">Способности героя временно недоступны.</div>';return;}
    box.innerHTML=list.map((x,i)=>{const {paras,dispel}=abilityParts(x.desc);const body=(paras.length?paras:['Описание пока недоступно.']).map(p=>`<p>${escapeHtml(p)}</p>`).join('');return `<article class="ability-card"><div class="ability-art"><img loading="lazy" src="${abilityIcon(x.key)}" alt=""><span>${i+1}</span></div><div class="ability-body"><b>${escapeHtml(x.dname)}</b>${body}${dispel?`<span class="ability-tag">Развеивание: ${escapeHtml(dispel.toLowerCase())}</span>`:''}</div></article>`;}).join('');
  }catch(e){
    box.innerHTML='<div class="item-pop-loading">Способности героя временно недоступны. Профиль героя продолжает работать.</div>';
  }
}

// Разделы гайда по конкретному герою: страница /hero/<slug>/guide/ собирается
// build-hero-guides.js, якоря заданы там же.
function heroGuideLinks(h){const b='/hero/'+slugForHero(h)+'/guide/';return [
  {href:b+'#kak-igrat',title:'Как играть',text:'Роль, тип атаки и с чего начинать'},
  {href:b+'#osobennosti',title:'Особенности',text:'Способности и базовые показатели'},
  {href:b+'#zakupy',title:'Варианты закупов',text:'Реальные покупки по стадиям игры'},
  {href:b+'#kogo-kontrit',title:'Кого контрит',text:'Против кого статистика лучше'},
  {href:b+'#kto-kontrit',title:'Кто контрит',text:'Против кого статистика хуже'},
];}
function openHero(id){const h=heroes.find(x=>Number(x.id)===Number(id));if(!h)return;lastFocusedEl=document.activeElement;const a=attrInfo(h.primary_attr),stats=heroStats(h);document.getElementById('modalContent').innerHTML=`<div class="hero-detail"><div class="hero-cover"><a class="hero-cover-art" href="/hero/${escapeHtml(slugForHero(h))}/"><img src="${imageUrl(h)}" alt="${escapeHtml(h.localized_name)}"></a><div><div class="eyebrow">HERO PROFILE</div><h2><a href="/hero/${escapeHtml(slugForHero(h))}/">${escapeHtml(h.localized_name)}</a></h2><p>${a[0]} ${a[1]} · ${escapeHtml(h.attack_type||'Тип атаки')} · ${escapeHtml(roleText(h))}</p><div class="hero-detail-actions"><a class="btn red" href="/hero/${escapeHtml(slugForHero(h))}/">Страница героя →</a><a class="btn ghost" href="/hero/${escapeHtml(slugForHero(h))}/guide/">Гайд по герою →</a></div></div></div>${heroRolesRowHtml(h,stats)}<div class="detail-section"><h3>Кто его контрит</h3><div class="qp-list" id="heroCounters"><p class="muted">Загружаем матчапы…</p></div></div><div class="detail-section item-popularity-section" id="heroItemPopularity"><div class="item-pop-loading">Загружаем реальные покупки предметов…</div></div><div class="detail-section"><h3>Способности</h3><div class="ability-grid" id="heroAbilities"><div class="item-pop-loading">Загружаем реальные способности героя…</div></div></div><div class="detail-section"><h3>Гайд по герою</h3><div class="hero-guide-links">${heroGuideLinks(h).map(g=>`<a href="${g.href}"><b>${g.title}</b><small>${g.text}</small><span>→</span></a>`).join('')}</div></div></div>`;document.getElementById('modal').classList.add('show');document.getElementById('close').focus();document.querySelectorAll('[data-hero-open]').forEach(b=>b.onclick=()=>openHero(Number(b.dataset.heroOpen)));document.querySelectorAll('[data-item-by-name]').forEach(b=>b.onclick=()=>{const term=b.dataset.itemByName.toLowerCase();const x=items.find(i=>String(i.dname).toLowerCase().includes(term.split(' ')[0]));if(x)openItem(x.name);});loadHeroItemPopularity(h.id);bindHeroRoleSwitch(h);loadHeroAbilities(h);fillHeroCounters(h);}
function closeModal(){document.getElementById('modal').classList.remove('show');if(lastFocusedEl?.focus)lastFocusedEl.focus();}
// Данные о предметах больше не догружаются из сети: описание, история,
// примечания, бонусы и картинка приходят из data/items-ru.json, который
// собирает tools/build-items-ru.py из официального русского datafeed Valve.
// Поэтому функции похода за Valve datafeed (кэш в localStorage, разбор
// special_values, «обновить данные») удалены целиком — они больше ничего не
// обслуживали и только расходились бы с локальной базой.
// --- Item counters: what commonly beats/negates this item, by mechanic. This
// is a curated, editorial list (not derived from OpenDota/Valve data — there
// is no public feed for "counters"), so it stays short and only lists
// well-established, uncontroversial mechanics rather than guessing at every
// possible interaction. Keyed by the item's internal name with any leading
// "item_" stripped (itemKey()), same normalization itemSlug() already uses,
// since different data sources disagree on whether that prefix is present.
function itemKey(x){return String((typeof x==='string'?x:x?.name)||'').replace(/^item_/,'').toLowerCase();}
const ITEM_COUNTERS={
  black_king_bar:[{k:'silver_edge',why:'Break не даёт активировать новую неуязвимость к магии на время действия'},{k:'abyssal_blade',why:'тот же эффект Break, что и у Silver Edge, плюс стан следом'},{k:'bloodthorn',why:'заглушение мешает активировать BKB до того, как эффект сработает'},{k:'orchid',why:'заглушение мешает активировать BKB до того, как эффект сработает'}],
  blink:[{k:'force_staff',why:'мгновенно отбрасывает инициатора сразу после блинка, разрывая комбо'},{k:'hurricane_pike',why:'отталкивает противника на дальность, не давая продолжить атаку в упор'}],
  invis_sword:[{k:'ward_sentry',why:'страж наблюдения раскрывает невидимость в своём радиусе'},{k:'gem',why:'даёт истинный взгляд, невидимость больше не скрывает'},{k:'dust',why:'подсвечивает и замедляет невидимого противника'}],
  silver_edge:[{k:'ward_sentry',why:'страж наблюдения раскрывает невидимость Silver Edge'},{k:'gem',why:'истинный взгляд снимает невидимость'},{k:'dust',why:'подсвечивает невидимого противника'}],
  heart:[{k:'urn_of_shadows',why:'дебафф на лечение резко снижает восстановление здоровья от Heart'},{k:'spirit_vessel',why:'сильнее снижает лечение и дополнительно наносит урон от здоровья'}],
  satanic:[{k:'orchid',why:'заглушение не даёт активировать лечение Satanic вовремя'},{k:'bloodthorn',why:'заглушение не даёт активировать лечение Satanic вовремя'}],
  butterfly:[{k:'monkey_king_bar',why:'гарантированное попадание игнорирует уклонение Butterfly'},{k:'bloodthorn',why:'атака после применения активки всегда попадает, игнорируя уклонение'}],
  manta:[{k:'radiance',why:'периодический урон по площади убивает иллюзии почти мгновенно'},{k:'mjollnir',why:'цепной удар молнии выкашивает иллюзии за один прок'},{k:'maelstrom',why:'цепной удар молнии выкашивает иллюзии за один прок'}],
  necronomicon:[{k:'radiance',why:'урон по площади быстро убивает призванных существ'},{k:'mjollnir',why:'цепной урон быстро убивает призванных существ'},{k:'bfury',why:'сплеш-урон от каждой атаки выкашивает слабых существ'}],
  sphere:[{k:'shivas_guard',why:'Linken’s Sphere блокирует только одноцелевые эффекты — площадные проходят'},{k:'radiance',why:'постоянный урон по площади не является «одиночным эффектом» и не блокируется сферой'}],
  lotus_orb:[{k:'shivas_guard',why:'Lotus Orb отражает только одноцелевые способности — площадные не блокируются'},{k:'radiance',why:'урон по площади не отражается Lotus Orb'}]
};
function itemCounterEntries(x){
  const list=ITEM_COUNTERS[itemKey(x)];if(!Array.isArray(list)||!list.length)return [];
  return list.map(e=>({item:items.find(i=>itemKey(i)===e.k),why:e.why})).filter(e=>e.item);
}
function renderItemCounters(x){
  const entries=itemCounterEntries(x);
  if(!entries.length){
    return '';
  }
  return `<div class="item-counters-list">${entries.map(e=>`<button class="item-counter-row" data-item-open="${escapeHtml(e.item.name)}"><img src="${itemImage(e.item)}" alt=""><span><b>${escapeHtml(e.item.dname)}</b><small>${escapeHtml(e.why)}</small></span></button>`).join('')}</div>`;
}
function itemDescriptionText(x){return (x?.desc||[]).map(b=>[b.h,b.t].filter(Boolean).join('. ')).join(' ').replace(/\s+/g,' ').trim();}
function itemDescBlocks(x){return (x?.desc||[]).map(b=>`<div class="ip-block">${b.h?`<h4>${escapeHtml(b.h)}</h4>`:''}${(b.t||'').split('\n').filter(Boolean).map(t=>`<p>${escapeHtml(t)}</p>`).join('')}</div>`).join('')||'<p class="muted">Описание отсутствует.</p>';}
function itemMetaChips(x){const out=[];if(x.cost)out.push(`💰 ${statValue(x.cost)} золота`);else if(x.cat==='neutral')out.push(`Нейтральный${x.tier?` · тир ${x.tier}`:''}`);if(x.mc)out.push(`Мана ${statValue(x.mc)}`);if(x.cd)out.push(`Перезарядка ${x.cd} сек`);if(x.charges)out.push(`Зарядов: ${x.charges}`);return out;}
function itemLinkChips(list){return (list||[]).map(k=>{const it=items.find(i=>i.name===k);return it?`<button class="ip-chip" data-item-open="${escapeHtml(it.name)}"><img src="${itemImage(it)}" alt="">${escapeHtml(it.dname)}</button>`:'';}).join('');}
// Связь «предмет -> герои» посчитана заранее (tools/build-item-heroes.py) по тем
// же данным OpenDota, что и гайды. В рантайме — ни одного запроса.
function itemHeroUsage(x){
  const rec=(itemHeroIndex||{})[String(x.id)];
  if(!rec||!(rec.heroes||[]).length)return '<p class="muted">Заметной статистики покупок по этому предмету нет.</p>';
  const rows=rec.heroes.map(r=>{const h=heroes.find(z=>Number(z.id)===Number(r.h));return `<button data-hero-open="${r.h}">${h?`<img src="${imageUrl(h)}" alt="">`:''}<span><b>${escapeHtml(r.n)}</b><small>${statValue(r.g)} покупок · чаще: ${escapeHtml(r.p)}</small></span></button>`;}).join('');
  const bars=['Старт','Ранняя','Середина','Поздняя'].map(p=>`<div><span>${p}</span><b>${statValue((rec.totals||{})[p]||0)}</b></div>`).join('');
  return `<div class="item-hero-links">${rows}</div><div class="item-phase-bars">${bars}</div>`;
}
async function openItem(name){
  const key=String(name||'').replace(/^item_/,'');
  const x=items.find(i=>i.name===key)||items.find(i=>String(i.dname).toLowerCase()===key.toLowerCase());
  if(!x)return;
  lastFocusedEl=document.activeElement;
  await loadItemHeroIndex();
  const page='/item/'+itemSlug(x.recipeFor||x.name)+'/';
  const own=x.descOwn||x.loreOwn;
  document.getElementById('modalContent').innerHTML=`
    <div class="item-profile-v3">
      <div class="item-profile-top">
        <div class="item-profile-art"><img src="${itemImage(x)}" alt="${escapeHtml(x.dname)}"></div>
        <div class="item-profile-title">
          <div class="eyebrow">ПРЕДМЕТ DOTA 2</div>
          <h2><a href="${escapeHtml(page)}">${escapeHtml(x.dname)}</a></h2>
          <div class="item-profile-meta">${itemMetaChips(x).map(c=>`<span>${escapeHtml(c)}</span>`).join('')}<span>ID ${x.id}</span></div>
          <p class="item-profile-sub">Описание, история и числа — официальная русская версия Valve. Всё хранится на сайте, ничего не подгружается со стороны.</p>
          <div class="item-profile-actions"><a class="btn red" href="${escapeHtml(page)}">Страница предмета →</a></div>
        </div>
      </div>
      <div class="item-profile-grid">
        <section class="item-profile-panel item-profile-description">
          <div class="item-panel-head"><div><span>ОПИСАНИЕ</span><h3>Что делает предмет</h3></div></div>
          ${itemDescBlocks(x)}
          ${x.notes&&x.notes.length?`<div class="item-notes"><h4>Примечания</h4>${x.notes.map(n=>`<p>• ${escapeHtml(n)}</p>`).join('')}</div>`:''}
        </section>
        <section class="item-profile-panel">
          <div class="item-panel-head"><div><span>ХАРАКТЕРИСТИКИ</span><h3>Что даёт в цифрах</h3></div></div>
          ${x.attr&&x.attr.length?`<div class="item-official-facts">${x.attr.map(a=>`<div><strong>${escapeHtml(a)}</strong></div>`).join('')}</div>`:'<p class="muted">Постоянных бонусов к характеристикам у предмета нет.</p>'}
          ${x.comp&&x.comp.length?`<div class="ip-links"><h4>Собирается из</h4><div class="ip-chips">${itemLinkChips(x.comp)}</div></div>`:''}
          ${x.into&&x.into.length?`<div class="ip-links"><h4>Входит в сборку</h4><div class="ip-chips">${itemLinkChips(x.into)}</div></div>`:''}
          ${itemLevelsHtml(x)}
          ${x.lore?`<div class="item-lore"><small>ИСТОРИЯ</small><p>${escapeHtml(x.lore)}</p></div>`:''}
        </section>
      </div>
      <section class="item-profile-panel item-use-panel">
        <div class="item-panel-head"><div><span>ГЕРОИ</span><h3>Кто покупает этот предмет</h3></div></div>
        ${itemHeroUsage(x)}
      </section>
      ${itemCounterEntries(x).length?`<section class="item-profile-panel item-counters-panel">
        <div class="item-panel-head"><div><span>ПРОТИВОДЕЙСТВИЕ</span><h3>Контрпики предмета</h3></div></div>
        ${renderItemCounters(x)}
      </section>`:''}
    </div>`;
  document.getElementById('modal').classList.add('show');document.getElementById('close').focus();
  document.querySelectorAll('[data-item-open]').forEach(b=>b.onclick=()=>openItem(b.dataset.itemOpen));
  document.querySelectorAll('#modalContent [data-hero-open]').forEach(b=>b.onclick=()=>openHero(Number(b.dataset.heroOpen)));
}

function compareHeroes(){const names=prompt('Введи двух героев через запятую, например: Invoker, Lina');if(!names)return;const [aName,bName]=names.split(',').map(x=>x.trim().toLowerCase());const a=heroes.find(h=>h.localized_name.toLowerCase()===aName)||heroes.find(h=>h.localized_name.toLowerCase().includes(aName));const b=heroes.find(h=>h.localized_name.toLowerCase()===bName)||heroes.find(h=>h.localized_name.toLowerCase().includes(bName));if(!a||!b){alert('Не удалось найти обоих героев.');return;}const rows=[['Атрибут',attrInfo(a.primary_attr)[1],attrInfo(b.primary_attr)[1]],['Move Speed',a.move_speed||'—',b.move_speed||'—'],['Damage',a.base_attack_min!=null?`${a.base_attack_min}–${a.base_attack_max}`:'—',b.base_attack_min!=null?`${b.base_attack_min}–${b.base_attack_max}`:'—'],['Pro Winrate',a.pro_pick?winrate(a).toFixed(1)+'%':'—',b.pro_pick?winrate(b).toFixed(1)+'%':'—'],['Pro Picks',statValue(a.pro_pick),statValue(b.pro_pick)]];document.getElementById('modalContent').innerHTML=`<div class="compare-detail"><div class="compare-head"><div><img src="${imageUrl(a)}"><h2>${escapeHtml(a.localized_name)}</h2></div><strong>VS</strong><div><img src="${imageUrl(b)}"><h2>${escapeHtml(b.localized_name)}</h2></div></div><table class="compare-table"><tbody>${rows.map(r=>`<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`;document.getElementById('modal').classList.add('show');document.getElementById('close').focus();}
// Картинки лежат у нас, перебирать домены CDN больше не нужно. Осталась
// единственная страховка: если файла нет, вместо «битой» иконки показываем
// нейтральную заглушку, один раз на элемент.
document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement)||img.dataset.d2hFinal)return;const src=img.currentSrc||img.src;if(!/\/assets\/(heroes|items|abilities)\//.test(src))return;img.dataset.d2hFinal='1';img.onerror=null;img.src=FALLBACK_IMG;},true);

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
  console.error('Dota Mate boot error:',err);
  try{
    if(typeof localHeroes==='function'){heroes=normalizeHeroes(localHeroes());updateHeroUI('локальная база');}
    if(typeof localItems==='function'){items=normalizeItems(localItems());rebuildItemVariantMaps();renderItems();updateItemCounters();}
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
// Сетка героев — обычные ссылки: клик, средняя кнопка, Enter и «открыть в
// новой вкладке» работают сами, без перехвата.
on('featuredHeroesGrid','click',e=>{const c=e.target.closest('.featured-hero-card');if(c){const h=heroes.find(x=>Number(x.id)===Number(c.dataset.id));if(h)location.href='/hero/'+slugForHero(h)+'/';}});
on('statsBody','click',e=>{const tr=e.target.closest('tr[data-id]');if(tr)openHero(Number(tr.dataset.id));});
on('statsExtra','click',e=>{const b=e.target.closest('button[data-id]');if(b)openHero(Number(b.dataset.id));});
on('quickPrepInput','input',e=>quickPrepSelectByName(e.target.value));
on('quickPrepChips','click',e=>{const b=e.target.closest('[data-quick-hero]');if(!b)return;const h=heroes.find(x=>Number(x.id)===Number(b.dataset.quickHero));if(h){const inp=document.getElementById('quickPrepInput');if(inp)inp.value=h.localized_name;renderQuickPrep(h);}});
on('quickPrepResult','click',e=>{const hb=e.target.closest('[data-hero-open]');if(hb){openHero(Number(hb.dataset.heroOpen));return;}const io_=e.target.closest('[data-item-open]');if(io_){openItem(io_.dataset.itemOpen);return;}const ib=e.target.closest('[data-item-by-name]');if(ib){const term=ib.dataset.itemByName.toLowerCase();const x=items.find(i=>String(i.dname).toLowerCase().includes(term.split(' ')[0]));if(x)openItem(x.name);}});
on('guidesGrid','click',e=>{const b=e.target.closest('[data-go]');if(b){closeModal();go(b.dataset.go);}});
on('modalContent','click',e=>{const b=e.target.closest('[data-go]');if(b){closeModal();go(b.dataset.go);}});
click('randomBtn',randomHero);
click('close',closeModal);click('modalBg',closeModal);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('modal')?.classList.contains('show'))closeModal();});
// Быстрый просмотр героя в карточке вместо перехода на его страницу.
// Работает для ссылок с data-hero-open (таблица в статье о контрпиках) и для
// обычных ссылок /hero/<slug>/ на главной, в статистике, в META и в гайдах
// (там же и /hero/<slug>/guide/). В каталоге /heroes/ и внутри самой карточки
// ссылки ведут на страницу героя. Ctrl/Shift/колесо — всегда обычный переход;
// пока справочник героев не загрузился, клик тоже уходит по ссылке.
const HERO_PEEK_PAGES=/^\/(?:|stats\/|guides\/|meta\/(?:match\/)?|guide\/[^/]+\/)$/;
function heroFromLink(a){
  if(a.dataset.heroOpen)return heroes.find(x=>Number(x.id)===Number(a.dataset.heroOpen));
  if(!HERO_PEEK_PAGES.test(location.pathname)||a.closest('#modal'))return null;
  const m=(a.getAttribute('href')||'').match(/^\/hero\/([^/?#]+)\/(guide\/)?$/);
  if(!m||(m[2]&&location.pathname!=='/guides/'))return null;
  return heroes.find(x=>slugForHero(x)===decodeURIComponent(m[1]))||null;
}
document.addEventListener('click',e=>{
  const a=e.target.closest('a[data-hero-open],a[href^="/hero/"]');
  if(!a||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  const h=heroFromLink(a);if(!h)return;
  e.preventDefault();openHero(Number(h.id));
});
const menuBtn=$('menu'),navMenu=$('navMenu');
function setMenuOpen(o){if(!navMenu||!menuBtn)return;navMenu.classList.toggle('open',o);menuBtn.setAttribute('aria-expanded',String(o));}
if(menuBtn&&navMenu){menuBtn.onclick=()=>setMenuOpen(!navMenu.classList.contains('open'));navMenu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenuOpen(false)));}
window.addEventListener('resize',()=>{if(innerWidth>760)setMenuOpen(false);});
// Initial data boot is performed before event wiring.
