#!/usr/bin/env node
// Дозаливает русские описания способностей тем героям, у кого они не доехали
// при основном сборе: воркер ходит за константами OpenDota, и при быстрой
// серии из 127 запросов часть ответов приходит пустой. Матчапы и покупки не
// трогаем — только способности.
//
// Запуск: node tools/topup-hero-abilities.js
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'seo', 'hero-guide-data.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const store = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const heroes = store.heroes || {};
  const missing = Object.entries(heroes).filter(([, v]) => !(v.abilities || []).length);
  console.log(`без способностей: ${missing.length}`);
  let fixed = 0;
  for (const [id, v] of missing) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://dotamate.ru/api/dota/hero/${encodeURIComponent(v.name)}/abilities`);
        if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) { heroes[id].abilities = j; fixed++; break; } }
      } catch {}
      await sleep(2500 * (attempt + 1));
    }
    await sleep(1200);
    if (fixed && fixed % 10 === 0) fs.writeFileSync(OUT, JSON.stringify({ ...store, heroes }, null, 1), 'utf8');
  }
  fs.writeFileSync(OUT, JSON.stringify({ ...store, heroes }, null, 1), 'utf8');
  const left = Object.values(heroes).filter(v => !(v.abilities || []).length).length;
  console.log(`дозалито: ${fixed}, осталось без способностей: ${left}`);
})();
