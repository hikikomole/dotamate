import {preloadImage,itemImage,tileImage} from './images.js';
import data from './data/tactics.js';
import {createTactics,tacticsStep,tacticsAction,tacticsTip,tacticsGrade,formatClock} from './tactics-logic.js';
import {renderTactics,worlds} from './tactics-art.js';
const instructions={
  'counter-pick':'Выберите лучшего героя против указанного соперника. Статистика и объяснение откроются после ответа. 1–3 или карточка. Разница до 1 п.п. даёт 50 очков. Статистика не гарантирует победу.',
  'budget-build':'Купите предметы с нужными свойствами. Нажмите ещё раз, чтобы вернуть покупку. 1–7: покупка; Enter: проверка. Бюджет и задачи учебные.',
  'minimap-awareness':'Следите за красным врагом: куда он движется перед исчезновением? 1–3: опасный сектор. Белый курсор ведите к маяку мышью или стрелками; это отвлечение без очков.',
  'rune-timing':'Время выхода = появление руны минус путь. Пробел: выйти. Ошибка до ±1 с считается точной. Часы идут в реальном темпе; между эпизодами время переносится.',
  'cooldown-tracking':'Запомните вспышку применения и кулдаун. Q/W/E: отметить готовность соответствующего предмета. Ошибка до ±1 с считается точной. Часы и кулдауны не ускорены.'
};
export function createTacticsHooks(slug,engine,actions){
  const root=actions.closest('#trainer');root.classList.add('trainer-tactics');
  const info=document.createElement('div');info.className='tactics-brief';info.id='tactics-brief';root.querySelector('canvas').before(info);
  const heading=document.createElement('strong'),description=document.createElement('p'),hint=document.createElement('p');info.append(heading,hint);const details=document.createElement('details');details.className='tactics-instructions';const summary=document.createElement('summary');summary.textContent='Управление и данные';details.append(summary,description);actions.after(details);
  description.textContent=instructions[slug]+(slug==='counter-pick'?` Выборка: ${data.stats.slice}; минимум ${data.stats.minGames} матчей; ${data.stats.date.slice(0,10)}. ${data.stats.method}`:'');hint.className='tactics-hint';
  const choices=document.createElement('div');choices.className='tactics-choices';actions.append(choices);
  const add=(label,name)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>engine.action(name);choices.append(b);return b};
  const buttons=[];let submit,mapSide='right',signature='';
  if(slug==='minimap-awareness'){
    const label=document.createElement('label');label.className='tactics-map-option';label.textContent='Миникарта: ';
    const select=document.createElement('select');for(const [value,title] of [['right','справа'],['left','слева']]){const o=document.createElement('option');o.value=value;o.textContent=title;select.append(o)}select.onchange=()=>mapSide=select.value;label.append(select);root.querySelector('.trainer-top').append(label);
  }
  const count=slug==='budget-build'?7:slug==='rune-timing'?1:3;
  for(let i=0;i<count;i++)buttons.push(add(slug==='rune-timing'?'Выйти к руне (Пробел)':String(i+1),slug==='rune-timing'?'act':String(i+1)));
  if(slug==='budget-build')submit=add('Проверить закуп (Enter)','submit');
  const next=add('Следующий эпизод (N)','next');next.className='tactics-next';next.hidden=true;
  engine.ctx.input.bindKeys({'1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7',q:'1',w:'2',e:'3',Enter:'submit',n:'next',ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'});
  function sync(s,ctx){
    const stamp=JSON.stringify([s.round,s.tier,!!s.review,s.selected,s.message,s.effects?.map(x=>[x.done,s.elapsed>=x.cast]),ctx.tutorial,s.routeChanged]);if(stamp===signature)return;signature=stamp;
    heading.textContent=worlds[slug].role+' · '+['I · Основы','II · Несколько условий','III · Без страховки'][s.tier];
    const tutorial=ctx.tutorial?'Учебный раунд, без очков. ':'';
    if(slug==='counter-pick')hint.textContent=tutorial+`Против ${s.draft.name} — кто лучший выбор?`+(s.banned>=0?' Бан: '+s.options[s.banned].name+'.':'');
    if(slug==='budget-build')hint.textContent=tutorial+'Нужно: '+s.needs.map(t=>s.options.find(x=>x.tag===t).effect).join(' + ')+` · Бюджет ${s.budget} · Слотов ${s.slots}.`;
    if(slug==='minimap-awareness')hint.textContent=tutorial+'1–3: куда ушёл красный враг? '+(s.tier===2?'Второй красный стоит на месте — следите за движущимся.':'Зелёные — союзники.');
    if(slug==='rune-timing')hint.textContent=tutorial+(s.tier===0||ctx.tutorial?`Цель ${formatClock(s.spawn)} − путь ${s.travel} с = выход ${formatClock(s.spawn-s.travel)}.`:'Пробел: выйти. Запомните цель; вычтите время пути.');
    if(slug==='cooldown-tracking')hint.textContent=tutorial+(ctx.tutorial?'Применение было на 0 с, сейчас наблюдение с 6 с. Blink готов на 15 с. ':'')+'Q/W/E: отметьте момент готовности. Кулдаун виден при вспышке.';
    const feedback=root.querySelector('#trainer-feedback');feedback.textContent=s.message||'';root.dataset.answer=s.review?(s.animation==='hit'?'incorrect':'correct'):'';
    buttons.forEach((b,i)=>{
      b.disabled=!!s.review;b.hidden=false;b.removeAttribute('aria-pressed');
      if(slug==='counter-pick'){b.textContent=`${i+1}. ${s.options[i].name}`+(i===s.banned?' · БАН':'');b.disabled=!!s.review||i===s.banned;tileImage(b,s.options[i].image);}
      if(slug==='budget-build'){const item=s.options[i];b.textContent=`${i+1}. ${item.name} · ${item.cost} · ${item.effect}`;b.setAttribute('aria-pressed',s.selected.includes(i));tileImage(b,itemImage(item.key));}
      if(slug==='minimap-awareness')b.textContent=`${i+1}. Сектор ${i+1}`;
      if(slug==='cooldown-tracking'){const e=s.effects[i];b.hidden=!e;if(e){b.textContent=`${'QWE'[i]} · ${e.name} — готов`;b.disabled=e.done||!!s.review||s.elapsed<e.cast}}
    });if(submit)submit.disabled=!!s.review;next.hidden=!s.review;
  }
  return {tutorialSeconds:12,
    setup(ctx){signature='';const s=createTactics(slug,data,ctx.tutorial?'novice':ctx.difficulty,ctx.rng);if(ctx.tutorial&&slug==='cooldown-tracking')s.elapsed=6;s.particles=[];if(s.draft)[s.draft,...s.options].forEach(x=>preloadImage(x.image));if(s.id==='budget-build'||s.id==='cooldown-tracking')data.items.forEach(x=>preloadImage(itemImage(x.key)));sync(s,ctx);return s},
    update(s,dt,ctx){tacticsStep(s,dt);for(const event of s.events.splice(0)){
      ctx.score.add(event.points,event.reason,event.good,event.error??event.elapsed);ctx.feedback({kind:event.good?'good':'bad',message:event.message,near:event.points===50||(!event.good&&event.error!=null&&Math.abs(event.error)<=2)});
      if(!ctx.motion.reduced)for(let i=0;i<12;i++)s.particles.push({x:.5,y:.5,vx:Math.cos(i*Math.PI/6)*.15,vy:Math.sin(i*Math.PI/6)*.2,life:1});
    }
      s.particles=s.particles.filter(x=>(x.life-=dt)>0);for(const p of s.particles){p.x+=p.vx*dt;p.y+=p.vy*dt}
      sync(s,ctx);
    },
    render(s,v,ctx){renderTactics(s,v,ctx,mapSide)},
    onAction(s,a,ctx){
      if(a.name==='pointer'){
        if(slug==='minimap-awareness'){s.cursor={x:a.x/ctx.view.width,y:a.y/ctx.view.height};}
        return;
      }
      if(['left','right','up','down'].includes(a.name)){s.cursor.x=Math.max(.02,Math.min(.98,s.cursor.x+(a.name==='right'?.04:a.name==='left'?-.04:0)));s.cursor.y=Math.max(.05,Math.min(.95,s.cursor.y+(a.name==='down'?.04:a.name==='up'?-.04:0)));return}
      tacticsAction(s,a.name);sync(s,ctx);
    },tip:s=>tacticsTip(s),grade:s=>tacticsGrade(s)
  };
}
