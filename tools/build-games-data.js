'use strict';
const fs=require('fs'),path=require('path');
function build(){const source=require('../data/items-ru.json'),items=source.items,recipes=[];
  for(const [key,item] of Object.entries(items)){
    if(!item.comp?.length||item.comp.length>3||!item.cost||!item.dname)continue;
    const components=item.comp.map(k=>({key:k,name:items[k]?.dname,cost:items[k]?.cost}));
    if(components.some(x=>!x.name||!x.cost))continue;
    const remainder=item.cost-components.reduce((s,x)=>s+x.cost,0);
    if(remainder<0)continue;
    const explicit=Object.values(items).find(x=>x.recipeFor===key&&x.cost===remainder);
    if(remainder>0&&!explicit)continue;
    recipes.push({key,name:item.dname,cost:item.cost,components,recipeCost:remainder,provenance:{file:'data/items-ru.json',key,fields:['comp','cost','recipeFor'],version:source.generated}});
  }
  if(recipes.length<8)throw Error('Недостаточно проверенных рецептов: '+recipes.length);
  const out=JSON.stringify({source:'data/items-ru.json',version:source.generated,recipes});
  for(const base of ['','deploy']){const dir=path.join(__dirname,'..',base,'data','games');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'item-recipes.json'),out)}
  return recipes.length;
}
if(require.main===module)console.log(build());
module.exports={build};
