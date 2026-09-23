#!/usr/bin/env node
/**
 * Снимок способностей всех героев для локальной отдачи.
 *
 * Зачем: карточка героя на главной ходила за способностями в /api/dota/... на
 * каждое открытие. Способности меняются только с патчами Dota, то есть раз в
 * несколько недель, поэтому держать их локально быстрее и надёжнее —
 * страница не зависит ни от OpenDota, ни от доступности воркера.
 *
 * Обновление — раз в три месяца (см. data/hero-abilities.json, поле
 * fetchedAt и nextRefresh). Скрипт сам предупредит, если снимок свежий.
 *
 * Запуск: node tools/fetch-hero-abilities.js [--force]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'hero-abilities.json');
const REFRESH_DAYS = 90;
const VDF_RU_URL = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Алгоритм тот же, что в deploy/worker.js (getHeroAbilities + resolveRuText),
// но справочники берутся ОДИН раз на всех героев, а не на каждого отдельно.
// Через воркер сбор занимал бы часы: он ходит в OpenDota на каждый запрос.
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
const fillPlaceholders = (text, attribMap) =>
  text.replace(/%([a-zA-Z0-9_]+)%/g, (full, name) => {
    const v = attribMap.get(name.toLowerCase());
    return v === undefined ? full : v;
  });
const hasUnresolved = t => /%[a-zA-Z0-9_]+%/.test(t);

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(url.split('/').pop() + ' HTTP ' + r.status);
  return r.json();
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      const ageDays = (Date.now() - new Date(prev.fetchedAt).getTime()) / 86400000;
      if (ageDays < REFRESH_DAYS) {
        console.log(`Снимку ${Math.round(ageDays)} дн., обновление раз в ${REFRESH_DAYS}. Нечего делать (--force чтобы всё равно обновить).`);
        return;
      }
    } catch { /* повреждён — собираем заново */ }
  }

  const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;

  const [heroAbilitiesMap, abilitiesMap] = await Promise.all([
    getJson('https://api.opendota.com/api/constants/hero_abilities'),
    getJson('https://api.opendota.com/api/constants/abilities')
  ]);
  const vdfRes = await fetch(VDF_RU_URL, { headers: { Accept: 'text/plain' } });
  if (!vdfRes.ok) throw new Error('локализация Valve HTTP ' + vdfRes.status);
  const vdf = parseVdfTokens(await vdfRes.text());
  console.log(`Справочники получены: героев ${Object.keys(heroAbilitiesMap).length}, строк локализации ${vdf.size}.`);

  const out = {};
  let ok = 0, noRu = 0;
  const missed = [];

  for (const h of heroes) {
    const entry = heroAbilitiesMap[h.name];
    if (!entry || !Array.isArray(entry.abilities)) { missed.push(h.localized_name); continue; }
    const keys = entry.abilities.filter(k => k && k !== 'generic_hidden').slice(0, 6);
    const list = [];
    for (const key of keys) {
      const a = abilitiesMap[key];
      if (!a) continue;
      const token = ('DOTA_Tooltip_ability_' + key + '_Description').toLowerCase();
      let desc = vdf.get(token) || '';
      if (desc) {
        desc = fillPlaceholders(desc, buildAttribMap(a.attrib));
        if (hasUnresolved(desc)) desc = '';
      }
      if (!desc) noRu++;
      list.push({ key, dname: a.dname || key, desc, source: desc ? 'official-ru' : 'none', behavior: a.behavior || '' });
    }
    if (!list.length) { missed.push(h.localized_name); continue; }
    out[h.id] = list;
    ok++;
  }
  console.log(`Способностей без русского описания: ${noRu}.`);

  // Частичный снимок хуже старого целого: лучше не трогать файл.
  if (ok < heroes.length * 0.9) {
    console.error(`Получено только ${ok} из ${heroes.length} — снимок не записан, чтобы не испортить рабочий.`);
    process.exit(1);
  }

  const now = new Date();
  const next = new Date(now.getTime() + REFRESH_DAYS * 86400000);
  fs.writeFileSync(OUT, JSON.stringify({
    source: 'OpenDota constants + официальная русская локализация Valve',
    fetchedAt: now.toISOString(),
    nextRefresh: next.toISOString(),
    refreshDays: REFRESH_DAYS,
    heroCount: ok,
    heroes: out
  }));
  console.log(`Готово: ${ok} героев. Следующее обновление после ${next.toISOString().slice(0, 10)}.`);
  if (missed.length) console.log('Не ответили:', missed.join(', '));
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
