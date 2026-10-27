// Deterministic simulation: no DOM, wall clock, network or hidden random source.
export const TACTICS=['counter-pick','budget-build','minimap-awareness','rune-timing','cooldown-tracking'];
export function createTactics(id,data,difficulty='novice',rng=()=>.5){
  const s={id,data,rng,base:['novice','normal','hard'].indexOf(difficulty),tier:0,time:0,round:0,score:0,hits:0,attempts:0,combo:0,errors:{},samples:[],events:[],review:0,message:'',animation:'idle',animationTime:0,banner:0,selected:[],cursor:{x:.5,y:.5},retry:null};
  nextRound(s);return s;
}
function shuffle(a,rng){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function nextRound(s){
  const old=s.tier;s.tier=Math.min(2,Math.max(0,s.base)+Math.floor(s.round/4));
  s.banner=s.tier>old?2.5:0;s.elapsed=0;s.review=0;s.selected=[];s.credited=[];s.animation='idle';s.message='';
  if(s.id==='counter-pick'){
    const pool=s.data.drafts;s.draft=s.retry||pool[Math.floor(s.rng()*pool.length)];s.retry=null;
    const sorted=s.draft.candidates,top=Math.floor(s.rng()*Math.min(3,sorted.length-3));
    const choices=s.tier===0?[sorted[0],sorted[Math.floor(sorted.length/2)],sorted.at(-1)]:sorted.slice(top,top+3);
    s.options=shuffle(choices,s.rng);s.banned=s.tier===2?Math.floor(s.rng()*3):-1;s.deadline=[20,16,10][s.tier];
  }else if(s.id==='budget-build'){
    s.options=s.data.items;const order=shuffle(s.options,s.rng);s.needs=order.slice(0,s.tier===0?1:s.tier===1?2:3).map(x=>x.tag);
    s.budget=order.slice(0,s.needs.length).reduce((n,x)=>n+x.cost,0)+(s.tier===2?0:100);s.slots=s.tier===2?3:6;s.deadline=30;
  }else if(s.id==='minimap-awareness'){
    s.origin=Math.floor(s.rng()*3);s.target=(s.origin+1+Math.floor(s.rng()*2))%3;
    s.signalAt=3;s.signalEnd=3+[2.6,1.8,1.1][s.tier];s.deadline=s.signalEnd+2.5;
  }else if(s.id==='rune-timing'){
    const schedule=s.data.runes;const n=s.round%6;
    s.spawn=n<2?schedule.water[n]:schedule.powerStart+(n-2)*schedule.powerInterval;
    s.rune=n<2?'Вода':'Сила';s.travel=s.tier===2?6+Math.floor(s.rng()*8):8;
    s.start=s.spawn-s.travel-7;s.routeChanged=false;s.departed=false;s.deadline=s.travel+17;
  }else{
    const keys=['blink','force_staff','ghost'];s.effects=keys.slice(0,s.tier===0?1:3).map((key,i)=>{
      const item=s.data.items.find(x=>x.key===key);return {key,name:item.name,cd:item.cooldown,cast:i*2,ready:i*2+item.cooldown,done:false};
    });s.deadline=Math.max(...s.effects.map(x=>x.ready))+6;
  }
}
function record(s,good,points,reason,message,error=null){
  s.attempts++;s.hits+=good?1:0;s.combo=good?s.combo+1:0;s.score=Math.max(0,s.score+points);
  if(!good)s.errors[reason]=(s.errors[reason]||0)+1;
  s.samples.push({good,error});s.animation=good?'victory':'hit';s.animationTime=1.3;
  s.message=message;s.events.push({good,points,reason,message,error,elapsed:s.elapsed});
}
function complete(s){s.review=4;s.round++}
export function tacticsStep(s,dt){
  s.time+=dt;s.banner=Math.max(0,s.banner-dt);s.animationTime=Math.max(0,s.animationTime-dt);
  if(!s.animationTime)s.animation='idle';
  if(s.review>0){s.review-=dt;if(s.review<=0)nextRound(s);return}
  s.elapsed+=dt;
  if(s.id==='rune-timing'&&s.tier===2&&!s.routeChanged&&s.elapsed>=2&&!s.departed){s.travel+=3;s.routeChanged=true;s.message='Мост закрыт: обход +3 с. Пересчитайте выход.'}
  if(s.id==='cooldown-tracking')for(const e of s.effects)if(!e.done&&s.elapsed>=e.ready+5){
    e.done=true;record(s,false,0,'пропуск','Пропущено: '+e.name+' был готов на '+e.ready+' с.',5);
  }
  if(s.id==='cooldown-tracking'&&s.effects.every(e=>e.done)){complete(s);return}
  if(s.elapsed>=s.deadline){record(s,false,s.id==='minimap-awareness'?-30:0,'пропуск','Окно пропущено. Посмотрите разбор и повторите.');if(s.id==='counter-pick')s.retry=s.draft;complete(s)}
}
export function tacticsAction(s,name){
  if(s.review>0){if(name==='next')nextRound(s);return}
  const i=Number(name)-1;s.animation='attack';s.animationTime=.35;
  if(s.id==='counter-pick'&&s.options[i]){
    if(i===s.banned){s.message='Этот герой забанен. Выберите доступного кандидата.';return}
    const max=Math.max(...s.options.filter((x,j)=>j!==s.banned).map(x=>x.d)),delta=max-s.options[i].d,good=delta<=1+1e-8;
    record(s,good,delta<1e-8?100:good?50:0,'выбор пары',(good?'Верно. ':'Неверно. ')+`${s.options.find((x,j)=>j!==s.banned&&x.d===max).name} — наибольшее преимущество в этой выборке; это не гарантия победы. `+s.options.map(x=>`${x.name}: d ${x.d>0?'+':''}${x.d} п.п., n=${x.g}`).join(' · '));
    if(!good)s.retry=s.draft;complete(s);
  }else if(s.id==='budget-build'){
    if(s.options[i]){
      if(s.selected.includes(i)){s.selected=s.selected.filter(x=>x!==i);return}
      const cost=s.selected.reduce((n,j)=>n+s.options[j].cost,0)+s.options[i].cost;
      if(cost>s.budget||s.selected.length>=s.slots){s.message=cost>s.budget?'Не хватает золота: верните другую покупку.':'Нет слота: верните ненужный предмет.';return}
      s.selected.push(i);s.message='Покупку можно вернуть повторным нажатием.';
    }else if(name==='submit'){
      const bought=s.selected.map(j=>s.options[j]),covered=s.needs.filter(tag=>bought.some(x=>x.tag===tag));
      const extra=bought.filter(x=>!s.needs.includes(x.tag)).length,good=covered.length===s.needs.length&&!extra;
      const newlyCovered=covered.filter(t=>!s.credited.includes(t));s.credited.push(...newlyCovered);
      record(s,good,newlyCovered.length*100-extra*20,extra?'лишняя покупка':'не закрыта задача',good?'Задача закрыта. Каждая покупка работает.':(covered.length<s.needs.length?'Не закрыто: '+s.needs.filter(t=>!covered.includes(t)).map(t=>s.options.find(x=>x.tag===t).effect).join(', '):'Все свойства есть.')+(extra?' · Верните лишние предметы: '+extra:''));
      // Failed builds stay editable; each requirement pays only once per task.
      if(good)complete(s);
    }
  }else if(s.id==='minimap-awareness'&&i>=0&&i<3){
    const good=s.elapsed>=s.signalAt&&i===s.target;
    record(s,good,good?100:-30,s.elapsed<s.signalAt?'ложная тревога':'неверный сектор',good?'Перемещение замечено. Команда предупреждена.':`Враг шёл из сектора ${s.origin+1} в ${s.target+1}. Отмечайте направление красного сигнала.`,s.elapsed-s.signalAt);complete(s);
  }else if(s.id==='rune-timing'&&name==='act'){
    const error=s.start+s.elapsed+s.travel-s.spawn;s.departed=true;s.arrival=s.spawn+error;
    record(s,Math.abs(error)<=1,Math.max(0,Math.round(100-10*Math.abs(error))),error<0?'рано':'поздно',`Прибытие ${formatClock(s.arrival)}: ${error<0?'раньше':'позже'} на ${Math.abs(error).toFixed(1)} с. Выход нужен в ${formatClock(s.spawn-s.travel)}.`,error);complete(s);
  }else if(s.id==='cooldown-tracking'&&s.effects[i]&&!s.effects[i].done&&s.elapsed>=s.effects[i].cast){
    const e=s.effects[i],error=s.elapsed-e.ready;e.done=true;
    record(s,Math.abs(error)<=1,Math.max(0,Math.round(100-10*Math.abs(error))),error<0?'рано':'поздно',`${e.name}: готов на ${e.ready} с; ошибка ${error.toFixed(1)} с.`,error);
    if(s.effects.every(x=>x.done))complete(s);
  }
}
export function formatClock(t){return `${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`}
export function tacticsGrade(s){const accuracy=s.attempts?s.hits/s.attempts*100:0;return accuracy>=90&&s.hits>=3?'S':accuracy>=75?'A':accuracy>=55?'B':accuracy>=35?'C':'D'}
export function tacticsTip(s){
  const error=Object.entries(s.errors).sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!error)return s.attempts?'Точность держится: перейдите к следующей сложности.':'Сначала завершите одну попытку; начните с обучения.';
  if(error==='пропуск'&&s.id==='counter-pick')return 'Вы чаще пропускали выбор: вспомните сильные стороны соперника и выберите героя до конца окна; затем изучите разбор.';
  if(error==='пропуск'&&s.id==='budget-build')return 'Вы не успевали проверить корзину: закройте первое требование и нажмите Enter, затем добавьте недостающее.';
  if(s.id==='counter-pick')return 'После ответа сравнивайте d кандидатов против одного врага; большой n повышает надёжность, но не заменяет d.';
  if(s.id==='budget-build')return error==='лишняя покупка'?'Перед проверкой верните предмет без требуемого свойства.':'Сверьте каждое требование с подписью эффекта купленного предмета.';
  if(s.id==='minimap-awareness')return error==='ложная тревога'?'Дождитесь движения красного маркера; зелёные сигналы — союзники.':'Следите за направлением исчезнувшего врага, а не только за его исходной позицией.';
  if(s.id==='rune-timing')return error==='рано'?'Вычитайте время пути из появления руны; ранний выход отдаёт лишние секунды линии.':'Выходите в момент «появление минус путь»; после обхода пересчитайте его.';
  return error==='рано'?'Прибавляйте полный кулдаун к моменту применения каждого предмета.':'Запоминайте отдельное время готовности Q/W/E; начинайте отсчёт при вспышке применения.';
}
