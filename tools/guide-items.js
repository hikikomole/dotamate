// Связь статей о предметах (guide-content.js, темы ITEMS/ПРЕДМЕТЫ) с предметами
// из data/items-ru.json. Общая для build-guide-pages.js и build-item-pages.js.
// Правило: английское название предмета целиком совпадает с частью адреса
// статьи; если по адресу ничего нет — название целиком есть в заголовке.
// EXTRA — проверенные вручную пары, которые правило не находит.
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const EXTRA={
  'euls-wind-waker':['cyclone'],
  'orchid-bloodthorn':['orchid'],
  'blink-upgrades':['arcane_blink','swift_blink'],
  'aghanim-scepter-shard':['aghanims_shard'],
  'heal-reduction-741':['skadi'],
  'tp-scroll-usage':['tpscroll'],
};
const ITEM_TAGS=new Set(['ITEMS','ПРЕДМЕТЫ','COMPARE']);
const norm=s=>String(s).toLowerCase().replace(/'/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function itemSlug(name){return String(name||'').replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}

// → {byGuide: Map(slug → [itemKey]), byItem: Map(itemKey → [guide]), unlinked: [slug]}
function linkGuideItems(){
  const guides=require(path.join(ROOT,'guide-content.js')).filter(g=>ITEM_TAGS.has(g.tag));
  const store=JSON.parse(fs.readFileSync(path.join(ROOT,'data','items-ru.json'),'utf8')).items;
  const V=require(path.join(ROOT,'js','item-variants.js'));
  const vm=V.buildVariantMaps(store);
  const items=Object.entries(store).filter(([k,x])=>x.dname&&!x.recipeFor&&!vm.byKey[k]);
  const ok=new Set(items.map(([k])=>k));
  const byGuide=new Map(),byItem=new Map(),unlinked=[];
  for(const g of guides){
    const S='-'+g.slug+'-',T=g.title.toLowerCase();
    let keys=items.filter(([,x])=>S.includes('-'+norm(x.dname)+'-')).map(([k])=>k);
    if(!keys.length) keys=items.filter(([,x])=>T.includes(x.dname.toLowerCase())).map(([k])=>k);
    for(const k of EXTRA[g.slug]||[]) if(ok.has(k)&&!keys.includes(k)) keys.push(k);
    const pos=k=>{const i=T.indexOf(store[k].dname.toLowerCase());return i<0?1e9:i;};
    keys.sort((a,b)=>pos(a)-pos(b));
    if(!keys.length){unlinked.push(g.slug);continue;}
    byGuide.set(g.slug,keys);
    for(const k of keys){if(!byItem.has(k))byItem.set(k,[]);byItem.get(k).push(g);}
  }
  return {byGuide,byItem,unlinked,store,itemSlug};
}
module.exports={linkGuideItems,itemSlug};
