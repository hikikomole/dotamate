import {createLane,spawnWave,laneAction,laneStep} from './logic.js';
import {paint,burst,tickEffects} from './art.js';
export function createLaneHooks(deny,engine,actions,colors){
  const add=(label,name,primary=false)=>{const b=document.createElement('button');b.type='button';b.className=primary?'trainer-action-primary':'trainer-action-ghost';b.innerHTML=label;b.addEventListener('click',()=>engine.action(name));actions.append(b)};
  add('Атака <kbd>Space</kbd>','act',true);add('Стоп <kbd>S</kbd>','stop');add('Дальний / ближний <kbd>R</kbd>','range');
  engine.ctx.input.bindKeys({a:'act',s:'stop',r:'range'});
  return {setup(){const s=createLane(deny);spawnWave(s);return s},update(s,dt,ctx){
    for(const e of laneStep(s,dt)){if(e.kind==='death')continue;const u=e.unit;const x=(u?.x??.5)*ctx.view.width,y=(u?.y??.5)*ctx.view.height;
      ctx.score.add(e.score,e.kind);const label=e.kind==='hit'?(deny?'ДЕНАЙ':'+золото'):e.kind==='early'?'РАНО':'ПРОМАХ';
      burst(s,x,y,label,e.kind==='hit'?'#f6ce71':'#f36b70');if(e.combo>1)burst(s,x,y-32,`Комбо ×${e.combo}`);ctx.feedback({kind:e.kind==='hit'?'good':'bad',message:label});
    }tickEffects(s,dt)
  },render(s,v){const {ctx:c,width:w,height:h}=v;const units=s.units.map(u=>({x:u.x,y:u.y,team:u.side,hp:u.hp,max:u.max,alpha:u.alive?1:u.fade,selected:u.id===s.selected,lethal:u.alive&&u.side===(deny?'green':'red')&&u.hp<=32,attack:u.hit}));
    units.push({x:.12,y:.55,team:'green',hero:true,attack:s.attack?.t});
    paint(v,deny?'ДЕНАЙ — добей союзного крипа':'ЛАСТХИТ — добей крипа в нужный момент',colors(),units,s.effects);
    if(s.projectile){const u=s.units.find(x=>x.id===s.projectile.id);if(u){const p=Math.min(1,s.projectile.t/s.projectile.duration);c.fillStyle='#f6ce71';c.beginPath();c.arc(w*(.12+(u.x-.12)*p),h*(.55+(u.y-.55)*p),Math.max(5,w*.012),0,7);c.fill()}}
    c.fillStyle=colors().ink;c.font='600 13px Inter, Manrope, system-ui, sans-serif';c.fillText(s.ranged?'Дальний: замах 0,46 с + полёт':'Ближний: замах 0,28 с',16,h-35);c.fillText('Пробел — атака   S — стоп   R — режим',16,h-15);
  },onAction(s,a,ctx){if(a.name==='pointer'&&a.phase==='down'){const u=s.units.filter(u=>u.alive&&u.side===(deny?'green':'red')).find(u=>Math.hypot(a.x-u.x*ctx.view.width,a.y-u.y*ctx.view.height)<Math.max(30,ctx.view.width*.065));if(u)laneAction(s,'act',u.id)}else laneAction(s,a.name)}};
}
