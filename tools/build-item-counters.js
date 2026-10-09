#!/usr/bin/env node
/**
 * Предметы против состава соперника для DraftMate → data/item-counters.json.
 *
 * Источники (только проверяемые):
 *   tools/item-counter-rules.json — угрозы и предметы против них. Механика каждого
 *     предмета подтверждается регулярным выражением proof по официальному русскому
 *     описанию Valve (data/items-ru.json); не совпало — сборка падает.
 *   data/hero-abilities.json — способности героев (официальный русский текст Valve):
 *     ручная разметка ссылается на способность по имени, сборщик проверяет, что она
 *     есть у героя и что текст/тип подтверждает угрозу; «auto»-угрозы (контроль)
 *     выводятся из текста способностей.
 *   data/meta-matches/*.jsonl — своя база матчей (те же правила, что у
 *     tools/build-hero-items.js): сколько матчей герой на роли покупает предмет и в
 *     какой фазе; угрозы «покупает X» — доля матчей героя с покупкой ≥ buyShare.
 *
 * Формат: threats[k] = { label, min, enemyPos?, items: [{ id, key, name, img, page, proof }] },
 *   heroTags[heroId][k] = [чем подтверждено], buy[heroId][pos] = { n, it: { itemId: [g по 5 фазам] } }.
 * Читает: js/draft-items.js. Поменял формат — поправь его.
 *
 * Запуск: node tools/build-item-counters.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const OUT = path.join(ROOT, 'data', 'item-counters.json');
const PHASES = [['start', -Infinity, 0], ['early', 0, 600], ['mid', 600, 1500], ['late', 1500, 2400], ['vlate', 2400, Infinity]];
const MIN_ROLE = 80;   // как в build-hero-items.js: роль героя учитывается от 80 матчей
const MIN_SHARE = 0.02; // предмет считается покупаемым на роли от 2% матчей (не меньше 2 матчей)
const MIN_ABS = 2;

const rules = read('tools/item-counter-rules.json');
const catalog = read('data/items-ru.json').items;
const abilities = read('data/hero-abilities.json').heroes;
const heroes = read('data/heroes.json').heroes;
const patch = read('data/patch-notes.json');
const since = Number(patch.timestamp) || 0;

const errors = [];
const itemText = x => [].concat((x.desc || []).map(d => (d.h || '') + ': ' + (d.t || '')), x.notes || [], x.attr || []).join(' \n ').replace(/\s+/g, ' ');
const byNpc = new Map(heroes.map(h => [h.name.replace('npc_dota_hero_', ''), h]));
const beh = a => [].concat(a.behavior || []);

// ---------- предметы ----------
const threats = {};
const counterIds = new Set();
for (const [k, t] of Object.entries(rules.threats)) {
  const items = [];
  for (const it of t.items) {
    const x = catalog[it.key];
    if (!x) { errors.push(`${k}: предмета ${it.key} нет в items-ru.json`); continue; }
    const txt = itemText(x);
    const m = txt.match(new RegExp('[^.:]*' + it.proof + '[^.]*', 'i'));
    if (!m) { errors.push(`${k}: описание ${x.dname} не подтверждает «${it.proof}»`); continue; }
    items.push({ id: x.id, key: it.key, name: x.dname, img: x.img || `/assets/items/${it.key}.png`,
      page: x.dname && !x.recipeFor ? `/item/${it.key}/` : null, proof: m[0].trim() });
    counterIds.add(x.id);
  }
  threats[k] = { label: t.label, min: t.min || 1 };
  if (t.enemyPos) threats[k].enemyPos = t.enemyPos;
  threats[k].items = items;
}

// ---------- метки героев по способностям ----------
const heroTags = {};
const tag = (id, k, why) => { ((heroTags[id] = heroTags[id] || {})[k] = heroTags[id][k] || []).push(why); };
for (const [k, t] of Object.entries(rules.threats)) {
  for (const [npc, names] of Object.entries(t.heroes || {})) {
    const h = byNpc.get(npc);
    if (!h) { errors.push(`${k}: героя ${npc} нет в heroes.json`); continue; }
    const abs = abilities[h.id] || [];
    for (const n of names) {
      const a = abs.find(x => x.dname === n);
      if (!a) { errors.push(`${k}: у ${h.localized_name} нет способности «${n}»`); continue; }
      if (t.abilityProof && !new RegExp(t.abilityProof, 'i').test(a.desc || '')) { errors.push(`${k}: текст ${h.localized_name} «${n}» не подтверждает угрозу`); continue; }
      if (t.abilityBehavior && !beh(a).includes(t.abilityBehavior)) { errors.push(`${k}: ${h.localized_name} «${n}» не ${t.abilityBehavior}`); continue; }
      tag(h.id, k, n);
    }
  }
  if (t.auto) {
    const rx = new RegExp(t.auto.text, 'i'), ex = new Set(t.exclude || []);
    for (const h of heroes) for (const a of abilities[h.id] || []) {
      if (ex.has(a.dname) || !rx.test(a.desc || '')) continue;
      if (t.auto.behavior && !beh(a).includes(t.auto.behavior)) continue;
      tag(h.id, k, a.dname);
    }
  }
}

// ---------- своя база: покупки ----------
const known = new Map(Object.values(catalog).map(x => [x.id, x]));
const buysKeys = new Set(Object.values(rules.threats).flatMap(t => t.buys || []));
const buysIds = new Map([...buysKeys].map(key => { const x = catalog[key]; if (!x) errors.push(`buys: нет предмета ${key}`); return [x && x.id, key]; }));
const phaseIdx = t => PHASES.findIndex(([, a, b]) => t >= a && t < b);
const acc = new Map();      // heroId -> { n, any: Map(itemId -> матчей), pos: {p: {n, it: Map(itemId -> [5])}} }
const dir = path.join(ROOT, 'data', 'meta-matches');
let matches = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.t < since) continue;
    let used = false;
    for (const p of m.p) {
      if (!Array.isArray(p.b) || !p.b.length) continue;
      used = true;
      const h = acc.get(p.h) || acc.set(p.h, { n: 0, any: new Map(), pos: {} }).get(p.h);
      h.n++;
      const P = p.pos >= 1 && p.pos <= 5 ? (h.pos[p.pos] = h.pos[p.pos] || { n: 0, it: new Map() }) : null;
      if (P) P.n++;
      const seenAny = new Set(), seenPh = new Set();
      for (const [t, id] of p.b) {
        if (!known.has(id)) continue;
        if (buysIds.has(id) && !seenAny.has(id)) { seenAny.add(id); h.any.set(id, (h.any.get(id) || 0) + 1); }
        if (!P || !counterIds.has(id)) continue;
        const ph = phaseIdx(t), key = ph + ':' + id;
        if (seenPh.has(key)) continue;
        seenPh.add(key);
        const v = P.it.get(id) || P.it.set(id, [0, 0, 0, 0, 0]).get(id);
        v[ph]++;
      }
    }
    if (used) matches++;
  }
}

const buy = {};
for (const [id, h] of acc) {
  for (const [p, P] of Object.entries(h.pos)) {
    if (P.n < MIN_ROLE) continue;
    const min = Math.max(MIN_ABS, Math.ceil(P.n * MIN_SHARE));
    const it = {};
    for (const [iid, v] of P.it) if (Math.max(...v) >= min) it[iid] = v;
    ((buy[id] = buy[id] || {})[p] = { n: P.n, it });
  }
  if (h.n < MIN_ROLE) continue;
  for (const [k, t] of Object.entries(rules.threats)) for (const key of t.buys || []) {
    const iid = catalog[key] && catalog[key].id, g = h.any.get(iid) || 0;
    if (g / h.n >= rules.buyShare) tag(id, k, `покупает ${catalog[key].dname} в ${Math.round(100 * g / h.n)}% матчей`);
  }
}

if (errors.length) { console.error('Ошибки правил:\n  ' + errors.join('\n  ')); process.exit(1); }

const out = {
  source: 'Описания предметов и способностей — официальный русский текст Valve; покупки — своя база матчей, патч ' + (patch.version || '?'),
  method: `угроза засчитывается, если у соперника не меньше min героев с ней; предмет предлагается, только если герой на своей роли покупает его в ≥ max(${MIN_ABS}, ${MIN_SHARE * 100}% матчей) хотя бы в одной фазе (роль — от ${MIN_ROLE} матчей); угроза «покупает X» — от ${rules.buyShare * 100}% матчей героя`,
  phases: PHASES.map(p => p[0]), since, matchesUsed: matches, builtAt: new Date().toISOString(),
  threats, heroTags, buy
};
fs.writeFileSync(OUT, JSON.stringify(out));
const tagCount = Object.fromEntries(Object.keys(threats).map(k => [k, Object.values(heroTags).filter(t => t[k]).length]));
console.log(`item-counters.json: матчей ${matches}, ролей с покупками ${Object.values(buy).reduce((s, b) => s + Object.keys(b).length, 0)}, предметов ${counterIds.size}, героев с угрозой: ${JSON.stringify(tagCount)}`);
