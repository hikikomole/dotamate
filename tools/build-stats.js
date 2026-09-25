#!/usr/bin/env node
/**
 * Раздел «Статистика и аналитика» (/stats/) — один файл data/stats.json.
 *
 * Источники (всё своё, на сайт уходят только посчитанные числа):
 *   data/public-matches/*.jsonl — лента OpenDota: герои, исход, ранг, длительность.
 *     → тир-лист, разрез по рангам, длительность матчей, Radiant/Dire.
 *   data/our-matrix.json        — пары героев (tools/build-our-stats.js).
 *     → связки союзников.
 *   data/hero-counters.json     — контрпики (tools/build-hero-counters.js).
 *   data/meta-matches/*.jsonl   — детали матчей Stratz (часть той же базы):
 *     позиция, GPM/XPM, исход линии, покупки.
 *     → позиции, экономика, линии, предметы.
 *   data/rank-positions.json    — роли героев по парам рангов (Stratz,
 *     tools/fetch-rank-positions.js) → значки ролей, роль на ранге.
 *   data/stats-history/*.json   — ежедневные снимки (пишет этот же скрипт).
 *     → динамика. На сайт не выкладываются, в stats.json попадает только ряд.
 *
 * Методы:
 *   - Винрейт с поправкой на выборку — нижняя граница интервала Уилсона (95%).
 *     Тиры S/A/B/C/D — квинтили этой границы среди героев с ≥ MIN_TIER матчами.
 *   - Связка союзников: d = фактическая доля побед пары − ожидаемая, где
 *     ожидаемая = σ(logit pA + logit pB − logit 0,5) — сумма логитов, как у
 *     контрпиков (log5). Пары, сыгранные меньше MIN_PAIR раз, не учитываются.
 *   - Длительность: винрейт героя в корзинах <25, 25–35, 35–45, 45+ мин.
 *   - Линия: исход линии Stratz (topLaneOutcome и т.д.) для линии игрока;
 *     сторона учитывается (у Radiant лёгкая линия — нижняя, у Dire — верхняя).
 *   - Предметы: доля матчей игроков, в которых предмет куплен, и медиана
 *     времени первой покупки. Винрейт предмета не считается — он путает
 *     причину и следствие (дорогие предметы покупают в уже выигранных играх).
 *
 * Запуск: node tools/build-stats.js (после tools/build-our-stats.js,
 * tools/build-hero-counters.js и tools/build-hero-items.js)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = f => path.join(ROOT, 'data', f);
const read = f => JSON.parse(fs.readFileSync(D(f), 'utf8'));
const OUT = D('stats.json');
const HIST = D('stats-history');

const MIN_DURATION = 900;          // как в build-our-stats.js
const MIN_TIER = 1000;             // матчей героя для тира
const MIN_RANK = 300;              // матчей героя в группе ранга
const MIN_PAIR = 300;              // как у контрпиков
const MIN_DUR_BUCKET = 300;
const MIN_POS = 30;                // матчей героя на позиции (база Stratz меньше)
const MIN_LANE = 30;
const Z = 1.96;
const RANKS = { 1: 'Рекрут', 2: 'Страж', 3: 'Рыцарь', 4: 'Герой', 5: 'Легенда', 6: 'Властелин' };
const DUR = [['lt25', 0, 1500, 'до 25 мин'], ['25_35', 1500, 2100, '25–35 мин'], ['35_45', 2100, 2700, '35–45 мин'], ['gt45', 2700, Infinity, '45+ мин']];
const HISTORY_DAYS = 60;

const r1 = x => Math.round(x * 10) / 10;
const logit = p => Math.log(p / (1 - p));
const sig = x => 1 / (1 + Math.exp(-x));
function wilsonLow(w, n) {
  if (!n) return 0;
  const p = w / n, z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

const heroes = read('heroes.json').heroes;
const heroIds = heroes.map(h => Number(h.id));
const known = new Set(heroIds);
const ourMeta = read('our-meta.json');

// ---------- 1. Лента публичных матчей ----------
const H = new Map(heroIds.map(id => [id, { n: 0, w: 0, rk: {}, du: {} }]));
const durHist = new Map();
let total = 0, radWins = 0, minT = Infinity, maxT = 0;
const rankHist = {};
for (const f of fs.readdirSync(D('public-matches')).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(D('public-matches'), f), 'utf8').split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const [, start, dur, rank, lobby, mode, rw] = r;
    if (mode !== 22 || ![0, 7].includes(lobby) || dur < MIN_DURATION) continue;
    const team = r.slice(7, 17);
    if (team.some(h => !known.has(h))) continue;
    total++; if (rw) radWins++;
    if (start < minT) minT = start; if (start > maxT) maxT = start;
    const rg = Math.min(6, Math.max(1, Math.floor(rank / 10)));
    rankHist[rg] = (rankHist[rg] || 0) + 1;
    const bin = Math.min(80, Math.floor(dur / 300) * 5);
    durHist.set(bin, (durHist.get(bin) || 0) + 1);
    const db = DUR.find(([, a, b]) => dur >= a && dur < b)[0];
    team.forEach((h, i) => {
      const won = i < 5 ? rw === 1 : rw === 0;
      const x = H.get(h);
      x.n++; if (won) x.w++;
      const k = x.rk[rg] || (x.rk[rg] = [0, 0]); k[0]++; if (won) k[1]++;
      const d = x.du[db] || (x.du[db] = [0, 0]); d[0]++; if (won) d[1]++;
    });
  }
}
if (!total) throw new Error('База публичных матчей пуста');

const heroRows = heroIds.map(id => {
  const x = H.get(id);
  const rank = {};
  for (const g of Object.keys(RANKS)) {
    const k = x.rk[g];
    if (k && k[0] >= MIN_RANK) rank[g] = [k[0], r1(k[1] / k[0] * 100), r1(wilsonLow(k[1], k[0]) * 100)];
  }
  const dur = {};
  for (const [k] of DUR) { const d = x.du[k]; if (d && d[0] >= MIN_DUR_BUCKET) dur[k] = [d[0], r1(d[1] / d[0] * 100)]; }
  return { id, n: x.n, wr: x.n ? r1(x.w / x.n * 100) : null, lo: r1(wilsonLow(x.w, x.n) * 100), pr: r1(x.n / total * 100), rank, dur };
});
const ranked = heroRows.filter(h => h.n >= MIN_TIER).sort((a, b) => b.lo - a.lo);
const TIERS = ['S', 'A', 'B', 'C', 'D'];
ranked.forEach((h, i) => { h.tier = TIERS[Math.min(4, Math.floor(i / ranked.length * 5))]; });

// длительность: кто сильнее в поздней игре
const durSwing = heroRows.filter(h => h.dur.lt25 && h.dur.gt45)
  .map(h => ({ id: h.id, early: h.dur.lt25[1], late: h.dur.gt45[1], d: r1(h.dur.gt45[1] - h.dur.lt25[1]) }))
  .sort((a, b) => b.d - a.d);

// ---------- 2. Связки и контрпики ----------
const M = read('our-matrix.json');
const idsM = M.heroIds.map(Number);
const N = idsM.length;
const pIdx = (i, j) => (i * (2 * N - i - 1)) / 2 + (j - i - 1);
const baseWr = new Map(heroRows.map(h => [h.id, h.wr / 100]));
const synergy = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
  const [n, w] = M.pairs.with[pIdx(i, j)];
  if (n < MIN_PAIR) continue;
  const pa = baseWr.get(idsM[i]), pb = baseWr.get(idsM[j]);
  if (!pa || !pb) continue;
  const e = sig(logit(pa) + logit(pb));
  const wr = w / n;
  synergy.push({ a: idsM[i], b: idsM[j], g: n, w: r1(wr * 100), e: r1(e * 100), d: r1((wr - e) * 100) });
}
synergy.sort((x, y) => y.d - x.d);
const C = read('hero-counters.json');
const counterPairs = [];
for (const [id, rec] of Object.entries(C.heroes || {})) for (const x of rec.against || []) counterPairs.push({ hero: Number(id), by: Number(x.id), g: x.g, w: x.w, e: x.e, d: x.d });
counterPairs.sort((x, y) => x.d - y.d);
const seen = new Set();
const topCounters = counterPairs.filter(p => { const k = p.hero + ':' + p.by; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);

// ---------- 3. База Stratz: позиции, экономика, линии, предметы ----------
const patchTs = Number(read('patch-notes.json').timestamp) || 0;
const catalog = read('items-ru.json').items;
const itemKey = new Map(Object.entries(catalog).map(([k, v]) => [v.id, k]));
const P = {};               // pos -> {n, gpm, xpm, heroes: Map}
const L = new Map();        // hero -> [n, win, draw, loss]
const IT = new Map();       // item -> {n, times[]}
let sm = 0, players = 0;
const laneOf = (r, ln) => ln === 'm' ? 1 : ln === 's' ? (r ? 2 : 0) : ln === 'o' ? (r ? 0 : 2) : -1;
for (const f of fs.readdirSync(D('meta-matches')).filter(f => f.endsWith('.jsonl')).sort()) {
  for (const line of fs.readFileSync(path.join(D('meta-matches'), f), 'utf8').split('\n')) {
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.t < patchTs) continue;
    sm++;
    for (const p of m.p) {
      const won = p.r ? m.rw === 1 : m.rw === 0;
      if (p.pos >= 1 && p.pos <= 5) {
        const q = P[p.pos] || (P[p.pos] = { n: 0, gpm: 0, xpm: 0, heroes: new Map() });
        q.n++; q.gpm += p.gpm || 0; q.xpm += p.xpm || 0;
        const hh = q.heroes.get(p.h) || [0, 0, 0, 0]; hh[0]++; if (won) hh[1]++; hh[2] += p.gpm || 0; hh[3] += p.xpm || 0; q.heroes.set(p.h, hh);
      }
      const li = laneOf(p.r, p.ln);
      const out = li >= 0 && m.lanes ? m.lanes[li] : null;
      if (out) {
        const x = L.get(p.h) || [0, 0, 0, 0]; x[0]++;
        if (out === 'TIE') x[2]++;
        else if ((out.startsWith('RADIANT') && p.r) || (out.startsWith('DIRE') && !p.r)) x[1]++;
        else x[3]++;
        L.set(p.h, x);
      }
      if (Array.isArray(p.b)) {
        players++;
        const first = new Map();
        for (const [t, id] of p.b) if (!first.has(id)) first.set(id, t);
        for (const [id, t] of first) {
          const k = itemKey.get(id);
          if (!k || k.startsWith('recipe_')) continue;
          const x = IT.get(id) || { n: 0, t: [] }; x.n++; x.t.push(t); IT.set(id, x);
        }
      }
    }
  }
}
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const positions = {};
for (const [pos, q] of Object.entries(P)) {
  const list = [...q.heroes].filter(([, v]) => v[0] >= MIN_POS)
    .map(([h, v]) => ({ id: h, n: v[0], wr: r1(v[1] / v[0] * 100), lo: r1(wilsonLow(v[1], v[0]) * 100), gpm: Math.round(v[2] / v[0]), xpm: Math.round(v[3] / v[0]) }))
    .sort((a, b) => b.lo - a.lo);
  positions[pos] = { n: q.n, gpm: Math.round(q.gpm / q.n), xpm: Math.round(q.xpm / q.n), heroes: list };
}
const lanes = [...L].filter(([, v]) => v[0] >= MIN_LANE)
  .map(([h, v]) => ({ id: h, n: v[0], win: r1(v[1] / v[0] * 100), draw: r1(v[2] / v[0] * 100), loss: r1(v[3] / v[0] * 100) }))
  .sort((a, b) => (b.win - b.loss) - (a.win - a.loss));
const items = [...IT].map(([id, x]) => ({ id, share: r1(x.n / players * 100), n: x.n, t: median(x.t) }))
  .sort((a, b) => b.n - a.n).slice(0, 40);

// ---------- 3б. Роли (Stratz, tools/fetch-rank-positions.js) ----------
// ro — «основные» роли героя: позиции с долей ≥ MAIN_SHARE его матчей, по
// убыванию винрейта (первая — где играет лучше всего): [позиция 1–5, доля %, винрейт %].
// rt — самая частая роль в каждой группе ранга 1…6 (по паре рангов Stratz).
const MAIN_SHARE = 10;
let rolesNote = null;
try {
  const RP = read('rank-positions.json');
  const roleList = arr => {
    const tot = arr.reduce((t, x) => t + x[0], 0);
    return tot ? arr.map((x, i) => [i + 1, r1(x[0] / tot * 100), x[0] ? r1(x[1] / x[0] * 100) : null]) : [];
  };
  for (const h of heroRows) {
    const all = RP.all[h.id];
    if (all) h.ro = roleList(all).filter(x => x[1] >= MAIN_SHARE).sort((a, b) => b[2] - a[2]);
    h.rt = {};
    for (const [g, pair] of Object.entries(RP.groupToPair)) {
      const arr = RP.pairs[pair] && RP.pairs[pair][h.id];
      if (!arr) continue;
      const l = roleList(arr).sort((a, b) => b[1] - a[1]);
      if (l.length) h.rt[g] = [l[0][0], l[0][1]];
    }
  }
  rolesNote = { fetchedAt: RP.fetchedAt, mainShare: MAIN_SHARE, pairs: RP.brackets };
} catch (e) { console.warn('Роли не добавлены:', e.message); }

// ---------- 4. История ----------
fs.mkdirSync(HIST, { recursive: true });
const day = new Date(maxT * 1000).toISOString().slice(0, 10);
fs.writeFileSync(path.join(HIST, day + '.json'), JSON.stringify({ day, total, h: Object.fromEntries(heroRows.map(h => [h.id, [h.n, h.wr, h.pr]])) }));
const snaps = fs.readdirSync(HIST).filter(f => f.endsWith('.json')).sort().slice(-HISTORY_DAYS)
  .map(f => JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8')));
const history = { days: snaps.map(s => s.day), totals: snaps.map(s => s.total), heroes: {} };
for (const id of heroIds) history.heroes[id] = snaps.map(s => (s.h[id] ? [s.h[id][1], s.h[id][2]] : null));

// ---------- запись ----------
const out = {
  builtAt: new Date().toISOString(),
  base: {
    source: 'Своя база рейтинговых матчей (OpenDota /publicMatches), 0–4500 MMR, Ranked All Pick',
    matches: total, from: new Date(minT * 1000).toISOString(), to: new Date(maxT * 1000).toISOString(),
    ranks: Object.fromEntries(Object.entries(RANKS).map(([g, name]) => [g, { name, n: rankHist[g] || 0 }])),
    radiantWr: r1(radWins / total * 100),
    duration: [...durHist].sort((a, b) => a[0] - b[0]).map(([m, n]) => [m, n]),
    stratzMatches: sm, patch: read('patch-notes.json').version
  },
  roles: rolesNote,
  method: { minTier: MIN_TIER, minRank: MIN_RANK, minPair: MIN_PAIR, minPos: MIN_POS, minLane: MIN_LANE, minDur: MIN_DUR_BUCKET, durBuckets: DUR.map(([k, , , l]) => [k, l]) },
  heroes: heroRows, durSwing, synergy: synergy.slice(0, 40), antiSynergy: synergy.slice(-20).reverse(), counters: topCounters,
  positions, lanes, items, history
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`stats.json: ${total} матчей, тир-лист ${ranked.length} героев, связок ${synergy.length}, позиций ${Object.keys(positions).length}, линий ${lanes.length}, предметов ${items.length}, снимков истории ${snaps.length}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} КБ`);
