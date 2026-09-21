#!/usr/bin/env node
// Собирает данные для гайдов по героям в seo/hero-guide-data.json.
// Файл нужен только при сборке — в deploy/ он не попадает.
//
// Источники, все — реальные агрегаты, ничего не придумывается:
//   1. OpenDota /api/heroStats — роли, атрибут, база, про-пики.
//   2. OpenDota /api/heroes/<id>/matchups — сыгранные матчи и победы против
//      каждого героя. Отсюда берутся «кого контрит» и «кто контрит».
//   3. OpenDota /api/heroes/<id>/itemPopularity — реальные покупки по стадиям.
//   4. Наш же воркер /api/dota/hero/<name>/abilities — официальный русский
//      текст способностей Valve (цепочка уже реализована в deploy/worker.js,
//      дублировать её здесь незачем).
//
// Бесплатный ключ OpenDota — 60 запросов в минуту, поэтому между запросами
// пауза. Полный проход занимает примерно шесть-семь минут.
//
// Запуск: node tools/fetch-hero-guide-data.js [--limit N]

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'seo', 'hero-guide-data.json');
const SITE = 'https://dotamate.ru';
const PAUSE = 1100;
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) return null;
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

// Нижняя граница доверительного интервала Уилсона (95%). Матчапов на пару
// героев мало (десятки игр), и без такой поправки наверх вылезали бы пары
// с двумя играми и 100%.
function wilson(wins, games) {
  if (!games) return -1;
  const p = wins / games, z = 1.96, z2 = z * z;
  return (p + z2 / (2 * games) - z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games)) / (1 + z2 / games);
}

(async () => {
  const heroes = await getJson('https://api.opendota.com/api/heroStats');
  if (!Array.isArray(heroes) || !heroes.length) { console.error('heroStats недоступен'); process.exit(1); }
  const byId = new Map(heroes.map(h => [Number(h.id), h]));
  console.log(`героев: ${heroes.length}`);

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const out = prev.heroes || {};
  let done = 0;

  for (const h of heroes) {
    if (done >= LIMIT) break;
    const key = String(h.id);
    // Пустой массив в JS истинный, поэтому проверяем длину: иначе герой, у
    // которого способности не доехали, при повторном запуске молча пропускался.
    if (out[key] && out[key].strongAgainst && out[key].items && (out[key].abilities || []).length) { done++; continue; }

    const matchups = await getJson(`https://api.opendota.com/api/heroes/${h.id}/matchups`);
    await sleep(PAUSE);
    const items = await getJson(`https://api.opendota.com/api/heroes/${h.id}/itemPopularity`);
    await sleep(PAUSE);
    const abilities = await getJson(`${SITE}/api/dota/hero/${encodeURIComponent(h.name)}/abilities`);

    const rows = (matchups || [])
      .filter(m => m.games_played >= 15 && byId.has(Number(m.hero_id)))
      .map(m => ({ id: Number(m.hero_id), games: m.games_played, wins: m.wins, wr: m.wins / m.games_played, score: wilson(m.wins, m.games_played) }));
    rows.sort((a, b) => b.score - a.score);

    out[key] = {
      name: h.name,
      localized_name: h.localized_name,
      matchupGames: (matchups || []).reduce((s, m) => s + (m.games_played || 0), 0),
      matchupPairs: rows.length,
      strongAgainst: rows.slice(0, 8),
      weakAgainst: rows.slice(-8).reverse(),
      items: items || null,
      abilities: Array.isArray(abilities) ? abilities : [],
    };
    done++;
    if (done % 10 === 0) {
      fs.writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), heroes: out }, null, 1), 'utf8');
      console.log(`  ${done}/${heroes.length}…`);
    }
    await sleep(PAUSE);
  }

  fs.writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), heroes: out }, null, 1), 'utf8');
  const n = Object.keys(out).length;
  const noMatch = Object.values(out).filter(x => !x.strongAgainst.length).length;
  const noAb = Object.values(out).filter(x => !x.abilities.length).length;
  console.log(`готово: ${n} героев, без матчапов ${noMatch}, без способностей ${noAb}`);
  console.log(`файл: ${OUT}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} КБ`);
})();
