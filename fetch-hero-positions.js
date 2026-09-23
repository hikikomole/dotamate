#!/usr/bin/env node
/**
 * Выгружает статистику героев по пяти позициям из Stratz GraphQL API
 * и сохраняет офлайн-снимок в data/hero-positions.json.
 *
 * Снимок — это запасной источник: Worker обновляет данные раз в сутки
 * напрямую из Stratz, а при недоступности API отдаёт этот файл.
 *
 * Запуск:  node fetch-hero-positions.js
 * Токен:   stratz.capi.txt (строка вида https://stratz.com/api=<JWT>)
 *          или переменная окружения STRATZ_TOKEN
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.stratz.com/graphql';
const BRACKET = 'DIVINE_IMMORTAL';        // верхний брекет — ближе всего к «7000+ MMR» у D2PT
const OUT = path.join(__dirname, 'data', 'hero-positions.json');
const POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const f = path.join(__dirname, 'stratz.capi.txt');
  if (!fs.existsSync(f)) throw new Error('Нет токена: ни STRATZ_TOKEN, ни stratz.capi.txt');
  const raw = fs.readFileSync(f, 'utf8').trim();
  const token = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw;
  const t = token.replace(/[\r\n\s]/g, '');
  if (t.split('.').length !== 3) throw new Error('Токен не похож на JWT (ожидались три части через точку)');
  return t;
}

async function gql(token, query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'STRATZ_API'
    },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error('Stratz ответил HTTP ' + res.status);
  const j = await res.json();
  if (j.errors) throw new Error('Stratz вернул ошибку: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

async function main() {
  const token = readToken();
  const data = await gql(token, `{
    heroStats {
      stats(bracketBasicIds:[${BRACKET}], groupByPosition:true) {
        heroId position matchCount winCount
      }
    }
  }`);

  const rows = data.heroStats.stats || [];
  if (!rows.length) throw new Error('Stratz вернул пустой список — прерываю, чтобы не затереть снимок');

  const byHero = new Map();
  for (const r of rows) {
    if (!POSITIONS.includes(r.position)) continue;
    if (!byHero.has(r.heroId)) byHero.set(r.heroId, {});
    byHero.get(r.heroId)[r.position] = {
      matches: r.matchCount,
      wins: r.winCount,
      winrate: r.matchCount ? +(r.winCount / r.matchCount * 100).toFixed(1) : null
    };
  }

  const heroes = {};
  for (const [heroId, pos] of byHero) {
    const total = POSITIONS.reduce((s, p) => s + (pos[p]?.matches || 0), 0);
    // «доля позиции» — сколько процентов матчей героя сыграно на этой линии
    for (const p of POSITIONS) {
      if (pos[p]) pos[p].share = total ? +(pos[p].matches / total * 100).toFixed(1) : 0;
    }
    const top = POSITIONS
      .filter(p => pos[p])
      .sort((a, b) => pos[b].matches - pos[a].matches)[0] || null;
    heroes[heroId] = {
      positions: pos,
      totalMatches: total,
      totalWins: POSITIONS.reduce((s, p) => s + (pos[p]?.wins || 0), 0),
      topPosition: top,
      // позиции, на которых герой играется заметно часто (≥10% его матчей)
      mainPositions: POSITIONS.filter(p => pos[p] && pos[p].share >= 10)
    };
  }

  const out = {
    source: 'Stratz GraphQL API',
    bracket: BRACKET,
    fetchedAt: new Date().toISOString(),
    heroCount: Object.keys(heroes).length,
    heroes
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`OK: ${out.heroCount} героев -> ${path.relative(__dirname, OUT)}`);
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
