#!/usr/bin/env node
/** Проверка data/draft-matrix.json: структура, покрытие, симметрия против живого Stratz. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const M=JSON.parse(fs.readFileSync(path.join(ROOT,'data','draft-matrix.json'),'utf8'));
const N=M.heroCount, ids=M.heroIds, pos=new Map(ids.map((id,i)=>[id,i]));
const idx=(i,j)=>(i*(2*N-i-1))/2+(j-i-1);
let fail=0; const bad=(m)=>{console.log('ПРОВАЛ:',m);fail++;};

if(ids.length!==N) bad('heroIds.length != heroCount');
if(M.pairs.with.length!==M.pairCount||M.pairs.vs.length!==M.pairCount) bad('длина pairs != pairCount');
if(M.pairCount!==N*(N-1)/2) bad('pairCount != N*(N-1)/2');

let zeroWith=0,zeroVs=0,badRange=0,nan=0;
for(let k=0;k<M.pairCount;k++){
  const w=M.pairs.with[k], v=M.pairs.vs[k];
  for(const p of [w,v]){
    if(!Array.isArray(p)||p.length!==2){bad('пара '+k+' не [n,w]');break;}
    if(!Number.isFinite(p[0])||!Number.isFinite(p[1])) nan++;
    if(p[1]<0||p[1]>p[0]) badRange++;
  }
  if(w[0]===0) zeroWith++; if(v[0]===0) zeroVs++;
}
if(nan) bad('нечисловых значений: '+nan);
if(badRange) bad('winCount вне [0,matchCount]: '+badRange);
console.log('Пар:',M.pairCount,'| пустых with:',zeroWith,'| пустых vs:',zeroVs);

// Разумность: общий винрейт по vs должен быть около 50%
let n=0,w=0; for(let k=0;k<M.pairCount;k++){n+=M.pairs.vs[k][0];w+=M.pairs.vs[k][1];}
const wr=100*w/n;
console.log('Совокупный винрейт по vs:',wr.toFixed(3)+'% (ожидается ~50%)');
if(Math.abs(wr-50)>1.5) bad('совокупный винрейт vs далёк от 50%');

(async()=>{
  // Симметрия: сверяем три случайных героя со свежим ответом Stratz в обе стороны
  let raw=fs.readFileSync(path.join(ROOT,'stratz.capi.txt'),'utf8').trim();
  const token=(raw.includes('=')?raw.slice(raw.indexOf('=')+1):raw).replace(/\s/g,'');
  const probe=[1,26,114];
  const r=await fetch('https://api.stratz.com/graphql',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'STRATZ_API'},body:JSON.stringify({query:`{heroStats{matchUp(heroIds:[${probe}],bracketBasicIds:[${M.bracket}],take:140,matchLimit:0){heroId with{heroId2 matchCount winCount} vs{heroId2 matchCount winCount}}}}`})});
  const rows=(await r.json()).data.heroStats.matchUp;
  // Сверяем правило сведения: matchCount снимка = max(двух направлений),
  // доля побед снимка лежит между долями обоих направлений.
  let cmp=0,mismatch=0,maxRateGap=0;
  for(const row of rows){
    const i=pos.get(row.heroId);
    const checkOne=(list,arr,dirWin)=>{
      for(const x of list){
        const j=pos.get(x.heroId2); if(j===undefined||j===i) continue;
        const k=i<j?idx(i,j):idx(j,i); const st=arr[k]; cmp++;
        if(!st[0]) continue;
        if(st[0]<x.matchCount) { mismatch++; continue; }          // снимок не может быть меньше направления
        const liveW=dirWin(x,i<j);
        const gap=Math.abs(liveW/x.matchCount - st[1]/st[0]);
        if(gap>maxRateGap) maxRateGap=gap;
        if(gap>0.12) mismatch++;                                   // направления не должны расходиться в разы
      }
    };
    checkOne(row.with,M.pairs.with,(x)=>x.winCount);
    checkOne(row.vs,M.pairs.vs,(x,low)=>low?x.winCount:x.matchCount-x.winCount);
  }
  console.log('Максимальное расхождение долей между направлениями:',(maxRateGap*100).toFixed(1)+' п.п.');
  console.log('Сверено значений со Stratz:',cmp,'| расхождений:',mismatch);
  if(mismatch>cmp*0.02) bad('расхождений больше 2% — данные разъехались');
  console.log(fail?('ИТОГ: провалов '+fail):'ИТОГ: все проверки пройдены');
  process.exit(fail?1:0);
})();
