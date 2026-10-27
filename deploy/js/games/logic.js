export function createLane(deny=false){
  return {deny,time:0,wave:0,units:[],selected:null,attack:null,projectile:null,ranged:false,effects:[],combo:0,score:0,attempts:0,hits:0};
}
export function spawnWave(s){
  for(let i=0;i<3;i++)for(const side of ['green','red'])s.units.push({id:`${s.wave}-${side}-${i}`,side,x:side==='green'?-.1-i*.1:1.1+i*.1,y:.42+i*.15,hp:100,max:100,alive:true,fade:1,phase:0,hit:0});
  s.wave++;
}
export function laneAction(s,name,id){
  if(name==='range'){s.ranged=!s.ranged;return}
  if(name==='stop'){s.attack=null;return}
  const candidates=s.units.filter(u=>u.alive&&u.side===(s.deny?'green':'red'));
  if(id&&candidates.some(u=>u.id===id))s.selected=id;
  if(name!=='act'||s.attack||s.projectile)return;
  const target=candidates.find(u=>u.id===s.selected)||candidates.sort((a,b)=>Math.abs(a.x-.5)-Math.abs(b.x-.5))[0];
  if(target){s.selected=target.id;s.attack={id:target.id,t:0,wind:s.ranged?.46:.28}}
}
export function laneStep(s,dt){
  s.time+=dt;const events=[];
  if(!s.units.length)spawnWave(s);
  for(const u of s.units){
    if(!u.alive){u.fade-=dt*1.7;continue}
    const foe=s.units.filter(v=>v.alive&&v.side!==u.side).sort((a,b)=>Math.abs(a.x-u.x)-Math.abs(b.x-u.x))[0];
    if(!foe||Math.abs(foe.x-u.x)>.095)u.x+=(u.side==='green'?1:-1)*dt*.105;
    else{u.phase+=dt;u.hit=Math.max(0,u.hit-dt);if(u.phase>=.18){foe.hp=Math.max(0,foe.hp-dt*17);u.hit=.12}}
    if(u.hp<=0){u.alive=false;events.push({kind:'death',unit:u})}
  }
  s.units=s.units.filter(u=>u.fade>0);
  if(s.units.filter(u=>u.alive&&u.side==='green').length===0||s.units.filter(u=>u.alive&&u.side==='red').length===0)spawnWave(s);
  if(s.attack){s.attack.t+=dt;if(s.attack.t>=s.attack.wind){s.projectile={id:s.attack.id,t:0,duration:s.ranged?.23:.06};s.attack=null}}
  if(s.projectile){s.projectile.t+=dt;if(s.projectile.t>=s.projectile.duration){const u=s.units.find(v=>v.id===s.projectile.id);const good=!!u?.alive&&u.hp>0&&u.hp<=32&&(!s.deny||u.hp/u.max<.5);const early=!!u?.alive&&u.hp>32; s.attempts++;if(good){s.hits++;s.score+=100;s.combo++;u.hp=0;u.alive=false}else{s.score=Math.max(0,s.score-20);s.combo=0}events.push({kind:good?'hit':early?'early':'miss',unit:u,score:good?100:-20,combo:s.combo});s.projectile=null}}
  return events;
}
export function grade(score,accuracy){return accuracy>=90&&score>=800?'S':accuracy>=75?'A':accuracy>=55?'B':accuracy>=35?'C':'D'}
export function hookStep(s,dt){s.time+=dt;s.x=.67+Math.sin(s.time*1.1)*.18;return s}
export function stunStep(s,dt){s.time+=dt;s.remaining=Math.max(0,s.remaining-dt);return s}
export function recipeStep(s,dt){s.time+=dt;return s}
