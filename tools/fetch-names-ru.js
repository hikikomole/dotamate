#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'data', 'names-ru.json');
const URL = 'https://www.dota2.com/datafeed/';
const { CACHE } = require('./valve-hero-stats');
const LANGUAGE = 'language=russian';

async function feed(endpoint, language, fetcher = fetch, signal = AbortSignal.timeout(20000)) {
  const r = await fetcher(URL + endpoint + '?' + language, { signal, headers: { 'Accept-Language': 'ru-RU,ru;q=0.9' } });
  if (!r.ok) throw new Error(endpoint + ': HTTP ' + r.status);
  return (await r.json())?.result?.data;
}
function list(data, key) {
  const value = data?.[key];
  return Array.isArray(value) ? value : Object.values(value || {});
}
async function build(fetcher = fetch, out = OUT, options = {}) {
  const deadline = Date.now() + (options.totalMs ?? 180000);
  const signal = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Valve total time cap exceeded');
    return AbortSignal.timeout(Math.min(20000, remaining));
  };
  const heroData = await feed('herolist', LANGUAGE, fetcher, signal());
  const itemData = await feed('itemlist', LANGUAGE, fetcher, signal());
  const heroes = {}, items = {}, abilities = {};
  for (const h of list(heroData, 'heroes')) if (h.id && typeof h.name_loc === 'string' && h.name_loc.trim()) heroes[h.id] = h.name_loc;
  for (const i of list(itemData, itemData?.itemabilities ? 'itemabilities' : 'items')) {
    const key = i.name?.replace(/^item_/, '') || i.name_key;
    if (key && typeof i.name_loc === 'string' && i.name_loc.trim()) items[key] = i.name_loc;
  }
  if (Object.keys(heroes).length < 120 || Object.keys(items).length < 300) throw new Error(`Valve catalog too small (${Object.keys(heroes).length} heroes, ${Object.keys(items).length} items); previous file kept`);
  const cachePath = options.cache ?? CACHE;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')).heroes || {}; } catch {}
  let requested = false;
  for (const id of Object.keys(heroes)) {
    let hero = cache[id];
    if (hero?.language !== 'russian' || !hero.name_loc || !Object.keys(hero.abilities || {}).length || !(Date.now() - Date.parse(hero.fetchedAt) < 86400000)) {
      if (requested) await new Promise(resolve => setTimeout(resolve, Math.min(options.delayMs ?? 250, Math.max(0, deadline - Date.now()))));
      const heroUrl = `https://www.dota2.com/datafeed/herodata?${LANGUAGE}&hero_id=${id}`;
      const response = await fetcher(heroUrl, { signal: signal(), headers: { 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!response.ok) throw new Error(`herodata: HTTP ${response.status}`);
      const data = (await response.json())?.result?.data;
      const detail = list(data, 'heroes')[0];
      if (!detail) throw new Error(`hero ${id}: missing details`);
      const heroAbilities = {};
      for (const ability of detail.abilities || []) if (ability.name && ability.name_loc) heroAbilities[ability.name] = ability.name_loc;
      hero = { hp: detail.max_health, mp: detail.max_mana, armor: detail.armor, dmin: detail.damage_min, dmax: detail.damage_max, ms: detail.movement_speed, range: detail.attack_range,
        language: 'russian', name_loc: detail.name_loc, abilities: heroAbilities, fetchedAt: new Date().toISOString() };
      cache[id] = hero;
      requested = true;
    }
    if (typeof hero.name_loc !== 'string' || !hero.name_loc.trim() || !Object.keys(hero.abilities || {}).length || Object.values(hero.abilities).some(name => typeof name !== 'string' || !name.trim())) throw new Error(`hero ${id}: missing localized names/abilities`);
    heroes[id] = hero.name_loc;
    Object.assign(abilities, hero.abilities);
  }
  signal();
  if (requested) require('./match-source').writeJsonAtomic(cachePath, { source: 'dota2.com/datafeed/herodata', fetchedAt: new Date().toISOString(), heroes: cache });
  const tmp = out + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ builtAt: new Date().toISOString(), heroes, items, abilities }));
    fs.renameSync(tmp, out);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  return { heroes, items, abilities };
}
if (require.main === module) build().then(x => console.log(`Valve samples: ${x.heroes[14] || Object.values(x.heroes)[0]} | ${x.items.blink} | ${Object.values(x.abilities)[0]}`))
  .catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { build };
