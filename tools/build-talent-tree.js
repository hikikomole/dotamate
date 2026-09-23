#!/usr/bin/env node
/**
 * Полное дерево талантов героев: обе стороны на каждом из уровней 10/15/20/25,
 * в игровом порядке, с готовым названием.
 *
 * Зачем отдельный справочник: Stratz присылает только те таланты, которые
 * брали хотя бы раз, и его собственный список talents тоже дырявый (у
 * Phantom Lancer там 3 слота из 8). Из-за этого дерево на странице
 * рисовалось наполовину пустым. Полное дерево есть у OpenDota
 * (constants/hero_abilities), названия — у Valve.
 *
 * Названия собираются по цепочке, первый непустой побеждает:
 *   1) заголовок из Stratz — там числа уже подставлены;
 *   2) официальная английская локализация Valve + значения из datafeed;
 *   3) dname у OpenDota.
 *
 * Запуск: node tools/build-talent-tree.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'talent-tree.json');
const EN_URL = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_english.txt';
const LEVELS = { 1: 10, 2: 15, 3: 20, 4: 25 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = t => String(t || '').replace(/<[^>]*>/g, '').replace(/\\n/g, ' ').replace(/%%/g, '%').replace(/\s+/g, ' ').trim();

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(url.split('/').pop() + ' HTTP ' + r.status);
  return r.json();
}

/** Значения для плейсхолдеров {s:name} — из официального datafeed Valve */
async function valveValues(abilityId) {
  try {
    const r = await fetch(`https://www.dota2.com/datafeed/abilitydata?language=english&ability_id=${abilityId}`);
    if (!r.ok) return null;
    const a = (await r.json())?.result?.data?.abilities?.[0];
    if (!a) return null;
    const out = {};
    for (const sv of (a.special_values || [])) {
      const v = (sv.values_float || [])[0];
      if (sv.name && v != null) out[sv.name] = Number.isInteger(v) ? v : Number(v.toFixed(2));
    }
    return { name: clean(a.name_loc), values: out };
  } catch { return null; }
}

function fill(text, values) {
  return String(text || '').replace(/\{s:([a-zA-Z0-9_]+)\}/g, (m, key) =>
    values && values[key] != null ? String(values[key]) : m);
}

