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
 * Источник ленты: --source opendota (по умолчанию) | steam — tools/match-source.js. Со steam
 * (с U3, 04.10.2026 — основной на сайте): все рейтинговые матчи всех рангов, чтение потоком;
 * ранг известен не у всех матчей (из ленты OpenDota; null — в разрез по рангам не идёт, группа 7 —
 * средний ранг матча Божество 5 и Титан); у героев добавляются средние gpm/xpm; posSteam — позиции
 * 1/2/3/«поддержка» по разметке tools/match-positions.js (U2; поз. 4/5 Stratz — в positions, как раньше);
 * снимки истории пишутся в data/stats-history-steam/.
 *
 * Запуск: node tools/build-stats.js [--source steam] (после tools/build-our-stats.js,
 * tools/build-hero-counters.js и tools/build-hero-items.js)
 */
const fs = require('fs');
const path = require('path');
const MS = require('./match-source.js');
const SRC = MS.source();

const ROOT = path.join(__dirname, '..');
const D = f => path.join(ROOT, 'data', f);
const read = f => JSON.parse(fs.readFileSync(D(f), 'utf8'));
const OUT = D('stats.json');
const HIST = D(SRC === 'steam' ? 'stats-history-steam' : 'stats-history'); // источники в одном ряду не смешиваются

const MIN_DURATION = 900;          // как в build-our-stats.js
const MIN_TIER = 1000;             // матчей героя для тира
const MIN_RANK = 300;              // матчей героя в группе ранга
const MIN_PAIR = 300;              // как у контрпиков
const MIN_DUR_BUCKET = 300;
const MIN_POS = 30;                // матчей героя на позиции (база Stratz меньше)
const MIN_LANE = 30;
// Про-матчи из архива эфира, считаются РАЗНЫЕ матчи (match_id), где героя выбрали (баны не считаются):
// 1–4 — не показывается; 5–11 — число матчей и «мало данных», вне рейтинга; от 12 — винрейт и место в про-тир-листе
// (решения владельца 09.10.2026: 5 и 10, затем порог участия поднят до 12).
const MIN_PRO_SHOW = 5;
const MIN_PRO_RANK = 12;
const Z = 1.96;
const RANKS = Object.assign({ 1: 'Рекрут', 2: 'Страж', 3: 'Рыцарь', 4: 'Герой', 5: 'Легенда', 6: 'Властелин' },
  SRC === 'steam' ? { 7: 'Божество 5 и Титан' } : {});
// Steam: ранг матча — из лент OpenDota (основная до Властелина, верхняя — Divine 5 и Immortal); 70–74 там не бывает.
const rankGroup = rank => rank == null ? null : SRC === 'steam' && rank >= 70 ? (rank >= 75 ? 7 : null) : Math.min(6, Math.max(1, Math.floor(rank / 10)));
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

