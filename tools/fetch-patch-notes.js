#!/usr/bin/env node
// Заметки патча с официального фида Valve → data/patch-notes.json.
//
// Источник тот же, по которому собирались гайды: dota2.com/datafeed. Берём
// русскую локализацию Valve, поэтому тексты изменений — авторские, а не наш
// пересказ. Имена героев, способностей и предметов подставляем из своих
// файлов: в фиде только идентификаторы.
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

function abilityMap() {
  const src = readJson('data/ability-index.json', { abilities: {} }).abilities || {};
  const byId = {};
  for (const id of Object.keys(src)) {
    const a = src[id];
    byId[id] = (a && (a.title || a.name)) || ('Способность ' + id);
  }
  return byId;
}

// Пустые строки-разделители Valve («<br>») в список изменений не попадают.
// Valve размечает часть слов тегами <font color>. Разметку снимаем, текст
// оставляем как есть: свою вёрстку в чужой текст не подмешиваем.
function stripTags(s) {
  return String(s || '').replace(/<\/?font[^>]*>/gi, '').replace(/<br\s*\/?>/gi, ' ').trim();
}
function cleanNotes(arr) {
  return (arr || [])
    .map(n => ({ level: Number(n.indent_level || 1), text: stripTags(n.note) }))
    .filter(n => n.text && n.text !== '<br>' && !/^<br\s*\/?>$/i.test(n.text));
}

async function main() {
  const version = process.argv[2] || (readJson('data/home-meta.json', {}).patch);
  if (!version) throw new Error('не задана версия патча и её нет в data/home-meta.json');

  const url = 'https://www.dota2.com/datafeed/patchnotes?version=' + encodeURIComponent(version) + '&language=russian';
  const res = await fetch(url);
  if (!res.ok) throw new Error('datafeed ответил ' + res.status);
  const d = await res.json();
  if (!d || d.success === false) throw new Error('фид не отдал патч ' + version);

  const H = heroMaps(), I = itemMap(), A = abilityMap();

  const general = cleanNotes(d.general_notes);

  const missing = (d.items || []).concat(d.neutral_items || [])
    .map(it => it.ability_id).filter(id => !I[id]);
  for (const id of missing) {
    try {
      const r = await fetch('https://www.dota2.com/datafeed/itemdata?language=russian&item_id=' + id);
      const j = await r.json();
      const row = (j.result && j.result.data && j.result.data.items || [])[0];
      if (row && row.name_loc) I[id] = { name: row.name_loc, slug: null, img: null };
    } catch (e) { /* останется номером — честнее, чем выдуманное имя */ }
  }

  const items = (d.items || []).concat(d.neutral_items || []).map(it => {
    const meta = I[it.ability_id] || null;
    return {
      id: it.ability_id,
      name: meta ? meta.name : ('Предмет ' + it.ability_id),
      slug: meta ? meta.slug : null,
      img: meta ? meta.img : null,
      notes: cleanNotes(it.ability_notes),
    };
  }).filter(x => x.notes.length);

  const heroes = (d.heroes || []).map(h => {
    const meta = H[h.hero_id] || null;
    return {
      id: h.hero_id,
      name: meta ? meta.name : ('Герой ' + h.hero_id),
      slug: meta ? meta.slug : null,
      notes: cleanNotes(h.hero_notes),
      abilities: (h.abilities || []).map(a => ({
        id: a.ability_id,
        name: A[String(a.ability_id)] || ('Способность ' + a.ability_id),
        notes: cleanNotes(a.ability_notes),
      })).filter(a => a.notes.length),
      talents: cleanNotes(h.talent_notes),
    };
  }).filter(h => h.notes.length || h.abilities.length || h.talents.length);

  heroes.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const out = {
    source: 'dota2.com/datafeed/patchnotes, русская локализация Valve',
    version: d.patch_name || version,
    number: d.patch_number || null,
    timestamp: d.patch_timestamp || null,
    fetchedAt: new Date().toISOString(),
    general, items, heroes,
    counts: { heroes: heroes.length, items: items.length, general: general.length },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const unknown = heroes.filter(h => !h.slug).length + items.filter(i => !i.slug).length;
  console.log(`патч ${out.version}: героев ${heroes.length}, предметов ${items.length}, общих заметок ${general.length}` +
    (unknown ? `, без ссылки ${unknown}` : ''));
}

main().catch(e => { console.error('Не собралось:', e.message); process.exit(1); });
