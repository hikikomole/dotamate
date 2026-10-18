'use strict';

// Локальный экспорт статистики DotaMate в игровой KeyValues, без запросов к API.
const fs = require('fs');
const path = require('path');
const { randomBytes, createHash } = require('crypto');
const { writeJsonAtomic } = require('./match-source');
const { slugForHero, RU_POSITIONS } = require('./hero-common');
const { buildVariantMaps } = require('../js/item-variants');

const MIN = 150;
const MIN_FILES = 100, MIN_HEROES = 120;
const PHASES = [
  ['start', 'Старт (до 0:00)'],
  ['early', 'Линия (0–10 мин)'],
  ['mid', 'Середина (10–25 мин)'],
  ['late', 'Поздняя (25–40 мин)'],
  ['vlate', 'Затяжная (40+ мин)']
];
const INTERNAL_NAME = /^[a-z][a-z0-9_]*$/;

function parseArgs(args) {
  const options = { data: './data', min: MIN, creator: 0 };
  const ranges = { min: [0, Number.MAX_SAFE_INTEGER], hero: [1, 809999999], pos: [1, 5], creator: [0, 4294967295] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') {
      console.log('node tools/build-ingame-guides.js [--publish] [--data ./data] [--skill-data DIR] [--out DIR] [--min 150] [--hero ID] [--pos 1–5] [--creator accountId32] [--check DIR]\nВыход: ./outputs/ingame-guides; с --publish: ./data/ingame-guides (creator=0).');
      return null;
    }
    if (flag === '--publish') { options.publish = true; continue; }
    const key = flag.slice(2);
    if (!flag.startsWith('--') || !['data', 'skill-data', 'out', 'check', ...Object.keys(ranges)].includes(key)) {
      throw new Error(`Неизвестный аргумент: ${flag}`);
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Не задано значение ${flag}`);
    if (ranges[key]) {
      const n = Number(value);
      const [lo, hi] = ranges[key];
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < lo || n > hi) {
        throw new Error(`${flag}: требуется целое десятичное число от ${lo} до ${hi}`);
      }
      options[key] = n;
    } else {
      options[key] = path.resolve(value);
    }
  }
  options.out ??= options.publish ? './data/ingame-guides' : './outputs/ingame-guides';
  if (options.publish && options.check) throw new Error('--publish и --check нельзя совмещать');
  options['skill-data'] ??= options.data;
  return options;
}

function readJson(dir, name, optional = false) {
  const file = path.join(dir, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error.code === 'ENOENT') throw new Error(`Нет файла данных: ${file}`);
    throw new Error(`Не удалось прочитать ${file}: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Некорректные данные: ${label} должен быть объектом`);
  }
  return value;
}

function dateRu(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Нет корректной даты hero-items.json builtAt');
  return date.toISOString().slice(0, 10).split('-').reverse().join('.');
}

function hex(value) {
  return '0x' + BigInt(value).toString(16).toUpperCase().padStart(16, '0');
}

function numberRu(value) {
  return String(value).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Локально: общий helper потребовал бы правки других файлов; build-hero-guides.js не импортируем с побочными эффектами.
function matches(n) {
  const x = Math.abs(n);
  return `${numberRu(n)} ${x % 10 === 1 && x % 100 !== 11 ? 'матч' : x % 10 >= 2 && x % 10 <= 4 && !(x % 100 >= 12 && x % 100 <= 14) ? 'матча' : 'матчей'}`;
}

function quote(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

// Список пар сохраняет повторяющиеся ключи item, которые потерялись бы в объекте.
function keyValues(entries, depth = 0) {
  const indent = '\t'.repeat(depth);
  return entries.map(([key, value]) => Array.isArray(value)
    ? `${indent}${quote(key)}\n${indent}{\n${keyValues(value, depth + 1)}${indent}}\n`
    : `${indent}${quote(key)}\t\t${quote(value)}\n`).join('');
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function makeGuide(hero, pos, purchases, build, context, general = false, group = null) {
  const { itemsById, consumables, variants, abilities, skillChains, missing, patch, updated, creator, now } = context;
  const internal = hero.name.replace(/^npc_dota_hero_/, '');
  const position = general ? 'все позиции' : `${RU_POSITIONS[`POSITION_${pos}`]}, поз. ${pos}`;
  const tooltips = new Map();
  const shown = new Set();
  const laterConsumables = new Map();
  const itemTooltip = (g, title) =>
    `Берут в ${Math.round(g / purchases.n * 100)}% матчей ${general ? 'на всех позициях' : `на позиции ${pos}`} · стадия «${title}»`;
  const categories = PHASES.map(([phase, title]) => {
    const seen = new Set();
    const rows = [];
    // При объединении вариантов берём первое (наибольшее) g: суммирование
    // завысило бы долю, поскольку один матч может содержать оба варианта.
    for (const row of [...(purchases[phase] || [])].sort((a, b) => b.g - a.g)) {
      const id = variants[row.i] ?? row.i;
      const name = itemsById.get(String(id));
      if (!name) {
        missing.add(`предмет ${row.i}`);
        continue;
      }
      if (!Number.isFinite(row.g) || row.g < 0) throw new Error(`Некорректное g: герой ${hero.id}, ${phase}, предмет ${row.i}`);
      if (seen.has(name)) continue;
      seen.add(name);
      if (phase !== 'start' && phase !== 'early') {
        if (shown.has(name)) continue;
        if (consumables.has(String(id))) {
          if (!laterConsumables.has(name) || row.g > laterConsumables.get(name).g) {
            laterConsumables.set(name, { g: row.g, title });
          }
          continue;
        }
      }
      rows.push(['item', name]);
      shown.add(name);
      if (!tooltips.has(name)) tooltips.set(name,
        itemTooltip(row.g, title));
    }
    return [title, rows];
  }).filter(([, rows]) => rows.length);
  const consumableRows = [...laterConsumables].sort((a, b) => b[1].g - a[1].g).slice(0, 6)
    .map(([name, { g, title }]) => {
      tooltips.set(name, itemTooltip(g, title));
      return ['item', name];
    });
  if (consumableRows.length) categories.push(['Расходники по ходу игры', consumableRows]);

  const abilityName = id => {
    if (id == null) return null;
    const name = abilities[id]?.name;
    if (typeof name === 'string' && INTERNAL_NAME.test(name)) {
      context.usedAbilities.add(String(id));
      return name;
    }
    missing.add(`способность/талант ${id}: ${hero.localized_name} (${hero.id})`);
    return null;
  };
  const order = new Map();
  const abilityTooltips = new Map();
  const chain = skillChains?.heroes?.[hero.id]?.[`POSITION_${pos}`];
  const popular = Array.isArray(chain?.popular?.seq) && chain.popular.seq.length ? chain.popular : null;
  const sequence = popular?.seq || (build?.progression?.popular?.steps || []).map(step => step?.abilityId);
  sequence.forEach((id, index) => {
    const name = abilityName(id);
    if (name) order.set(index + 1, name);
  });
  for (const talent of build?.talents || []) {
    const level = Number(talent.level);
    if (![10, 15, 20, 25].includes(level)) continue;
    const options = talent.options || [];
    let best = null;
    for (const option of options) {
      const name = abilityName(option.abilityId);
      if (Number.isFinite(option.pick) && (!best || option.pick > best.pick)) best = option;
      if (name && [option.pick, option.winrate, option.matches].every(Number.isFinite)) {
        abilityTooltips.set(name,
          `Берут в ${numberRu(option.pick)}% матчей, винрейт ${numberRu(option.winrate)}% · выборка ${matches(option.matches)}`);
      }
    }
    if (best && level > sequence.length) {
      // Не заменяем ни занятые уровни, ни пропуски исходной последовательности, включая 15/20/25.
      const name = abilityName(best.abilityId);
      if (name) order.set(level, name);
    }
  }

  if (popular) {
    const name = abilityName(sequence[0]);
    if (name) {
      const tooltip = `Самая частая прокачка первых ${sequence.length} уровней: ${matches(popular.matches)}, винрейт ${numberRu(popular.winrate)}%`;
      abilityTooltips.set(name, [abilityTooltips.get(name), tooltip].filter(Boolean).join('\n'));
    }
  }

  const overview = (group ? `Предметы: выборка ${purchases.n} матчей, ранги ${group.ranks[0]}–${group.ranks[1]} (Stratz). Прокачка и таланты: все ранги (Steam). ` : '') +
    `Покупки — ${matches(purchases.n)} ${hero.localized_name || internal} ${general ? 'на всех позициях' : 'на этой позиции'} из базы рейтинговых матчей DotaMate, патч ${patch}, обновлено ${updated}. ` +
    (purchases.n < 300 ? 'Выборка небольшая — проценты ориентировочные. ' : '') +
    'Процент у предмета — доля матчей, где его купили в этой стадии. ' +
    `Подробнее: dotamate.ru/hero/${slugForHero(hero)}/` +
    (popular ? `\nПрокачка — Steam, ${matches(chain.sampleMatches ?? popular.matches)} ${hero.localized_name || internal} на позиции ${pos}. Только факты базы, не «правильная сборка».` : '');
  return keyValues([['guidedata', [
    ['Hero', internal],
    ['Title', Array.from(`DotaMate · ${group ? `${group.key === 'low' ? '10–49' : '50+'} · ` : ''}${hero.localized_name || internal} · ${position}`).slice(0, 60).join('')],
    ['Role', pos <= 3 ? '#DOTA_HeroGuide_Role_Core' : '#DOTA_HeroGuide_Role_Support'],
    ['GameplayVersion', patch], ['Overview', overview], ['GuideRevision', '1'],
    ['AssociatedWorkshopItemID', hex(0)], ['OriginalCreatorID', hex(creator)],
    ['GuideFormatVersion', '2'], ['TimeUpdated', hex(now)], ['TimePublished', hex(0)],
    ['ItemBuild', [['Items', categories], ['ItemTooltips', [...tooltips]]]],
    ['AbilityBuild', [
      ['AbilityOrder', [...order].sort((a, b) => a[0] - b[0])],
      ['AbilityTooltips', [...abilityTooltips]]
    ]]
  ]]]);
}

function loadAbilities(dataDir) {
  const abilities = Object.create(null);
  // Первый достоверный ID→internal name побеждает. Не угадываем ID по названию/слоту.
  const dirs = [...new Set([path.resolve(dataDir), path.resolve(__dirname, '../data')])];
  for (const dir of dirs) {
    for (const file of ['ability-index.json', 'talent-tree.json', 'hero-abilities.json', 'ability_ids.json']) {
      const source = path.join(dir, file);
      const data = readJson(dir, file, true);
      const add = (id, name) => {
        if (id != null && /^\d+$/.test(String(id)) && typeof name === 'string' && INTERNAL_NAME.test(name) && !abilities[id]) {
          abilities[id] = { name, source };
        }
      };
      if (file === 'ability-index.json' || file === 'ability_ids.json') {
        for (const [id, row] of Object.entries(data?.abilities || data || {})) add(id, typeof row === 'string' ? row : row?.name);
      } else {
        const walk = row => {
          if (!row || typeof row !== 'object') return;
          add(row.abilityId ?? row.id, row.name ?? row.key);
          Object.values(row).forEach(walk);
        };
        walk(data);
      }
    }
  }
  return abilities;
}

// Парсер сохраняет пары: повторяющиеся item разрешены, дубли tooltip — нет.
function parseKeyValues(text) {
  let i = 0;
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) i++;
      else if (text.slice(i, i + 2) === '//') { while (i < text.length && text[i] !== '\n') i++; }
      else break;
    }
  };
  const string = () => {
    skip();
    if (text[i++] !== '"') throw new Error(`ожидалась строка в позиции ${i}`);
    let value = '';
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') return value;
      if (ch === '\\') {
        const escaped = text[i++];
        const escapes = { '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' };
        if (!Object.hasOwn(escapes, escaped)) throw new Error(`некорректное экранирование в позиции ${i}`);
        value += escapes[escaped];
      } else {
        if (ch.charCodeAt(0) < 32) throw new Error('неэкранированный управляющий символ');
        value += ch;
      }
    }
    throw new Error('незакрытая строка');
  };
  const block = nested => {
    const entries = [];
    while (true) {
      skip();
      if (i === text.length) {
        if (nested) throw new Error('незакрытая скобка');
        return entries;
      }
      if (text[i] === '}') {
        if (!nested) throw new Error('лишняя закрывающая скобка');
        i++; return entries;
      }
      const key = string();
      skip();
      let value;
      if (text[i] === '{') { i++; value = block(true); } else value = string();
      entries.push([key, value]);
    }
  };
  return block(false);
}

function checkGuides(dir, catalog) {
  const known = new Set(Object.keys(catalog).map(k => k.startsWith('item_') ? k : `item_${k}`));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.build')).sort();
  let failed = 0;
  for (const file of files) {
    const errors = [];
    try {
      const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '');
      if (/\b(?:undefined|NaN|null)\b/.test(text)) errors.push('undefined/NaN/null в тексте');
      const root = parseKeyValues(text);
      const get = (rows, key) => Array.isArray(rows) ? rows.find(r => r[0] === key)?.[1] : undefined;
      const guide = get(root, 'guidedata');
      if (root.length !== 1 || !Array.isArray(guide)) errors.push('ожидался один блок guidedata');
      const hero = get(guide, 'Hero');
      if (typeof hero !== 'string' || !hero.trim()) errors.push('Hero пустой');
      const items = get(get(guide, 'ItemBuild'), 'Items');
      const categories = Array.isArray(items) ? items.filter(r => Array.isArray(r[1])) : [];
      if (categories.length < 3) errors.push('Items: меньше 3 категорий');
      const rows = categories.flatMap(r => r[1]);
      const itemRows = rows.filter(r => r[0] === 'item' && typeof r[1] === 'string');
      if (itemRows.length < 8) errors.push('Items: меньше 8 предметов');
      for (const [key, name] of rows) if (key !== 'item' || !known.has(name)) errors.push(`неизвестный предмет: ${name}`);
      const order = get(get(guide, 'AbilityBuild'), 'AbilityOrder');
      if (!Array.isArray(order) || order.length < 6) errors.push('AbilityOrder: меньше 6 уровней');
      if (Array.isArray(order) && (new Set(order.map(r => r[0])).size !== order.length || order.some(([k, v]) => !/^[1-9]\d*$/.test(k) || Number(k) > 30 || typeof v !== 'string' || !INTERNAL_NAME.test(v)))) errors.push('AbilityOrder: некорректные/повторные уровни');
      const walk = entries => {
        for (const [key, value] of entries) if (Array.isArray(value)) {
          if (['ItemTooltips', 'AbilityTooltips'].includes(key)) {
            const seen = new Set();
            for (const [name] of value) { if (seen.has(name)) errors.push(`${key}: дубль ${name}`); seen.add(name); }
          }
          walk(value);
        }
      };
      walk(root);
    } catch (error) { errors.push(error.message); }
    if (errors.length) { failed++; console.error(`${file}: ${errors.join('; ')}`); }
  }
  if (!files.length) { console.error('Нет .build файлов'); process.exitCode = 1; }
  if (failed) process.exitCode = 1;
  console.log(`Проверка: файлов ${files.length}, без ошибок ${files.length - failed}, с ошибками ${failed}.`);
  return files.length > 0 && failed === 0;
}

function lstatOptional(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function canonicalPath(file) {
  const absolute = path.resolve(file);
  if (lstatOptional(absolute)) return fs.realpathSync(absolute);
  return path.join(canonicalPath(path.dirname(absolute)), path.basename(absolute));
}

function validateGuideDirectory(dir) {
  const stat = lstatOptional(dir);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Не обычный каталог гайдов: ${dir}`);
  if (!fs.readdirSync(dir).length) return;
  if (!lstatOptional(path.join(dir, 'manifest.json'))?.isFile() || readJson(dir, 'manifest.json').format !== 1) {
    throw new Error(`Нет manifest.json с format 1: ${dir}`);
  }
}

