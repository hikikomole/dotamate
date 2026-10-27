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
 *
 * Источник: --source opendota (по умолчанию: детали Stratz из data/meta-matches) | steam
 * (финальный инвентарь из data/steam-matches, tools/match-source.js). У Steam нет позиций,
 * линий и графиков — база долей только по герою целиком (byPos = 0), нишевые по позициям пусты.
 */
const fs = require('fs');
const path = require('path');
const { slugForHero, imageUrl } = require('./hero-common.js');
const MS = require('./match-source.js');
const SRC = MS.source();

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const OUT_DIR = MS.outDir(); // --out-dir (по умолчанию data/)
const OUT = path.join(OUT_DIR, 'meta-escape.json');
const OUT_MATCH = path.join(OUT_DIR, 'meta-match');

const WINDOW_DAYS = 5;      // витрина: последние 5 дней от самого свежего матча
const MIN_BASE = 30;        // сборок героя на позиции, чтобы считать долю по позиции
const MIN_ITEMS = 4;        // меньше — сборка не успела сложиться
const TOP_ALL = 1500;       // сколько сборок уходит в общий список (прокрутка с подгрузкой порциями)
const NICHE_SHARE = 0.2;    // герой на позиции нишевый, если это ≤ 20% его матчей
const NICHE_MIN = 10;       // и сыграно на ней не меньше стольких матчей

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
// матрица и калибровка для прогноза на страницах матчей: из каталога вывода, если там есть (data-steam/), иначе data/
const readOut = f => fs.existsSync(path.join(OUT_DIR, f)) ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')) : read(f);

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

function refs() {
  const heroes = read('heroes.json').heroes;
  const heroById = new Map(heroes.map(h => [h.id, h]));
  const itemsRu = read('items-ru.json').items;
  const itemById = new Map();
  for (const [key, it] of Object.entries(itemsRu)) itemById.set(it.id, Object.assign({ key }, it));
  const counted = id => { const it = itemById.get(id); return it && it.cat !== 'consumable'; };
  return { heroById, itemById, counted };
}

