#!/usr/bin/env node
/** Проверка data/lane-matrix.json: структура, полнота, встречная согласованность. */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const L=JSON.parse(fs.readFileSync(path.join(ROOT,'data','lane-matrix.json'),'utf8'));
const P=JSON.parse(fs.readFileSync(path.join(ROOT,'data','hero-positions.json'),'utf8'));
const POS=['POSITION_1','POSITION_2','POSITION_3','POSITION_4','POSITION_5'];
let fail=0; const bad=m=>{console.log('ПРОВАЛ:',m);fail++;};

// 1. структура
let rows=0,badRange=0,nan=0,minN=Infinity;
for(const [id,h] of Object.entries(L.heroes)){
  for(const [pos,list] of Object.entries(h)){
    if(POS.indexOf(pos)===-1) bad('неизвестная позиция '+pos);
    for(const r of list){
      rows++;
      if(r.length!==4||r.some(x=>!Number.isFinite(x))) {nan++;continue;}
      if(r[2]+r[3]>r[1]) badRange++;            // побед + поражений не больше матчей
      if(r[1]<minN) minN=r[1];
    }
  }
}
if(nan) bad('нечисловых строк: '+nan);
if(badRange) bad('побед+поражений больше матчей: '+badRange);
if(minN<L.minPairMatches) bad('есть пары ниже порога выборки: '+minN);
console.log('Строк:',rows,'| комбинаций герой+позиция:',L.comboCount,'| минимальная выборка пары:',minN);
if(rows!==L.rowCount) bad('rowCount в файле не сходится: '+L.rowCount+' против '+rows);

// 2. полнота: все позиции с долей >= minShare собраны
let missing=0;
for(const [id,h] of Object.entries(P.heroes||{})){
  for(const p of POS){
    const c=h.positions&&h.positions[p];
    if(c&&(c.share||0)>=L.minShare&&!(L.heroes[id]&&L.heroes[id][p])) missing++;
  }
}
if(missing) bad('не собрано комбинаций: '+missing);
console.log('Незакрытых комбинаций:',missing);

// 3. встречная согласованность: линия A против B и B против A должны
// давать зеркальные доли побед (это разные срезы Stratz, но об одном событии)
let pairs=0,sumGap=0,maxGap=0;
for(const [id,h] of Object.entries(L.heroes)){
  for(const [pos,list] of Object.entries(h)){
    for(const r of list){
      const other=L.heroes[r[0]];
      if(!other) continue;
      for(const [pos2,list2] of Object.entries(other)){
        const back=list2.find(x=>x[0]===Number(id));
        if(!back) continue;
        const n1=r[2]+r[3], n2=back[2]+back[3];
        if(n1<50||n2<50) continue;
        const gap=Math.abs(r[2]/n1-(1-back[2]/n2));
        pairs++; sumGap+=gap; if(gap>maxGap)maxGap=gap;
      }
    }
  }
}
console.log('Встречных пар (выборка >= 50):',pairs,
  '| среднее расхождение:',(100*sumGap/pairs).toFixed(2)+' п.п.',
  '| худшее:',(100*maxGap).toFixed(1)+' п.п.');
if(pairs&&100*sumGap/pairs>6) bad('встречные срезы расходятся в среднем больше чем на 6 п.п.');

// 4. общий баланс: по всем строкам доля выигранных линий должна быть около 50%
let W=0,Lo=0;
for(const h of Object.values(L.heroes)) for(const list of Object.values(h)) for(const r of list){W+=r[2];Lo+=r[3];}
const wr=100*W/(W+Lo);
console.log('Доля выигранных линий по всему снимку:',wr.toFixed(2)+'% (ожидается ~50%)');
if(Math.abs(wr-50)>3) bad('общий баланс линий далёк от 50%');

console.log(fail?('ИТОГ: провалов '+fail):'ИТОГ: все проверки пройдены');
process.exit(fail?1:0);
