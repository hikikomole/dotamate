// Cloudflare Worker: serves the static site (via env.ASSETS) and proxies a few
// same-origin "/api/dota/*" endpoints that js/app.js expects, so hero abilities,
// hero item-popularity and item detail actually load in production (previously
// only implemented in the old Node server.js / preview-server.js, which is not
// deployed here). Ported 1:1 from server.js's logic, with Redis caching replaced
// by the Workers Cache API.

const VDF_RU_URL = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// OpenDota's free API is shared across every Cloudflare Worker on the
// planet, so its rate limits get hit from our egress IP far more often
// than from a normal browser/device IP. A couple of short retries absorb
// most of those transient 429/5xx blips without the caller noticing.
async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.ok) return await r.json();
      lastErr = new Error('HTTP ' + r.status + ' for ' + url);
      if (r.status !== 429 && r.status < 500) break; // don't retry real client errors
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 2) await sleep(400 * (attempt + 1));
  }
  throw lastErr;
}

async function fetchJsonSafe(url) { return fetchJson(url); }

// --- Workers Cache API helper (replaces the old server's Redis cache) ---
async function cachedJson(cacheKey, ttlSeconds, fetcher) {
  const cache = caches.default;
  const cacheReq = new Request('https://cache.internal/' + encodeURIComponent(cacheKey));
  const hit = await cache.match(cacheReq);
  if (hit) { try { return await hit.json(); } catch { /* fall through and refetch */ } }
  const data = await fetcher();
  try {
    await cache.put(cacheReq, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` }
    }));
  } catch { /* cache write is best-effort */ }
  return data;
}

// --- Official Valve Russian ability/item text (same source as the old server) ---
function parseVdfTokens(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const map = new Map();
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*"((?:[^"\\]|\\.)*)"/;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const m = line.match(re);
    if (m) map.set(m[1].toLowerCase(), m[2].replace(/\\"/g, '"'));
  }
  return map;
}
function buildAttribMap(attribArr) {
  const m = new Map();
  for (const a of attribArr || []) {
    if (!a || !a.key) continue;
    let v = a.value; if (Array.isArray(v)) v = v.join('/');
    m.set(String(a.key).toLowerCase(), String(v));
  }
  return m;
}
function fillPlaceholders(text, attribMap) {
  return text.replace(/%([a-zA-Z0-9_]+)%/g, (full, name) => {
    const v = attribMap.get(name.toLowerCase());
    return v === undefined ? full : v;
  });
}
function hasUnresolvedPlaceholder(text) { return /%[a-zA-Z0-9_]+%/.test(text); }

async function getOfficialRuMap() {
  const pairs = await cachedJson('vdf-ru-v1', 60 * 60 * 24, async () => {
    const r = await fetch(VDF_RU_URL, { headers: { Accept: 'text/plain' } });
    if (!r.ok) throw new Error('VDF HTTP ' + r.status);
    const text = await r.text();
    return [...parseVdfTokens(text)];
  });
  return new Map(pairs);
}

async function resolveRuText(internalKey, isItem, attribArr) {
  const none = { text: '', source: 'none' };
  if (!internalKey) return none;
  try {
    const vdf = await getOfficialRuMap();
    const tokenKey = ('DOTA_Tooltip_ability_' + (isItem ? 'item_' : '') + internalKey + '_Description').toLowerCase();
    let text = vdf.get(tokenKey);
    if (!text) return none;
    text = fillPlaceholders(text, buildAttribMap(attribArr));
    if (hasUnresolvedPlaceholder(text)) return none;
    return { text, source: 'official-ru' };
  } catch (e) {
    return none;
  }
}

async function fetchStaticJson(env, path) {
  const res = await env.ASSETS.fetch(new Request('https://internal.assets' + path));
  if (!res.ok) throw new Error('static asset ' + path + ' HTTP ' + res.status);
  return res.json();
}

// OpenDota's hero/ability constants change only with game patches, so a
// bundled static snapshot (data/hero_abilities.json, data/abilities.json --
// fetched once at deploy time) is a safe fallback when the live call gets
// rate-limited (see fetchJson's comment above the retry loop).
async function getConstantsMap(url, cacheKey, ttlSec, fallbackPath, env) {
  try {
    return await cachedJson(cacheKey, ttlSec, () => fetchJson(url));
  } catch (e) {
    if (fallbackPath && env) {
      try { return await fetchStaticJson(env, fallbackPath); } catch (e2) { /* fall through to original error */ }
    }
    throw e;
  }
}

// --- Hero abilities: OpenDota constants (which abilities a hero has + their
// English metadata/attrib) + Valve's own RU localization for the description text.
async function getHeroAbilities(heroInternalName, env) {
  const [heroAbilitiesMap, abilitiesMap] = await Promise.all([
    getConstantsMap('https://api.opendota.com/api/constants/hero_abilities', 'const-hero-abilities-v1', 60 * 60 * 24, '/data/hero_abilities.json', env),
    getConstantsMap('https://api.opendota.com/api/constants/abilities', 'const-abilities-v1', 60 * 60 * 24, '/data/abilities.json', env)
  ]);
  const entry = heroAbilitiesMap[heroInternalName];
  if (!entry || !Array.isArray(entry.abilities)) return [];
  const keys = entry.abilities.filter(k => k && k !== 'generic_hidden').slice(0, 6);
  const out = [];
  for (const key of keys) {
    const a = abilitiesMap[key]; if (!a) continue;
    const dname = a.dname || key;
    const r = await resolveRuText(key, false, a.attrib);
    out.push({ key, dname, desc: r.text, source: r.source, behavior: a.behavior || '' });
  }
  return out;
}

// --- Hero item popularity: straight OpenDota pass-through, cached 12h. ---
async function getHeroItemPopularity(heroId) {
  return cachedJson('hero-items-' + heroId, 60 * 60 * 12, () =>
    fetchJson(`https://api.opendota.com/api/heroes/${encodeURIComponent(heroId)}/itemPopularity`)
  );
}

// --- Item list merge (Valve datafeed + OpenDota constants + dotaconstants
// fallback), same 3-source merge the old server used, cached 6h. ---
function officialItems(j) { return j?.result?.data?.itemabilities || j?.result?.data?.items || j?.data?.itemabilities || j?.data?.items || []; }
function objectValues(j) { if (Array.isArray(j)) return j; if (j && typeof j === 'object') return Object.values(j); return []; }
function normalizeItems(source) {
  let arr = officialItems(source); if (!arr.length) arr = objectValues(source);
  const out = [], seen = new Set();
  for (const raw of arr) {
    if (!raw || !raw.id || !raw.name) continue;
    const x = { ...raw, id: Number(raw.id), dname: raw.dname || raw.name_loc || raw.name_english_loc || raw.name };
    if (seen.has(x.id)) continue; seen.add(x.id); out.push(x);
  }
  return out;
}
function mergeItems(base, constants) {
  const m = new Map(constants.map(x => [Number(x.id), x]));
  return base.map(x => ({ ...m.get(Number(x.id)), ...x, dname: x.dname || m.get(Number(x.id))?.dname || x.name }));
}
async function fetchItemsList() {
  const [o, s, c] = await Promise.allSettled([
    fetchJsonSafe('https://www.dota2.com/datafeed/itemlist?language=english'),
    fetchJsonSafe('https://api.opendota.com/api/constants/items'),
    fetchJsonSafe('https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json')
  ]);
  const official = o.status === 'fulfilled' ? normalizeItems(o.value) : [];
  const constants = s.status === 'fulfilled' ? objectValues(s.value) : [];
  const staticItems = c.status === 'fulfilled' ? normalizeItems(c.value) : [];
  const base = official.length ? official : (constants.length ? constants : staticItems);
  if (!base.length) throw new Error('No item source available');
  const merged = mergeItems(base, constants);
  if (merged.length < 100) throw new Error('Item source incomplete: ' + merged.length);
  return merged;
}
async function getItemsList() {
  return cachedJson('items-list-v2', 60 * 60 * 6, fetchItemsList);
}
async function fetchOfficialItem(itemId) {
  const r = await fetch(`https://www.dota2.com/datafeed/itemdata?language=english&item_id=${encodeURIComponent(itemId)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Valve itemdata HTTP ' + r.status);
  const payload = await r.json();
  const d = payload?.result?.data?.itemability || payload?.result?.data?.itemabilities?.[0] || payload?.result?.data?.items?.[0] || payload?.result?.data?.item
    || payload?.data?.itemability || payload?.data?.itemabilities?.[0] || payload?.data?.items?.[0] || payload?.data?.item;
  if (!d) throw new Error('Official item detail missing');
  return d;
}
async function getItemDetail(itemId) {
  const raw = await cachedJson('item-detail-' + itemId, 60 * 60 * 24 * 30, () => fetchOfficialItem(itemId));
  const internalKey = String(raw.name || '').replace(/^item_/, '');
  let attrib = [];
  try { const list = await getItemsList(); attrib = list.find(x => Number(x.id) === Number(itemId))?.attrib || []; } catch { }
  const r = await resolveRuText(internalKey, true, attrib);
  return { ...raw, desc_loc: r.text, description: r.text, source: r.source };
}

async function handleApi(pathname, env) {
  let m;
  if ((m = pathname.match(/^\/api\/dota\/hero\/(\d+)\/items$/))) {
    try { return jsonResponse(await getHeroItemPopularity(Number(m[1]))); }
    catch (e) { return jsonResponse({ error: 'hero_items_unavailable', message: e.message }, 502); }
  }
  if ((m = pathname.match(/^\/api\/dota\/hero\/([a-zA-Z0-9_]+)\/abilities$/))) {
    try { return jsonResponse(await getHeroAbilities(m[1], env)); }
    catch (e) { return jsonResponse({ error: 'hero_abilities_unavailable', message: e.message }, 502); }
  }
  if ((m = pathname.match(/^\/api\/dota\/item\/(\d+)$/))) {
    try { return jsonResponse(await getItemDetail(Number(m[1]))); }
    catch (e) { return jsonResponse({ error: 'item_unavailable', message: e.message }, 502); }
  }
  return jsonResponse({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/dota/')) {
      if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
      return handleApi(url.pathname, env);
    }
    return env.ASSETS.fetch(request);
  }
};
