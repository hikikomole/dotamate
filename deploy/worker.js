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
// Valve's own desc_loc (English) still has unresolved %placeholder% tokens --
// fill those from the item's own special_values so the English fallback reads
// like a real tooltip instead of leftover template syntax.
function fillItemPlaceholders(text, specialValues) {
  const clean = String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const map = new Map();
  for (const sv of specialValues || []) {
    if (!sv || !sv.name) continue;
    const vals = Array.isArray(sv.values_float) && sv.values_float.length ? sv.values_float
      : (Array.isArray(sv.values) && sv.values.length ? sv.values : null);
    if (vals) map.set(String(sv.name).toLowerCase(), vals.join('/'));
  }
  return clean.replace(/%([a-zA-Z0-9_]+)%/g, (full, name) => {
    const v = map.get(name.toLowerCase());
    return v === undefined ? full : v;
  });
}

async function getItemDetail(itemId) {
  const raw = await cachedJson('item-detail-' + itemId, 60 * 60 * 24 * 30, () => fetchOfficialItem(itemId));
  const internalKey = String(raw.name || '').replace(/^item_/, '');
  let attrib = [];
  try { const list = await getItemsList(); attrib = list.find(x => Number(x.id) === Number(itemId))?.attrib || []; } catch { }
  const r = await resolveRuText(internalKey, true, attrib);
  // Official Russian text first; if Valve hasn't localized this item (true for
  // some hidden/internal objects), fall back to the English datafeed text
  // with its own placeholders filled in -- never fall back further to the
  // item's own name, which reads as nonsense ("description: Item Name").
  const englishDesc = fillItemPlaceholders(raw.desc_loc, raw.special_values);
  const desc = r.text || englishDesc;
  const source = r.text ? r.source : (englishDesc ? 'official-en' : 'none');
  return { ...raw, desc_loc: desc, description: desc, source };
}


// --- Статистика героев по пяти позициям (Stratz GraphQL).
// Stratz обновляет срез не чаще раза в сутки, поэтому и мы ходим туда раз в
// сутки: cachedJson держит ответ 24 часа, а при недоступности API или
// отсутствии токена отдаём снимок из data/hero-positions.json — страница
// показывает вчерашние настоящие числа вместо пустоты.
const STRATZ_ENDPOINT = 'https://api.stratz.com/graphql';
const STRATZ_BRACKET = 'DIVINE_IMMORTAL';
const POSITION_KEYS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];

async function fetchStratzPositions(token) {
  const query = `{ heroStats { stats(bracketBasicIds:[${STRATZ_BRACKET}], groupByPosition:true) { heroId position matchCount winCount } } }`;
  const res = await fetch(STRATZ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'STRATZ_API'
    },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error('stratz HTTP ' + res.status);
  const j = await res.json();
  if (j.errors) throw new Error('stratz errors: ' + JSON.stringify(j.errors).slice(0, 200));
  const rows = j?.data?.heroStats?.stats || [];
  if (!rows.length) throw new Error('stratz returned no rows');

  const heroes = {};
  for (const r of rows) {
    if (!POSITION_KEYS.includes(r.position)) continue;
    const id = String(r.heroId);
    if (!heroes[id]) heroes[id] = { positions: {}, totalMatches: 0, totalWins: 0, topPosition: null, mainPositions: [] };
    heroes[id].positions[r.position] = {
      matches: r.matchCount,
      wins: r.winCount,
      winrate: r.matchCount ? Number((r.winCount / r.matchCount * 100).toFixed(1)) : null
    };
  }
  for (const h of Object.values(heroes)) {
    h.totalMatches = POSITION_KEYS.reduce((s, p) => s + (h.positions[p]?.matches || 0), 0);
    h.totalWins = POSITION_KEYS.reduce((s, p) => s + (h.positions[p]?.wins || 0), 0);
    for (const p of POSITION_KEYS) {
      if (h.positions[p]) h.positions[p].share = h.totalMatches ? Number((h.positions[p].matches / h.totalMatches * 100).toFixed(1)) : 0;
    }
    h.topPosition = POSITION_KEYS.filter(p => h.positions[p]).sort((a, b) => h.positions[b].matches - h.positions[a].matches)[0] || null;
    h.mainPositions = POSITION_KEYS.filter(p => h.positions[p] && h.positions[p].share >= 10);
  }
  return {
    source: 'Stratz GraphQL API',
    bracket: STRATZ_BRACKET,
    fetchedAt: new Date().toISOString(),
    heroCount: Object.keys(heroes).length,
    heroes
  };
}

