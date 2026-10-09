#!/usr/bin/env node
/**
 * Свои позиции 1–5 по архиву разобранных реплеев эфира (~/dotamate-collector/archive, только на сервере).
 *
 * Зачем: модель по итоговой статистике Steam (tools/match-positions.js) различает 1/2/3 на 88–92 %, а 4 и 5 —
 * только на 63–66 % (claude/steam-T3-itog.md). В реплее есть координаты героев по секундам, поэтому позицию
 * можно определить так же, как её определяют Stratz/OpenDota, — по линии и фарму:
 *   линия игрока — медиана (y − x) по секундам 1:00–8:00, пока он жив и не на своей базе (клетки карты, центр 128):
 *     > LANE_THR — верхняя линия, < −LANE_THR — нижняя, иначе — центр;
 *   в команде: мид — игрок центральной линии с наибольшим числом добиваний к 10:00;
 *     1 — игрок лёгкой линии своей стороны (Свет — нижняя, Тьма — верхняя) с наибольшим числом добиваний;
 *     3 — то же на сложной линии; оставшиеся двое — поддержка: 5 — на лёгкой линии, 4 — второй.
 *   Если расстановка не сходится (например, оба саппорта на одной линии), позиция «?» — в статистику не идёт.
 *
 * Проверка — попутная: матчи архива, которые уже есть в data/meta-matches с позициями Stratz (новых запросов к Stratz
 * ради неё не делается — решение владельца 09.10.2026). Точность по каждой позиции и отдельно «4 против 5».
 *
 * Выход: data/archive-positions.json — метод, проверка, период и выборка, по героям [матчей, побед] на позициях 1–5.
 * На сайт не выводится, пока не выполнены условия ready (точность 4 и 5 ≥ 85 % на ≥ 200 командах эталона).
 * Кеш разметки по матчам: <archive>/positions-cache.json (каждый матч размечается один раз).
 *
 * Запуск (на сервере): node tools/archive-positions.js [--seconds 240]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('./match-source.js');

const ROOT = path.join(__dirname, '..');
const ARCHIVE = path.join(process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector'), 'archive');
const CACHE = path.join(ARCHIVE, 'positions-cache.json');
const OUT = path.join(ROOT, 'data', 'archive-positions.json');
const META = path.join(ROOT, 'data', 'meta-matches');

const LANE_FROM = 60, LANE_TO = 480;   // секунды матча, по которым определяется линия
const LANE_THR = 10;                   // клеток от диагонали; подобрано на 60 матчах: 115 из 120 команд — 2–1–2
const MIN_SAMPLES = 60;                // секунд в окне, иначе линия неизвестна
const READY_ACC45 = 85, READY_TEAMS = 200;
const i = process.argv.indexOf('--seconds');
const MAX_SEC = i > 0 ? Number(process.argv[i + 1]) : 240;

function laneOf(p, t0) {
  const d = [];
  for (let t = LANE_FROM; t <= LANE_TO; t++) {
    const k = t - t0;
    if (k < 0 || k >= p.x.length) continue;
    if (p.dead.some(([a, b]) => t >= a && t < b)) continue;
    const u = p.x[k] - 128, v = p.y[k] - 128;
    if (p.team === 'radiant' ? (u < -38 && v < -38) : (u > 38 && v > 38)) continue; // своя база
    d.push(v - u);
  }
  if (d.length < MIN_SAMPLES) return null;
  d.sort((a, b) => a - b);
  const m = d[d.length >> 1];
  return m > LANE_THR ? 'top' : m < -LANE_THR ? 'bot' : 'mid';
}

function label(m) {
  const lh10 = p => { const k = Math.floor((600 - m.econFrom) / m.econStep); return (p.econ.lh[k] != null ? p.econ.lh[k] : p.lh) || 0; };
  const out = [];
  for (const team of ['radiant', 'dire']) {
    const T = m.players.filter(p => p.team === team);
    const safe = team === 'radiant' ? 'bot' : 'top', off = team === 'radiant' ? 'top' : 'bot';
    const L = new Map(T.map(p => [p.slot, laneOf(p, m.t0)]));
    const best = list => list.sort((a, b) => lh10(b) - lh10(a))[0];
    const mid = best(T.filter(p => L.get(p.slot) === 'mid'));
    const carry = best(T.filter(p => p !== mid && L.get(p.slot) === safe));
    const offl = best(T.filter(p => p !== mid && L.get(p.slot) === off));
    const sup = T.filter(p => p !== mid && p !== carry && p !== offl);
    for (const p of T) {
      let pos = p === carry ? 1 : p === mid ? 2 : p === offl ? 3 : null;
      if (pos == null && carry && mid && offl && sup.length === 2) {
        const other = sup.find(q => q !== p);
        const mine = L.get(p.slot) === safe, his = L.get(other.slot) === safe;
        if (mine !== his) pos = mine ? 5 : 4;
      }
      out.push({ s: p.slot, h: p.heroId, ln: L.get(p.slot), pos });
    }
  }
  return out;
}

function stratzIndex() {
  const ix = new Map();
  if (!fs.existsSync(META)) return ix;
  for (const f of fs.readdirSync(META).filter(f => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(META, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const m = JSON.parse(line); if (m.p && m.p.length === 10 && m.p.every(p => p.pos >= 1 && p.pos <= 5)) ix.set(String(m.id), m); } catch { /* оборванная строка */ }
    }
  }
  return ix;
}

