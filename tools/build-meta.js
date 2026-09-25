#!/usr/bin/env node
/**
 * Раздел META: необычные сборки нашего диапазона (0–4500 MMR).
 *
 * Вход:  data/meta-matches/*.jsonl  (tools/collect-meta-matches.js, Stratz)
 *        data/heroes.json, data/items-ru.json, data/our-matrix.json,
 *        data/draft-calibration.json
 * Выход: data/meta-escape.json      — витрина раздела /meta/
 *        data/meta-match/<id>.json  — матчи, на которые витрина ссылается
 *
 * Оценка необычности (Off-Meta Score) — своя. Формула D2PT не опубликована,
 * поэтому повторить её нельзя; наша описана здесь и на странице:
 *
 *   для каждого предмета сборки p = доля сборок того же героя на той же
 *   позиции, где этот предмет есть в финальном инвентаре;
 *   score = Σ −ln(p) по разным предметам сборки.
 *
 * Сама оцениваемая сборка из базы исключается (leave-one-out), иначе
 * уникальный предмет давал бы p = 1/n вместо 0. Чтобы ноль не давал
 * бесконечность, p = (c − 1 + 0,5) / n, где c — сколько сборок с предметом
 * включая эту, n — всего сборок героя на позиции. Расходники не считаются.
 * Если сборок героя на позиции меньше MIN_BASE, база берётся по герою на всех
 * позициях; такая оценка помечается.
 */
const fs = require('fs');
const path = require('path');
const { slugForHero, imageUrl } = require('./hero-common.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const OUT = path.join(ROOT, 'data', 'meta-escape.json');
const OUT_MATCH = path.join(ROOT, 'data', 'meta-match');

const WINDOW_DAYS = 5;      // витрина: последние 5 дней от самого свежего матча
const MIN_BASE = 30;        // сборок героя на позиции, чтобы считать долю по позиции
const MIN_ITEMS = 4;        // меньше — сборка не успела сложиться
const TOP_ALL = 1500;       // сколько сборок уходит в общий список (прокрутка с подгрузкой порциями)
const NICHE_SHARE = 0.2;    // герой на позиции нишевый, если это ≤ 20% его матчей
const NICHE_MIN = 10;       // и сыграно на ней не меньше стольких матчей

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

function loadMatches() {
  const byId = new Map();
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (!line) continue;
      const m = JSON.parse(line);
      byId.set(m.id, m);        // повтор после оборванного запуска — берём один
    }
  }
  return [...byId.values()];
}

// нижняя граница доверительного интервала Уилсона, 95%
function wilson(w, n) {
  if (!n) return 0;
  const z = 1.96, p = w / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
}

const RANKS = ['', 'Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'];
const rankName = r => r ? (RANKS[Math.floor(r / 10)] || '') + (r % 10 ? ' ' + (r % 10) : '') : '';

