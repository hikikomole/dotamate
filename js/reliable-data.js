/* Dota 2 Helper — reliable local/online data layer */
const D2H_CACHE_VERSION='v43';
const D2H_CACHE_TTL=1000*60*60*12;
const D2H_TIMEOUT=7000;
function d2hReadCache(key){try{const x=JSON.parse(localStorage.getItem(`d2h_cache_${D2H_CACHE_VERSION}_${key}`)||'null');if(x&&Array.isArray(x.data)&&Date.now()-x.ts<D2H_CACHE_TTL)return x.data;}catch{}return null;}
function d2hWriteCache(key,data){try{localStorage.setItem(`d2h_cache_${D2H_CACHE_VERSION}_${key}`,JSON.stringify({ts:Date.now(),data}));}catch{}}
function d2hClearCache(){try{Object.keys(localStorage).filter(k=>k.startsWith(`d2h_cache_${D2H_CACHE_VERSION}_`)).forEach(k=>localStorage.removeItem(k));}catch{}}
async function d2hFetchJSON(url,opts={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),opts.timeout||D2H_TIMEOUT);try{const r=await fetch(url,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(opts.headers||{})}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(timer);}}
async function d2hFirstSuccessful(tasks){const jobs=tasks.map(task=>Promise.resolve().then(task));try{return await Promise.any(jobs.map(p=>p.then(data=>{if(data==null)throw new Error('empty');return data;})));}catch{return null;}}
function d2hImageCandidates(kind,slug,exact=''){const base=kind==='heroes'?`/apps/dota2/images/dota_react/heroes/${slug}.png`:`/apps/dota2/images/dota_react/items/${slug}.png`;const out=[];if(exact&&/^https?:\/\//.test(exact))out.push(exact.split('?')[0]);['https://cdn.dota2.com','https://cdn.cloudflare.steamstatic.com','https://cdn.akamai.steamstatic.com','https://cdn.steamstatic.com'].forEach(h=>out.push(h+base));return [...new Set(out)];}
