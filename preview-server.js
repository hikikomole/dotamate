const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const CACHE_DIR = path.join(ROOT, '.d2h-data-cache-v43');
const TTL = 1000 * 60 * 60 * 12;
const ITEM_DETAIL_TTL = 1000 * 60 * 60 * 24 * 30;
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Minimal .env loader (no dependency) so local preview can pick up env vars from .env.
try {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}


const SOURCES = {
  heroes: [
    {name:'Valve', url:'https://www.dota2.com/datafeed/herolist?language=english'},
    {name:'OpenDota', url:'https://api.opendota.com/api/heroStats'},
    {name:'dotaconstants', url:'https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json'}
  ],
  items: [
    {name:'Valve', url:'https://www.dota2.com/datafeed/itemlist?language=english'},
    {name:'OpenDota', url:'https://api.opendota.com/api/constants/items'},
    {name:'dotaconstants', url:'https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json'}
  ]
};

const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};

function send(res,status,data,type='application/json; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
  res.end(typeof data==='string'?data:JSON.stringify(data));
}
function cachePath(key){return path.join(CACHE_DIR,key+'.json');}
function readCache(key){try{return JSON.parse(fs.readFileSync(cachePath(key),'utf8'));}catch{return null;}}
function writeCache(key,data,source='unknown'){try{fs.writeFileSync(cachePath(key),JSON.stringify({ts:Date.now(),source,data}));}catch{}}