function main() {
  const heroes = read('heroes.json').heroes;
  const heroById = new Map(heroes.map(h => [h.id, h]));
  const itemsRu = read('items-ru.json').items;
  const itemById = new Map();
  for (const [key, it] of Object.entries(itemsRu)) itemById.set(it.id, Object.assign({ key }, it));
  const counted = id => { const it = itemById.get(id); return it && it.cat !== 'consumable'; };

  const all = loadMatches();
  if (!all.length) throw new Error('Нет матчей: сначала node tools/collect-meta-matches.js');
  const newest = all.reduce((x, m) => Math.max(x, m.t), 0);
  const matches = all.filter(m => m.t >= newest - WINDOW_DAYS * 86400);

  // --- сборки: одна на игрока
  const builds = [];
  for (const m of matches) for (const p of m.p) {
    const items = [...new Set(p.it.filter(counted))];
    builds.push({ m, p, items, win: (p.r === 1) === (m.rw === 1) });
  }

  // --- база долей: по герою+позиции и по герою целиком
  const base = new Map();
  const add = (k, items) => { let b = base.get(k); if (!b) base.set(k, b = { n: 0, c: new Map() }); b.n++; for (const i of items) b.c.set(i, (b.c.get(i) || 0) + 1); };
  for (const b of builds) { add(b.p.h + ':' + b.p.pos, b.items); add(b.p.h + ':all', b.items); }

  for (const b of builds) {
    if (b.items.length < MIN_ITEMS || !b.p.pos) continue;
    let bs = base.get(b.p.h + ':' + b.p.pos), byPos = true;
    if (bs.n < MIN_BASE) { bs = base.get(b.p.h + ':all'); byPos = false; }
    if (bs.n < MIN_BASE) continue;
    let s = 0; const share = {};
    for (const i of b.items) {
      const c = bs.c.get(i) || 1;
      const p = (c - 0.5) / bs.n;
      s += -Math.log(p);
      share[i] = Math.round(1000 * (c - 1) / (bs.n - 1)) / 10;   // доля ДРУГИХ сборок с этим предметом, %
    }
    b.score = Math.round(s * 100) / 100; b.share = share; b.byPos = byPos; b.baseN = bs.n;
  }
  const scored = builds.filter(b => b.score !== undefined).sort((a, b) => b.score - a.score);

  const usedHeroes = new Set(), usedItems = new Set(), usedMatches = new Set();
  const row = b => {
    usedHeroes.add(b.p.h); usedMatches.add(b.m.id); b.p.it.forEach(i => i && usedItems.add(i));
    return {
      match: b.m.id, t: b.m.t, rank: rankName(b.m.rank), hero: b.p.h, pos: b.p.pos, win: b.win ? 1 : 0,
      score: b.score, byPos: b.byPos ? 1 : 0, baseN: b.baseN,
      items: b.p.it, share: b.p.it.map(i => (i && b.share[i] !== undefined) ? b.share[i] : null),
      k: b.p.k, d: b.p.d, a: b.p.a, name: b.p.name || ''
    };
  };
  const dayAgo = newest - 86400;
  const day = scored.filter(b => b.m.t >= dayAgo).slice(0, 6).map(row);
  const five = scored.slice(0, 6).map(row);
  const list = scored.slice(0, TOP_ALL).map(row);

  // --- нишевые герои по позициям
  const hp = new Map(), ht = new Map();
  for (const b of builds) {
    if (!b.p.pos) continue;
    const k = b.p.h + ':' + b.p.pos;
    let x = hp.get(k); if (!x) hp.set(k, x = { h: b.p.h, pos: b.p.pos, n: 0, w: 0, players: new Map() });
    x.n++; if (b.win) x.w++;
    ht.set(b.p.h, (ht.get(b.p.h) || 0) + 1);
    if (b.p.name) { let pl = x.players.get(b.p.acc); if (!pl) x.players.set(b.p.acc, pl = { name: b.p.name, n: 0, w: 0 }); pl.n++; if (b.win) pl.w++; }
  }
  const niche = {};
  for (let pos = 1; pos <= 5; pos++) {
    niche[pos] = [...hp.values()]
      .filter(x => x.pos === pos && x.n >= NICHE_MIN && x.n / ht.get(x.h) <= NICHE_SHARE && x.w / x.n > 0.5)
      .map(x => ({ x, lb: wilson(x.w, x.n) }))
      .sort((a, b) => b.lb - a.lb).slice(0, 8)
      .map(({ x }) => {
        usedHeroes.add(x.h);
        const best = [...x.players.values()].filter(p => p.w > 0).sort((a, b) => b.w - a.w || a.n - b.n)[0];
        return { hero: x.h, games: x.n, wins: x.w, share: Math.round(1000 * x.n / ht.get(x.h)) / 10, player: best ? { name: best.name, n: best.n, w: best.w } : null };
      });
  }

  // --- справочники: только то, что попало на страницу
  const heroDict = {}, itemDict = {};
  for (const id of usedHeroes) { const h = heroById.get(id); if (h) heroDict[id] = { n: h.localized_name, img: imageUrl(h), slug: slugForHero(h) }; }
  for (const id of usedItems) {
    const it = itemById.get(id);
    if (it) itemDict[id] = { n: it.dname, img: it.img, slug: it.cat === 'recipe' ? '' : it.key.replace(/^item_/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Stratz, матчи из нашей базы публичных матчей OpenDota',
    slice: 'Ranked All Pick, 0–4500 MMR, матчи от 20 минут',
    window: { from: matches.reduce((x, m) => Math.min(x, m.t), newest), to: newest, days: WINDOW_DAYS },
    matches: matches.length, builds: builds.length, scored: scored.length,
    rules: { minBase: MIN_BASE, minItems: MIN_ITEMS, nicheShare: NICHE_SHARE * 100, nicheMin: NICHE_MIN },
    heroes: heroDict, items: itemDict, day, five, list, niche
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Матчей за ${WINDOW_DAYS} дн.: ${matches.length}, сборок: ${builds.length}, с оценкой: ${scored.length}`);
  console.log(`meta-escape.json: ${(fs.statSync(OUT).size / 1024).toFixed(1)} КБ`);

  writeMatches(matches.filter(m => usedMatches.has(m.id)), heroById, itemById);
}

// --- страницы матчей: прогноз драфта той же формулой, что инструмент драфта
function draftModel() {
  const mx = read('our-matrix.json'), cal = read('draft-calibration.json');
  const K = cal.smoothingK, a = cal.alpha, ids = mx.heroIds, N = ids.length;
  const pos = new Map(ids.map((id, i) => [id, i]));
  const idx = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
  const adv = (n, w) => n ? 100 * ((w + K / 2) / (n + K)) - 50 : 0;
  const withAdv = (x, y) => { const p = mx.pairs.with[x < y ? idx(x, y) : idx(y, x)]; return adv(p[0], p[1]); };
  const vsAdv = (x, y) => { const p = mx.pairs.vs[x < y ? idx(x, y) : idx(y, x)]; return x < y ? adv(p[0], p[1]) : adv(p[0], p[0] - p[1]); };
  return (rad, dire) => {
    const r = rad.map(h => pos.get(h)), d = dire.map(h => pos.get(h));
    if (r.concat(d).some(x => x === undefined)) return null;
    let s = 0;
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) s += withAdv(r[i], r[j]) - withAdv(d[i], d[j]);
    for (const x of r) for (const y of d) s += vsAdv(x, y);
    return Math.round(1000 / (1 + Math.exp(-a * s))) / 10;
  };
}

function writeMatches(list, heroById, itemById) {
  const draft = draftModel();
  fs.mkdirSync(OUT_MATCH, { recursive: true });
  for (const f of fs.readdirSync(OUT_MATCH)) fs.unlinkSync(path.join(OUT_MATCH, f));
  for (const m of list) {
    const hd = {}, id = {};
    for (const p of m.p) {
      const h = heroById.get(p.h); if (h) hd[p.h] = { n: h.localized_name, img: imageUrl(h), slug: slugForHero(h) };
      for (const i of p.it.concat(p.nt)) { const it = itemById.get(i); if (it) id[i] = { n: it.dname, img: it.img, slug: it.cat === 'recipe' ? '' : it.key.replace(/^item_/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') }; }
    }
    for (const b of m.bans) { const h = heroById.get(b); if (h) hd[b] = { n: h.localized_name, img: imageUrl(h), slug: slugForHero(h) }; }
    const rad = m.p.filter(p => p.r).map(p => p.h), dire = m.p.filter(p => !p.r).map(p => p.h);
    const out = Object.assign({}, m, {
      rankName: rankName(m.rank), draftRadiant: draft(rad, dire),
      heroes: hd, items: id
    });
    out.p = m.p.map(p => Object.assign({}, p, { acc: undefined }));
    fs.writeFileSync(path.join(OUT_MATCH, m.id + '.json'), JSON.stringify(out));
  }
  console.log(`Страниц матчей: ${list.length} (data/meta-match/)`);
}

main();
