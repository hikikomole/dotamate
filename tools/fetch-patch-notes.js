#!/usr/bin/env node
// Заметки патча с официального фида Valve → data/patch-notes.json.
//
// Источник: dota2.com/datafeed/patchnotes, русская локализация Valve. Тексты
// изменений авторские — свой пересказ был бы хуже и непроверяем. В фиде одни
// идентификаторы, имена и картинки подставляем из своих файлов.
//
// Что в фиде есть у каждой строки, кроме текста:
//   indent_level — вложенность (2 = уточнение к строке выше)
//   icon         — тип изменения: armor, str, agi, int, attack_speed и т.д.
//   aghanims     — строка относится к Aghanim's Scepter или Shard
//   info         — у строки в клиенте есть сноска-пояснение
// Всё это сохраняем: на странице из этого получаются значки, вложенность и
// подсветка — то, чем список Valve отличается от простого перечня.
//
// Запуск: node tools/fetch-patch-notes.js [версия]
//         без аргумента берётся версия из data/home-meta.json

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'patch-notes.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return fallback; }
}
function exists(rel) {
  return rel ? fs.existsSync(path.join(ROOT, rel.replace(/^\//, ''))) : false;
}

function heroMaps() {
  const heroes = readJson('data/heroes.json', {});
  const list = Array.isArray(heroes) ? heroes : (heroes.heroes || []);
  const urls = readJson('hero-urls.json', []);
  const slugByName = {};
  for (const u of urls) {
    const m = String(u.loc || '').match(/\/hero\/([^/]+)\//);
    if (m && u.name) slugByName[u.name] = m[1];
  }
  const byId = {};
  for (const h of list) {
    const name = h.localized_name || h.name;
    byId[h.id] = { name, slug: slugByName[name] || String(h.name || '').replace(/^npc_dota_hero_/, '') };
  }
  return byId;
}

function itemMap() {
  const src = readJson('data/items-ru.json', { items: {} }).items || {};
  const byId = {};
  for (const slug of Object.keys(src)) {
    const it = src[slug];
    if (it && it.id != null) byId[it.id] = { name: it.dname || slug, slug, img: it.img || null };
  }
  return byId;
}

// Внутреннее имя способности нужно не только для подписи: по нему лежит
// иконка в assets/abilities (скачаны один раз, 700 файлов).
function abilityMap() {
  const src = readJson('data/ability-index.json', { abilities: {} }).abilities || {};
  const byId = {};
  for (const id of Object.keys(src)) {
    const a = src[id] || {};
    byId[id] = {
      title: a.title || a.name || ('Способность ' + id),
      key: a.name || null,
      isTalent: !!a.isTalent,
    };
  }
  return byId;
}

// Valve размечает часть слов тегами <font color>. Разметку снимаем: своё
// оформление в чужой текст не подмешиваем.
function stripTags(s) {
  return String(s || '').replace(/<\/?font[^>]*>/gi, '').replace(/<br\s*\/?>/gi, ' ').trim();
}
function cleanNotes(arr) {
  return (arr || [])
    .map(n => {
      const note = { level: Number(n.indent_level || 1), text: stripTags(n.note) };
      if (n.icon) note.icon = String(n.icon);
      if (n.aghanims) note.aghanims = true;
      if (n.info) note.info = true;
      return note;
    })
    .filter(n => n.text && !/^<br\s*\/?>$/i.test(n.text));
}

async function currentPatch() {
  try {
    const r = await fetch('https://www.dota2.com/datafeed/patchnoteslist?language=english');
    if (!r.ok) throw new Error('datafeed ' + r.status);
    const d = await r.json();
    const list = d.patches || d;
    const last = list[list.length - 1];
    return String(last.patch_name || last.patch_number || '').trim() || null;
  } catch (e) { return null; }
}

async function main() {
  const version = process.argv[2] || readJson('data/home-meta.json', {}).patch || await currentPatch();
  if (!version) throw new Error('не удалось определить версию патча');

  const url = 'https://www.dota2.com/datafeed/patchnotes?version=' + encodeURIComponent(version) + '&language=russian';
  const res = await fetch(url);
  if (!res.ok) throw new Error('datafeed ответил ' + res.status);
  const d = await res.json();
  if (!d || d.success === false) throw new Error('фид не отдал патч ' + version);

  const H = heroMaps(), I = itemMap(), A = abilityMap();
  const missing = [];

  // Имя предмета, которого нет в нашем каталоге (нейтральные), спрашиваем у
  // Valve: номер вместо названия смотрелся бы как ошибка.
  const allItems = (d.items || []).concat(d.neutral_items || []);
  for (const it of allItems) {
    if (I[it.ability_id]) continue;
    try {
      const r = await fetch('https://www.dota2.com/datafeed/itemdata?language=russian&item_id=' + it.ability_id);
      const j = await r.json();
      const row = ((j.result && j.result.data && j.result.data.items) || [])[0];
      if (row && row.name_loc) {
        // У предметов вне каталога (нейтральные чары) иконка всё же может
        // лежать в assets: имя файла — внутреннее имя Valve без префикса item_.
        const key = String(row.name || '').replace(/^item_/, '');
        const img = key ? '/assets/items/' + key + '.png' : null;
        I[it.ability_id] = { name: row.name_loc, slug: null, img: exists(img) ? img : null };
      }
    } catch (e) { /* останется номером — честнее выдуманного имени */ }
  }

  function mapItems(src) {
    return (src || []).map(it => {
      const meta = I[it.ability_id] || null;
      const img = meta && exists(meta.img) ? meta.img : null;
      if (meta && meta.img && !img) missing.push('предмет ' + meta.slug);
      return {
        id: it.ability_id,
        name: meta ? meta.name : ('Предмет ' + it.ability_id),
        slug: meta ? meta.slug : null,
        img,
        notes: cleanNotes(it.ability_notes),
      };
    }).filter(x => x.notes.length);
  }

  const general = cleanNotes(d.general_notes);
  const items = mapItems(d.items);
  const neutrals = mapItems(d.neutral_items);

  const heroes = (d.heroes || []).map(h => {
    const meta = H[h.hero_id] || null;
    const img = meta ? '/assets/heroes/' + meta.slug + '.png' : null;
    if (img && !exists(img)) missing.push('герой ' + meta.slug);
    return {
      id: h.hero_id,
      name: meta ? meta.name : ('Герой ' + h.hero_id),
      slug: meta ? meta.slug : null,
      img: exists(img) ? img : null,
      notes: cleanNotes(h.hero_notes),
      abilities: (h.abilities || []).map(a => {
        const am = A[String(a.ability_id)] || {};
        const icon = am.key ? '/assets/abilities/' + am.key + '.png' : null;
        const ok = exists(icon);
        if (icon && !ok) missing.push('способность ' + am.key);
        return {
          id: a.ability_id,
          name: am.title || ('Способность ' + a.ability_id),
          icon: ok ? icon : null,
          notes: cleanNotes(a.ability_notes),
        };
      }).filter(a => a.notes.length),
      talents: cleanNotes(h.talent_notes),
    };
  }).filter(h => h.notes.length || h.abilities.length || h.talents.length);

  heroes.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  neutrals.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  // Какие типы значков встретились — сразу видно, для чего ещё нужен свой
  // символ, а что уйдёт в обычную точку.
  const icons = {};
  const walk = ns => ns.forEach(n => { if (n.icon) icons[n.icon] = (icons[n.icon] || 0) + 1; });
  walk(general);
  [...items, ...neutrals].forEach(i => walk(i.notes));
  heroes.forEach(h => { walk(h.notes); walk(h.talents); h.abilities.forEach(a => walk(a.notes)); });

  const out = {
    source: 'dota2.com/datafeed/patchnotes, русская локализация Valve',
    version: d.patch_name || version,
    number: d.patch_number || null,
    timestamp: d.patch_timestamp || null,
    fetchedAt: new Date().toISOString(),
    general, items, neutrals, heroes,
    iconKinds: icons,
    counts: {
      heroes: heroes.length, items: items.length,
      neutrals: neutrals.length, general: general.length,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`патч ${out.version}: героев ${heroes.length}, предметов ${items.length}, нейтральных ${neutrals.length}, общих заметок ${general.length}`);
  console.log('значки:', Object.entries(icons).map(([k, v]) => k + '×' + v).join(', ') || 'нет');
  if (missing.length) console.warn('НЕТ КАРТИНОК (' + missing.length + '):', [...new Set(missing)].join(', '));
}

main().catch(e => { console.error('Не собралось:', e.message); process.exit(1); });
