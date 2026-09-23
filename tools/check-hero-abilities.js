#!/usr/bin/env node
/**
 * Проверка снимка способностей перед деплоем.
 *
 * Смысл: обновление идёт без человека, поэтому испорченный снимок не должен
 * молча уехать на сайт. Скрипт возвращает код 1, и обновлялка останавливается.
 *
 * Запуск: node tools/check-hero-abilities.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIN_HEROES = 115;        // ниже — явно что-то отвалилось
const MAX_MISSING_DESC = 40;   // на 2026-09-23 было 7 из 719

function fail(msg) { console.error('ПРОВЕРКА НЕ ПРОЙДЕНА: ' + msg); process.exit(1); }

let snap;
try { snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hero-abilities.json'), 'utf8')); }
catch (e) { fail('файл data/hero-abilities.json не читается (' + e.message + ')'); }

const heroes = snap.heroes || {};
const ids = Object.keys(heroes);
if (ids.length < MIN_HEROES) fail(`героев ${ids.length}, ожидалось не меньше ${MIN_HEROES}`);

let abilities = 0, noDesc = 0;
const thin = [];
for (const id of ids) {
  const list = heroes[id];
  if (!Array.isArray(list) || list.length < 3) { thin.push(id); continue; }
  for (const a of list) {
    abilities++;
    if (!a.key || !a.dname) fail(`у героя ${id} способность без ключа или названия`);
    if (!a.desc) noDesc++;
  }
}
if (thin.length) fail(`у героев ${thin.slice(0, 5).join(', ')} меньше трёх способностей`);
if (noDesc > MAX_MISSING_DESC) fail(`без русского описания ${noDesc} способностей, порог ${MAX_MISSING_DESC}`);

const age = (Date.now() - new Date(snap.fetchedAt).getTime()) / 3600000;
if (!(age >= 0) || age > 24) fail(`снимок не свежий: ${Math.round(age)} ч. от роду`);

console.log(`Проверка пройдена: героев ${ids.length}, способностей ${abilities}, без описания ${noDesc}.`);
