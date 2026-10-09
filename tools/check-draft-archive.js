#!/usr/bin/env node
/**
 * Независимая проверка прогноза DraftMate на матчах эфира DotaMate.
 *
 * Модель — data/our-matrix-top.json + data/draft-calibration-top.json (срез Divine 5 и Immortal), формула — js/draft-model.js.
 * Матчи — архив разобранных реплеев (~/dotamate-collector/archive, есть только на сервере): про-матчи и публичные игры.
 * Матчи, которые уже есть в базе среза (data/public-matches-top), исключаются: их модель видела.
 * Метрики: доля угаданных исходов, log loss и Brier против прогноза «50 на 50».
 *
 * Выход: data/draft-archive-check.json. Без архива (рабочий компьютер) файл не трогается.
 * Запуск: node tools/check-draft-archive.js (после tools/build-draft-calibration.js --tier top)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = f => path.join(ROOT, 'data', f);
const ARCHIVE = path.join(process.env.DOTAMATE_COLLECTOR || path.join(require('os').homedir(), 'dotamate-collector'), 'archive');

global.window = {};
require(path.join(ROOT, 'js', 'draft-model.js'));
const DM = global.window.DraftModel;

if (!fs.existsSync(path.join(ARCHIVE, 'index.json'))) { console.log('Архива эфира нет — проверку пропускаю.'); process.exit(0); }
const M = JSON.parse(fs.readFileSync(D('our-matrix-top.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(D('draft-calibration-top.json'), 'utf8'));
const idx = DM.index(M);

const seen = new Set();
const TOP = D('public-matches-top');
for (const f of fs.existsSync(TOP) ? fs.readdirSync(TOP).filter(f => f.endsWith('.jsonl')) : []) {
  for (const line of fs.readFileSync(path.join(TOP, f), 'utf8').split('\n')) {
    if (!line) continue;
    try { seen.add(String(JSON.parse(line)[0])); } catch { /* битая строка */ }
  }
}

const rows = [];
let skipped = 0;
for (const im of JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'index.json'), 'utf8')).matches) {
  if (seen.has(String(im.matchId))) { skipped++; continue; }
  let m; try { m = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'matches', im.matchId + '.json'), 'utf8')); } catch { continue; }
  if (!m.players || m.players.length !== 10) continue;
  const ids = team => m.players.filter(p => p.team === team).map(p => p.heroId);
  const p = DM.prob(DM.score(M, idx, ids('radiant'), ids('dire'), 0), C) / 100;
  rows.push({ p, y: m.radiantWin ? 1 : 0, pro: !!im.pro });
}
const metrics = list => {
  if (!list.length) return null;
  let ll = 0, br = 0, ok = 0;
  for (const r of list) {
    const q = Math.min(Math.max(r.y ? r.p : 1 - r.p, 1e-12), 1 - 1e-12);
    ll -= Math.log(q); br += (r.p - r.y) ** 2; if ((r.p >= 0.5 ? 1 : 0) === r.y) ok++;
  }
  return { matches: list.length, accuracy: Number((100 * ok / list.length).toFixed(1)), logLoss: Number((ll / list.length).toFixed(4)), brier: Number((br / list.length).toFixed(4)) };
};
const out = {
  builtAt: new Date().toISOString(),
  model: 'our-matrix-top + draft-calibration-top (alpha ' + C.alpha + ')',
  baselineLogLoss: Number(Math.log(2).toFixed(4)), baselineBrier: 0.25,
  excludedSeenInBase: skipped,
  all: metrics(rows), pro: metrics(rows.filter(r => r.pro)), pub: metrics(rows.filter(r => !r.pro))
};
fs.writeFileSync(D('draft-archive-check.json'), JSON.stringify(out, null, 1));
console.log('Проверка на эфире:', JSON.stringify(out.all), '| про:', JSON.stringify(out.pro), '| исключено (были в базе):', skipped);
