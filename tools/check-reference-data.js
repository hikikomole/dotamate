#!/usr/bin/env node
/**
 * Проверка справочников, которые ежедневное обновление само не обновляет (аудит 10.10.2026, п. 1.4).
 *
 *  1. Патч: версия data/patch-notes.json против последней в списке Valve (datafeed/patchnoteslist).
 *     Устарела — фильтр «текущий патч» (build-stats, build-hero-items, build-item-*) режет не по тому патчу.
 *  2. Герои: hero_id из последнего закрытого дня базы Steam, которых нет в data/heroes.json.
 *     Неизвестный герой — матч с ним целиком выпадает из всей статистики (build-stats, build-our-stats).
 *
 * Ничего не меняет и не обновляет. Итог — в logs/reference-check.txt (пустой файл — всё в порядке)
 * и в stdout; код выхода 0 — в порядке, 3 — справочники устарели, 1 — проверку выполнить не удалось.
 * Запуск: node tools/check-reference-data.js   (шаг в tools/daily-update.js)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const MS = require('./match-source.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'logs', 'reference-check.txt');
const MAX_ROWS = 50000;           // хватает, чтобы встретить любого героя; весь день (~200 тыс.) читать незачем

async function latestPatch() {
  const r = await fetch('https://www.dota2.com/datafeed/patchnoteslist?language=english', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('datafeed HTTP ' + r.status);
  const d = await r.json();
  const list = d.patches || d;
  const last = Array.isArray(list) ? list[list.length - 1] : null;
  return last ? String(last.patch_name || last.patch_number || '').trim() || null : null;
}

async function unknownHeroes() {
  const known = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes.map(h => Number(h.id)));
  const files = MS.steamFiles();
  // сегодняшний файл ещё дописывается сборщиком — берём предпоследний (закрытый) день
  const file = files.length > 1 ? files[files.length - 2] : files[0];
  if (!file) return { file: null, rows: 0, unknown: new Map() };
  const unknown = new Map();
  let rows = 0;
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    for (const p of r.slice(9, 19)) if (Array.isArray(p) && !known.has(p[0])) unknown.set(p[0], (unknown.get(p[0]) || 0) + 1);
    if (++rows >= MAX_ROWS) { rl.close(); input.destroy(); break; }
  }
  return { file: path.basename(file), rows, unknown };
}

async function main() {
  const issues = [];
  const ours = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'patch-notes.json'), 'utf8')).version || '?';
  let theirs = null;
  try { theirs = await latestPatch(); } catch (e) { console.log('Список патчей Valve недоступен: ' + e.message + ' — версию не сверил.'); }
  if (theirs && theirs !== ours) issues.push(`вышел патч ${theirs}, а data/patch-notes.json — ${ours}: обновить node tools/fetch-patch-notes.js (и справочники героев/предметов)`);
  else console.log('Патч: ' + ours + (theirs ? ' — совпадает с Valve' : ''));
  const h = await unknownHeroes();
  if (h.unknown.size) issues.push(`в матчах Steam (${h.file}, ${h.rows} строк) есть герои, которых нет в data/heroes.json: ${[...h.unknown].map(([id, n]) => id + ' (' + n + ' игроков)').join(', ')} — такие матчи выпадают из статистики целиком`);
  else console.log(`Герои: неизвестных нет (${h.file || 'нет файлов Steam'}, ${h.rows} строк)`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, issues.join('\n'));
  if (issues.length) { console.log('СПРАВОЧНИКИ УСТАРЕЛИ:\n- ' + issues.join('\n- ')); process.exitCode = 3; }
}

main().catch(e => { console.error('Проверка справочников не выполнена: ' + e.message); process.exit(1); });
