#!/usr/bin/env node
/**
 * Средние по героям для карточек игроков в эфире /live.
 *
 * Источник — архив разобранных реплеев сервера (~/dotamate-collector/archive/matches, tools/replay/normalize.js):
 * у каждого игрока econ.{gold,lh,lvl} с шагом econStep от econFrom (gold — всё заработанное золото, проверяется ниже),
 * смерти — deaths[{t, victim, killer}]. Считаем на отметках 5, 10, 15 … 60 мин (только матчи, дошедшие до отметки):
 *   добивания, GPM = заработанное золото / минуты, уровень, убийства, смерти (по deaths, как счёт в эфире).
 * Один матч = одна запись героя (повтор номера матча не учитывается дважды).
 *
 * Порог выборки MIN_N = 30 матчей на отметке (обоснование и проверка на данных — --report, отчёт в
 * claude/plan-efir-10-zadach.md, «Чат 3»). Ниже порога отметка в файл не пишется — сайт её не показывает.
 *
 * Запуск (на сервере): node tools/build-live-hero-avg.js [--archive <папка>] [--out <файл>] [--report]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const ARCH = arg('--archive', path.join(os.homedir(), 'dotamate-collector', 'archive'));
const OUT = arg('--out', path.join(__dirname, '..', 'data', 'live-hero-avg.json'));
const REPORT = process.argv.includes('--report');
const MIN_N = 30, MARK = 300, MAX_MARK = 3600;

const dir = path.join(ARCH, 'matches');
if (!fs.existsSync(dir)) { console.error('Нет архива матчей: ' + dir); process.exit(2); }
const seen = new Set(), acc = {}; // acc[hero][mark] = массивы значений
let used = 0, bad = 0, dup = 0, nonMono = 0, goldChecks = 0;
for (const f of fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { bad++; continue; }
  if (!Array.isArray(m.players) || m.players.length !== 10 || !m.econStep || !Array.isArray(m.deaths)) { bad++; continue; }
  const id = String(m.matchId); if (seen.has(id)) { dup++; continue; } seen.add(id); used++;
  for (const p of m.players) {
    const e = p.econ || {}, g = e.gold || [];
    for (let i = 1; i < g.length; i++) if (g[i] != null && g[i - 1] != null) { goldChecks++; if (g[i] < g[i - 1]) nonMono++; }
    for (let t = MARK; t <= MAX_MARK && t <= m.t1; t += MARK) {
      const i = Math.round((t - m.econFrom) / m.econStep);
      const gold = g[i], lh = (e.lh || [])[i], lvl = (e.lvl || [])[i];
      if (gold == null || lh == null || lvl == null) continue;
      let k = 0, d = 0;
      for (const x of m.deaths) if (x.t <= t) { if (x.victim === p.slot) d++; if (x.killer === p.slot) k++; }
      const h = acc[p.heroId] = acc[p.heroId] || {}, a = h[t] = h[t] || { lh: [], gpm: [], lvl: [], k: [], d: [] };
      a.lh.push(lh); a.gpm.push(gold / (t / 60)); a.lvl.push(lvl); a.k.push(k); a.d.push(d);
    }
  }
}
const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
const sd = v => { const mu = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1)); };
const r1 = v => Math.round(v * 10) / 10;
console.log('Матчей: ' + used + ' (повторов ' + dup + ', пропущено ' + bad + '); econ.gold не убывает в ' + (goldChecks - nonMono) + ' из ' + goldChecks + ' шагов');
if (nonMono > goldChecks * 0.001) { console.error('econ.gold убывает — это не заработанное золото, GPM считать нельзя. Файл не записан.'); process.exit(3); }

if (REPORT) { // точность среднего: половина 95% интервала (1,96·sd/√n) в % от среднего, по всем героям с n ≥ 60 на отметке
  for (const t of [600, 1200, 1800]) for (const key of ['lh', 'gpm', 'lvl']) {
    const cv = []; for (const h in acc) { const a = acc[h][t]; if (a && a[key].length >= 60) cv.push(sd(a[key]) / mean(a[key])); }
    cv.sort((x, y) => x - y); const med = cv[cv.length >> 1];
    console.log('отметка ' + t / 60 + ' мин, ' + key + ': героев ' + cv.length + ', медиана CV ' + (med * 100).toFixed(1) + '%; ±95%: ' +
      [10, 20, 30, 50, 100].map(n => 'n=' + n + ' ' + (196 * med / Math.sqrt(n)).toFixed(1) + '%').join(', '));
  }
  const hist = {}; for (const h in acc) for (const t in acc[h]) { const n = acc[h][t].lh.length; if (t == 600 || t == 1800) { const b = (t / 60) + 'мин ' + (n >= 30 ? '≥30' : n >= 20 ? '20-29' : '<20'); hist[b] = (hist[b] || 0) + 1; } }
  console.log('героев по выборке:', JSON.stringify(hist));
}

const heroes = {}; let marks = 0;
for (const h in acc) for (const t in acc[h]) {
  const a = acc[h][t]; if (a.lh.length < MIN_N) continue;
  (heroes[h] = heroes[h] || {})[t] = [a.lh.length, r1(mean(a.lh)), Math.round(mean(a.gpm)), r1(mean(a.lvl)), r1(mean(a.k)), r1(mean(a.d))];
  marks++;
}
console.log('Героев с данными: ' + Object.keys(heroes).length + ', отметок ≥ ' + MIN_N + ' матчей: ' + marks);
fs.writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString(), matches: used, minN: MIN_N, mark: MARK,
  source: 'архив разобранных реплеев эфира DotaMate (рейтинговые матчи высокого ранга и про-матчи)',
  format: 'heroes[heroId][секунда отметки] = [матчей, добивания, GPM, уровень, убийства, смерти] — средние на эту минуту',
  heroes
}));
