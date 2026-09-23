#!/usr/bin/env node
/** Независимый пересчёт перевеса драфта прямо по файлам данных.
 *  Нужен, чтобы сверить то, что показывает страница, с сырыми числами. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const M=JSON.parse(fs.readFileSync(path.join(ROOT,'data','our-matrix.json'),'utf8'));
const H=JSON.parse(fs.readFileSync(path.join(ROOT,'data','heroes.json'),'utf8')).heroes;
const L=JSON.parse(fs.readFileSync(path.join(ROOT,'data','lane-matrix.json'),'utf8'));
const P=JSON.parse(fs.readFileSync(path.join(ROOT,'data','hero-positions.json'),'utf8'));
const K=50, N=M.heroCount, pos=new Map(M.heroIds.map((id,i)=>[id,i]));
const idx=(i,j)=>(i*(2*N-i-1))/2+(j-i-1);
const key=(a,b)=>{const i=pos.get(a),j=pos.get(b);return i<j?idx(i,j):idx(j,i);};
const id=n=>{const h=H.find(x=>x.localized_name===n);if(!h)throw new Error('нет героя '+n);return h.id;};
const adv=(n,w)=>n?100*((w+K/2)/(n+K))-50:0;
const withAdv=(a,b)=>{const p=M.pairs.with[key(a,b)];return adv(p[0],p[1]);};
const vsAdv=(a,b)=>{const i=pos.get(a),j=pos.get(b),p=M.pairs.vs[key(a,b)];return i<j?adv(p[0],p[1]):adv(p[0],p[0]-p[1]);};

const rad=['Lina','Earthshaker','Tidehunter','Pudge','Luna'].map(id);
const dire=['Windranger','Lifestealer','Lion','Phantom Lancer','Invoker'].map(id);
const POS=['POSITION_1','POSITION_2','POSITION_3','POSITION_4','POSITION_5'];
const share=(h,p)=>{const x=P.heroes[String(h)];const c=x&&x.positions&&x.positions[p];return c?(c.share||0):0;};

// оптимальная расстановка перебором 120 вариантов — та же, что на странице
function assign(team){
  const perms=[];(function rec(r,a){if(!r.length){perms.push(a);return;}for(let i=0;i<r.length;i++)rec(r.slice(0,i).concat(r.slice(i+1)),a.concat([r[i]]))})([0,1,2,3,4],[]);
  let best=null,bs=-1;
  for(const pm of perms){let sc=0;for(let j=0;j<5;j++)sc+=share(team[j],POS[pm[j]]);if(sc>bs){bs=sc;best=pm;}}
  return team.map((h,j)=>POS[best[j]]);
}
const pr=assign(rad), pd=assign(dire);
console.log('Свет :',rad.map((h,i)=>H.find(x=>x.id===h).localized_name+' '+pr[i].slice(-1)).join(', '));
console.log('Тьма :',dire.map((h,i)=>H.find(x=>x.id===h).localized_name+' '+pd[i].slice(-1)).join(', '));

const syn=t=>{let s=0;for(let a=0;a<5;a++)for(let b=a+1;b<5;b++)s+=withAdv(t[a],t[b]);return s;};
let mat=0; rad.forEach(a=>dire.forEach(b=>{mat+=vsAdv(a,b)}));
const synR=syn(rad), synD=syn(dire);

// линии: усреднение двух встречных срезов, как на странице
const laneRow=(h,p,vs)=>{const a=L.heroes[String(h)];const l=a&&a[p];if(!l)return null;return l.find(r=>r[0]===vs)||null;};
function laneAdv(h,p,vs,vp){
  const a=laneRow(h,p,vs), b=laneRow(vs,vp,h);
  const nA=a?a[2]+a[3]:0, nB=b?b[2]+b[3]:0;
  if(!nA&&!nB)return null;
  if(!nB)return adv(nA,a[2]);
  if(!nA)return -adv(nB,b[2]);
  const rate=(a[2]+(nB-b[2]))/(nA+nB), n=Math.max(nA,nB);
  return adv(n,Math.round(n*rate));
}
const at=(t,ps,want)=>t.map((h,i)=>({h,p:ps[i]})).filter(x=>want.includes(x.p));
const LANES=[['Нижняя',['POSITION_1','POSITION_5'],['POSITION_3','POSITION_4']],
             ['Центр',['POSITION_2'],['POSITION_2']],
             ['Верхняя',['POSITION_3','POSITION_4'],['POSITION_1','POSITION_5']]];
let laneTotal=0;
for(const [nm,rp,dp] of LANES){
  const A=at(rad,pr,rp), B=at(dire,pd,dp);
  let s=0,c=0;
  A.forEach(x=>B.forEach(y=>{const v=laneAdv(x.h,x.p,y.h,y.p);if(v!==null){s+=v;c++;}}));
  const val=c?s/c:null;
  if(val!==null)laneTotal+=val;
  console.log(nm+':',val===null?'—':val.toFixed(1)+' п.п.');
}
const total=(synR-synD)+mat+laneTotal;
console.log('\nсинергия Свет:',synR.toFixed(1),'| синергия Тьма:',synD.toFixed(1),'| контрпик Свет:',mat.toFixed(1));
console.log('линии всего:',laneTotal.toFixed(1));
console.log('ПЕРЕВЕС ДРАФТА:',(total>=0?'+':'')+total.toFixed(1),'п.п.');

// контроль направления: поменяем стороны — должно отразиться
let mat2=0; dire.forEach(a=>rad.forEach(b=>{mat2+=vsAdv(a,b)}));
console.log('проверка направления контрпика (должно быть зеркально):',mat.toFixed(1),'против',mat2.toFixed(1));
