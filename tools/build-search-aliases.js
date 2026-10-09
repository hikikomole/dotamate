// Собирает data/search-aliases.json — поисковые синонимы героев и предметов.
// Источник — официальная локализация Dota 2 из файлов игры:
//   dota_russian.txt     "npc_dota_hero_<x>__name_alias"
//   abilities_russian.txt / abilities_english.txt  "DOTA_SearchAlias_Ability_item_<x>"
// Синонимы только для поиска, на сайте не показываются.
// Для предметов, у которых у Valve синонимов нет, — tools/search-aliases-own.json.
// Запуск: node tools/build-search-aliases.js ["<папка game Dota 2>"]
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const GAME = process.argv[2] || process.env.DOTA_GAME_DIR ||
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game';

// Минимальный читатель VPK v1/v2: достаёт файлы, путь которых содержит одно из имён.
function readVpk(dirFile, names) {
  const b = fs.readFileSync(dirFile); let o = 0;
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const u16 = () => { const v = b.readUInt16LE(o); o += 2; return v; };
  const str = () => { const s = o; while (b[o]) o++; const r = b.toString('utf8', s, o); o++; return r; };
  if (u32() !== 0x55aa1234) throw new Error('не VPK: ' + dirFile);
  const ver = u32(), treeSize = u32(); if (ver === 2) o += 16;
  const end = o + treeSize, base = dirFile.replace(/_dir\.vpk$/, ''), out = {};
  for (;;) { const ext = str(); if (!ext) break;
    for (;;) { const p = str(); if (!p) break;
      for (;;) { const n = str(); if (!n) break;
        u32(); const pre = u16(), ai = u16(), off = u32(), len = u32(); u16();
        const preB = b.slice(o, o + pre); o += pre;
        const file = n + '.' + ext; if (!names.includes(file)) continue;
        let data;
        if (ai === 0x7fff) data = b.slice(end + off, end + off + len);
        else { const fd = fs.openSync(base + '_' + String(ai).padStart(3, '0') + '.vpk', 'r'); data = Buffer.alloc(len); fs.readSync(fd, data, 0, len, off); fs.closeSync(fd); }
        out[file] = Buffer.concat([preB, data]).toString('utf8').replace(/^\uFEFF/, '');
      } } }
  return out;
}

function tokens(text) {
  const m = {}, re = /^\s*"([^"]+)"\s+"([^"]*)"/gm; let x;
  while ((x = re.exec(text))) m[x[1].toLowerCase()] = x[2];
  return m;
}
const split = s => String(s || '').replace(/\\+/g, '').split(/[;,]/).map(x => x.trim().toLowerCase()).filter(Boolean);
const uniq = a => [...new Set(a)];

// Локализация лежит в основном архиве dota/; dota_russian/ — запасной путь.
const NEED = ['dota_russian.txt', 'abilities_russian.txt', 'abilities_english.txt'];
const ru = readVpk(path.join(GAME, 'dota', 'pak01_dir.vpk'), NEED);
const alt = path.join(GAME, 'dota_russian', 'pak01_dir.vpk');
if ((!ru['dota_russian.txt'] || !ru['abilities_russian.txt']) && fs.existsSync(alt)) Object.assign(ru, readVpk(alt, NEED), ru);
const en = ru;
for (const f of ['dota_russian.txt', 'abilities_russian.txt']) if (!ru[f]) throw new Error('нет ' + f + ' в ' + GAME);
const T = Object.assign(tokens(en['abilities_english.txt'] || ''), tokens(ru['abilities_russian.txt']), tokens(ru['dota_russian.txt']));
// русские синонимы перекрывают английские по одному ключу — английские добавляем отдельно
const TEN = tokens(en['abilities_english.txt'] || '');

const heroes = require(path.join(ROOT, 'data', 'heroes.json')).heroes;
const items = require(path.join(ROOT, 'data', 'items-ru.json')).items;
const ownFile = path.join(__dirname, 'search-aliases-own.json');
const own = fs.existsSync(ownFile) ? JSON.parse(fs.readFileSync(ownFile, 'utf8')).items || {} : {};

const H = {}, missH = [];
for (const h of heroes) {
  const a = split(T[h.name.toLowerCase() + '__name_alias']);
  if (!a.length) missH.push(h.localized_name);
  H[h.id] = uniq(a);
}
const I = {}, missI = [];
const itemAliases = k => { const key = 'dota_searchalias_ability_item_' + k;
  return uniq([...split(T[key]), ...split(TEN[key]), ...split((own[k] || []).join(';'))]); };
for (const [k, v] of Object.entries(items)) {
  if (v.cat === 'recipe') continue;
  const a = itemAliases(k); if (!a.length) missI.push(k); I[k] = a;
}
for (const [k, v] of Object.entries(items)) if (v.cat === 'recipe') I[k] = uniq([...(I[v.recipeFor] || []), 'рецепт', 'recipe']);

// Страницы сайта для общего поиска: разделы, статьи, гайды по ролям, словарь.
// Герои и предметы ищутся отдельно, поэтому их страницы сюда не входят.
const P = [];
for (const f of ['page-urls.json', 'guide-urls.json', 'role-guide-urls.json', 'glossary-urls.json', 'privacy-urls.json']) {
  const fp = path.join(ROOT, f); if (!fs.existsSync(fp)) continue;
  for (const u of JSON.parse(fs.readFileSync(fp, 'utf8'))) {
    const url = String(u.loc || '').replace(/^https?:\/\/[^/]+/, '') || '/';
    const t = String(u.name || '').replace(/\s*\|\s*Dota Mate\s*$/, '').trim();
    if (t && url !== '/' && !P.some(p => p.u === url)) P.push({ t, u: url });
  }
}

const out = { generated: new Date().toISOString().slice(0, 10),
  source: 'Dota 2: dota_russian.txt, abilities_russian.txt, abilities_english.txt (+ tools/search-aliases-own.json)',
  heroes: H, items: I, pages: P };
fs.writeFileSync(path.join(ROOT, 'data', 'search-aliases.json'), JSON.stringify(out));
console.log('страниц', P.length);
console.log('героев', heroes.length, 'без синонимов', missH.length, missH.join(', '));
console.log('предметов', Object.keys(I).length, 'без синонимов', missI.length);
if (missI.length) console.log(missI.join(' '));
