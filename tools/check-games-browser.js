'use strict';
// Offline Chromium QA. Only the loopback fixture is reachable; no packages needed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const WebSocket=require('ws');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/games-batch2-qa');
const slugs=require('../games-registry').games.slice(5).map(x=>x.slug);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname),url.pathname.endsWith('/')?'index.html':'');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return}
    // Block all external resources, telemetry, API traffic, workers and forms.
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; worker-src 'none'"}).end(body);
  });
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(18767,'127.0.0.1',r));
  const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=19343','--user-data-dir='+path.join(out,'chrome-profile'),'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  chrome.stderr.on('data',chunk=>{const message=String(chunk);if(message.includes('ERROR'))process.stderr.write(message)});
  let socket;
  try{
    let targets;for(let i=0;i<40;i++){try{targets=await(await fetch('http://127.0.0.1:19343/json/list',{signal:AbortSignal.timeout(1000)})).json();break}catch{await wait(100)}}
    assert(targets?.length,'Chrome started');socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.once('open',r));
    let seq=0;const pending=new Map(),errors=[];
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
    socket.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=pending.get(x.id);pending.delete(x.id);x.error?p?.reject(Error(JSON.stringify(x.error))):p?.resolve(x.result)}else if(x.method==='Runtime.exceptionThrown')errors.push(x.params.exceptionDetails.text+': '+x.params.exceptionDetails.exception?.description)});
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    await call('Network.setBlockedURLs',{urls:['https://*','http://mc.*','http://api.*']});
    // Advance the actual engine's RAF at fixed dt without waiting two minutes per case.
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__frames=new Map();let frameId=0;window.requestAnimationFrame=f=>{window.__frames.set(++frameId,f);return frameId};window.cancelAnimationFrame=i=>window.__frames.delete(i);window.__advance=n=>{window.__time??=performance.now();for(let i=0;i<n;i++){window.__time+=1000/60;const frames=[...window.__frames.values()];window.__frames.clear();frames.forEach(f=>f(window.__time))}};window.__goals=[];window.ym=(...a)=>window.__goals.push(a);`});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
    const reports=[];
    for(const slug of slugs)for(const width of [1440,1100,360]){
      errors.length=0;await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:2,mobile:width===360});
      await call('Page.navigate',{url:'http://127.0.0.1:18767/games/'+slug+'/'});
      for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.tactics-choices button')"))break;await wait(50)}
      assert(await evaluate("!!document.querySelector('.tactics-choices button')"),slug+' mounts');
      await evaluate("document.querySelector('#trainer-primary').click();window.__advance(60)");
      await evaluate("document.querySelector('.tactics-choices button:not([hidden])').click();window.__advance(2)");
      assert.equal(await evaluate("document.querySelector('#trainer-score').textContent"),'0 очков');
      await evaluate("window.__advance(700)");
      const layout=await evaluate(`(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,ratio:r.width/r.height,dpr:c.width/r.width,buttons:[...document.querySelectorAll('.tactics-choices button:not([hidden])')].map(b=>b.getBoundingClientRect().height)}})()`);
      if(layout.overflow)console.log(await evaluate("JSON.stringify([...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))"));assert(!layout.overflow,slug+' no overflow '+width);assert(layout.buttons.every(h=>h>=44));assert(Math.abs(layout.dpr-2)<.02);
      if(width===360)assert(layout.ratio<1,'portrait canvas');
      await evaluate("document.querySelector('#trainer').scrollIntoView({block:'start'})");
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,slug+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      if(slug==='counter-pick')await evaluate(`(async()=>{const {default:data}=await import('/js/games/data/tactics.js');const hint=document.querySelector('.tactics-hint').textContent;const enemy=data.drafts.find(d=>hint.startsWith('Против '+d.name+':'));const buttons=[...document.querySelectorAll('.tactics-choices button')].slice(0,3);const rows=buttons.map(b=>enemy.candidates.find(c=>b.textContent.endsWith(c.name)));buttons[rows.findIndex(r=>r.d===Math.max(...rows.map(x=>x.d)))].click();window.__advance(2)})()`);
      else if(slug==='budget-build')await evaluate(`(()=>{const hint=document.querySelector('.tactics-hint').textContent;const buttons=[...document.querySelectorAll('.tactics-choices button')];buttons.filter(b=>b.textContent.includes(' · ')&&hint.includes(b.textContent.split(' · ').at(-1))).forEach(b=>b.click());buttons.find(b=>b.textContent.includes('Проверить')).click();window.__advance(2)})()`);
      else if(slug==='rune-timing')await evaluate("window.__advance(380);document.querySelector('.tactics-choices button').click();window.__advance(2)");
      else if(slug==='cooldown-tracking')await evaluate("window.__advance(860);document.querySelector('.tactics-choices button').click();window.__advance(2)");
      else await evaluate("window.__advance(220);document.querySelector('#trainer').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}));window.__advance(2)");
      if(slug!=='minimap-awareness')assert(await evaluate("parseInt(document.querySelector('#trainer-score').textContent)>0"),slug+' browser action scores');
      // Tab-hide pauses; input cannot score while paused.
      const paused=await evaluate(`(()=>{const before=document.querySelector('#trainer-timer').textContent;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.__advance(120);const after=document.querySelector('#trainer-timer').textContent;Object.defineProperty(document,'hidden',{configurable:true,value:false});return before===after&&!document.querySelector('#trainer-screen').hidden})()`);assert(paused);
      await evaluate("document.querySelector('#trainer-primary').click();window.__advance(7300)");
      assert(await evaluate("!!document.querySelector('#trainer-results')"),slug+' results');
      assert(await evaluate("window.__goals.some(x=>x[2]==='game_start')&&window.__goals.some(x=>x[2]==='game_finish')"),'Metrika goals through engine');
      assert.match(await evaluate("document.querySelector('#trainer-screen h2').textContent"),/[SABCD]/);
      assert(await evaluate("document.querySelector('#trainer-screen a[href^=\"/guide/\"]')!==null"));
      const finished=await call('Page.captureScreenshot',{format:'png'});if(width===360)fs.writeFileSync(path.join(out,slug+'-result.png'),Buffer.from(finished.data,'base64'));
      await evaluate("document.querySelector('#trainer-primary').focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));window.__advance(2)");
      assert(await evaluate("document.querySelector('#trainer-screen').hidden"),'R restarts');
      assert.equal(errors.length,0,errors.join('\n'));reports.push({slug,width,...layout,pause:true,results:true,restart:true,exceptions:errors.length});
      console.log('PASS browser:',slug,width);
    }
    for(const slug of slugs){
      await call('Page.navigate',{url:'http://127.0.0.1:18767/games/'+slug+'/'});
      for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.tactics-choices button')"))break;await wait(50)}
      await evaluate("document.querySelector('#trainer-difficulty').value='hard';document.querySelector('#trainer-primary').click();window.__advance(1000)");
      assert.equal(errors.length,0,errors.join('\n'));
      assert(await evaluate("document.documentElement.scrollWidth<=innerWidth"),slug+' hard mobile overflow');
      await evaluate("document.querySelector('#trainer').scrollIntoView({block:'start'})");
      const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,slug+'-hard-360.png'),Buffer.from(shot.data,'base64'));
      if(slug==='counter-pick')assert(await evaluate("[...document.querySelectorAll('.tactics-choices button')].some(b=>b.disabled&&b.textContent.includes('БАН'))"));
      console.log('PASS hard mobile:',slug);
    }
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));await evaluate('window.__advance(60)');assert.equal(errors.length,0);
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));
  }finally{socket?.close();chrome.kill();server.close()}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1});