async function main() {
  const [heroAbilities, abilityMeta, abilityIds] = await Promise.all([
    getJson('https://api.opendota.com/api/constants/hero_abilities'),
    getJson('https://api.opendota.com/api/constants/abilities'),
    getJson('https://api.opendota.com/api/constants/ability_ids')
  ]);

  const enRes = await fetch(EN_URL, { headers: { Accept: 'text/plain' } });
  if (!enRes.ok) throw new Error('локализация Valve HTTP ' + enRes.status);
  const enText = (await enRes.text()).replace(/^\uFEFF/, '');
  const enNames = {};
  const re = /"DOTA_Tooltip_[Aa]bility_(special_bonus_[A-Za-z0-9_]+)"\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(enText))) if (!/_Description$/i.test(m[1]) && !enNames[m[1]]) enNames[m[1]] = clean(m[2]);

  const stratz = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ability-index.json'), 'utf8')).abilities; }
    catch { return {}; }
  })();
  const stratzByName = {};
  for (const [id, meta] of Object.entries(stratz)) if (meta.name) stratzByName[meta.name] = { id: Number(id), title: meta.title };

  const idByName = {};
  for (const [id, name] of Object.entries(abilityIds)) idByName[name] = Number(id);

  // Значения талантов из файлов игры (tools/extract-talent-values.js).
  // Единственный источник, где они вообще есть — см. комментарий в том скрипте.
  const gameValues = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'talent-values.json'), 'utf8')).values; }
    catch { return {}; }
  })();

  /**
   * Подставляет значение в шаблон. Знак берём из шаблона: у «-{s:...}s
   * Cooldown» и значения «-10» иначе вышло бы «--10s». Если своего знака в
   * шаблоне нет, ставим значение как есть.
   */
  function fillFromGame(text, name) {
    const raw = gameValues[name];
    if (raw === undefined) return text;
    return String(text).replace(/([+\-−]?)\s*\{s:[A-Za-z0-9_]+\}/g, (m, sign) => {
      const v = String(raw).replace(/^[+\-−]/, '');
      return sign ? sign + v : String(raw);
    });
  }

  const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
  const internalById = new Map(heroes.map(h => [h.id, h.name]));

  const tree = {};
  let needValve = [], resolved = 0, unresolved = 0;

  for (const h of heroes) {
    const entry = heroAbilities[internalById.get(h.id)];
    if (!entry || !entry.talents) continue;
    const lv = { 10: [], 15: [], 20: [], 25: [] };
    for (const t of entry.talents) {
      const level = LEVELS[t.level];
      if (!level || lv[level].length >= 2) continue;
      const s = stratzByName[t.name];
      const id = s ? s.id : (idByName[t.name] ?? null);
      // Заголовок Stratz обычно уже с числами, но не всегда: у части талантов
      // оттуда приходит «+{s:bonus_bonus_damage} Jinada Damage». Такой считаем
      // незаполненным и идём дальше по цепочке источников.
      let title = (s && s.title && !/\{s:/.test(s.title)) ? s.title : '';
      if (!title) {
        const raw = enNames[t.name] || abilityMeta[t.name]?.dname || '';
        title = clean(raw);
        if (/\{s:/.test(title) && id != null) needValve.push({ heroId: h.id, level, name: t.name, id });
      }
      lv[level].push({ abilityId: id, name: t.name, title });
      if (title) resolved++;
    }
    tree[h.id] = lv;
  }

  // Добираем числа только там, где плейсхолдер остался
  const seen = new Set();
  for (const job of needValve) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    const v = await valveValues(job.id);
    for (const lv of Object.values(tree[job.heroId])) {
      for (const t of lv) {
        if (t.name !== job.name) continue;
        let text = fill(t.title, v && v.values);
        if (/\{s:/.test(text) && v && v.name) text = fill(v.name, v.values);
        // Часть значений лежит не у самого таланта, а у родительской
        // способности, и datafeed их не отдаёт (у Abaddon это
        // «-{s:bonus_AbilityCooldown}s Borrowed Time Cooldown»). Тогда
        // вырезаем заглушку вместе со знаком и приклеенной единицей
        // измерения, иначе на странице остаётся «- s Borrowed Time Cooldown».
        // Сначала пробуем файлы игры — там значение настоящее
        text = fillFromGame(text, job.name);
        if (/\{s:/.test(text)) {
          text = text.replace(/[+\-−]?\s*\{s:[A-Za-z0-9_]+\}\s*(?:s\b|%|x\b)?/g, ' ');
          unresolved++;
        }
        t.title = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:%])/g, '$1').replace(/^[\s/·,]+|[\s/·,-]+$/g, '').replace(/^-(?!\d)/, '').trim();
      }
    }
    await sleep(140);
  }

  // Проходим всё дерево ещё раз: плейсхолдер мог остаться у талантов,
  // чей заголовок пришёл из Stratz и в очередь на добор не попал.
  for (const lv of Object.values(tree)) {
    for (const arr of Object.values(lv)) {
      for (const t of arr) {
        if (!/\{s:/.test(t.title)) continue;
        let text = fillFromGame(t.title, t.name);
        if (/\{s:/.test(text)) {
          text = text.replace(/[+\-−]?\s*\{s:[A-Za-z0-9_]+\}\s*(?:s\b|%|x\b)?/g, ' ');
          unresolved++;
        }
        t.title = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:%])/g, '$1').replace(/^[\s/·,]+|[\s/·,-]+$/g, '').replace(/^-(?!\d)/, '').trim();
      }
    }
  }

  // Финальная нормализация пробелов для ВСЕХ названий: двойные пробелы
  // встречаются и в исходных шаблонах Valve («+{s:a} Health / +{s:b} Damage
  // ��for Enchantress»), а не только на месте вырезанных заглушек.
  for (const lv of Object.values(tree))
    for (const arr of Object.values(lv))
      for (const t of arr) t.title = String(t.title).replace(/\s{2,}/g, ' ').trim();

  let total = 0, empty = [], half = [];
  for (const [id, lv] of Object.entries(tree)) {
    for (const [level, arr] of Object.entries(lv)) {
      if (arr.length !== 2) half.push(id + '/' + level + ':' + arr.length);
      for (const t of arr) { total++; if (!t.title) empty.push(t.name); }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'OpenDota hero_abilities + локализация Valve + Stratz',
    fetchedAt: new Date().toISOString(),
    heroes: tree
  }));
  console.log(`Дерево: ${Object.keys(tree).length} героев, ${total} талантов.`);
  console.log(`Без названия: ${empty.length}${empty.length ? ' (' + empty.slice(0, 4).join(', ') + ')' : ''}`);
  console.log(`Уровней не с двумя сторонами: ${half.length}${half.length ? ' (' + half.slice(0, 4).join(', ') + ')' : ''}`);
  console.log(`Без числового значения (лежит у родительской способности): ${unresolved}`);
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