function validatePublishOut(options) {
  const requested = path.resolve(options.out);
  if (path.basename(requested) !== 'ingame-guides') throw new Error('--out: имя каталога должно быть ingame-guides');
  const out = path.join(canonicalPath(path.dirname(requested)), path.basename(requested));
  for (const dir of [path.resolve(__dirname, '..'), options.data, options['skill-data']]) {
    const relative = path.relative(out, canonicalPath(dir));
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
      throw new Error('--out совпадает с защищённым каталогом или является его предком');
    }
  }
  validateGuideDirectory(out);
  return out;
}

function acquirePublishLock(lock) {
  for (;;) {
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner, stat;
      try {
        stat = fs.lstatSync(lock);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Небезопасный lock: ${lock}`);
        try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* незавершённая запись */ }
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      let stale = Date.now() - (Number.isFinite(owner?.time) ? owner.time : stat.mtimeMs) > 2 * 60 * 60 * 1000;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') stale = true; else if (error.code !== 'EPERM') throw error; }
      }
      if (!stale) throw new Error(`Публикация уже выполняется: ${lock} (pid ${owner?.pid ?? 'неизвестен'})`);
      try { fs.unlinkSync(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() })); }
    catch (error) { fs.unlinkSync(lock); throw error; }
    finally { fs.closeSync(fd); }
    return;
  }
}

function main(args) {
  const options = parseArgs(args);
  if (!options) return;
  if (options.check) return checkGuides(options.check, requireObject(readJson(options.data, 'items-ru.json').items, 'items-ru.json items'));
  if (!options.publish) return buildGuides(options);
  const out = validatePublishOut(options), old = `${out}.old`;
  const parent = path.dirname(out), lock = path.join(parent, 'ingame-guides.lock');
  fs.mkdirSync(parent, { recursive: true });
  acquirePublishLock(lock);
  let tmp;
  try {
    validateGuideDirectory(out);
    validateGuideDirectory(old);
    if (lstatOptional(old)) {
      if (!lstatOptional(out)) fs.renameSync(old, out);
      else fs.rmSync(old, { recursive: true });
    }
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.name.startsWith('ingame-guides.tmp-') && entry.isDirectory() && !entry.isSymbolicLink()) {
        fs.rmSync(path.join(parent, entry.name), { recursive: true });
      }
    }
    tmp = fs.mkdtempSync(`${out}.tmp-`);
    const manifest = buildGuides({ ...options, out: tmp, creator: 0 });
    const catalog = requireObject(readJson(options.data, 'items-ru.json').items, 'items-ru.json items');
    if (!checkGuides(tmp, catalog)) throw new Error('Проверка опубликованных гайдов не пройдена');
    if (manifest.count < MIN_FILES || manifest.heroes < MIN_HEROES)
      throw new Error(`Недостаточное покрытие: ${manifest.count} файлов (нужно ${MIN_FILES}), ${manifest.heroes} героев (нужно ${MIN_HEROES})`);
    writeJsonAtomic(path.join(tmp, 'manifest.json'), manifest);
    const hadOld = fs.existsSync(out);
    if (hadOld) fs.renameSync(out, old);
    try { fs.renameSync(tmp, out); }
    catch (error) { if (hadOld) fs.renameSync(old, out); throw error; }
    if (hadOld) {
      try { fs.rmSync(old, { recursive: true }); }
      catch (error) { console.warn(`Гайды опубликованы, не удалена ${old}: ${error.message}`); }
    }
    console.log(`Опубликовано: ${out}`);
  } finally {
    try { if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true }); }
    finally { fs.unlinkSync(lock); }
  }
}

function buildGuides(options) {
  const builtAt = new Date().toISOString(), files = [];
  let skillDir = options['skill-data'];
  let skillChains = readJson(skillDir, 'skill-chains.json', true);
  if (!skillChains && path.resolve(skillDir) !== path.resolve('./data')) {
    skillDir = './data';
    skillChains = readJson(skillDir, 'skill-chains.json', true);
  }
  console.log(skillChains ? `Прокачка: ${path.resolve(skillDir, 'skill-chains.json')}`
    : 'skill-chains.json не найден; прокачка из builds/<id>.json.');
  const purchases = readJson(options.data, 'hero-items.json');
  const heroItems = requireObject(purchases.heroes, 'hero-items.json heroes');
  const rankedPurchases = readJson(options.data, 'hero-items-ranked.json', true);
  const rankGroups = rankedPurchases?.rankGroups || [];
  const ranked = rankedPurchases?.ranked || {};
  const heroes = readJson(options.data, 'heroes.json').heroes;
  if (!Array.isArray(heroes)) throw new Error('Некорректные данные: heroes.json heroes должен быть массивом');
  const catalog = requireObject(readJson(options.data, 'items-ru.json').items, 'items-ru.json items');
  const abilities = loadAbilities(options.data);
  const notes = readJson(options.data, 'patch-notes.json', true);
  const patch = notes?.version || notes?.number || readJson(options.data, 'stats.json', true)?.base?.patch;
  if (typeof patch !== 'string' || !patch.trim()) throw new Error('Не найдена версия патча в patch-notes.json или stats.json base.patch');
  const itemsById = new Map();
  const consumables = new Set();
  for (const [key, item] of Object.entries(catalog)) {
    if (item?.id != null && INTERNAL_NAME.test(key)) {
      itemsById.set(String(item.id), key.startsWith('item_') ? key : `item_${key}`);
      if (item.cat === 'consumable') consumables.add(String(item.id));
    }
  }
  const missing = new Set();
  const context = {
    itemsById, consumables, variants: buildVariantMaps(catalog).byId, abilities, skillChains, missing, patch, usedAbilities: new Set(),
    updated: dateRu(purchases.builtAt), creator: options.creator, now: Math.floor(Date.parse(builtAt) / 1000)
  };
  const heroesById = new Map(heroes.map(hero => [String(hero.id), hero]));
  const ids = options.hero ? [String(options.hero)]
    : [...new Set([...heroesById.keys(), ...Object.keys(heroItems)])].sort((a, b) => Number(a) - Number(b));
  let written = 0;
  let lowSample = 0;
  let noData = 0;
  let generalCount = 0;
  const covered = new Set();
  const guideIds = new Set();
  const counts = { all: 0, low: 0, high: 0 };
  const reasons = { 'нет pos в hero-items': 0, 'нет builds': 0, 'нет skill-chains': 0, 'нет покупок': 0, 'нет героя': 0 };
  const absent = { builds: 0, skillChains: 0 };
  const mainRoles = readJson(path.resolve(__dirname, '../data'), 'hero-main-roles.json', true)?.heroes || {};
  for (const id of ids) {
    const hero = heroesById.get(id);
    const build = readJson(options.data, `builds/${id}.json`, true);
    const all = heroItems[id];
    const qualifies = Object.values(all?.pos || {}).some(rec => Number.isFinite(rec.n) && rec.n > 0 && rec.n >= options.min);
    const byMatches = Object.entries(all?.posN || {}).sort((a, b) => b[1] - a[1]);
    const role = [...(mainRoles[id] || [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mainPos = Number(role || byMatches[0]?.[0] || build?.positionOrder?.[0]?.replace('POSITION_', ''));
    const positions = options.pos ? [options.pos] : [1, 2, 3, 4, 5];
    if (!options.pos && !qualifies) positions.push(0);
    for (const slot of positions) {
      const general = slot === 0;
      const pos = general ? mainPos : slot;
      const rec = general ? all : all?.pos?.[pos];
      if (!hero || !/^npc_dota_hero_[a-z0-9_]+$/.test(hero.name) || !rec || !Number.isFinite(rec.n) || rec.n <= 0) {
        noData++;
        reasons[!hero || !/^npc_dota_hero_[a-z0-9_]+$/.test(hero.name) ? 'нет героя' : general ? 'нет покупок' : 'нет pos в hero-items']++;
        if (!hero || !/^npc_dota_hero_[a-z0-9_]+$/.test(hero.name)) missing.add(`герой ${id}`);
        continue;
      }
      if (!general && rec.n < options.min) { lowSample++; continue; }
      if (!PHASES.some(([phase]) => Array.isArray(rec[phase]) && rec[phase].length)) { noData++; reasons['нет покупок']++; continue; }
      const positionBuild = build?.positions?.[`POSITION_${pos}`];
      const hasChain = skillChains?.heroes?.[id]?.[`POSITION_${pos}`]?.popular?.seq?.length;
      const hasBuild = positionBuild?.progression?.popular?.steps?.length;
      if (!hasBuild) absent.builds++;
      if (!hasChain) absent.skillChains++;
      if (!hasChain && (general || !hasBuild)) {
        noData++;
        reasons[general || hasBuild ? 'нет skill-chains' : 'нет builds']++;
        console.warn(`Пропуск: ${hero.localized_name} (${id}), позиция ${pos}: ${!hasBuild ? 'нет builds; ' : ''}нет skill-chains`);
        continue;
      }
      const content = makeGuide(hero, pos, rec, positionBuild, context, general);
      if (!Number.isInteger(Number(id)) || Number(id) >= 100000) throw new Error(`Некорректный ID героя: ${id}`);
      const number = 1900000000 + Number(id) * 10 + slot;
      if (!Number.isSafeInteger(number) || String(number).length !== 10) throw new Error(`Некорректный ID героя: ${id}`);
      if (guideIds.has(number)) throw new Error(`Повтор ID гайда: ${number}`);
      guideIds.add(number);
      fs.mkdirSync(options.out, { recursive: true });
      const internal = hero.name.replace(/^npc_dota_hero_/, '');
      const file = `${internal}_${number}.build`;
      writeAtomic(path.join(options.out, file), content);
      files.push({ file, heroId: Number(id), hero: internal, pos: slot, rankGroup: 'all', sampleN: rec.n,
        title: parseKeyValues(content)[0][1].find(([key]) => key === 'Title')[1],
        bytes: Buffer.byteLength(content, 'utf8'), sha256: createHash('sha256').update(content, 'utf8').digest('hex') });
      written++;
      counts.all++;
      if (general) generalCount++;
      covered.add(id);
      if (general) continue;
      for (const group of rankGroups) {
        const rankedRec = ranked[group.key]?.heroes?.[id]?.pos?.[pos];
        if (!rankedRec || rankedRec.n < MIN || !PHASES.some(([phase]) => rankedRec[phase]?.length)) continue;
        const heroId = Number(id);
        if (!Number.isInteger(heroId) || heroId >= 100000) throw new Error(`Некорректный ID героя: ${id}`);
        const variantId = 1900000000 + group.id * 1000000 + heroId * 10 + pos;
        if (!Number.isSafeInteger(variantId) || String(variantId).length !== 10) throw new Error(`Некорректный ID варианта гайда: ${variantId}`);
        if (guideIds.has(variantId)) throw new Error(`Повтор ID гайда: ${variantId}`);
        guideIds.add(variantId);
        const variantContent = makeGuide(hero, pos, rankedRec, positionBuild, context, false, group);
        const variantFile = `${internal}_${variantId}.build`;
        writeAtomic(path.join(options.out, variantFile), variantContent);
        files.push({ file: variantFile, heroId, hero: internal, pos, rankGroup: group.key, sampleN: rankedRec.n,
          title: parseKeyValues(variantContent)[0][1].find(([key]) => key === 'Title')[1],
          bytes: Buffer.byteLength(variantContent, 'utf8'), sha256: createHash('sha256').update(variantContent, 'utf8').digest('hex') });
        written++;
        counts[group.key]++;
      }
    }
  }
  const sources = new Map();
  for (const id of [...context.usedAbilities].sort((a, b) => Number(a) - Number(b))) {
    const { name, source } = abilities[id];
    sources.set(source, (sources.get(source) || 0) + 1);
    console.log(`Имя ${id} → ${name}; источник: ${source}`);
  }
  for (const [source, count] of sources) console.log(`Источник имён: ${source}: ${count}`);
  console.log(`Файлов: ${written}; позиционных: ${written - generalCount}; общих: ${generalCount}; покрытие героев ${covered.size}/${ids.length}; пропущено: мало матчей — ${lowSample}, нет данных — ${noData}.`);
  console.log(`Причины пропусков: ${JSON.stringify(reasons)}. Отсутствующие источники прокачки у кандидатов: ${JSON.stringify(absent)}.`);
  if (covered.size !== ids.length) console.warn(`Без гайда: ${ids.filter(id => !covered.has(id)).map(id => `${heroesById.get(id)?.localized_name} (${id})`).join(', ')}`);
  console.log(`Не сопоставлено: ${missing.size ? [...missing].sort().join(', ') : 'нет'}.`);
  console.log(`По рангам: ${JSON.stringify(counts)}`);
  return { format: 1, patch, builtAt, itemsBuiltAt: purchases.builtAt, rankGroups,
    creatorNote: 'OriginalCreatorID = 0; приложение DotaMate подставляет аккаунт пользователя при установке.',
    count: written, heroes: covered.size, files };
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Ошибка: ${error.message}`); process.exitCode = 1; }
}
