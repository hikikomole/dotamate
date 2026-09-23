#!/usr/bin/env node
/**
 * Проверяет, что на сайт уехал именно свежий снимок способностей.
 * Сравнивает дату из локального файла с тем, что отдаёт dotamate.ru.
 *
 * Запуск: node tools/verify-live-abilities.js
 */
const fs = require('fs');
const path = require('path');

const URL = 'https://dotamate.ru/data/hero-abilities.json';

(async () => {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hero-abilities.json'), 'utf8'));
  let live;
  try {
    const r = await fetch(URL + '?t=' + Date.now(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    live = await r.json();
  } catch (e) {
    console.error('Сайт не ответил: ' + e.message);
    process.exit(1);
  }
  if (live.fetchedAt !== local.fetchedAt) {
    console.error(`На сайте снимок от ${String(live.fetchedAt).slice(0, 19)}, а локально ${String(local.fetchedAt).slice(0, 19)} — деплой не доехал.`);
    process.exit(1);
  }
  console.log(`На сайте свежий снимок: героев ${live.heroCount}, от ${String(live.fetchedAt).slice(0, 10)}.`);
})();
