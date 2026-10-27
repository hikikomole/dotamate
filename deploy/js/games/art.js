import {drawScene} from './scenes.js';
export function paint(view, title, colors, units = [], effects = []) {
  const {ctx:c,width:w,height:h}=view;
  drawScene(c,w,h,view.id,view.time,view.reduced);
  c.fillStyle='#07152299';c.fillRect(8,h*.24,w-16,h*.71);
  c.fillStyle=colors.ink;c.font=`700 ${Math.max(13,w*.022)}px Inter, Manrope, system-ui, sans-serif`;c.fillText(title,20,34);
  const scale=Math.max(.85,w/800);
  for(const u of units){const x=u.x*w,y=u.y*h,color=u.team==='red'?'#ed7379':'#55d995';c.save();c.globalAlpha=Math.max(0,u.alpha??1);c.translate(x,y);c.scale(scale,scale);c.translate(-x,-y);
    if(u.lethal){c.strokeStyle='#f6ce71';c.lineWidth=3;c.beginPath();c.ellipse(x,y+20,31+3*(view.reduced?0:Math.sin(view.time*5)),12,0,0,7);c.stroke()}
    if(u.selected){c.strokeStyle='#fff';c.lineWidth=2;c.beginPath();c.ellipse(x,y+20,37,15,0,0,7);c.stroke()}
    c.fillStyle='#0008';c.beginPath();c.ellipse(x,y+20,25,7,0,0,7);c.fill();
    c.fillStyle=color;c.beginPath();c.moveTo(x-18,y+8);c.lineTo(x-13,y-16);c.lineTo(x,y-26);c.lineTo(x+14,y-16);c.lineTo(x+18,y+8);c.closePath();c.fill();
    c.fillStyle='#26312e';c.beginPath();c.arc(x,y-13,7,0,7);c.fill();c.fillStyle='#f6ce71';c.fillRect(x+6,y-14,13,3);
    if(u.hero){c.fillStyle='#f6ce71';c.fillRect(x-23,y-18,12,4);if(u.attack){c.strokeStyle='#f6ce71';c.lineWidth=4;c.beginPath();c.arc(x,y-8,29,-1.2,-1.2+u.attack*8);c.stroke()}}
    if(u.attack){c.strokeStyle='#fff8';c.lineWidth=3;c.beginPath();c.arc(x,y,25,-.8,.7);c.stroke()}
    if(u.hp!=null){c.fillStyle='#0b1514';c.fillRect(x-24,y-43,48,8);c.fillStyle=color;c.fillRect(x-22,y-41,44*Math.max(0,Math.min(1,(u.display??u.hp)/(u.max||100))),4)}c.restore();
  }
  for(const e of effects){c.globalAlpha=Math.min(1,e.life*2);c.fillStyle=e.color||'#f6ce71';c.font='700 18px Inter, Manrope, system-ui, sans-serif';c.textAlign='center';if(e.dot)c.fillRect(e.x,e.y,3,3);else c.fillText(e.text,e.x,e.y);c.textAlign='left'}c.globalAlpha=1;
}
export function burst(state,x,y,text,color='#f6ce71'){(state.effects??=[]).push({x,y,text,color,life:.9});for(let i=0;i<8;i++){const a=i*Math.PI/4;state.effects.push({x,y,dot:true,color,life:.42,vx:Math.cos(a)*70,vy:Math.sin(a)*70})}}
export function tickEffects(state,dt){state.effects=(state.effects||[]).filter(e=>(e.life-=dt)>0);for(const e of state.effects){e.x+=(e.vx||0)*dt;e.y+=(e.vy||-38)*dt}}