async function main() {
const heroes = read('heroes.json').heroes;
const heroIds = heroes.map(h => Number(h.id));
const known = new Set(heroIds);
const ourMeta = read('our-meta.json');

// ---------- 1. Лента публичных матчей ----------
const H = new Map(heroIds.map(id => [id, { n: 0, w: 0, rk: {}, du: {}, g: 0, x: 0, bn: 0 }]));
const durHist = new Map();
let total = 0, radWins = 0, minT = Infinity, maxT = 0;
const rankHist = {};
// Steam: позиции по разметке U2 (1/2/3/sup) — модель data/position-model.json, поз. 4/5 из Stratz, если матч там есть
const PS = {};              // pos -> {n, gpm, xpm, heroes: Map}
let PM = null, posLabeled = 0, posStratz = 0;
if (SRC === 'steam') {
  try { const MP = require('./match-positions.js'); PM = { MP, model: MP.loadModel(), stratz: MP.stratzIndex() }; }
  catch (e) { console.warn('Позиции Steam не размечены:', e.message); }
}
function addRow(r, eco, raw) {
  const [, start, dur, rank, lobby, mode, rw] = r;
  if (mode !== 22 || ![0, 7].includes(lobby) || dur < MIN_DURATION) return;
  const team = r.slice(7, 17);
  if (team.some(h => !known.has(h))) return;
  total++; if (rw) radWins++;
  if (start < minT) minT = start; if (start > maxT) maxT = start;
  const rg = rankGroup(rank);
  if (rg) rankHist[rg] = (rankHist[rg] || 0) + 1;
  const bin = Math.min(80, Math.floor(dur / 300) * 5);
  durHist.set(bin, (durHist.get(bin) || 0) + 1);
  const db = DUR.find(([, a, b]) => dur >= a && dur < b)[0];
  team.forEach((h, i) => {
    const won = i < 5 ? rw === 1 : rw === 0;
    const x = H.get(h);
    x.n++; if (won) x.w++;
    if (rg) { const k = x.rk[rg] || (x.rk[rg] = [0, 0]); k[0]++; if (won) k[1]++; }
    if (eco) { x.g += eco[i][0]; x.x += eco[i][1]; }
    const d = x.du[db] || (x.du[db] = [0, 0]); d[0]++; if (won) d[1]++;
  });
  // баны рейтинговых матчей Steam (строка: [.., bans[hero_id…], ..]) — список «Банят чаще всего» на главной
  if (raw && Array.isArray(raw[8])) for (const b of raw[8]) { const x = H.get(b); if (x) x.bn++; }
  if (raw && PM) {
    let lab; try { lab = PM.MP.labelSteamRow(raw, PM.model, PM.stratz); } catch { return; }
    posLabeled++; if (lab.src === 'stratz') posStratz++;
    lab.p.forEach((q, i) => {
      const pos = q.pos === 4 || q.pos === 5 ? 'sup' : String(q.pos);
      const won = raw[9 + i][1] < 128 ? rw === 1 : rw === 0;
      const z = PS[pos] || (PS[pos] = { n: 0, gpm: 0, xpm: 0, heroes: new Map() });
      z.n++; z.gpm += eco[i][0]; z.xpm += eco[i][1];
      const hh = z.heroes.get(q.h) || [0, 0, 0, 0]; hh[0]++; if (won) hh[1]++; hh[2] += eco[i][0]; hh[3] += eco[i][1]; z.heroes.set(q.h, hh);
    });
  }
}
if (SRC === 'steam') {
  // все рейтинговые матчи всех рангов, потоком (боевой объём не помещается в память)
  for await (const raw of MS.steamStream()) addRow(MS.steamToPublic(raw), raw.slice(9, 19).map(p => [p[7], p[8]]), raw);
} else for (const r of MS.publicRows({ src: SRC, tier: 'base' })) addRow(r, null, null);
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
  const row = { id, n: x.n, wr: x.n ? r1(x.w / x.n * 100) : null, lo: r1(wilsonLow(x.w, x.n) * 100), pr: r1(x.n / total * 100), rank, dur };
  if (SRC === 'steam' && x.n) { row.gpm = Math.round(x.g / x.n); row.xpm = Math.round(x.x / x.n); }
  if (SRC === 'steam') row.bn = x.bn;
  return row;
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
// Ожидаемая доля побед — по винрейтам из our-meta.json: та же выборка и тот же момент, что у матрицы пар
// (build-our-stats пишет их вместе). Винрейты тир-листа считаются позже — сборщик Steam успевает дописать матчи.
const baseWr = new Map(Object.entries(ourMeta.heroes || {}).map(([id, h]) => [Number(id), h.matches ? h.wins / h.matches : 0]));
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
let sm = 0, players = 0, smFrom = Infinity, smTo = 0, smRankLo = Infinity, smRankHi = 0;
const laneOf = (r, ln) => ln === 'm' ? 1 : ln === 's' ? (r ? 2 : 0) : ln === 'o' ? (r ? 0 : 2) : -1;
// Повтор id после оборванного сбора отсеивается, битая строка пропускается — tools/match-source.js metaMatches()
for (const m of require('./match-source.js').metaMatches()) {
  {
    if (m.t < patchTs) continue;
    sm++;
    if (m.t < smFrom) smFrom = m.t; if (m.t > smTo) smTo = m.t;
    if (m.rank >= 10) { if (m.rank < smRankLo) smRankLo = m.rank; if (m.rank > smRankHi) smRankHi = m.rank; }
    for (const p of m.p) {
      const won = p.r ? m.rw === 1 : m.rw === 0;
      if (p.pos >= 1 && p.pos <= 5) {
        const q = P[p.pos] || (P[p.pos] = { n: 0, gpm: 0, xpm: 0, heroes: new Map() });
        q.n++; q.gpm += p.gpm || 0; q.xpm += p.xpm || 0;
        const hh = q.heroes.get(p.h) || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; hh[0]++; hh[9] += m.dur || 0; if (won) hh[1]++; hh[2] += p.gpm || 0; hh[3] += p.xpm || 0;
        hh[4] += p.k || 0; hh[5] += p.d || 0; hh[6] += p.a || 0; hh[7] += p.hd || 0; hh[8] += p.lh || 0; q.heroes.set(p.h, hh);   // + K, D, A, урон, добивания (для /me)
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
    .map(([h, v]) => ({ id: h, n: v[0], wr: r1(v[1] / v[0] * 100), lo: r1(wilsonLow(v[1], v[0]) * 100), gpm: Math.round(v[2] / v[0]), xpm: Math.round(v[3] / v[0]),
      k: r1(v[4] / v[0]), d: r1(v[5] / v[0]), a: r1(v[6] / v[0]), hd: Math.round(v[7] / v[0]), lh: Math.round(v[8] / v[0]), m: r1(v[9] / v[0] / 60) }))   // m — средняя длительность матча, мин (Учебный центр, разбор матча: показатели «в минуту»)
    .sort((a, b) => b.lo - a.lo);
  positions[pos] = { n: q.n, gpm: Math.round(q.gpm / q.n), xpm: Math.round(q.xpm / q.n), heroes: list };
}
const posSteam = {};
for (const [pos, q] of Object.entries(PS)) {
  const list = [...q.heroes].filter(([, v]) => v[0] >= MIN_POS)
    .map(([h, v]) => ({ id: h, n: v[0], wr: r1(v[1] / v[0] * 100), lo: r1(wilsonLow(v[1], v[0]) * 100), gpm: Math.round(v[2] / v[0]), xpm: Math.round(v[3] / v[0]) }))
    .sort((a, b) => b.lo - a.lo);
  posSteam[pos] = { n: q.n, gpm: Math.round(q.gpm / q.n), xpm: Math.round(q.xpm / q.n), heroes: list };
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
  // Тот же список основных ролей — отдельным маленьким файлом для значков
  // ролей по всему сайту (js/hero-roles.js, data-hero-badges).
  MS.writeJsonAtomic(D('hero-main-roles.json'), JSON.stringify({ fetchedAt: RP.fetchedAt, mainShare: MAIN_SHARE,
    heroes: Object.fromEntries(heroRows.filter(h => h.ro && h.ro.length).map(h => [h.id, h.ro])) }));
} catch (e) { console.warn('Роли не добавлены:', e.message); }

// ---------- 4. История ----------
fs.mkdirSync(HIST, { recursive: true });
const day = new Date(maxT * 1000).toISOString().slice(0, 10);
MS.writeJsonAtomic(path.join(HIST, day + '.json'), JSON.stringify({ day, total, h: Object.fromEntries(heroRows.map(h => [h.id, [h.n, h.wr, h.pr]])) }));
const snaps = fs.readdirSync(HIST).filter(f => f.endsWith('.json')).sort().slice(-HISTORY_DAYS)
  .map(f => JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8')));
const history = { days: snaps.map(s => s.day), totals: snaps.map(s => s.total), heroes: {} };
for (const id of heroIds) history.heroes[id] = snaps.map(s => (s.h[id] ? [s.h[id][1], s.h[id][2]] : null));

// ---------- 5. Срезы тир-листа: Divine 5 и Immortal, про-сцена ----------
// Строка героя: [id, матчей, винрейт %, надёжный винрейт (Уилсон) %, пикрейт %] (+ у про-сцены средние У/С/П).
const slices = {};
try {
  const T = read('our-meta-top.json');
  const used = T.matchesUsed;
  slices.top = {
    // our-meta-top.json считается по ленте OpenDota top (tools/build-our-stats.js --tier top) при любом --source
    source: (/Steam/.test(T.source || '') ? 'Своя база рейтинговых матчей (Steam Web API, ранг матча из ленты OpenDota)' : 'Своя база рейтинговых матчей (OpenDota /publicMatches)') + ', Ranked All Pick, средний ранг матча Divine 5 и Immortal',
    matches: used, from: T.firstMatchAt, to: T.lastMatchAt,
    heroes: Object.entries(T.heroes).map(([id, h]) => [Number(id), h.matches, r1(h.wins / h.matches * 100), r1(wilsonLow(h.wins, h.matches) * 100), r1(h.matches / used * 100)])
  };
} catch (e) { console.warn('Срез Divine 5 и Immortal не добавлен:', e.message); }
// Про-сцена — по разобранным реплеям архива эфира (только на сервере: ~/dotamate-collector/archive).
// Без архива (рабочий компьютер) берётся прошлый срез из data/stats.json, чтобы его не потерять.
const ARCHIVE = path.join(process.env.DOTAMATE_COLLECTOR || path.join(require('os').homedir(), 'dotamate-collector'), 'archive');
try {
  const idx = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'index.json'), 'utf8')).matches.filter(m => m.pro);
  const P = new Map(), leagues = new Map();
  let n = 0, from = Infinity, to = 0;
  const seenPro = new Set();   // повтор match_id в индексе не должен раздувать выборку
  for (const im of idx) {
    if (seenPro.has(String(im.matchId))) continue;
    seenPro.add(String(im.matchId));
    let m; try { m = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'matches', im.matchId + '.json'), 'utf8')); } catch { continue; }
    if (!m.players || m.players.length !== 10) continue;
    n++; from = Math.min(from, m.endTime); to = Math.max(to, m.endTime);
    const lg = im.pro.league || '—'; leagues.set(lg, (leagues.get(lg) || 0) + 1);
    const pickedHere = new Set();   // герой — один раз на матч
    for (const pl of m.players) {
      if (pickedHere.has(pl.heroId)) continue;
      pickedHere.add(pl.heroId);
      const x = P.get(pl.heroId) || { n: 0, w: 0, k: 0, d: 0, a: 0 };
      x.n++; if ((pl.team === 'radiant') === m.radiantWin) x.w++;
      x.k += pl.k; x.d += pl.d; x.a += pl.a; P.set(pl.heroId, x);
    }
  }
  if (n) slices.pro = {
    source: 'Разобранные реплеи про-матчей (лента OpenDota /proMatches, реплеи Valve) из архива эфира DotaMate',
    matches: n, from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString(),
    leagues: [...leagues].sort((a, b) => b[1] - a[1]),
    // Меньше MIN_PRO_RANK выборов — винрейт и «надёжный» не отдаются (null): на сайте 1–4 не показываются, 5–11 — «мало данных».
    heroes: [...P].map(([id, x]) => [id, x.n, x.n >= MIN_PRO_RANK ? r1(x.w / x.n * 100) : null, x.n >= MIN_PRO_RANK ? r1(wilsonLow(x.w, x.n) * 100) : null, r1(x.n / n * 100), r1(x.k / x.n), r1(x.d / x.n), r1(x.a / x.n)])
  };
} catch (e) {
  try { const old = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (old.slices && old.slices.pro) slices.pro = old.slices.pro; } catch { /* прошлого среза нет */ }
  if (!slices.pro) console.warn('Срез про-сцены не добавлен:', e.message);
}

