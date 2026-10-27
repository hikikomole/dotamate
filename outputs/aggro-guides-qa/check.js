const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),{spawn}=require('child_process'),assert=require('assert/strict'),WebSocket=require('ws');
const root=path.resolve(__dirname,'../../deploy'),out=__dirname,slugs=['creep-aggro','tower-aggro','deny-creeps','deny-towers'];
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost'),f=path.resolve(root,'.'+decodeURIComponent(u.pathname),u.pathname.endsWith('/')?'index.html':'');
  if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream','Content-Security-Policy':"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'"}).end(b)});
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise(r=>server.listen(18769,'127.0.0.1',r));
  const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=19349','--user-data-dir='+path.join(os.tmpdir(),'dotamate-deny-qa-'+Date.now()),'about:blank'],{stdio:'ignore',windowsHide:true});
  let socket;
  try{
    let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:19349/json/list')).json();break}catch{await wait(100)}}assert(tabs?.length,'Chrome started');
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.once('open',r));
    let seq=0;const pending=new Map(),errors=[];
    socket.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=pending.get(x.id);pending.delete(x.id);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result)}else if(x.method==='Runtime.exceptionThrown')errors.push(x.params.exceptionDetails.text)});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
    const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
    await call('Page.enable');await call('Runtime.enable');
    const nav=async url=>{await call('Page.navigate',{url:'http://127.0.0.1:18769'+url});for(let i=0;i<60;i++){if(await ev("document.readyState==='complete'"))break;await wait(50)}await wait(150)};
    const reports=[];
    for(const slug of slugs){
      const html=fs.readFileSync(path.join(root,'guide',slug,'index.html'),'utf8');
      const broken=[];for(const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)){const rel=m[1],target=path.join(root,rel,rel.endsWith('/')?'index.html':'');if(!fs.existsSync(target))broken.push(rel)}assert.deepEqual(broken,[],slug+' local links/assets');
      assert(fs.readFileSync(path.join(root,'sitemap.xml'),'utf8').includes('/guide/'+slug+'/'));
      for(const width of [1440,390]){
        await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});await nav('/guide/'+slug+'/');
        assert.equal(await ev("document.querySelectorAll('h1').length"),1);assert(await ev("[...document.querySelectorAll('h2')].some(x=>x.textContent==='Коротко')"));
        assert(await ev('document.documentElement.scrollWidth<=innerWidth'),slug+' overflow');
        assert((await ev("document.querySelector('main').innerText.length"))>4500);
        const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,slug+'-'+width+'.png'),Buffer.from(shot.data,'base64'));reports.push({slug,width,render:true,links:true,sitemap:true});
      }
    }
    for(const q of ['агр','реагрить крипов','сбросить агр вышки']){
      await nav('/guides/?q='+encodeURIComponent(q));
      const found=await ev("[...document.querySelectorAll('#gdGrid > a')].filter(x=>!x.hidden).map(x=>x.getAttribute('href'))");
      const expected=q==='агр'?['creep-aggro','tower-aggro']:q==='реагрить крипов'?['creep-aggro']:['tower-aggro'];for(const slug of expected)assert(found.includes('/guide/'+slug+'/'),q+' finds '+slug);reports.push({query:q,found});
    }
    
    const guides=require('../../guide-content');
    const summaries=guides.filter(g=>g.answer||g.sections.some(s=>s.h==='Коротко'));
    for(const width of [1440,390]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
      for(const g of summaries){
        await nav('/guide/'+g.slug+'/');
        const panels=await ev("[...document.querySelectorAll('.hx-quick')].map(x=>{const h=x.querySelector('.hq-title'),s=getComputedStyle(h);return {first:x.firstElementChild===h,title:h.textContent,margin:s.marginTop,padding:s.paddingTop,border:s.borderTopWidth,empty:[...x.children].some(c=>!c.textContent.trim())}})");
        assert(panels.length,g.slug+' summary exists');
        for(const p of panels){assert.equal(p.title,'Коротко');assert.equal(p.margin,'0px',g.slug);assert.equal(p.padding,'0px',g.slug);assert.equal(p.border,'0px',g.slug);assert(p.first&&!p.empty,g.slug+' no empty summary element');}
      }
      reports.push({summaryGuides:summaries.length,width,noEmptyBlocks:true,noHeadingDivider:true});
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));console.log('PASS: four guides at 1440/390; all three searches; links/assets/sitemap; all summary guides at both widths; no runtime exceptions.');
  }finally{socket?.close();chrome.kill();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
