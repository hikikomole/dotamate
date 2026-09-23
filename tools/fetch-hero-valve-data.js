#!/usr/bin/env node
/**
 * Официальные данные героев из datafeed Valve (dota2.com), на русском.
 *
 * Зачем: поля complexity в нашей базе не было вообще, поэтому код
 * `h.complexity||1` показывал сложность 1 из 3 у ВСЕХ 127 героев —
 * у Invoker и Meepo (настоящая сложность 3) ромбик был такой же, как
 * у Anti-Mage. Здесь берём настоящее значение прямо из клиента игры.
 *
 * Заодно тянем русские тексты (био, описание роли, подсказка новичку) —
 * они пригодятся для контента страниц героев.
 *
 * Запуск: node tools/fetch-hero-valve-data.js
 */
const fs = require('fs');
const path = require('path');

const FEED = id => `https://www.dota2.com/datafeed/herodata?language=russian&hero_id=${id}`;
const ROOT = path.join(__dirname, '..');
const HEROES = path.join(ROOT, 'data', 'heroes.json');
const OUT_TEXT = path.join(ROOT, 'data', 'hero-valve-ru.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchHero(id, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(FEED(id), { headers: { 'User-Agent': 'dotamate.ru' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const h = (j?.result?.data?.heroes || [])[0];
      if (h) return h;
      throw new Error('пустой ответ');
    } catch (e) {
      if (i === tries - 1) return null;
      await sleep(800 * (i + 1));
    }
  }
  return null;
}

async function main() {
  const store = JSON.parse(fs.readFileSync(HEROES, 'utf8'));
  const heroes = store.heroes;
  const texts = {};
  let got = 0, missed = [];

  for (const h of heroes) {
    const v = await fetchHero(h.id);
    if (!v) { missed.push(h.localized_name); continue; }

    // Сложность 1–3 — это шкала самой Valve, ничего не пересчитываем.
    if (typeof v.complexity === 'number' && v.complexity >= 1 && v.complexity <= 3) {
      h.complexity = v.complexity;
      got++;
    }
    texts[h.id] = {
      name_ru: v.name_loc || null,
      bio: v.bio_loc || null,
      hype: v.hype_loc || null,      // короткая «зазывалка» о герое
      npe: v.npe_desc_loc || null,   // описание для новичков
      attack_range: v.attack_range ?? null,
      turn_rate: v.turn_rate ?? null,
      magic_resistance: v.magic_resistance ?? null
    };
    await sleep(120); // datafeed без заявленных лимитов — не долбим его
  }

  store.valveDataAt = new Date().toISOString();
  fs.writeFileSync(HEROES, JSON.stringify(store, null, 1));
  fs.writeFileSync(OUT_TEXT, JSON.stringify({
    source: 'dota2.com/datafeed/herodata (русский)',
    fetchedAt: new Date().toISOString(),
    heroes: texts
  }, null, 1));

  const dist = {};
  for (const h of heroes) dist[h.complexity ?? 'нет'] = (dist[h.complexity ?? 'нет'] || 0) + 1;
  console.log(`Сложность получена у ${got} из ${heroes.length}. Распределение:`, JSON.stringify(dist));
  if (missed.length) console.log('Не ответили:', missed.join(', '));
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