// ---------- запись ----------
const out = {
  builtAt: new Date().toISOString(),
  base: {
    source: SRC === 'steam' ? 'Выборка рейтинговых матчей Steam Web API (не все матчи), Ranked All Pick; ранг известен у ' + r1(Object.values(rankHist).reduce((a, b) => a + b, 0) / total * 100) + '% матчей'
      : 'Своя база рейтинговых матчей (OpenDota /publicMatches), ранги Рекрут–Властелин, Ranked All Pick',
    matches: total, from: new Date(minT * 1000).toISOString(), to: new Date(maxT * 1000).toISOString(),
    // Steam: сбор выборочный (бюджет запросов, курсор прыгает к «сейчас»), не все рейтинговые матчи; days — дневных файлов в базе.
    ...(SRC === 'steam' ? { sampled: true, days: MS.steamFiles().length } : {}),
    // Детальные матчи Stratz (линии, покупки, позиции 1–5): свой срез — текущий патч, кандидаты из ленты OpenDota.
    stratz: { matches: sm, from: sm ? new Date(smFrom * 1000).toISOString() : null, to: sm ? new Date(smTo * 1000).toISOString() : null,
      rankLo: sm && smRankHi ? smRankLo : null, rankHi: sm && smRankHi ? smRankHi : null },
    ranks: Object.fromEntries(Object.entries(RANKS).map(([g, name]) => [g, { name, n: rankHist[g] || 0 }])),
    radiantWr: r1(radWins / total * 100),
    duration: [...durHist].sort((a, b) => a[0] - b[0]).map(([m, n]) => [m, n]),
    stratzMatches: sm, patch: read('patch-notes.json').version,
    // начало патча: все матчи Steam в выборке — не раньше него (tools/match-source.js patchSince)
    patchFrom: MS.patchSince() ? new Date(MS.patchSince() * 1000).toISOString() : null,
    src: SRC
  },
  roles: rolesNote,
  method: { minProShow: MIN_PRO_SHOW, minProRank: MIN_PRO_RANK, minTier: MIN_TIER, minRank: MIN_RANK, minPair: MIN_PAIR, minPos: MIN_POS, minLane: MIN_LANE, minDur: MIN_DUR_BUCKET, durBuckets: DUR.map(([k, , , l]) => [k, l]) },
  // контрпики берутся из hero-counters.json как есть; если его пересчёт сегодня упал, тут дата прошлого расчёта
  countersAt: C.builtAt || null,
  heroes: heroRows, durSwing, synergy: synergy.slice(0, 40), antiSynergy: synergy.slice(-20).reverse(), counters: topCounters,
  positions, lanes, items, history, slices
};
if (SRC === 'steam') out.posSteam = { labeled: posLabeled, stratz: posStratz, model: PM ? { created: PM.model.meta.created || null, test: PM.model.meta.metrics && PM.model.meta.metrics.test ? { acc: PM.model.meta.metrics.test.acc, core3sup: PM.model.meta.metrics.test.core3sup } : null } : null, pos: posSteam };
MS.writeJsonAtomic(OUT, out);
console.log(`stats.json: ${total} матчей, тир-лист ${ranked.length} героев, связок ${synergy.length}, позиций ${Object.keys(positions).length}, линий ${lanes.length}, предметов ${items.length}, снимков истории ${snaps.length}, срезов ${Object.keys(slices).join('+') || 'нет'}${SRC === 'steam' ? `, позиций Steam ${Object.keys(posSteam).length} (размечено матчей ${posLabeled}, из них по Stratz ${posStratz})` : ''}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} КБ`);
}
main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