async function getHeroPositions(env) {
  const token = env && env.STRATZ_TOKEN;
  if (token) {
    try {
      return await cachedJson('hero-positions-v1', 60 * 60 * 24, () => fetchStratzPositions(token));
    } catch (e) { /* ниже отдадим снимок */ }
  }
  return fetchStaticJson(env, '/data/hero-positions.json');
}


// --- Билд героя: прокачка, таланты и тайминги предметов по его позициям.
// Отдаём по одному герою, а не весь массив: суммарно билды весят около мегабайта,
// и гнать их целиком на каждый холодный кеш незачем. Живой запрос к Stratz здесь
// не делаем — пересчёт «популярного выбора на каждом уровне» требует нескольких
// запросов и агрегации (см. fetch-hero-builds.js), это работа сборки, а не воркера.
// Снимок обновляется тем же скриптом и раскладывается в ассеты.
async function getHeroBuild(heroId, env) {
  return cachedJson('hero-build-' + heroId, 60 * 60 * 24, () =>
    fetchStaticJson(env, '/data/builds/' + heroId + '.json'));
}


// --- Про-показатели героев (пики, победы, баны на профессиональной сцене).
// Раньше за ними ходил БРАУЗЕР КАЖДОГО ПОСЕТИТЕЛЯ напрямую в OpenDota: чужой
// домен в сетевых запросах сайта, зависимость от их доступности и лимитов на
// каждого гостя. Теперь это один запрос с воркера раз в сутки, а при
// недоступности OpenDota отдаём снимок из ассетов — цифры будут от даты
// сборки, но страница не сломается.
async function getHeroStats(env) {
  try {
    return await cachedJson('hero-stats-v1', 60 * 60 * 24, () =>
      fetchJson('https://api.opendota.com/api/heroStats'));
  } catch (e) {
    const local = await fetchStaticJson(env, '/data/heroes.json');
    return local && local.heroes ? local.heroes : [];
  }
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
  if (pathname === '/api/dota/hero-positions') {
    try { return jsonResponse(await getHeroPositions(env)); }
    catch (e) { return jsonResponse({ error: 'hero_positions_unavailable', message: e.message }, 502); }
  }
  if ((m = pathname.match(/^\/api\/dota\/hero\/(\d+)\/build$/))) {
    try { return jsonResponse(await getHeroBuild(Number(m[1]), env)); }
    catch (e) { return jsonResponse({ error: 'hero_build_unavailable', message: e.message }, 404); }
  }
  if (pathname === '/api/dota/hero-stats') {
    try { return jsonResponse(await getHeroStats(env)); }
    catch (e) { return jsonResponse({ error: 'hero_stats_unavailable', message: e.message }, 502); }
  }
  return jsonResponse({ error: 'not_found' }, 404);
}


// --- Переадресация со страниц, которых больше нет.
// Dagon и Necronomicon лежали в каталоге как несколько записей с одинаковым
// названием — это уровни одного предмета, и в сетке они выглядели дублями.
// Теперь у них одна страница. Старые адреса были в поиске и во внешних
// ссылках, поэтому отдаём постоянную переадресацию, а не 404.
const MERGED_ITEM_PAGES = {
  dagon_2: 'dagon', dagon_3: 'dagon', dagon_4: 'dagon', dagon_5: 'dagon',
  necronomicon_2: 'necronomicon', necronomicon_3: 'necronomicon',
  // Тот же предмет, добытый иначе: версии с Рошана и заряд Tango от союзника
  aghanims_shard_roshan: 'aghanims_shard',
  ultimate_scepter_roshan: 'ultimate_scepter_2',
  tango_single: 'tango'
};
function mergedItemRedirect(url) {
  const m = url.pathname.match(/^\/item\/([a-z0-9_]+)\/?$/);
  if (!m) return null;
  const target = MERGED_ITEM_PAGES[m[1]];
  if (!target) return null;
  return Response.redirect(new URL('/item/' + target + '/', url).toString(), 301);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirect = mergedItemRedirect(url);
    if (redirect) return redirect;
    if (url.pathname.startsWith('/api/dota/')) {
      if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
      return handleApi(url.pathname, env);
    }
    return env.ASSETS.fetch(request);
  }
};
