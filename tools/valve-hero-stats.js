// Характеристики героя на 1-м уровне из официального datafeed Valve
// (dota2.com/datafeed/herodata): здоровье, мана, броня, урон, скорость.
// Раньше страницы брали base_health/base_mana из OpenDota — это константы 120/75
// без учёта атрибутов, и у всех героев было «HP 120, Mana 75».
// Удачный ответ кешируется в data/hero-base-stats.json; если Valve недоступен —
// берётся кеш; нет и кеша — блок характеристик просто не выводится.
'use strict';
const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, '..', 'data', 'hero-base-stats.json');
const URL = id => `https://www.dota2.com/datafeed/herodata?language=russian&hero_id=${id}`;

async function fetchOne(id, fetcher = fetch, signal = AbortSignal.timeout(20000)) {
  const r = await fetcher(URL(id), { signal });
  if (!r.ok) throw new Error(`hero ${id}: HTTP ${r.status}`);
  const d = (await r.json())?.result?.data?.heroes?.[0];
  if (!d || d.max_health == null) throw new Error(`hero ${id}: пустой ответ`);
  const abilities = {};
  for (const a of d.abilities || []) if (a.name && a.name_loc) abilities[a.name] = a.name_loc;
  return { hp: d.max_health, mp: d.max_mana, armor: d.armor, dmin: d.damage_min, dmax: d.damage_max, ms: d.movement_speed, range: d.attack_range,
    language: 'russian', name_loc: d.name_loc, abilities, fetchedAt: new Date().toISOString() };
}

async function load(ids) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')).heroes || {}; } catch {}
  const out = { ...cache }; let fresh = 0, failed = 0;
  const queue = [...ids];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        if (cache[id]?.language === 'russian' && Date.now() - Date.parse(cache[id].fetchedAt) < 86400000) continue;
        out[id] = await fetchOne(id); fresh++;
      } catch (e) { failed++; }
    }
  }));
  if (fresh) fs.writeFileSync(CACHE, JSON.stringify({ source: 'dota2.com/datafeed/herodata', fetchedAt: new Date().toISOString(), heroes: out }));
  console.log(`Характеристики Valve: свежих ${fresh}, ошибок ${failed}, из кеша ${Object.keys(out).length - fresh}.`);
  return out;
}

// Карточки для строки характеристик. Нет данных — пустой список (не выдумываем цифры).
function cells(v) {
  if (!v) return [];
  const arm = Number(v.armor);
  return [
    { k: 'Здоровье', v: v.hp },
    { k: 'Мана', v: v.mp },
    { k: 'Броня', v: Number.isFinite(arm) ? arm.toFixed(1).replace('.', ',') : '—' },
    { k: 'Урон', v: `${v.dmin}–${v.dmax}` },
    { k: 'Скорость', v: v.ms }
  ];
}
module.exports = { load, cells, fetchOne, CACHE };