// справочники: только то, что попало на страницу
function dicts(usedHeroes, usedItems, heroById, itemById) {
  const heroDict = {}, itemDict = {};
  for (const id of usedHeroes) { const h = heroById.get(id); if (h) heroDict[id] = { n: h.localized_name, img: imageUrl(h), slug: slugForHero(h) }; }
  for (const id of usedItems) {
    const it = itemById.get(id);
    if (it) itemDict[id] = { n: it.dname, img: it.img, slug: it.cat === 'recipe' ? '' : it.key.replace(/^item_/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_') };
  }
  return { heroDict, itemDict };
}

function main() {
  if (SRC === 'steam') return mainSteam();
  const { heroById, itemById, counted } = refs();

  const all = loadMatches();
  if (!all.length) throw new Error(SRC === 'steam' ? 'Нет матчей Steam: сначала node tools/collect-steam-matches.js' : 'Нет матчей: сначала node tools/collect-meta-matches.js');
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
  for (const b of builds) { if (b.p.pos) add(b.p.h + ':' + b.p.pos, b.items); add(b.p.h + ':all', b.items); }

  for (const b of builds) {
    if (b.items.length < MIN_ITEMS || (!b.p.pos && SRC !== 'steam')) continue;
    let bs = b.p.pos ? base.get(b.p.h + ':' + b.p.pos) : null, byPos = true;
    if (!bs || bs.n < MIN_BASE) { bs = base.get(b.p.h + ':all'); byPos = false; }
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
  const day = scored.filter(b => b.m.t >= dayAgo).slice(0, 5).map(row);
  const five = scored.slice(0, 5).map(row);
  // «Последние билды»: самые свежие оценённые сборки, новые сверху.
  const list = scored.slice().sort((a, b) => b.m.t - a.m.t || b.score - a.score).slice(0, TOP_ALL).map(row);

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

  const { heroDict, itemDict } = dicts(usedHeroes, usedItems, heroById, itemById);

  const out = {
    generatedAt: new Date().toISOString(),
    source: SRC === 'steam' ? 'Steam Web API, финальный инвентарь рейтинговых матчей' : 'Stratz, матчи из нашей базы публичных матчей OpenDota',
    slice: SRC === 'steam' ? 'Ranked All Pick, ранг неизвестен или до Властелина, матчи от 20 минут' : 'Ranked All Pick, ранги Рекрут–Властелин, матчи от 20 минут',
    window: { from: matches.reduce((x, m) => Math.min(x, m.t), newest), to: newest, days: WINDOW_DAYS },
    matches: matches.length, builds: builds.length, scored: scored.length,
    rules: { minBase: MIN_BASE, minItems: MIN_ITEMS, nicheShare: NICHE_SHARE * 100, nicheMin: NICHE_MIN },
    heroes: heroDict, items: itemDict, day, five, list, niche
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  if (OUT_DIR === path.join(ROOT, 'data')) require('./prerender-meta.js');
  console.log(`Матчей за ${WINDOW_DAYS} дн.: ${matches.length}, сборок: ${builds.length}, с оценкой: ${scored.length}`);
  console.log(`meta-escape.json: ${(fs.statSync(OUT).size / 1024).toFixed(1)} КБ`);

  writeMatches(matches.filter(m => usedMatches.has(m.id)), heroById, itemById);
}

/**
 * META на Steam (--source steam): финальный инвентарь из data/steam-matches за последние WINDOW_DAYS,
 * позиции — разметка U2 (tools/match-positions.js: 1/2/3/саппорт; где матч есть у Stratz — его позиции,
 * 4 и 5 здесь сводятся в «саппорт»). Формула и пороги те же, что в main().
 * На боевом объёме (сотни тысяч матчей в сутки) сборки хранятся в типизированных массивах, полные
 * матчи читаются вторым проходом только для попавших на страницу.
 */
async function mainSteam() {
  const MP = require('./match-positions.js');
  const model = MP.loadModel(), stratz = MP.stratzIndex();
  const { heroById, itemById, counted } = refs();
  const POS = [null, 1, 2, 3, 'sup'];              // код позиции → значение pos в выходе
  const grow = T => ({ a: new T(1 << 16), n: 0, push(v) { if (this.n === this.a.length) { const b = new T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; } });
  const mId = grow(Float64Array), mT = grow(Int32Array);
  const bM = grow(Uint32Array), bH = grow(Uint16Array), bPos = grow(Uint8Array), bWin = grow(Uint8Array), bIt = grow(Uint32Array), bItN = grow(Uint8Array);
  const items = grow(Uint16Array);
  const keep = r => r[3] >= 1200 && (r[4] == null || r[4] <= 65);   // как кандидаты Stratz: ranked AP от 20 минут, ранг неизвестен или до Властелина

  for await (const r of MS.steamStream({ days: WINDOW_DAYS + 1 })) {
    if (!keep(r)) continue;
    const lab = MP.labelSteamRow(r, model, stratz), mi = mId.n;
    mId.push(r[0]); mT.push(r[2]);
    for (let s = 0; s < 10; s++) {
      const p = r[9 + s], pos = lab.p[s].pos;
      bM.push(mi); bH.push(p[0]); bPos.push(pos === 1 || pos === 2 || pos === 3 ? pos : 4);
      bWin.push((p[1] < 128) === (r[5] === 1) ? 1 : 0);
      const set = [...new Set((p[14] || []).filter(counted))];
      bIt.push(items.n); bItN.push(set.length); for (const i of set) items.push(i);
    }
  }
  if (!mId.n) throw new Error('Нет матчей Steam: сначала node tools/collect-steam-matches.js');
  let newest = 0; for (let i = 0; i < mT.n; i++) if (mT.a[i] > newest) newest = mT.a[i];
  const from = newest - WINDOW_DAYS * 86400;
  const inWin = b => mT.a[bM.a[b]] >= from;
  const NB = bM.n;

  // --- база долей: герой+позиция и герой целиком; счётчики для нишевых
  const base = new Map(), hp = new Map(), ht = new Map();
  const add = (k, b) => { let x = base.get(k); if (!x) base.set(k, x = { n: 0, c: new Map() }); x.n++; for (let j = bIt.a[b], e = j + bItN.a[b]; j < e; j++) x.c.set(items.a[j], (x.c.get(items.a[j]) || 0) + 1); };
  let matches = 0, builds = 0, mFrom = newest;
  for (let i = 0; i < mT.n; i++) if (mT.a[i] >= from) { matches++; if (mT.a[i] < mFrom) mFrom = mT.a[i]; }
  for (let b = 0; b < NB; b++) {
    if (!inWin(b)) continue;
    builds++;
    const h = bH.a[b], k = h * 8 + bPos.a[b];
    add(k, b); add(h * 8, b);
    let x = hp.get(k); if (!x) hp.set(k, x = { h, pos: POS[bPos.a[b]], n: 0, w: 0 });
    x.n++; x.w += bWin.a[b];
    ht.set(h, (ht.get(h) || 0) + 1);
  }

  // --- оценка каждой сборки
  const score = new Float64Array(NB).fill(NaN), byPos = new Uint8Array(NB);
  let scoredN = 0;
  for (let b = 0; b < NB; b++) {
    if (!inWin(b) || bItN.a[b] < MIN_ITEMS) continue;
    const h = bH.a[b];
    let bs = base.get(h * 8 + bPos.a[b]), bp = 1;
    if (!bs || bs.n < MIN_BASE) { bs = base.get(h * 8); bp = 0; }
    if (bs.n < MIN_BASE) continue;
    let s = 0;
    for (let j = bIt.a[b], e = j + bItN.a[b]; j < e; j++) s += -Math.log(((bs.c.get(items.a[j]) || 1) - 0.5) / bs.n);
    score[b] = Math.round(s * 100) / 100; byPos[b] = bp; scoredN++;
  }
  const top5 = pred => { const t = []; for (let b = 0; b < NB; b++) { if (Number.isNaN(score[b]) || !pred(b)) continue; t.push(b); t.sort((x, y) => score[y] - score[x]); if (t.length > 5) t.pop(); } return t; };
  const dayAgo = newest - 86400;
  const dayB = top5(b => mT.a[bM.a[b]] >= dayAgo), fiveB = top5(() => true);
  // «Последние билды»: TOP_ALL самых свежих оценённых, окно по времени расширяется, пока не наберётся
  let listB = [];
  for (let span = 3600; ; span *= 2) {
    listB = []; for (let b = 0; b < NB; b++) if (!Number.isNaN(score[b]) && mT.a[bM.a[b]] >= newest - span) listB.push(b);
    if (listB.length >= TOP_ALL || span >= WINDOW_DAYS * 86400) break;
  }
  listB = listB.sort((x, y) => mT.a[bM.a[y]] - mT.a[bM.a[x]] || score[y] - score[x]).slice(0, TOP_ALL);

  // --- полные матчи только для попавших на страницу (второй проход)
  const need = new Set([...dayB, ...fiveB, ...listB].map(b => mId.a[bM.a[b]]));
  const full = new Map();
  for await (const r of MS.steamStream({ days: WINDOW_DAYS + 1 })) {
    if (!need.has(r[0])) continue;
    const m = MS.steamToMeta(r), lab = MP.labelSteamRow(r, model, stratz);
    m.p.forEach((q, i) => { q.pos = lab.p[i].pos; });
    full.set(m.id, m);
  }
  const slotOf = b => b % 10; // сборки матча идут подряд по слотам 0–9

  const usedHeroes = new Set(), usedItems = new Set(), usedMatches = new Set();
  const row = b => {
    const m = full.get(mId.a[bM.a[b]]), p = m.p[slotOf(b)];
    const bs = byPos[b] ? base.get(p.h * 8 + bPos.a[b]) : base.get(p.h * 8);
    const share = {};
    for (let j = bIt.a[b], e = j + bItN.a[b]; j < e; j++) { const i = items.a[j], c = bs.c.get(i) || 1; share[i] = Math.round(1000 * (c - 1) / (bs.n - 1)) / 10; }
    usedHeroes.add(p.h); usedMatches.add(m.id); p.it.forEach(i => i && usedItems.add(i));
    return {
      match: m.id, t: m.t, rank: rankName(m.rank), hero: p.h, pos: POS[bPos.a[b]], win: bWin.a[b],
      score: score[b], byPos: byPos[b], baseN: bs.n,
      items: p.it, share: p.it.map(i => (i && share[i] !== undefined) ? share[i] : null),
      k: p.k, d: p.d, a: p.a, name: ''
    };
  };
  const day = dayB.map(row), five = fiveB.map(row), list = listB.map(row);

  // --- нишевые герои по позициям (у Steam нет имён игроков — player: null)
  const niche = {};
  for (const pos of [1, 2, 3, 'sup']) {
    niche[pos] = [...hp.values()]
      .filter(x => x.pos === pos && x.n >= NICHE_MIN && x.n / ht.get(x.h) <= NICHE_SHARE && x.w / x.n > 0.5)
      .map(x => ({ x, lb: wilson(x.w, x.n) }))
      .sort((a, b) => b.lb - a.lb).slice(0, 8)
      .map(({ x }) => { usedHeroes.add(x.h); return { hero: x.h, games: x.n, wins: x.w, share: Math.round(1000 * x.n / ht.get(x.h)) / 10, player: null }; });
  }

  const { heroDict, itemDict } = dicts(usedHeroes, usedItems, heroById, itemById);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Steam Web API, финальный инвентарь рейтинговых матчей',
    slice: 'Ranked All Pick, ранг неизвестен или до Властелина, матчи от 20 минут',
    positions: 'Модель позиций U2 (1/2/3/саппорт, data/position-model.json); матчи Stratz — по Stratz, 4 и 5 сведены в «саппорт»',
    window: { from: mFrom, to: newest, days: WINDOW_DAYS },
    matches, builds, scored: scoredN,
    rules: { minBase: MIN_BASE, minItems: MIN_ITEMS, nicheShare: NICHE_SHARE * 100, nicheMin: NICHE_MIN },
    heroes: heroDict, items: itemDict, day, five, list, niche
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  if (OUT_DIR === path.join(ROOT, 'data')) require('./prerender-meta.js');
  console.log(`Steam: матчей за ${WINDOW_DAYS} дн.: ${matches}, сборок: ${builds}, с оценкой: ${scoredN}`);
  console.log(`${path.relative(ROOT, OUT)}: ${(fs.statSync(OUT).size / 1024).toFixed(1)} КБ`);
  writeMatches([...full.values()].filter(m => usedMatches.has(m.id)), heroById, itemById);
}

// --- страницы матчей: прогноз драфта той же формулой, что инструмент драфта
function draftModel() {
  const mx = readOut('our-matrix.json'), cal = readOut('draft-calibration.json');
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
  console.log(`Страниц матчей: ${list.length} (${path.relative(ROOT, OUT_MATCH)}/)`);
}

Promise.resolve().then(main).catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
