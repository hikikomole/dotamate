import {drawScene} from './scenes.js';
import {drawImage,itemImage} from './images.js';
import {formatClock} from './tactics-logic.js';
export const worlds={
  'counter-pick':{sky:'#11182f',ground:'#30345b',accent:'#d3b1ff',title:'ЗАЛ СОВЕТА',role:'Стратег',line:'У каждой пары есть история.'},
  'budget-build':{sky:'#25131b',ground:'#653b2a',accent:'#ffcb70',title:'ЛАВКА НА ПЕРЕВАЛЕ',role:'Снабженец',line:'Золото должно работать.'},
  'minimap-awareness':{sky:'#081e29',ground:'#153c38',accent:'#72ead5',title:'НОЧНОЙ ДОЗОР',role:'Разведчик',line:'След ещё тёплый.'},
  'rune-timing':{sky:'#35335d',ground:'#397c87',accent:'#ffce9b',title:'РЕКА НА РАССВЕТЕ',role:'Гонец',line:'Выйду точно к рассвету.'},
  'cooldown-tracking':{sky:'#1e1026',ground:'#562c43',accent:'#ff8992',title:'ОБСЕРВАТОРИЯ ПЕПЛА',role:'Хрономант',line:'Я запомнил эту вспышку.'}
};
function disk(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill()}
export function text(c,value,x,y,max,size=16,color='#f6f4ee',align='left'){
  c.font=`600 ${size}px system-ui`;c.fillStyle=color;c.textAlign=align;
  const words=String(value).split(' ');let line='',row=0;
  for(const word of words){if(c.measureText(line+word).width>max&&line){c.fillText(line.trim(),x,y+row*size*1.3);line='';row++}line+=word+' '}
  c.fillText(line.trim(),x,y+row*size*1.3);c.textAlign='left';return (row+1)*size*1.3;
}
function glyph(c,x,y,r,kind,color){
  c.save();c.translate(x,y);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=2;
  if(kind%4===0){c.beginPath();c.moveTo(0,-r);c.lineTo(r,0);c.lineTo(0,r);c.lineTo(-r,0);c.closePath();c.stroke();disk(c,0,0,r*.25,color)}
  else if(kind%4===1){c.strokeRect(-r*.7,-r*.7,r*1.4,r*1.4);c.beginPath();c.moveTo(-r,0);c.lineTo(r,0);c.moveTo(0,-r);c.lineTo(0,r);c.stroke()}
  else if(kind%4===2){c.beginPath();c.arc(0,0,r,-2.5,2.5);c.moveTo(0,0);c.lineTo(r*.6,-r*.8);c.stroke()}
  else{c.beginPath();c.moveTo(-r,r*.6);c.lineTo(0,-r);c.lineTo(r,r*.6);c.closePath();c.stroke()}
  c.restore();
}
export function renderTactics(s,v,ctx,mapSide='right'){
  const {ctx:c,width:w,height:h}=v,p=worlds[s.id],small=w<500,font=small?12:15;
  drawScene(c,w,h,s.id,s.time,ctx.motion.reduced);
  if(!ctx.tutorial)text(c,p.title,16,25,w-60,small?13:18,p.accent);

  c.fillStyle='#091323b8';c.fillRect(10,h*.24,w-20,h*.69);
  if(s.id==='counter-pick'){
    drawImage(c,s.draft.image,16,h*.13,small?42:64,h*.12,()=>glyph(c,36,h*.19,12,0,p.accent));text(c,'Соперник: '+s.draft.name,w/2,h*.21,w-90,font,p.accent,'center');
    s.options.forEach((o,i)=>{const x=w*(i+.5)/3;drawImage(c,o.image,x-w*.14,h*.32,w*.28,h*.27,()=>glyph(c,x,h*.46,small?16:24,i,p.accent));text(c,(i+1)+'. '+o.name,x,h*.68,w/3-14,font,'#fff','center');if(s.review>0||ctx.tutorial){text(c,`d ${o.d>0?'+':''}${o.d}`,x,h*.80,w/3-10,font,p.accent,'center');text(c,'n='+o.g,x,h*.87,w/3-10,11,'#c3cddd','center')}});
    if(s.banned>=0){const x=w*(s.banned+.5)/3;c.strokeStyle='#ff7b83';c.lineWidth=3;c.beginPath();c.moveTo(x-22,h*.56-22);c.lineTo(x+22,h*.56+22);c.stroke();text(c,'БАН',x,h*.83,w/3-10,12,'#ff7b83','center')}
  }else if(s.id==='budget-build'){
    const spent=s.selected.reduce((n,i)=>n+s.options[i].cost,0);
    text(c,`${s.budget-spent} золота · ${s.selected.length}/${s.slots} слотов`,w/2,h*.21,w-20,font,p.accent,'center');
    for(let i=0;i<6;i++){const x=w*(.2+i%3*.3),y=h*(i<3?.40:.72);c.strokeStyle=p.accent+'55';c.strokeRect(x-26,y-25,52,50);const item=s.options[s.selected[i]];if(item){drawImage(c,itemImage(item.key),x-26,y-25,52,40,()=>glyph(c,x,y,16,s.selected[i],p.accent));text(c,item.name,x,y+29,w*.28,10,'#fff','center');text(c,item.cost+' зол.',x,y+42,w*.28,10,p.accent,'center')}else text(c,'+',x,y+5,30,20,'#aaaaaa','center')}
  }else if(s.id==='minimap-awareness'){
    const mapW=w*(small?.6:.4),left=mapSide==='right'?w-mapW-18:18,top=h*.31,mh=h*.51;
    c.fillStyle='#173f43';c.fillRect(left,top,mapW,mh);c.strokeStyle='#73ccb533';c.lineWidth=3;c.beginPath();c.moveTo(left,top+mh);c.lineTo(left+mapW,top);c.stroke();
    const positions=[[.18,.22],[.5,.5],[.82,.78]];positions.forEach(([x,y],i)=>{glyph(c,left+x*mapW,top+y*mh,13,i,'#9bbdbd');text(c,i+1,left+x*mapW,top+y*mh+26,30,12,'#fff','center')});
    const progress=Math.max(0,Math.min(1,(s.elapsed-s.signalAt)/(s.signalEnd-s.signalAt))),a=positions[s.origin],b=positions[s.target];
    if(s.elapsed<s.signalEnd||s.review>0)disk(c,left+(a[0]+(b[0]-a[0])*progress)*mapW,top+(a[1]+(b[1]-a[1])*progress)*mh,6,'#ff757c');
    if(s.tier>0)for(let i=0;i<2;i++)disk(c,left+(i?.74:.3)*mapW,top+(ctx.motion.reduced?.3:(.25+Math.sin(s.elapsed+i)*.12))*mh,5,'#73e4a4');
    if(s.tier===2){const decoy=positions[(s.origin+1)%3];disk(c,left+decoy[0]*mapW-10,top+decoy[1]*mh-12,6,'#ff757c')}
    const center=mapSide==='right'?w*.18:w*.82,beaconY=h*(.65+(ctx.motion.reduced?0:Math.sin(s.time)*.08));glyph(c,center,beaconY,21,3,p.accent);disk(c,s.cursor.x*w,s.cursor.y*h,4,'#fff');
    text(c,'Веди белый курсор',center,h*.82,w*.32,10,'#c3cddd','center');
    text(c,s.review>0?`Маршрут: ${s.origin+1} → ${s.target+1}`:'Красный — враг',w/2,h*.21,w-25,font,p.accent,'center');
  }else if(s.id==='rune-timing'){
    text(c,formatClock(s.start+s.elapsed),w/2,h*.44,w*.8,small?32:46,p.accent,'center');
    text(c,`${s.rune} · путь ${s.travel} с`,w/2,h*.60,w*.8,font,'#fff','center');
    if(s.tier===0||s.elapsed<3||s.review||ctx.tutorial)text(c,`Появление ${formatClock(s.spawn)}`,w/2,h*.75,w*.8,font,p.accent,'center');
    c.strokeStyle=p.accent;c.lineWidth=2;c.beginPath();c.moveTo(w*.12,h*.89);c.lineTo(w*.88,h*.89);c.stroke();
    glyph(c,w*.88,h*.89,8,0,p.accent);disk(c,w*(s.departed?.12+.76*Math.min(1,(4-s.review)/3):.12),h*.89,6,'#fff');
  }else{
    s.effects.forEach((e,i)=>{const x=w*(i+.5)/s.effects.length,revealed=s.elapsed>=e.cast&&(s.elapsed<e.cast+3||s.review||e.done||ctx.tutorial);
      if(s.elapsed>=e.cast&&s.elapsed<e.cast+.75){c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();c.arc(x,h*.59,ctx.motion.reduced?34:24+(s.elapsed-e.cast)*25,0,7);c.stroke()}
      const size=small?56:92,cy=h*.49;drawImage(c,itemImage(e.key),x-size/2,cy-size/2,size,size,()=>glyph(c,x,cy,size*.35,i,p.accent));
      if(revealed&&s.elapsed>=e.cast){const remaining=Math.max(0,1-(s.elapsed-e.cast)/e.cd);c.save();c.beginPath();c.rect(x-size/2,cy-size/2,size,size);c.clip();c.fillStyle='#06111acc';c.beginPath();c.moveTo(x,cy);c.arc(x,cy,size*.7,-Math.PI/2,-Math.PI/2+remaining*Math.PI*2);c.closePath();c.fill();c.restore()}

      text(c,'QWE'[i],x,h*.29,30,13,p.accent,'center');text(c,e.name,x,h*.72,w/s.effects.length-12,font,'#fff','center');
      text(c,s.elapsed<e.cast?'Ждите вспышку':revealed?`${e.cd} с · каст ${e.cast} с`:e.done?'Отмечено':'Держите в памяти',x,h*.85,w/s.effects.length-12,11,p.accent,'center');
    });
    text(c,s.tier<2||ctx.tutorial?`С начала эпизода: ${s.elapsed.toFixed(1)} с`:'Часы скрыты · держите три отсчёта',w/2,h*.21,w-25,font,p.accent,'center');
    if(s.tier===2&&Math.floor(s.elapsed/4)%2===1)text(c,'Союзник просит обзор — не сбивайте отсчёт',w/2,h*.94,w-22,10,'#d9bbbd','center');
  }
  text(c,'УСЛОВНАЯ МОДЕЛЬ: сцена, путь, задания и очки',12,h-8,w-24,9,'#bdc7d6');
  if(s.banner){c.fillStyle='#142139ee';c.fillRect(10,h*.34,w-20,50);text(c,'НОВЫЙ УРОВЕНЬ · '+(s.tier+1),w/2,h*.34+30,w-35,18,p.accent,'center')}
  for(const e of s.particles||[]){c.globalAlpha=Math.min(1,e.life);disk(c,e.x*w,e.y*h,3,p.accent)}c.globalAlpha=1;
}