function main() {
  const idx = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'index.json'), 'utf8')).matches;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* первый запуск */ }
  const t0 = Date.now();
  let added = 0, failed = 0;
  // Новые матчи — сначала свежие; лимит времени, остальное доберётся следующим запуском.
  for (const im of idx.filter(m => !m.pro && !cache[m.matchId]).sort((a, b) => b.endTime - a.endTime)) {
    if ((Date.now() - t0) / 1000 > MAX_SEC) break;
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'matches', im.matchId + '.json'), 'utf8')); } catch { continue; }
    try {
      cache[im.matchId] = { t: m.endTime, mode: m.gameMode, dur: m.duration, rw: m.radiantWin ? 1 : 0, p: m.players.length === 10 ? label(m) : null };
      added++;
    } catch { failed++; cache[im.matchId] = { t: m.endTime, mode: m.gameMode, p: null }; }
  }
  writeJsonAtomic(CACHE, cache);

  // Проверка по Stratz и выборка (только рейтинговые матчи от 15 минут)
  const SZ = stratzIndex();
  const acc = { 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0], 5: [0, 0] };
  let teams45 = 0, ok45 = 0, laneN = 0, laneOk = 0, refMatches = 0;
  const heroes = {}; let matches = 0, labeled = 0, players = 0, from = Infinity, to = 0;
  for (const [id, c] of Object.entries(cache)) {
    if (!c.p || c.mode !== 22 || (c.dur || 0) < 900) continue;
    matches++; from = Math.min(from, c.t); to = Math.max(to, c.t);
    for (const q of c.p) {
      players++;
      if (q.pos == null) continue;
      labeled++;
      const won = (q.s < 5) === (c.rw === 1);
      const h = heroes[q.h] || (heroes[q.h] = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
      h[q.pos - 1][0]++; if (won) h[q.pos - 1][1]++;
    }
    const z = SZ.get(id);
    if (!z) continue;
    refMatches++;
    for (const r of [1, 0]) {
      const ours = c.p.filter(q => (q.s < 5 ? 1 : 0) === r), ref = z.p.filter(p => p.r === r);
      for (const q of ours) {
        const zp = ref.find(p => p.h === q.h);
        if (!zp) continue;
        if (q.pos != null) { acc[zp.pos][1]++; if (q.pos === zp.pos) acc[zp.pos][0]++; }
        const want = zp.ln === 'm' ? 'mid' : zp.ln === 's' ? (r ? 'bot' : 'top') : zp.ln === 'o' ? (r ? 'top' : 'bot') : null;
        if (want && q.ln) { laneN++; if (q.ln === want) laneOk++; }
      }
      const s4 = ours.find(q => q.pos === 4), s5 = ours.find(q => q.pos === 5);
      const z4 = ref.find(p => p.pos === 4), z5 = ref.find(p => p.pos === 5);
      if (s4 && s5 && z4 && z5) { teams45++; if (s4.h === z4.h && s5.h === z5.h) ok45++; }
    }
  }
  const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
  const check = {
    refMatches, teams45, acc45: pct(ok45, teams45), lane: pct(laneOk, laneN), laneN,
    byPos: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { n: v[1], acc: pct(v[0], v[1]) }]))
  };
  const out = {
    builtAt: new Date().toISOString(),
    source: 'Разобранные реплеи рейтинговых матчей (Ranked All Pick) из архива эфира DotaMate',
    method: { laneFrom: LANE_FROM, laneTo: LANE_TO, laneThr: LANE_THR, rule: 'линия 1:00–8:00 + добивания к 10:00; 5 — поддержка на лёгкой линии, 4 — вторая' },
    period: matches ? { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() } : null,
    matches, players, labeled, labeledShare: pct(labeled, players),
    check,
    ready: check.acc45 != null && check.acc45 >= READY_ACC45 && teams45 >= READY_TEAMS,
    readyRule: { acc45: READY_ACC45, teams: READY_TEAMS },
    heroes
  };
  writeJsonAtomic(OUT, out);
  console.log(`Позиции по архиву: размечено новых ${added}${failed ? ', ошибок ' + failed : ''}; рейтинговых матчей ${matches}, ` +
    `позиция определена у ${out.labeledShare} % игроков; эталон Stratz: ${refMatches} матчей, 4/5 верно ${check.acc45 ?? '—'} % на ${teams45} командах, ` +
    `линия ${check.lane ?? '—'} % (${laneN}); ready=${out.ready}`);
}

main();
