const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),WebSocket=require('ws');
const {Pool}=require('pg');
const {createClient}=require('redis');

const PORT=Number(process.env.PORT||3000);
function secret(name,fallback=''){const file=process.env[name+'_FILE'];if(file){try{return fs.readFileSync(file,'utf8').trim()}catch{}}return process.env[name]||fallback}
const JWT_SECRET=secret('JWT_SECRET');
if(!JWT_SECRET||JWT_SECRET.length<32) throw new Error('JWT_SECRET must be configured and at least 32 chars');
const DATABASE_URL=secret('DATABASE_URL');
const REDIS_URL=secret('REDIS_URL','redis://redis:6379');
const PUBLIC_MEDIA_HOST=process.env.PUBLIC_MEDIA_HOST||'localhost';
const MEDIA_SCHEME=process.env.MEDIA_SCHEME||'http';
const WEBRTC_PORT=Number(process.env.MEDIAMTX_WEBRTC_PORT||8889), HLS_PORT=Number(process.env.MEDIAMTX_HLS_PORT||8888);
const PUBLIC_ORIGIN=(process.env.PUBLIC_ORIGIN||'').replace(/\/$/,'');
const isProd=process.env.NODE_ENV==='production';
if(isProd&&!PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN is required in production');
const DEEPL_API_KEY=secret('DEEPL_API_KEY');
const DEEPL_API_URL=DEEPL_API_KEY.endsWith(':fx')?'https://api-free.deepl.com/v2/translate':'https://api.deepl.com/v2/translate';

const pool=new Pool({connectionString:DATABASE_URL,max:Number(process.env.DB_POOL_MAX||20),idleTimeoutMillis:30000,connectionTimeoutMillis:5000,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:process.env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:undefined});
const redis=createClient({url:REDIS_URL});
const pub=createClient({url:REDIS_URL});
const sub=createClient({url:REDIS_URL});

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const localRateFallback=new Map();
const wss=new WebSocket.Server({noServer:true});
const csrfCookie='d2h_csrf';

async function q(sql,p=[]){const r=await pool.query(sql,p);return r.rows}
async function one(sql,p=[]){const r=await pool.query(sql,p);return r.rows[0]}
async function run(sql,p=[]){return pool.query(sql,p)}
function now(){return Date.now()}
function slugify(s){return String(s||'stream').toLowerCase().trim().replace(/[^a-z0-9а-яё_-]+/gi,'-').replace(/[а-яё]/gi,c=>({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}[c.toLowerCase()]||c)).replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'stream'}
function token(user){return jwt.sign({id:user.id,username:user.username,role:user.role},JWT_SECRET,{expiresIn:'7d',issuer:'dota2-helper',audience:'dota2-helper-users'})}
function verifyToken(t){try{return jwt.verify(t,JWT_SECRET,{issuer:'dota2-helper',audience:'dota2-helper-users'})}catch{return null}}
function auth(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?verifyToken(h.slice(7)):null}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}))}
function json(res,status,data,extra={}){const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin',...extra};res.writeHead(status,headers);res.end(JSON.stringify(data))}
function securityHeaders(res){res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://widget.cloudpayments.ru; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; frame-src 'self' https:; font-src 'self' data: https://fonts.gstatic.com; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");res.setHeader('Permissions-Policy','camera=(self), microphone=(self), display-capture=(self)');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');if(isProd)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains; preload')}
function allowedOrigin(origin){if(!origin)return true;return !PUBLIC_ORIGIN||origin===PUBLIC_ORIGIN}
function checkOrigin(req){const origin=req.headers.origin;return allowedOrigin(origin)}
function requireCsrf(req){const safe=['GET','HEAD','OPTIONS'];if(safe.includes(req.method))return true;if(req.url.startsWith('/api/webhooks/')||req.url==='/api/mediamtx/auth')return true;const c=cookies(req),h=req.headers['x-csrf-token'];if(!h||!c[csrfCookie])return false;const a=Buffer.from(String(h)),b=Buffer.from(String(c[csrfCookie]));return a.length===b.length&&crypto.timingSafeEqual(a,b)}
async function rateLimit(req,key,limit,windowSec){const id=`rl:${key}`;try{const n=await redis.incr(id);if(n===1)await redis.expire(id,windowSec);return {ok:n<=limit,count:n}}catch{const t=now(),v=localRateFallback.get(id);if(!v||v.reset<t){localRateFallback.set(id,{count:1,reset:t+windowSec*1000});return {ok:true,count:1}}v.count++;return {ok:v.count<=limit,count:v.count}}}
function rawBody(req,max=2e6){return new Promise((res,rej)=>{let b='',size=0;req.on('data',c=>{size+=c.length;if(size>max){rej(new Error('payload too large'));req.destroy();return}b+=c});req.on('end',()=>res(b));req.on('error',rej)})}
async function body(req){const b=await rawBody(req,1e6);try{return JSON.parse(b||'{}')}catch{throw Object.assign(new Error('bad json'),{status:400})}}
function urls(slug){const mediaBase=(process.env.PUBLIC_MEDIA_BASE||`${MEDIA_SCHEME}://${PUBLIC_MEDIA_HOST}:${WEBRTC_PORT}`).replace(/\/$/,'');const hlsBase=(process.env.PUBLIC_HLS_BASE||`${MEDIA_SCHEME}://${PUBLIC_MEDIA_HOST}:${HLS_PORT}`).replace(/\/$/,'');const rtmpBase=(process.env.PUBLIC_RTMP_BASE||`rtmp://${PUBLIC_MEDIA_HOST}:1935`).replace(/\/$/,'');return{publish:`${mediaBase}/${encodeURIComponent(slug)}/publish`,whip:`${mediaBase}/${encodeURIComponent(slug)}/whip`,webrtc:`${mediaBase}/${encodeURIComponent(slug)}`,hls:`${hlsBase}/${encodeURIComponent(slug)}/index.m3u8`,rtmp:`${rtmpBase}/${encodeURIComponent(slug)}`}}
function hashStreamKey(raw){return crypto.createHash('sha256').update(String(raw)).digest('hex')}
function safeChannel(c){const user=c.username||c.user||'';return {id:Number(c.id),slug:c.slug,title:c.title||'',description:c.description||'',category:c.category||'',username:user,channel:c.slug,user,live:!!c.live,viewers:Number(c.viewers||0),subscriberCount:Number(c.subscriberCount||0),subscribed:!!c.subscribed,owner:!!c.owner,canModerate:!!c.canModerate,urls:urls(c.slug)}}
async function userById(id){return one('SELECT id,username,email,role,created_at FROM users WHERE id=$1',[id])}
async function channelBySlug(slug){return one('SELECT c.*,u.username FROM channels c JOIN users u ON u.id=c.user_id WHERE c.slug=$1',[slug])}
async function isMod(uid,cid){return !!uid&&!!(await one('SELECT 1 FROM moderators WHERE channel_id=$1 AND user_id=$2',[cid,uid]))}
async function canModerate(claim,cid){if(!claim)return false;const c=await one('SELECT user_id FROM channels WHERE id=$1',[cid]);return !!c&&(Number(c.user_id)===Number(claim.id)||claim.role==='admin'||await isMod(claim.id,cid))}
async function notify(userId,type,title,body,url=''){await run('INSERT INTO notifications(user_id,type,title,body,url,created_at) VALUES($1,$2,$3,$4,$5,$6)',[userId,type,title,body,url,now()])}

async function initDb(){await run(`CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,username VARCHAR(24) UNIQUE NOT NULL,email VARCHAR(320) UNIQUE NOT NULL,password_hash TEXT NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'user',created_at BIGINT NOT NULL)`);await run(`CREATE TABLE IF NOT EXISTS channels(id BIGSERIAL PRIMARY KEY,user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug VARCHAR(64) UNIQUE NOT NULL,title VARCHAR(120) DEFAULT 'Мой канал',description VARCHAR(500) DEFAULT '',category VARCHAR(40) DEFAULT 'ranked',stream_key_hash TEXT NOT NULL,live BOOLEAN DEFAULT FALSE,created_at BIGINT NOT NULL)`);await run(`CREATE TABLE IF NOT EXISTS subscriptions(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,created_at BIGINT,PRIMARY KEY(user_id,channel_id))`);await run(`CREATE TABLE IF NOT EXISTS moderators(channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,created_at BIGINT,PRIMARY KEY(channel_id,user_id))`);await run(`CREATE TABLE IF NOT EXISTS bans(channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,created_at BIGINT,PRIMARY KEY(channel_id,user_id))`);await run(`CREATE TABLE IF NOT EXISTS notifications(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,title TEXT NOT NULL,body TEXT DEFAULT '',url TEXT DEFAULT '',read_at BIGINT,created_at BIGINT NOT NULL)`);await run(`CREATE TABLE IF NOT EXISTS donations(id BIGSERIAL PRIMARY KEY,from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,amount INTEGER NOT NULL,currency VARCHAR(3) DEFAULT 'RUB',message VARCHAR(300),status VARCHAR(20) DEFAULT 'pending',external_id VARCHAR(100) UNIQUE,created_at BIGINT)`);await run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC)`);await run(`CREATE INDEX IF NOT EXISTS idx_donations_channel ON donations(channel_id,created_at DESC)`);await run(`CREATE TABLE IF NOT EXISTS favorites(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,hero_id INTEGER NOT NULL,created_at BIGINT NOT NULL,PRIMARY KEY(user_id,hero_id))`);await run(`CREATE TABLE IF NOT EXISTS builds(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,hero_id INTEGER,hero_name VARCHAR(120),items JSONB NOT NULL DEFAULT '[]'::jsonb,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`);await run(`CREATE TABLE IF NOT EXISTS guides(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,title VARCHAR(160) NOT NULL,hero_name VARCHAR(120),role VARCHAR(40),content TEXT DEFAULT '',published BOOLEAN DEFAULT FALSE,likes INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`);await run(`CREATE TABLE IF NOT EXISTS guide_likes(guide_id BIGINT REFERENCES guides(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,created_at BIGINT NOT NULL,PRIMARY KEY(guide_id,user_id))`);await run(`CREATE TABLE IF NOT EXISTS stream_sessions(id BIGSERIAL PRIMARY KEY,channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,started_at BIGINT NOT NULL,ended_at BIGINT,peak_viewers INTEGER DEFAULT 0,record_url TEXT,created_at BIGINT NOT NULL)`);await run(`CREATE INDEX IF NOT EXISTS idx_builds_user ON builds(user_id,updated_at DESC)`);await run(`CREATE INDEX IF NOT EXISTS idx_guides_user ON guides(user_id,updated_at DESC)`);await run(`CREATE INDEX IF NOT EXISTS idx_sessions_channel ON stream_sessions(channel_id,started_at DESC)`)}

async function mediamtxAuth(req,res){try{const b=await body(req);const rawPath=String(b.path||'').replace(/^\/+|\/+$/g,'');const slug=rawPath.replace(/\/(?:whip|publish)$/,'');const c=await channelBySlug(slug);const supplied=String(b.token||b.password||b.streamKey||'');if(!c||!supplied)return json(res,401,{error:'unauthorized'});const stored=String(c.stream_key_hash||'');const suppliedHash=hashStreamKey(supplied);let valid=stored===suppliedHash;if(!valid&&/^[a-f0-9]{64}$/i.test(stored)){const a=Buffer.from(supplied),b=Buffer.from(stored);valid=a.length===b.length&&crypto.timingSafeEqual(a,b);if(valid)await run('UPDATE channels SET stream_key_hash=$1 WHERE id=$2',[suppliedHash,c.id])}if(!valid)return json(res,401,{error:'invalid stream key'});return json(res,200,{})}catch{return json(res,401,{error:'unauthorized'})}}

// Heroes: OpenDota heroStats already includes a usable `name` field per hero, so a raw pass-through is fine.
// Items: OpenDota constants/items objects do NOT include a `name` field (only `dname` + an internal object
// key) -- passing that straight through used to make the client's normalizeItems() (which requires
// raw.id && raw.name) drop every single item, i.e. an empty item list once deployed. Mirrors the
// Valve -> OpenDota -> dotaconstants merge that preview-server.js already does (see CLAUDE.md "Карта данных").
function officialItems(j){return j?.result?.data?.itemabilities||j?.result?.data?.items||j?.data?.itemabilities||j?.data?.items||[];}
function objectValues(j){if(Array.isArray(j))return j;if(j&&typeof j==='object')return Object.values(j);return [];}
function normalizeItems(source){
  let arr=officialItems(source);if(!arr.length)arr=objectValues(source);
  const out=[],seen=new Set();
  for(const raw of arr){if(!raw||!raw.id||!raw.name)continue;const x={...raw,id:Number(raw.id),dname:raw.dname||raw.name_loc||raw.name_english_loc||raw.name};if(seen.has(x.id))continue;seen.add(x.id);out.push(x);}
  return out;
}
function mergeItems(base,constants){
  const m=new Map(constants.map(x=>[Number(x.id),x]));
  return base.map(x=>({...m.get(Number(x.id)),...x,dname:x.dname||m.get(Number(x.id))?.dname||x.name}));
}
async function fetchJsonSafe(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok) throw new Error('HTTP '+r.status+' for '+url);return r.json();}
async function fetchItemsList(){
  const [o,s,c]=await Promise.allSettled([
    fetchJsonSafe('https://www.dota2.com/datafeed/itemlist?language=english'),
    fetchJsonSafe('https://api.opendota.com/api/constants/items'),
    fetchJsonSafe('https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json')
  ]);
  const official=o.status==='fulfilled'?normalizeItems(o.value):[];
  const constants=s.status==='fulfilled'?objectValues(s.value):[];
  const staticItems=c.status==='fulfilled'?normalizeItems(c.value):[];
  const base=official.length?official:(constants.length?constants:staticItems);
  if(!base.length) throw new Error('No item source available');
  const merged=mergeItems(base,constants);
  if(merged.length<100) throw new Error('Item source incomplete: '+merged.length);
  return merged;
}
async function getItemsList(){
  const cacheKey='dota:items:list:v2';
  try{const cached=await redis.get(cacheKey);if(cached) return JSON.parse(cached);}catch{}
  const merged=await fetchItemsList();
  try{await redis.set(cacheKey,JSON.stringify(merged),{EX:60*60*6});}catch{}
  return merged;
}
async function dotaProxy(req,res,u){
  if(req.method!=='GET') return json(res,404,{error:'not found'});
  if(u.pathname==='/api/dota/heroes'){
    try{
      const r=await fetch('https://api.opendota.com/api/heroStats',{headers:{'Accept':'application/json','User-Agent':'Dota2-Helper/1.0'}});
      if(!r.ok) throw new Error(`upstream ${r.status}`);
      const text=await r.text();
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300'});
      return res.end(text);
    }catch(e){
      console.error('Dota data proxy (heroes):',e.message);
      return json(res,502,{error:'Dota data source unavailable',source:'heroes'});
    }
  }
  if(u.pathname==='/api/dota/items'){
    try{
      const items=await getItemsList();
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=300'});
      return res.end(JSON.stringify(items));
    }catch(e){
      console.error('Dota data proxy (items):',e.message);
      return json(res,502,{error:'Dota data source unavailable',source:'items'});
    }
  }
  return json(res,404,{error:'not found'});
}

// --- RU translation of official (English) Dota text, with Redis caching (falls back in-memory if Redis is down). ---
// Never blocks the page: on any failure it returns the original English text with translated:false.
const localTranslateFallback=new Map();
async function translateToRu(text){
  const t=String(text||'').trim();
  if(!t) return {text:t,translated:false};
  if(!DEEPL_API_KEY) return {text:t,translated:false};
  const cacheKey='tr:ru:'+crypto.createHash('sha1').update(t).digest('hex');
  try{const cached=await redis.get(cacheKey);if(cached) return JSON.parse(cached);}
  catch{const v=localTranslateFallback.get(cacheKey);if(v) return v;}
  try{
    const params=new URLSearchParams();params.set('text',t);params.set('target_lang','RU');params.set('source_lang','EN');
    const r=await fetch(DEEPL_API_URL,{method:'POST',headers:{'Authorization':'DeepL-Auth-Key '+DEEPL_API_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:params});
    if(!r.ok) throw new Error('DeepL HTTP '+r.status);
    const data=await r.json();
    const out=data?.translations?.[0]?.text;
    if(!out) throw new Error('DeepL: empty translation');
    const result={text:out,translated:true};
    try{await redis.set(cacheKey,JSON.stringify(result),{EX:60*60*24*90});}catch{localTranslateFallback.set(cacheKey,result);}
    return result;
  }catch(e){
    console.warn('translateToRu:',e.message);
    return {text:t,translated:false};
  }
}
async function getConstantsMap(url,cacheKey,ttlSec){
  try{const cached=await redis.get(cacheKey);if(cached) return JSON.parse(cached);}catch{}
  const r=await fetch(url,{headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error('HTTP '+r.status+' for '+url);
  const data=await r.json();
  try{await redis.set(cacheKey,JSON.stringify(data),{EX:ttlSec});}catch{}
  return data;
}
async function fetchOfficialItem(itemId){
  const r=await fetch(`https://www.dota2.com/datafeed/itemdata?language=english&item_id=${encodeURIComponent(itemId)}`,{headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error('Valve itemdata HTTP '+r.status);
  const payload=await r.json();
  const d=payload?.result?.data?.itemability||payload?.result?.data?.itemabilities?.[0]||payload?.result?.data?.items?.[0]||payload?.result?.data?.item||payload?.data?.itemability||payload?.data?.itemabilities?.[0]||payload?.data?.items?.[0]||payload?.data?.item;
  if(!d) throw new Error('Official item detail missing');
  return d;
}
async function getItemDetail(itemId){
  const cacheKey='item-detail:'+itemId;
  let raw=null;
  try{const cached=await redis.get(cacheKey);if(cached) raw=JSON.parse(cached);}catch{}
  if(!raw){
    raw=await fetchOfficialItem(itemId);
    try{await redis.set(cacheKey,JSON.stringify(raw),{EX:60*60*24*30});}catch{}
  }
  const rawDesc=raw.desc_loc||raw.description||(Array.isArray(raw.abilities)?raw.abilities.map(a=>a.description).filter(Boolean).join('\n\n'):'');
  const tr=await translateToRu(rawDesc);
  return {...raw,desc_loc:tr.text,desc_original_en:rawDesc,translated:tr.translated};
}
async function getHeroAbilities(heroInternalName){
  const [heroAbilitiesMap,abilitiesMap]=await Promise.all([
    getConstantsMap('https://api.opendota.com/api/constants/hero_abilities','const:hero_abilities',60*60*24),
    getConstantsMap('https://api.opendota.com/api/constants/abilities','const:abilities',60*60*24)
  ]);
  const entry=heroAbilitiesMap[heroInternalName];
  if(!entry||!Array.isArray(entry.abilities)) return [];
  const keys=entry.abilities.filter(k=>k&&k!=='generic_hidden').slice(0,6);
  const out=[];
  for(const key of keys){
    const a=abilitiesMap[key];if(!a) continue;
    const dname=a.dname||key;
    const descEn=a.desc||a.description||a.lore||'';
    const cacheKey='ability-tr:'+key;
    let tr=null;
    try{const cached=await redis.get(cacheKey);tr=cached?JSON.parse(cached):null;}catch{}
    if(!tr){tr=await translateToRu(descEn);try{await redis.set(cacheKey,JSON.stringify(tr),{EX:60*60*24*90});}catch{}}
    out.push({key,dname,desc:tr.text,desc_original_en:descEn,translated:tr.translated,behavior:a.behavior||''});
  }
  return out;
}
async function getHeroItemPopularity(heroId){
  const cacheKey='hero-items:'+heroId;
  try{const cached=await redis.get(cacheKey);if(cached) return JSON.parse(cached);}catch{}
  const r=await fetch(`https://api.opendota.com/api/heroes/${encodeURIComponent(heroId)}/itemPopularity`,{headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const data=await r.json();
  try{await redis.set(cacheKey,JSON.stringify(data),{EX:60*60*12});}catch{}
  return data;
}

async function api(req,res,u){
 if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{ok:true,version:'v43'});
 if(req.method==='GET'&&u.pathname==='/api/stream/ice'){const secretKey=secret('TURN_SECRET');const host=process.env.TURN_HOST||process.env.TURN_REALM||PUBLIC_MEDIA_HOST;if(!secretKey)return json(res,200,{iceServers:[]});const username=`${Math.floor(Date.now()/1000)+3600}:${String((auth(req)?.username)||'guest').slice(0,24)}`;const credential=crypto.createHmac('sha1',secretKey).update(username).digest('base64');return json(res,200,{iceServers:[{urls:[`turn:${host}:3478?transport=udp`,`turn:${host}:3478?transport=tcp`],username,credential}]});}
 if(u.pathname==='/api/dota/heroes'||u.pathname==='/api/dota/items') return dotaProxy(req,res,u);
 { const m=u.pathname.match(/^\/api\/dota\/item\/(\d+)$/); if(req.method==='GET'&&m){try{return json(res,200,await getItemDetail(Number(m[1])));}catch(e){return json(res,502,{error:'item_unavailable',message:e.message});}} }
 { const m=u.pathname.match(/^\/api\/dota\/hero\/(\d+)\/items$/); if(req.method==='GET'&&m){try{return json(res,200,await getHeroItemPopularity(Number(m[1])));}catch(e){return json(res,502,{error:'hero_items_unavailable',message:e.message});}} }
 { const m=u.pathname.match(/^\/api\/dota\/hero\/([a-zA-Z0-9_]+)\/abilities$/); if(req.method==='GET'&&m){try{return json(res,200,await getHeroAbilities(m[1]));}catch(e){return json(res,502,{error:'hero_abilities_unavailable',message:e.message});}} }
 if(u.pathname==='/api/security/csrf'&&req.method==='GET'){const t=crypto.randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`${csrfCookie}=${encodeURIComponent(t)}; Path=/; SameSite=Strict${isProd?'; Secure':''}`);return json(res,200,{csrfToken:t})}
 if(req.method==='POST'&&u.pathname==='/api/auth/register'){const rl=await rateLimit(req,'register:'+req.socket.remoteAddress,8,900);if(!rl.ok)return json(res,429,{error:'Слишком много попыток. Попробуйте позже.'},{'Retry-After':'900'});const b=await body(req),username=String(b.username||'').trim().slice(0,24),email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');if(!/^[\w-]{3,24}$/i.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||pw.length<8)return json(res,400,{error:'Проверьте ник, email и пароль (минимум 8 символов).'});try{const hash=await bcrypt.hash(pw,12),r=await run('INSERT INTO users(username,email,password_hash,created_at) VALUES($1,$2,$3,$4) RETURNING id',[username,email,hash,now()]);const user=await userById(r.rows[0].id);return json(res,201,{token:token(user),user})}catch{return json(res,409,{error:'Пользователь или email уже существует.'})}}
 if(req.method==='POST'&&u.pathname==='/api/auth/login'){const rl=await rateLimit(req,'login:'+req.socket.remoteAddress,12,900);if(!rl.ok)return json(res,429,{error:'Слишком много попыток входа.'},{'Retry-After':'900'});const b=await body(req),login=String(b.login||''),user=await one('SELECT * FROM users WHERE lower(email)=lower($1) OR username=$2',[login,login]);if(!user||!(await bcrypt.compare(String(b.password||''),user.password_hash)))return json(res,401,{error:'Неверный логин или пароль'});return json(res,200,{token:token(user),user:{id:user.id,username:user.username,email:user.email,role:user.role}})}
 if(req.method==='GET'&&u.pathname==='/api/auth/me'){const c=auth(req);if(!c)return json(res,401,{error:'unauthorized'});const user=await userById(c.id);return json(res,200,{user})}

 if(req.method==='GET'&&u.pathname==='/api/profile/channel'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const ch=await one('SELECT c.id,c.slug,c.title,c.description,c.category,c.live,c.user_id,u.username,(SELECT COUNT(*) FROM subscriptions s WHERE s.channel_id=c.id) AS subscriberCount FROM channels c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1',[c.id]);if(!ch)return json(res,404,{error:'Канал ещё не создан'});return json(res,200,{channel:safeChannel({...ch,owner:true,subscriberCount:ch.subscriberCount,viewers:await viewersCount(ch.slug)})})}
 if(req.method==='GET'&&u.pathname==='/api/profile'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const user=await userById(c.id);const favorites=await q('SELECT hero_id AS id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC',[c.id]);const builds=await q('SELECT id,name,hero_id,hero_name,items,created_at,updated_at FROM builds WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',[c.id]);const guides=await q('SELECT id,title,hero_name,role,content,published,likes,created_at,updated_at FROM guides WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',[c.id]);const subscriptions=await q('SELECT c.slug,c.title,c.live,u.username FROM subscriptions s JOIN channels c ON c.id=s.channel_id JOIN users u ON u.id=c.user_id WHERE s.user_id=$1 ORDER BY s.created_at DESC',[c.id]);return json(res,200,{user,favorites:favorites.map(x=>({id:Number(x.id),name:'Герой #'+x.id,image:''})),builds,guides,subscriptions,stats:{favorites:favorites.length,builds:builds.length,guides:guides.length,subscriptions:subscriptions.length}})}
 if(req.method==='GET'&&u.pathname==='/api/profile/favorites'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const rows=await q('SELECT hero_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC',[c.id]);return json(res,200,{favorites:rows.map(x=>Number(x.hero_id))})}
 if(req.method==='POST'&&u.pathname==='/api/profile/favorites'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req);const ids=[...new Set((Array.isArray(b.heroIds)?b.heroIds:[]).map(Number).filter(Number.isInteger).slice(0,100))];const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM favorites WHERE user_id=$1',[c.id]);if(ids.length)await client.query('INSERT INTO favorites(user_id,hero_id,created_at) SELECT $1,x,$2 FROM unnest($3::int[]) AS x ON CONFLICT DO NOTHING',[c.id,now(),ids]);await client.query('COMMIT');return json(res,200,{ok:true,favorites:ids})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
 if(req.method==='DELETE'&&/^\/api\/profile\/favorites\/\d+$/.test(u.pathname)){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});await run('DELETE FROM favorites WHERE user_id=$1 AND hero_id=$2',[c.id,Number(u.pathname.split('/').pop())]);return json(res,200,{ok:true})}
 if(req.method==='GET'&&u.pathname==='/api/profile/builds'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});return json(res,200,{builds:await q('SELECT id,name,hero_id,hero_name,items,created_at,updated_at FROM builds WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',[c.id])})}
 if(req.method==='POST'&&u.pathname==='/api/profile/builds'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req),name=String(b.name||'Мой билд').trim().slice(0,120),items=Array.isArray(b.items)?b.items.slice(0,6):[];if(!items.length)return json(res,400,{error:'Билд должен содержать хотя бы один предмет'});const t=now();const r=await run('INSERT INTO builds(user_id,name,hero_id,hero_name,items,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) RETURNING id,name,hero_id,hero_name,items,created_at,updated_at',[c.id,name,Number(b.heroId)||null,String(b.hero||b.hero_name||'').slice(0,120),JSON.stringify(items),t]);return json(res,201,{build:r.rows[0]})}
 if(req.method==='DELETE'&&/^\/api\/profile\/builds\/\d+$/.test(u.pathname)){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});await run('DELETE FROM builds WHERE id=$1 AND user_id=$2',[Number(u.pathname.split('/').pop()),c.id]);return json(res,200,{ok:true})}
 if(req.method==='GET'&&u.pathname==='/api/profile/guides'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});return json(res,200,{guides:await q('SELECT id,title,hero_name,role,content,published,likes,created_at,updated_at FROM guides WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',[c.id])})}
 if(req.method==='POST'&&u.pathname==='/api/profile/guides'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req),title=String(b.title||'').trim().slice(0,160);if(title.length<3)return json(res,400,{error:'Название гайда слишком короткое'});const t=now();const r=await run('INSERT INTO guides(user_id,title,hero_name,role,content,published,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,title,hero_name,role,content,published,likes,created_at,updated_at',[c.id,title,String(b.hero||b.hero_name||'').slice(0,120),String(b.role||'').slice(0,40),String(b.content||'').slice(0,10000),!!b.published,t]);return json(res,201,{guide:r.rows[0]})}
 if(req.method==='PUT'&&/^\/api\/profile\/guides\/\d+$/.test(u.pathname)){const c=auth(req),id=Number(u.pathname.split('/').pop());if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req);const r=await run('UPDATE guides SET title=$1,hero_name=$2,role=$3,content=$4,published=$5,updated_at=$6 WHERE id=$7 AND user_id=$8 RETURNING id,title,hero_name,role,content,published,likes,created_at,updated_at',[String(b.title||'').slice(0,160),String(b.hero||b.hero_name||'').slice(0,120),String(b.role||'').slice(0,40),String(b.content||'').slice(0,10000),!!b.published,now(),id,c.id]);if(!r.rowCount)return json(res,404,{error:'Гайд не найден'});return json(res,200,{guide:r.rows[0]})}
 if(req.method==='GET'&&u.pathname==='/api/guides'){const page=Math.max(1,Number(u.searchParams.get('page')||1)),limit=Math.min(30,Math.max(1,Number(u.searchParams.get('limit')||12))),offset=(page-1)*limit;const rows=await q('SELECT g.id,g.title,g.hero_name,g.role,g.content,g.published,g.likes,g.created_at,u.username FROM guides g JOIN users u ON u.id=g.user_id WHERE g.published=true ORDER BY g.likes DESC,g.created_at DESC LIMIT $1 OFFSET $2',[limit,offset]);return json(res,200,{guides:rows,page,limit})}
 if(req.method==='POST'&&/^\/api\/guides\/\d+\/like$/.test(u.pathname)){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const id=Number(u.pathname.split('/')[3]);const inserted=await run('INSERT INTO guide_likes(guide_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING guide_id',[id,c.id,now()]);if(inserted.rowCount){await run('UPDATE guides SET likes=likes+1 WHERE id=$1',[id]);return json(res,200,{liked:true})}await run('DELETE FROM guide_likes WHERE guide_id=$1 AND user_id=$2',[id,c.id]);await run('UPDATE guides SET likes=GREATEST(0,likes-1) WHERE id=$1',[id]);return json(res,200,{liked:false})}
 if(req.method==='GET'&&/^\/api\/channels\/[^/]+\/sessions$/.test(u.pathname)){const slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c)return json(res,404,{error:'Канал не найден'});return json(res,200,{sessions:await q('SELECT id,started_at,ended_at,peak_viewers,record_url FROM stream_sessions WHERE channel_id=$1 ORDER BY started_at DESC LIMIT 30',[c.id])})}
 if(req.method==='GET'&&u.pathname==='/api/payments/config')return json(res,200,{provider:'cloudpayments',enabled:!!process.env.CLOUDPAYMENTS_PUBLIC_ID,publicTerminalId:process.env.CLOUDPAYMENTS_PUBLIC_ID||null})
 if(req.method==='GET'&&u.pathname==='/api/notifications'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const rows=await q('SELECT id,type,title,body,url,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50',[c.id]);return json(res,200,{notifications:rows,unread:rows.filter(x=>!x.read_at).length})}
 if(req.method==='POST'&&u.pathname==='/api/notifications/read'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req);if(b.all)await run('UPDATE notifications SET read_at=$1 WHERE user_id=$2 AND read_at IS NULL',[now(),c.id]);else if(b.id)await run('UPDATE notifications SET read_at=$1 WHERE id=$2 AND user_id=$3',[now(),Number(b.id),c.id]);return json(res,200,{ok:true})}
 if(req.method==='GET'&&u.pathname==='/api/streams'){const rows=await q(`SELECT c.id,c.slug,c.title,c.description,c.category,c.live,u.username,(SELECT COUNT(*) FROM subscriptions s WHERE s.channel_id=c.id) AS subscriberCount FROM channels c JOIN users u ON u.id=c.user_id ORDER BY c.live DESC,c.id DESC`);const streams=[];for(const s of rows)streams.push({...safeChannel(s),viewers:await viewersCount(s.slug)});return json(res,200,{streams})}
 if(req.method==='GET'&&/^\/api\/streams\/[^/]+$/.test(u.pathname)){const slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c)return json(res,404,{error:'Канал не найден'});const subs=await one('SELECT COUNT(*)::int AS n FROM subscriptions WHERE channel_id=$1',[c.id]),claim=auth(req),subscribed=!!(claim&&await one('SELECT 1 FROM subscriptions WHERE channel_id=$1 AND user_id=$2',[c.id,claim.id]));return json(res,200,{...safeChannel({...c,subscriberCount:subs.n,subscribed,owner:!!(claim&&Number(c.user_id)===Number(claim.id)),canModerate:!!(claim&&await canModerate(claim,c.id)),viewers:await viewersCount(slug)})})}
 if(req.method==='POST'&&u.pathname==='/api/channels'){const c=auth(req);if(!c)return json(res,401,{error:'Нужна авторизация'});const b=await body(req);let slug=slugify(b.slug||c.username);const existing=await channelBySlug(slug);if(existing){if(Number(existing.user_id)===Number(c.id))return json(res,409,{error:'Канал уже создан'});slug+='-'+crypto.randomBytes(2).toString('hex');}const raw=crypto.randomBytes(32).toString('hex');const r=await run('INSERT INTO channels(user_id,slug,title,description,category,stream_key_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[c.id,slug,String(b.title||c.username).slice(0,120),String(b.description||'').slice(0,500),String(b.category||'ranked').slice(0,40),hashStreamKey(raw),now()]);return json(res,201,{channel:safeChannel(await channelBySlug(slug)),streamKey:raw})}
 if(req.method==='PUT'&&/^\/api\/channels\/[^/]+$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!claim||Number(c.user_id)!==Number(claim.id))return json(res,403,{error:'Нет доступа'});const b=await body(req);await run('UPDATE channels SET title=$1,description=$2,category=$3 WHERE id=$4',[String(b.title??c.title).slice(0,120),String(b.description??c.description).slice(0,500),String(b.category??c.category).slice(0,40),c.id]);return json(res,200,{channel:safeChannel(await channelBySlug(slug))})}
 if(req.method==='GET'&&/^\/api\/channels\/[^/]+$/.test(u.pathname)){const slug=decodeURIComponent(u.pathname.split('/')[3]||''),c=await channelBySlug(slug);if(!c)return json(res,404,{error:'Канал не найден'});const subs=await one('SELECT COUNT(*)::int n FROM subscriptions WHERE channel_id=$1',[c.id]);return json(res,200,{channel:{...safeChannel({...c,subscriberCount:subs.n}),viewers:await viewersCount(slug)},owner:c.username})}
 if(req.method==='POST'&&/^\/api\/channels\/[^/]+\/rotate-key$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!claim||Number(c.user_id)!==Number(claim.id))return json(res,403,{error:'Нет доступа'});const raw=crypto.randomBytes(32).toString('hex');await run('UPDATE channels SET stream_key_hash=$1 WHERE id=$2',[hashStreamKey(raw),c.id]);return json(res,200,{streamKey:raw})}
 if(req.method==='POST'&&/^\/api\/channels\/[^/]+\/live-beacon$/.test(u.pathname)){const slug=decodeURIComponent(u.pathname.split('/')[3]);const claim=auth(req),c=await channelBySlug(slug);if(!c||!claim||Number(c.user_id)!==Number(claim.id))return json(res,403,{error:'Нет доступа'});const sess=await one('SELECT id,peak_viewers FROM stream_sessions WHERE channel_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',[c.id]);if(sess)await run('UPDATE stream_sessions SET ended_at=$1,peak_viewers=GREATEST(COALESCE(peak_viewers,0),$2) WHERE id=$3',[now(),await viewersCount(c.slug),sess.id]);await run('UPDATE channels SET live=false WHERE id=$1',[c.id]);return json(res,200,{ok:true})}
 if(req.method==='POST'&&/^\/api\/channels\/[^/]+\/live$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!claim||Number(c.user_id)!==Number(claim.id))return json(res,403,{error:'Нет доступа'});const b=await body(req),live=!!b.live,wasLive=!!c.live;if(live===wasLive){if(live){const active=await one('SELECT id FROM stream_sessions WHERE channel_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',[c.id]);if(!active)await run('INSERT INTO stream_sessions(channel_id,started_at,created_at) VALUES($1,$2,$2) ON CONFLICT DO NOTHING',[c.id,now()])}return json(res,200,{ok:true,live,changed:false});}if(live){await run('INSERT INTO stream_sessions(channel_id,started_at,created_at) VALUES($1,$2,$2) ON CONFLICT DO NOTHING',[c.id,now()]);await run('UPDATE channels SET live=true WHERE id=$1',[c.id]);const followers=await q('SELECT user_id FROM subscriptions WHERE channel_id=$1',[c.id]);for(const f of followers)await notify(f.user_id,'live','Стример начал эфир',`${c.username}: ${c.title}`,`/channel.html?channel=${encodeURIComponent(c.slug)}`)}else{const sess=await one('SELECT id,peak_viewers FROM stream_sessions WHERE channel_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',[c.id]);if(sess)await run('UPDATE stream_sessions SET ended_at=$1,peak_viewers=GREATEST(COALESCE(peak_viewers,0),$2) WHERE id=$3',[now(),await viewersCount(c.slug),sess.id]);await run('UPDATE channels SET live=false WHERE id=$1',[c.id])}return json(res,200,{ok:true,live,changed:true})}
 if(req.method==='POST'&&/^\/api\/channels\/[^/]+\/subscribe$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!claim)return json(res,401,{error:'Нужна авторизация'});const exists=await one('SELECT 1 FROM subscriptions WHERE user_id=$1 AND channel_id=$2',[claim.id,c.id]);if(exists){await run('DELETE FROM subscriptions WHERE user_id=$1 AND channel_id=$2',[claim.id,c.id]);return json(res,200,{subscribed:false})}await run('INSERT INTO subscriptions(user_id,channel_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[claim.id,c.id,now()]);await notify(c.user_id,'subscription','Новый подписчик',`${claim.username} подписался на ваш канал`,`/channel.html?channel=${encodeURIComponent(c.slug)}`);return json(res,200,{subscribed:true})}
 if(req.method==='GET'&&/^\/api\/channels\/[^/]+\/moderators$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!await canModerate(claim,c.id))return json(res,403,{error:'Нет доступа'});return json(res,200,{moderators:await q('SELECT u.id,u.username FROM moderators m JOIN users u ON u.id=m.user_id WHERE m.channel_id=$1 ORDER BY u.username',[c.id])})}
 if(req.method==='GET'&&/^\/api\/channels\/[^/]+\/bans$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!await canModerate(claim,c.id))return json(res,403,{error:'Нет доступа'});return json(res,200,{bans:await q('SELECT u.id,u.username FROM bans b JOIN users u ON u.id=b.user_id WHERE b.channel_id=$1 ORDER BY u.username',[c.id])})}
 if(req.method==='POST'&&/^\/api\/channels\/[^/]+\/moderators$/.test(u.pathname)){const claim=auth(req),slug=decodeURIComponent(u.pathname.split('/')[3]),c=await channelBySlug(slug);if(!c||!await canModerate(claim,c.id))return json(res,403,{error:'Нет доступа'});const b=await body(req),u2=await one('SELECT id,username FROM users WHERE username=$1',[String(b.username||'')]);if(!u2)return json(res,404,{error:'Пользователь не найден'});await run('INSERT INTO moderators(channel_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[c.id,u2.id,now()]);return json(res,200,{ok:true})}
 if(req.method==='DELETE'&&/^\/api\/channels\/[^/]+\/moderators\/[^/]+$/.test(u.pathname)){const claim=auth(req),parts=u.pathname.split('/'),c=await channelBySlug(decodeURIComponent(parts[3]));if(!c||!await canModerate(claim,c.id))return json(res,403,{error:'Нет доступа'});const u2=await one('SELECT id FROM users WHERE username=$1',[decodeURIComponent(parts[5])]);if(u2)await run('DELETE FROM moderators WHERE channel_id=$1 AND user_id=$2',[c.id,u2.id]);return json(res,200,{ok:true})}
 if(req.method==='POST'&&u.pathname==='/api/donations'){const claim=auth(req),b=await body(req),c=await channelBySlug(String(b.channel||'')),amount=Math.floor(Number(b.amount));if(!c||!Number.isFinite(amount)||amount<50||amount>100000)return json(res,400,{error:'Минимум 50 ₽, максимум 100000 ₽'});const externalId='d2h-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex');const r=await run('INSERT INTO donations(from_user_id,channel_id,amount,currency,message,status,external_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[claim?.id||null,c.id,amount,'RUB',String(b.message||'').slice(0,300),'pending',externalId,now()]);return json(res,201,{donationId:r.rows[0].id,externalId,status:'pending',provider:'cloudpayments',enabled:!!process.env.CLOUDPAYMENTS_PUBLIC_ID,message:process.env.CLOUDPAYMENTS_PUBLIC_ID?'Готово к оплате через CloudPayments.':'Платёжный провайдер не настроен.'})}
 if(req.method==='POST'&&u.pathname==='/api/webhooks/cloudpayments/pay'){const raw=await rawBody(req),sig=String(req.headers['x-content-hmac']||''),secret=secret('CLOUDPAYMENTS_API_SECRET');if(!secret)return json(res,503,{error:'webhook secret not configured'});const expected=crypto.createHmac('sha256',secret).update(raw).digest('base64'),a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return json(res,401,{error:'invalid signature'});let data;try{data=JSON.parse(raw)}catch{return json(res,400,{error:'bad json'})}const external=String(data.InvoiceId||data.externalId||'');const d=await one('SELECT * FROM donations WHERE external_id=$1',[external]);if(d){const status=String(data.Status||'').toLowerCase();if(['completed','authorized'].includes(status)){const updated=await run('UPDATE donations SET status=$1 WHERE id=$2 AND status<>$1 RETURNING id',['paid',d.id]);if(updated.rowCount){const c=await one('SELECT user_id,slug FROM channels WHERE id=$1',[d.channel_id]);if(c)await notify(c.user_id,'donation','Новый донат',`Вам отправили ${d.amount} ₽${d.message?': '+d.message:''}`,`/channel.html?channel=${encodeURIComponent(c.slug)}`)}}else if(['declined','cancelled'].includes(status))await run('UPDATE donations SET status=$1 WHERE id=$2',['failed',d.id])}return json(res,200,{code:0})}
 if(req.method==='POST'&&u.pathname==='/api/moderation/ban'){const claim=auth(req),b=await body(req),c=await channelBySlug(String(b.channel||'')),target=await one('SELECT id FROM users WHERE username=$1',[String(b.username||'')]);if(!c||!target||!await canModerate(claim,c.id))return json(res,403,{error:'Нет доступа'});await run('INSERT INTO bans(channel_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[c.id,target.id,now()]);return json(res,200,{ok:true})}
 if(req.method==='POST'&&u.pathname==='/api/mediamtx/auth')return mediamtxAuth(req,res);
 return json(res,404,{error:'Not found'})
}

async function viewersCount(channel){try{return Number(await redis.sCard(`presence:${channel}`))||0}catch{return 0}}
async function initRedis(){await Promise.all([redis.connect(),pub.connect(),sub.connect()]);await sub.pSubscribe('chat:*',message=>{const channel=message.slice(message.indexOf(':')+1);let data;try{data=JSON.parse(message)}catch{return}broadcast(channel,data)});await sub.pSubscribe('presence:*',async message=>{const channel=message.slice(message.indexOf(':')+1);let data;try{data=JSON.parse(message)}catch{return}broadcast(channel,data)})}
function broadcast(ch,p){const raw=JSON.stringify(p);wss.clients.forEach(c=>{if(c.readyState===WebSocket.OPEN&&c.channel===ch)c.send(raw)})}
async function chatHistory(ch){try{const rows=await redis.lRange(`chat:${ch}`,0,79);return rows.reverse().map(x=>JSON.parse(x))}catch{return[]}}
async function handleWsMessage(ws,m){const ch=ws.channel;if(m.type==='chat'){const c=await channelBySlug(ch),claim=ws.claim;if(claim&&c&&await one('SELECT 1 FROM bans WHERE channel_id=$1 AND user_id=$2',[c.id,claim.id]))return;const text=String(m.text||'').trim().slice(0,300);if(!text)return;const msg={id:crypto.randomUUID(),user:String(claim?.username||'Гость').slice(0,32),text,ts:now()};await redis.lPush(`chat:${ch}`,JSON.stringify(msg));await redis.lTrim(`chat:${ch}`,0,299);await pub.publish(`chat:${ch}`,JSON.stringify({type:'chat',message:msg}))}
 if(m.type==='delete'){const c=await channelBySlug(ch),claim=ws.claim;if(c&&await canModerate(claim,c.id)){const rows=await redis.lRange(`chat:${ch}`,0,299),filtered=rows.filter(x=>{try{return JSON.parse(x).id!==m.messageId}catch{return true}});await redis.del(`chat:${ch}`);if(filtered.length)await redis.rPush(`chat:${ch}`,...filtered.reverse());await pub.publish(`chat:${ch}`,JSON.stringify({type:'delete',messageId:m.messageId}))}}
 if(m.type==='ban'){const c=await channelBySlug(ch),claim=ws.claim;if(c&&await canModerate(claim,c.id)){const target=await one('SELECT id FROM users WHERE username=$1',[String(m.username||'')]);if(target){await run('INSERT INTO bans(channel_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[c.id,target.id,now()]);await pub.publish(`chat:${ch}`,JSON.stringify({type:'system',text:`${m.username} заблокирован модератором`}))}}}}

const server=http.createServer(async(req,res)=>{securityHeaders(res);if(req.method==='OPTIONS'){if(!checkOrigin(req))return json(res,403,{error:'CORS origin denied'});res.writeHead(204,{'Access-Control-Allow-Origin':PUBLIC_ORIGIN||req.headers.origin||'','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, Authorization, X-CSRF-Token','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'});return res.end()}try{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname.startsWith('/api/')){if(!checkOrigin(req))return json(res,403,{error:'CORS origin denied'});res.setHeader('Access-Control-Allow-Origin',PUBLIC_ORIGIN||req.headers.origin||'');res.setHeader('Access-Control-Allow-Credentials','true');if(!requireCsrf(req))return json(res,403,{error:'CSRF validation failed'});const general=await rateLimit(req,'api:'+req.socket.remoteAddress,300,60);if(!general.ok)return json(res,429,{error:'Слишком много запросов.'},{'Retry-After':'60'});return await api(req,res,u)}serveStatic(req,res,u)}catch(e){console.error(e);json(res,e.status||500,{error:e.status===400?'Некорректный JSON':'server error'})}});
function serveStatic(req,res,u){let p=u.pathname==='/'?'/index.html':u.pathname;const root=path.resolve(__dirname),file=path.resolve(root,'.'+decodeURIComponent(p));if(!file.startsWith(root))return json(res,403,{error:'Forbidden'});fs.stat(file,(e,s)=>{if(e||!s.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':p.endsWith('.html')?'no-cache':'public, max-age=3600'});fs.createReadStream(file).pipe(res)})}

server.on('upgrade',(req,socket,head)=>{try{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/ws')return socket.destroy();if(!allowedOrigin(req.headers.origin))return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>{ws.channel=decodeURIComponent(u.searchParams.get('channel')||'lobby').slice(0,64);ws.token=u.searchParams.get('token')||'';ws.claim=verifyToken(ws.token);ws.user=ws.claim?.username||'Гость';wss.emit('connection',ws)})}catch{socket.destroy()}});
wss.on('connection',async ws=>{const ch=ws.channel;ws.viewerId=crypto.randomUUID();try{await redis.sAdd(`presence:${ch}`,ws.viewerId);await redis.expire(`presence:${ch}`,120);ws.send(JSON.stringify({type:'history',messages:await chatHistory(ch)}));await pub.publish(`presence:${ch}`,JSON.stringify({type:'presence',viewers:await viewersCount(ch)}))}catch{}const heartbeat=setInterval(async()=>{if(ws.readyState!==WebSocket.OPEN)return;try{await redis.expire(`presence:${ch}`,120);await redis.sAdd(`presence:${ch}`,ws.viewerId);const c=await channelBySlug(ch);if(c&&c.live){const sess=await one('SELECT id,peak_viewers FROM stream_sessions WHERE channel_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',[c.id]);if(sess){const viewers=await viewersCount(ch);if(viewers>Number(sess.peak_viewers||0))await run('UPDATE stream_sessions SET peak_viewers=$1 WHERE id=$2',[viewers,sess.id])}}}catch{}},30000);ws.on('message',async raw=>{try{const m=JSON.parse(raw);await handleWsMessage(ws,m)}catch{}});ws.on('close',async()=>{clearInterval(heartbeat);try{await redis.sRem(`presence:${ch}`,ws.viewerId);await pub.publish(`presence:${ch}`,JSON.stringify({type:'presence',viewers:await viewersCount(ch)}))}catch{}})});

(async()=>{await initDb();await initRedis();server.listen(PORT,()=>console.log(`Dota2 Helper production server on ${PORT}`))})().catch(e=>{console.error(e);process.exit(1)});