function fetchWithHttps(url, timeout=12000){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{Accept:'application/json','User-Agent':'DotaMate/2.0'}},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',c=>body+=c);
      res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error('HTTP '+res.statusCode));
        try{resolve(JSON.parse(body));}catch(e){reject(new Error('Invalid JSON from '+url));}
      });
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('timeout')));
    req.on('error',reject);
  });
}
async function fetchJson(url,timeout=12000){
  if(typeof fetch==='function'){
    const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
    try{const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json','User-Agent':'DotaMate/2.0'},signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
    finally{clearTimeout(t);}
  }
  return fetchWithHttps(url,timeout);
}
async function fetchText(url,timeout=15000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{cache:'no-store',headers:{Accept:'text/plain','User-Agent':'DotaMate/2.0'},signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text();}
  finally{clearTimeout(t);}
}
async function firstSource(sources,validator){
  const results=await Promise.allSettled(sources.map(s=>fetchJson(s.url).then(data=>({source:s.name,data}))));
  for(const r of results){if(r.status==='fulfilled'&&validator(r.value.data))return r.value;}
  return null;
}
function officialHeroes(j){return j?.result?.data?.heroes||j?.data?.heroes||[];}
function officialItems(j){return j?.result?.data?.itemabilities||j?.result?.data?.items||j?.data?.itemabilities||j?.data?.items||[];}
function objectValues(j){if(Array.isArray(j))return j;if(j&&typeof j==='object')return Object.values(j);return [];}
function isRecipe(x){const n=String(x?.name||'').toLowerCase();return n.startsWith('item_recipe_')||n.startsWith('recipe_');}
function normalizeHeroes(source){
  let arr=officialHeroes(source)||[];
  if(!arr.length)arr=objectValues(source);
  return arr.filter(x=>x&&x.id&&x.name).map(x=>({...x,id:Number(x.id),localized_name:x.localized_name||x.name_loc||x.name_english_loc||String(x.name).replace(/^npc_dota_hero_/,'').replace(/_/g,' ')}));
}
function normalizeItems(source){
  let arr=officialItems(source); if(!arr.length)arr=objectValues(source);
  const out=[];const seen=new Set();
  for(const raw of arr){if(!raw||!raw.id||!raw.name)continue;const x={...raw,id:Number(raw.id),dname:raw.dname||raw.name_loc||raw.name_english_loc||raw.name};if(seen.has(x.id))continue;seen.add(x.id);out.push(x);}
  return out;
}
function mergeHeroStats(base,stats){
  const m=new Map(stats.map(x=>[Number(x.id),x]));
  return base.map(h=>({...h,...(m.get(Number(h.id))||{}) ,localized_name:h.localized_name||m.get(Number(h.id))?.localized_name||h.name_loc||h.name_english_loc||h.name}));
}
function mergeItems(base,constants){
  const m=new Map(constants.map(x=>[Number(x.id),x]));
  return base.map(x=>({...m.get(Number(x.id)),...x,dname:x.dname||m.get(Number(x.id))?.dname||x.name}));
}

let sourceState={heroes:'none',items:'none'};
async function refreshHeroes(){
  const [o,s,c]=await Promise.allSettled(SOURCES.heroes.map(x=>fetchJson(x.url).then(data=>({source:x.name,data}))));
  const official=o.status==='fulfilled'?normalizeHeroes(o.value.data):[];
  const stats=s.status==='fulfilled'?objectValues(s.value.data):[];
  const constants=c.status==='fulfilled'?objectValues(c.value.data):[];
  let base=official.length?official:(stats.length?stats:constants);
  if(!base.length)throw new Error('No hero source available');
  const merged=mergeHeroStats(base,stats);
  if(merged.length<100)throw new Error('Hero source incomplete: '+merged.length);
  sourceState.heroes=official.length?'Valve':stats.length?'OpenDota':'dotaconstants';
  writeCache('heroes',merged,sourceState.heroes);return merged;
}
async function getHeroes(force=false){
  // Fresh-first. Cache is only fallback.
  try{return await refreshHeroes();}catch(e){const c=readCache('heroes');if(c?.data?.length){sourceState.heroes=c.source||'cache';return c.data;}throw e;}
}
async function refreshItems(){
  const [o,s,c]=await Promise.allSettled(SOURCES.items.map(x=>fetchJson(x.url).then(data=>({source:x.name,data}))));
  const official=o.status==='fulfilled'?normalizeItems(o.value.data):[];
  const constants=s.status==='fulfilled'?objectValues(s.value.data):[];
  const staticItems=c.status==='fulfilled'?normalizeItems(c.value.data):[];
  let base=official.length?official:(constants.length?constants:staticItems);
  if(!base.length)throw new Error('No item source available');
  const merged=mergeItems(base,constants);
  if(merged.length<100)throw new Error('Item source incomplete: '+merged.length);
  sourceState.items=official.length?'Valve':constants.length?'OpenDota':'dotaconstants';
  writeCache('items',merged,sourceState.items);return merged;
}
async function getItems(force=false){
  try{return await refreshItems();}catch(e){const c=readCache('items');if(c?.data?.length){sourceState.items=c.source||'cache';return c.data;}throw e;}
}
async function refreshItem(id){
  const j=await fetchJson(`https://www.dota2.com/datafeed/itemdata?language=english&item_id=${encodeURIComponent(id)}`);
  const d=j?.result?.data?.itemability||j?.result?.data?.itemabilities?.[0]||j?.result?.data?.items?.[0]||j?.result?.data?.item||j?.data?.itemability||j?.data?.itemabilities?.[0]||j?.data?.items?.[0]||j?.data?.item;
  if(!d)throw new Error('Official item detail missing');writeCache('item-'+id,d,'Valve');return d;
}
async function getItem(id,force=false){
  const c=readCache('item-'+id);
  if(c?.data&&!force&&Date.now()-c.ts<ITEM_DETAIL_TTL){refreshItem(id).catch(()=>{});return c.data;}
  try{return await refreshItem(id);}catch{if(c?.data)return c.data;const list=readCache('items');const x=list?.data?.find(v=>Number(v.id)===Number(id));if(x)return x;throw new Error('Item detail unavailable');}
}
async function refreshHeroItems(id){const d=await fetchJson(`https://api.opendota.com/api/heroes/${encodeURIComponent(id)}/itemPopularity`);writeCache('hero-items-'+id,d,'OpenDota');return d;}
async function getHeroItems(id){const c=readCache('hero-items-'+id);try{return await refreshHeroItems(id);}catch{if(c?.data)return c.data;throw new Error('Hero item popularity unavailable');}}

// --- Official Valve Russian text (extracted from the real game files by dotabuff/d2vpkr, no API key,
// no cost, no DeepL/English fallback -- русский язык основной на этом этапе). Если для способности/предмета
// нет токена, или в тексте остался нерешённый %placeholder%, возвращаем пустую строку -- фронтенд уже
// показывает нейтральную заглушку в этом случае. Локализационный файл кэшируется на 12 часов: первый
// показ после истечения кэша тянет свежий файл с GitHub, все последующие -- из дискового кэша. See
// CLAUDE.md "Карта данных" -- server.js has the same functions on purpose.
const VDF_TTL=1000*60*60*12;
const VDF_RU_URL='https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt';
function parseVdfTokens(text){
  if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);
  const map=new Map();
  const re=/^\s*"((?:[^"\\]|\\.)*)"\s*"((?:[^"\\]|\\.)*)"/;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('//'))continue;
    const m=line.match(re);
    if(m)map.set(m[1].toLowerCase(),m[2].replace(/\\"/g,'"'));
  }
  return map;
}
function buildAttribMap(attribArr){
  const m=new Map();
  for(const a of attribArr||[]){
    if(!a||!a.key)continue;
    let v=a.value;if(Array.isArray(v))v=v.join('/');
    m.set(String(a.key).toLowerCase(),String(v));
  }
  return m;
}
function fillPlaceholders(text,attribMap){
  return text.replace(/%([a-zA-Z0-9_]+)%/g,(full,name)=>{const v=attribMap.get(name.toLowerCase());return v===undefined?full:v;});
}
function hasUnresolvedPlaceholder(text){return /%[a-zA-Z0-9_]+%/.test(text);}
async function getOfficialRuMap(){
  const cached=readCache('vdf-ru');
  if(cached?.data&&Date.now()-cached.ts<VDF_TTL)return new Map(cached.data);
  try{
    const text=await fetchText(VDF_RU_URL);
    const map=parseVdfTokens(text);
    writeCache('vdf-ru',[...map],'d2vpkr');
    return map;
  }catch(e){
    if(cached?.data)return new Map(cached.data);
    throw e;
  }
}
async function resolveRuText(internalKey,isItem,attribArr){
  const none={text:'',source:'none'};
  if(!internalKey)return none;
  try{
    const vdf=await getOfficialRuMap();
    const tokenKey=('DOTA_Tooltip_ability_'+(isItem?'item_':'')+internalKey+'_Description').toLowerCase();
    let text=vdf.get(tokenKey);
    if(!text)return none;
    text=fillPlaceholders(text,buildAttribMap(attribArr));
    if(hasUnresolvedPlaceholder(text))return none;
    return {text,source:'official-ru'};
  }catch(e){
    console.warn('resolveRuText:',e.message);
    return none;
  }
}
async function getHeroAbilities(heroInternalName){
  const heroAbilitiesCache=readCache('const-hero-abilities');
  const abilitiesCache=readCache('const-abilities');
  const fresh=async(key,url)=>{const cached=key==='const-hero-abilities'?heroAbilitiesCache:abilitiesCache;if(cached?.data&&Date.now()-cached.ts<TTL)return cached.data;try{const data=await fetchJson(url);writeCache(key,data,'OpenDota');return data;}catch{if(cached?.data)return cached.data;throw new Error('constants unavailable: '+key);}};
  const [heroAbilitiesMap,abilitiesMap]=await Promise.all([
    fresh('const-hero-abilities','https://api.opendota.com/api/constants/hero_abilities'),
    fresh('const-abilities','https://api.opendota.com/api/constants/abilities')
  ]);
  const entry=heroAbilitiesMap[heroInternalName];
  if(!entry||!Array.isArray(entry.abilities)) return [];
  const keys=entry.abilities.filter(k=>k&&k!=='generic_hidden').slice(0,6);
  const out=[];
  for(const key of keys){
    const a=abilitiesMap[key];if(!a) continue;
    const dname=a.dname||key;
    const r=await resolveRuText(key,false,a.attrib);
    out.push({key,dname,desc:r.text,source:r.source,behavior:a.behavior||''});
  }
  return out;
}

function serveStatic(req,res,u){let p=decodeURIComponent(u.pathname);if(!p||p==='/')p='/index.html';else if(p.endsWith('/'))p+='index.html';else if(!path.extname(p))p+='/index.html';const full=path.resolve(ROOT,'.'+p);if(!full.startsWith(path.resolve(ROOT)))return send(res,403,{error:'forbidden'});fs.stat(full,(e,st)=>{if(e||!st.isFile())return send(res,404,{error:'not found'});const ext=path.extname(full).toLowerCase();const noCacheExt=['.html','.js','.css'];res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':noCacheExt.includes(ext)?'no-cache':'public, max-age=3600'});fs.createReadStream(full).pipe(res);});}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,version:'v43',sources:sourceState});
    if(req.method==='GET'&&u.pathname==='/api/dota/heroes'){try{return send(res,200,await getHeroes(u.searchParams.get('refresh')==='1'));}catch(e){return send(res,503,{error:'heroes_unavailable',message:e.message});}}
    if(req.method==='GET'&&u.pathname==='/api/dota/items'){try{return send(res,200,await getItems(u.searchParams.get('refresh')==='1'));}catch(e){return send(res,503,{error:'items_unavailable',message:e.message});}}
    const im=u.pathname.match(/^\/api\/dota\/item\/(\d+)$/);if(req.method==='GET'&&im){try{const id=Number(im[1]);const d=await getItem(id,u.searchParams.get('refresh')==='1');const internalKey=String(d.name||'').replace(/^item_/,'');let attrib=[];try{const list=await getItems();attrib=list.find(x=>Number(x.id)===id)?.attrib||[];}catch{}const r=await resolveRuText(internalKey,true,attrib);return send(res,200,{...d,desc_loc:r.text,description:r.text,source:r.source});}catch(e){return send(res,503,{error:'item_unavailable',message:e.message});}}
    const ham=u.pathname.match(/^\/api\/dota\/hero\/([a-zA-Z0-9_]+)\/abilities$/);if(req.method==='GET'&&ham){try{return send(res,200,await getHeroAbilities(ham[1]));}catch(e){return send(res,503,{error:'hero_abilities_unavailable',message:e.message});}}
    const hm=u.pathname.match(/^\/api\/dota\/hero\/(\d+)\/items$/);if(req.method==='GET'&&hm){try{return send(res,200,await getHeroItems(Number(hm[1])));}catch(e){return send(res,503,{error:'hero_items_unavailable',message:e.message});}}
    return serveStatic(req,res,u);
  }catch(e){return send(res,500,{error:'server_error',message:String(e.message||e)});}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`Dota Mate v43: http://127.0.0.1:${PORT}`));
