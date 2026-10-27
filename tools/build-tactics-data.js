'use strict';
const fs=require('node:fs');
const path=require('node:path');
function build(){
  const mechanics=require('../js/games/data/mechanics.json');
  if(mechanics.clientVersion!=='6966')throw Error('Expected mechanics 6966');
  const stats=require('../data/hero-counters.json'),heroes=require('../data/heroes.json').heroes;
  const names=new Map(heroes.map(h=>[h.id,h.localized_name]));
  const {imageUrl}=require('./hero-common');
  const portraits=new Map(heroes.map(h=>[h.id,imageUrl(h)]));
  const opponents=new Map();
  for(const [id,hero] of Object.entries(stats.heroes))for(const row of [...hero.good,...hero.against]){
    if(row.g<stats.minGames||!Number.isFinite(row.d)||!names.has(+id)||!names.has(row.id))continue;
    if(!opponents.has(row.id))opponents.set(row.id,new Map());
    opponents.get(row.id).set(+id,{id:+id,name:names.get(+id),image:portraits.get(+id),d:row.d,g:row.g});
  }
  const drafts=[...opponents].filter(([,rows])=>rows.size>=5).map(([id,rows])=>({id,name:names.get(id),image:portraits.get(id),candidates:[...rows.values()].sort((a,b)=>b.d-a.d)}));
  if(drafts.length<12)throw Error('Insufficient confirmed draft pairs');
  const catalog=require('../data/items-ru.json').items;
  const specs=[['blink','Прыжок к точке','blink'],['force_staff','Сдвинуть союзника','push'],['glimmer_cape','Скрыть союзника','hide'],['ghost','Защититься от физических атак','physical'],['dust','Раскрыть невидимость','reveal'],['boots','Постоянная скорость','speed'],['cyclone','Поднять врага в циклон','cyclone']];
  const items=specs.map(([key,effect,tag])=>{
    const m=mechanics.items['item_'+key],local=catalog[key];
    if(!m||!Number.isFinite(m.cost)||!local?.desc?.length)throw Error('Missing item '+key);
    return {key,name:local.dname,effect,tag,cost:m.cost,cooldown:m.cooldown??null,values:m.values,provenance:{file:'js/games/data/mechanics.json',key:'items.item_'+key,version:'6966',effectFile:'data/items-ru.json',excerpt:local.desc.map(x=>x.t).join(' ')}};
  });
  const guide=fs.readFileSync(path.join(__dirname,'../guide-content.js'),'utf8');
  if(!guide.includes('Руны воды появляются только дважды — на 2:00 и на 4:00.')||!guide.includes('Руны силы начинают появляться с 6:00 и дальше каждые 2 минуты.'))throw Error('Review rune schedule');
  const data={version:'6966',stats:{minGames:stats.minGames,date:stats.dataAt,slice:stats.slice,method:stats.method,file:'data/hero-counters.json'},drafts,items,runes:{water:[120,240],powerStart:360,powerInterval:120,provenance:{file:'guide-content.js',key:'match-timings',excerpt:'Руны воды: 2:00 и 4:00. Руны силы: с 6:00 каждые 2 минуты.'}}};
  fs.writeFileSync(path.join(__dirname,'../js/games/data/tactics.js'),'// Generated locally by tools/build-tactics-data.js. Do not edit.\nexport default '+JSON.stringify(data)+';\n');
  return drafts.length;
}
if(require.main===module)console.log('Tactics snapshot:',build());
module.exports={build};
