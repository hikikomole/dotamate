'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
  // Import as ESM despite the repo's CommonJS package mode and plain `node` invocation.
  const source=fs.readFileSync(require.resolve('../js/games/logic.js'),'utf8');
  const {createLane,spawnWave,laneAction,laneStep,grade,hookStep,stunStep,recipeStep}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for(const deny of [false,true]){
    const s=createLane(deny);spawnWave(s);const x=s.units[0].x;
    for(let i=0;i<360;i++)laneStep(s,1/60);
    assert.notEqual(s.units[0].x,x,'units move');assert(s.units.some(u=>u.hp<100),'creep HP decreases');
    const target=s.units.find(u=>u.alive&&u.side===(deny?'green':'red'));assert(target);
    target.hp=80;laneAction(s,'act',target.id);let events=[];for(let i=0;i<40;i++)events.push(...laneStep(s,1/60));assert(events.some(e=>e.kind==='early'),'early attack misses');
    target.hp=20;laneAction(s,'act',target.id);events=[];for(let i=0;i<40;i++)events.push(...laneStep(s,1/60));assert(events.some(e=>e.kind==='hit'),'timed attack scores');assert(s.score>0);
  }
  const h={time:0};hookStep(h,1/60);assert(h.x>0);
  const stun={time:0,remaining:2};stunStep(stun,1/60);assert(stun.remaining<2);
  const recipe={time:0};recipeStep(recipe,1/60);assert(recipe.time>0);
  assert.equal(grade(900,95),'S');
  assert.equal(grade(0,0),'D');
  const moduleFrom=async file=>import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(require.resolve(file),'utf8')).toString('base64')}`);
  const {default:data}=await moduleFrom('../js/games/data/tactics.js');
  const {TACTICS,createTactics,tacticsStep,tacticsAction,tacticsTip,tacticsGrade}=await moduleFrom('../js/games/tactics-logic.js');
  const mechanics=require('../js/games/data/mechanics.json');
  assert.equal(data.version,'6966');
  for(const item of data.items){assert.equal(item.cost,mechanics.items['item_'+item.key].cost);assert.equal(item.cooldown,mechanics.items['item_'+item.key].cooldown??null)}
  const sourceStats=require('../data/hero-counters.json');
  for(const draft of data.drafts)for(const row of draft.candidates){
    const hero=sourceStats.heroes[row.id],original=[...hero.good,...hero.against].find(x=>x.id===draft.id);
    assert.equal(row.d,original.d);assert.equal(row.g,original.g);assert(row.g>=data.stats.minGames);
  }
  const rng=()=>{let n=6966;return ()=>((n=(1664525*n+1013904223)>>>0)/4294967296)};
  // Exercise the actual canvas renderer: data present in memory must not be painted early.
  const path=require('node:path'),moduleUrls=new Map();
  function localModule(file){
    file=path.resolve(__dirname,file);if(moduleUrls.has(file))return moduleUrls.get(file);
    const body=fs.readFileSync(file,'utf8').replace(/from '(\.\/[^']+)'/g,(_,rel)=>`from '${localModule(path.resolve(path.dirname(file),rel))}'`);
    const url='data:text/javascript;base64,'+Buffer.from(body).toString('base64');moduleUrls.set(file,url);return url;
  }
  global.Image=class {set src(value){this.onerror?.()} };
  const {renderTactics}=await import(localModule('../js/games/tactics-art.js'));
  const drawn=[],canvas=new Proxy({fillText:value=>drawn.push(String(value)),measureText:value=>({width:String(value).length*7}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
  const stats=()=>drawn.filter(x=>/^d [+-]?\d|^n=/.test(x));
  for(const level of ['novice','normal','hard']){
    const s=createTactics('counter-pick',data,level,rng());
    const render=tutorial=>{drawn.length=0;renderTactics(s,{ctx:canvas,width:800,height:400},{tutorial,motion:{reduced:true}})};
    render(false);assert.equal(stats().length,0,'counter-pick hides stats before answer: '+level);
    render(true);assert.equal(stats().length,6,'tutorial can explain stats');
    tacticsAction(s,String(s.options.findIndex((_,i)=>i!==s.banned)+1));render(false);
    assert.equal(stats().length,6,'answer reveals d and n');assert.match(s.message,/преимущество/);
    tacticsAction(s,'next');render(false);assert.equal(stats().length,0,'new question hides previous stats');
  }
  assert(!fs.readFileSync(require.resolve('../js/games/tactics.js'),'utf8').includes('выберите максимальное d'));
  for(const draft of data.drafts)for(const hero of [draft,...draft.candidates])assert(fs.existsSync(path.join(__dirname,'..',hero.image)),hero.image);
  for(const item of data.items)assert(fs.existsSync(path.join(__dirname,'../assets/items',item.key+'.png')));
  const {guides}=await import(localModule('../js/games/guide.js'));
  assert.equal(Object.keys(guides).length,10);for(const lines of Object.values(guides))assert(new Set(lines.slice(1)).size>=8);
  console.log('PASS: counter-pick hidden/reveal/reset in all tiers; local imagery; 10 character dialogue banks');
  const tick=(s,seconds)=>{for(let i=0;i<Math.round(seconds*60);i++)tacticsStep(s,1/60)};
  for(const id of TACTICS)for(const level of ['novice','normal','hard']){
    const good=createTactics(id,data,level,rng()),bad=createTactics(id,data,level,rng());
    if(id==='counter-pick'){
      tick(good,.5);const best=Math.max(...good.options.filter((x,i)=>i!==good.banned).map(x=>x.d));tacticsAction(good,String(good.options.findIndex((x,i)=>i!==good.banned&&x.d===best)+1));
      // Force a real, widely separated pair for an unambiguous wrong answer.
      bad.options=[bad.draft.candidates[0],bad.draft.candidates.at(-1)];bad.banned=-1;tacticsAction(bad,'2');assert(bad.retry);
    }else if(id==='budget-build'){
      tick(good,.5);good.needs.forEach(t=>tacticsAction(good,String(good.options.findIndex(x=>x.tag===t)+1)));tacticsAction(good,'submit');
      tacticsAction(bad,'submit');assert.equal(bad.review,0,'failed build remains editable');
      const budget=bad.budget;bad.budget=0;tacticsAction(bad,'1');assert.equal(bad.selected.length,0,'overspend refused');bad.budget=budget;
    }else if(id==='minimap-awareness'){
      tick(good,4);tacticsAction(good,String(good.target+1));tacticsAction(bad,String(bad.target+1));assert(bad.errors['ложная тревога']);
    }else if(id==='rune-timing'){
      tick(good,2.1);tick(good,good.spawn-good.travel-good.start-good.elapsed);tacticsAction(good,'act');tacticsAction(bad,'act');
    }else{
      const remaining=[...good.effects];for(const effect of remaining){tick(good,effect.ready-good.elapsed);tacticsAction(good,String(good.effects.indexOf(effect)+1))}
      tacticsAction(bad,'1');assert(bad.errors['рано']);
    }
    assert(good.score>0,id+' correct play scores '+level);assert(good.hits>0);assert.equal(bad.hits,0,id+' wrong play fails');assert(bad.attempts>0);
    assert.match(grade(good.score,100),/^[SABCD]$/);assert(tacticsTip(bad).length>20);
    assert.equal(tacticsGrade(bad),'D');assert.match(tacticsGrade(good),/^[SA]$/);
    // Inactivity must finish episodes rather than stall, and each tier remains finite.
    const idle=createTactics(id,data,level,rng());tick(idle,132);assert(idle.attempts>0);assert(Number.isFinite(idle.score));
    tick(good,5);assert.equal(good.review,0);assert(good.round>=1);
    console.log('PASS:',id,level,'correct / wrong / timeout / grade / tip');
  }
  const tie=createTactics('counter-pick',data,'novice',rng());tie.options=[{name:'A',d:3,g:500},{name:'B',d:3,g:500}];tacticsAction(tie,'2');assert.equal(tie.score,100,'ties accepted');
  const near=createTactics('counter-pick',data,'novice',rng());near.options=[{name:'A',d:3,g:500},{name:'B',d:2,g:500}];tacticsAction(near,'2');assert.equal(near.score,50,'one point tolerance');
  const slots=createTactics('budget-build',data,'hard',rng());slots.budget=99999;['1','2','3','4'].forEach(x=>tacticsAction(slots,x));assert.equal(slots.selected.length,3);tacticsAction(slots,'2');assert.equal(slots.selected.length,2,'return purchase');
  const partial=createTactics('budget-build',data,'normal',rng());tacticsAction(partial,String(partial.options.findIndex(x=>x.tag===partial.needs[0])+1));tacticsAction(partial,'submit');assert.equal(partial.score,100);tacticsAction(partial,'submit');assert.equal(partial.score,100,'no farming a covered requirement');
  assert.equal(tacticsGrade({hits:3,attempts:3}),'S');assert.equal(tacticsGrade({hits:3,attempts:4}),'A');assert.equal(tacticsGrade({hits:3,attempts:5}),'B');assert.equal(tacticsGrade({hits:2,attempts:5}),'C');
  const banned=createTactics('counter-pick',data,'hard',rng());tacticsAction(banned,String(banned.banned+1));assert.equal(banned.attempts,0,'banned hero cannot be picked');
  for(const id of TACTICS){const s=createTactics(id,data,'novice',rng());s.round=8;s.review=.01;tick(s,.1);assert.equal(s.tier,2,'tier adds new twists')}
  console.log('PASS: 10 games; original lane checks + 15 batch-2 scenarios, provenance, ties, budget, slots, tiers');
})().catch(e=>{console.error(e);process.exitCode=1});
