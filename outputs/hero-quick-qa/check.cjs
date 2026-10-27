// Offline assertions for generated quick cards and preservation of role statistics.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
process.chdir(path.resolve(__dirname,'../..'));
const guides=require('../../guide-content');
let pages=0,links=0,images=0,guideCards=0;
for(const dir of fs.readdirSync('deploy/hero')){
 const f=`deploy/hero/${dir}/index.html`;if(!fs.existsSync(f))continue;
 const s=fs.readFileSync(f,'utf8'),q=s.match(/<section class="container hx-quick"[\s\S]*?<\/section>/)?.[0];
 assert(q,f);assert(s.indexOf(q)>s.indexOf('hx-pass'),f);assert(s.indexOf(q)<s.indexOf('class="container hx-rows"'),f);
 for(const [,u] of q.matchAll(/(?:href|src)="(\/[^"#]+)"/g)){
  assert(fs.existsSync('deploy'+u+(u.endsWith('/')?'index.html':'')),f+' missing '+u);u.endsWith('/')?links++:images++;
 }pages++;
}
for(const g of guides){
 const expected=Number(!!g.answer)+(g.sections||[]).filter(s=>s.h==='Коротко').length;
 const s=fs.readFileSync(`deploy/guide/${g.slug}/index.html`,'utf8');
 assert.equal((s.match(/detail-section hx-quick/g)||[]).length,expected,g.slug);guideCards+=expected;
 if(expected)assert(s.includes('/css/hero-quick.css'),g.slug);
}
assert.equal(fs.readFileSync('css/hero-quick.css','utf8'),fs.readFileSync('deploy/css/hero-quick.css','utf8'));
const original=cp.execFileSync('git',['show','HEAD:tools/hero-stat-tiles.js'],{encoding:'utf8'});
assert.equal(original.replace(/\r/g,''),fs.readFileSync('tools/hero-stat-tiles.js','utf8').replace(/\r/g,''));
// Feed a role slice to the unchanged renderer: both missing production elements must appear.
const stats=JSON.parse(fs.readFileSync('data/stats.json','utf8'));
const hero=JSON.parse(fs.readFileSync('data/heroes.json','utf8')).heroes.find(h=>h.id===73);
const hstat=stats.heroes.find(h=>h.id===73);const pos=[...hstat.ro].sort((a,b)=>b[1]-a[1])[0][0];
assert(!stats.positions[pos].heroes.some(h=>h.id===73),'The diagnosed local absence changed');
const ctx={S:stats,counters:{heroes:{}},heroItems:{heroes:{}},byId:new Map([[73,hero]]),itemById:new Map(),itemVariants:{},...require('../../tools/hero-common'),minRole:80};
const renderer=require('../../tools/hero-stat-tiles');
const before=renderer.render(hero,ctx);assert(!before.passport.includes('Место в роли'));assert(!before.rows.includes('против других'));
// Synthetic fixture stays in memory; never substitute it into real data or generated pages.
const peer=stats.positions[pos].heroes[0];assert(peer);
stats.positions[pos].heroes.push({...peer,id:73,n:100});
const after=renderer.render(hero,ctx);assert(after.passport.includes('Место в роли'));assert(after.rows.includes('против других'));
const result={pages,links,images,guideCards,unchangedRenderer:true,roleSliceFixture:'pass',visualQA:'Chrome launch timed out; not verified'};
fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2));console.log(result);
