#!/usr/bin/env node
/**
 * Детали матчей нашего диапазона (0–4500 MMR) для раздела META.
 *
 * Зачем отдельный сборщик: лента OpenDota /publicMatches (data/public-matches/)
 * даёт только героев и исход. Для сборок нужны финальные предметы, позиция
 * игрока, линии, графики — это есть только в деталях матча.
 *
 * Источник: Stratz GraphQL, запрос match(id) по одному матчу. Пакетный
 * matches(ids:[…]) бесплатному токену закрыт («User is not an admin.»).
 * Кандидаты — свежие матчи из нашей базы public-matches. У Stratz есть не
 * каждый матч нашего ранга: на пробе 25.09.2026 нашлось 10 из 40. Промахи
 * запоминаются, повторно не спрашиваем.
 *
 * Почему с компьютера: токен Stratz работает не более чем с двух IP за 15
 * минут, воркер Cloudflare ходит наружу с разных адресов и получает 403.
 *
 * Хранилище (в git и в deploy/ не попадает):
 *   data/meta-matches/YYYY-MM-DD.jsonl — по строке на найденный матч
 *   data/meta-matches/_tried.json      — все спрошенные id (найденные и нет)
 *
 * Запуск:
 *   node tools/collect-meta-matches.js                  — до 2000 запросов
 *   node tools/collect-meta-matches.js --max 500        — ограничить запросы
 *   node tools/collect-meta-matches.js --seconds 160    — ограничить время
 *   node tools/collect-meta-matches.js --stats          — что уже собрано
 *   node tools/collect-meta-matches.js --backfill       — дозапросить покупки
 *        для матчей, собранных до того, как сборщик начал их сохранять
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'public-matches');
const DIR = path.join(ROOT, 'data', 'meta-matches');
const TRIED = path.join(DIR, '_tried.json');
const ENDPOINT = 'https://api.stratz.com/graphql';
const WINDOW_DAYS = 5;        // META показывает последние 5 дней
const MIN_DURATION = 1200;    // до 20 минут сборка не успевает сложиться
const PAUSE_MS = 700;         // два потока ≈ 2 запроса в секунду; с тремя потоками Stratz отвечал 429
const RATE_WAIT_MS = 60000;
const RATE_TRIES = 6;

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : def; };
const MAX_REQ = arg('--max', 2000);
const MAX_SEC = arg('--seconds', 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const f = path.join(ROOT, 'stratz.capi.txt');
  if (!fs.existsSync(f)) throw new Error('Нет токена: ни STRATZ_TOKEN, ни stratz.capi.txt');
  const raw = fs.readFileSync(f, 'utf8').trim();
  const token = (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
  if (token.split('.').length !== 3) throw new Error('Токен не похож на JWT');
  return token;
}

const Q = `query($id:Long!){ match(id:$id){
 id didRadiantWin durationSeconds startDateTime gameMode rank
 winRates radiantNetworthLeads topLaneOutcome midLaneOutcome bottomLaneOutcome
 pickBans{ isPick bannedHeroId }
 players{ heroId isRadiant position lane kills deaths assists goldPerMinute experiencePerMinute
  numLastHits numDenies heroDamage towerDamage heroHealing networth level
  item0Id item1Id item2Id item3Id item4Id item5Id neutral0Id
  stats{ itemPurchases{ time itemId } }
  steamAccountId steamAccount{ name isAnonymous } } } }`;

const POS = { POSITION_1: 1, POSITION_2: 2, POSITION_3: 3, POSITION_4: 4, POSITION_5: 5 };
const LANE = { SAFE_LANE: 's', MID_LANE: 'm', OFF_LANE: 'o', JUNGLE: 'j', ROAMING: 'r' };

// Покупки игрока: [[секунда матча, itemId], …]. Время до 0:00 — отрицательное
// (стартовая закупка). Читает tools/build-hero-items.js.
function buys(p) {
  const list = p.stats && p.stats.itemPurchases;
  return Array.isArray(list) ? list.filter(x => x && x.itemId).map(x => [x.time | 0, x.itemId]) : null;
}

// Компактная строка: только то, что читает tools/build-meta.js.
function pack(m) {
  return {
    id: m.id, rw: m.didRadiantWin ? 1 : 0, dur: m.durationSeconds, t: m.startDateTime, rank: m.rank,
    wr: m.winRates || null, nw: m.radiantNetworthLeads || null,
    lanes: [m.topLaneOutcome, m.midLaneOutcome, m.bottomLaneOutcome],
    bans: (m.pickBans || []).filter(b => !b.isPick && b.bannedHeroId).map(b => b.bannedHeroId),
    p: m.players.map(p => ({
      h: p.heroId, r: p.isRadiant ? 1 : 0, pos: POS[p.position] || 0, ln: LANE[p.lane] || '',
      k: p.kills, d: p.deaths, a: p.assists, gpm: p.goldPerMinute, xpm: p.experiencePerMinute,
      lh: p.numLastHits, dn: p.numDenies, hd: p.heroDamage, td: p.towerDamage, hh: p.heroHealing,
      nw: p.networth, lvl: p.level,
      it: [p.item0Id, p.item1Id, p.item2Id, p.item3Id, p.item4Id, p.item5Id].map(x => x || 0),
      nt: p.neutral0Id || 0,
      b: buys(p),
      // имя показываем только если игрок сам открыл профиль
      acc: p.steamAccount && !p.steamAccount.isAnonymous ? p.steamAccountId : 0,
      name: p.steamAccount && !p.steamAccount.isAnonymous ? p.steamAccount.name : ''
    }))
  };
}

async function ask(token, id, query = Q) {
  for (let t = 1; t <= RATE_TRIES; t++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API' },
        body: JSON.stringify({ query, variables: { id } })
      });
    } catch (e) { await sleep(3000 * t); continue; }
    if (res.status === 429) { console.log('Stratz просит остыть, ждём', RATE_WAIT_MS / 1000, 'с'); await sleep(RATE_WAIT_MS); continue; }
    if (!res.ok) throw new Error('Stratz HTTP ' + res.status);
    const j = await res.json();
    if (j.errors) throw new Error('Stratz: ' + JSON.stringify(j.errors).slice(0, 200));
    return j.data && j.data.match;
  }
  throw new Error('Stratz не отвечает после ' + RATE_TRIES + ' попыток');
}

function candidates(tried) {
  const rows = [];
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(SRC, f), 'utf8').split('\n')) {
      if (!line) continue;
      const m = JSON.parse(line);
      // [id, start, duration, avg_rank, lobby, game_mode, radiant_win, ...heroes]
      if (m[5] === 22 && m[2] >= MIN_DURATION && !tried.has(m[0])) rows.push(m);
    }
  }
  if (!rows.length) return [];
  const newest = rows.reduce((x, m) => Math.max(x, m[1]), 0);
  // Сначала последние сутки (витрина «за 24 часа»), затем остальное окно вперемешку,
  // чтобы база долей покрывала все пять дней, а не только самые свежие часы.
  const mix = id => (id * 2654435761) % 4294967296;
  const fresh = m => m[1] >= newest - 86400 ? 0 : 1;
  return rows.filter(m => m[1] >= newest - WINDOW_DAYS * 86400)
    .sort((a, b) => fresh(a) - fresh(b) || mix(a[0]) - mix(b[0]));
}

function stats() {
  if (!fs.existsSync(DIR)) return console.log('Ещё ничего не собрано.');
  let n = 0;
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'))) {
    const c = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).length;
    n += c; console.log(f, c);
  }
  const tried = fs.existsSync(TRIED) ? JSON.parse(fs.readFileSync(TRIED, 'utf8')).length : 0;
  console.log('Матчей с деталями:', n, '| спрошено всего:', tried);
}

const QB = `query($id:Long!){ match(id:$id){ players{ heroId isRadiant stats{ itemPurchases{ time itemId } } } } }`;

// Дозапрос покупок для старых строк. Файл переписывается целиком после
// каждого прохода (через временный файл), прерывание ничего не теряет.
async function backfill(token) {
  const t0 = Date.now();
  let asked = 0;
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) {
    const file = path.join(DIR, f);
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const todo = rows.filter(m => m.p.some(p => !('b' in p)));
    let next = 0, changed = 0;
    const worker = async () => {
      while (next < todo.length) {
        if (asked >= MAX_REQ || (MAX_SEC && (Date.now() - t0) / 1000 > MAX_SEC)) return;
        const m = todo[next++];
        asked++;
        const got = await ask(token, m.id, QB);
        const pl = got && got.players || [];
        for (const p of m.p) {
          const g = pl.find(x => x.heroId === p.h && (x.isRadiant ? 1 : 0) === p.r);
          p.b = g ? buys(g) : null;
        }
        changed++;
        await sleep(PAUSE_MS);
      }
    };
    await Promise.all([worker(), worker()]);
    if (changed) {
      fs.writeFileSync(file + '.tmp', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      fs.renameSync(file + '.tmp', file);
    }
    const left = rows.filter(m => m.p.some(p => !('b' in p))).length;
    console.log(`${f}: дозапрошено ${changed}, осталось без покупок ${left}`);
  }
}

async function main() {
  if (process.argv.includes('--stats')) return stats();
  if (process.argv.includes('--backfill')) return backfill(readToken());
  const token = readToken();
  fs.mkdirSync(DIR, { recursive: true });
  const tried = new Set(fs.existsSync(TRIED) ? JSON.parse(fs.readFileSync(TRIED, 'utf8')) : []);
  const list = candidates(tried);
  console.log('Кандидатов за', WINDOW_DAYS, 'дн.:', list.length);
  const t0 = Date.now();
  let asked = 0, found = 0;
  const saveTried = () => fs.writeFileSync(TRIED, JSON.stringify([...tried]));
  // Два запроса параллельно: Stratz отвечает ~0,6 с, по одному выходит 1,5 запроса в секунду.
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      if (asked >= MAX_REQ) return;
      if (MAX_SEC && (Date.now() - t0) / 1000 > MAX_SEC) return;
      const m = list[next++];
      asked++;
      const got = await ask(token, m[0]);
      tried.add(m[0]);
      if (got && got.players && got.players.length === 10) {
        const day = new Date(got.startDateTime * 1000).toISOString().slice(0, 10);
        fs.appendFileSync(path.join(DIR, day + '.jsonl'), JSON.stringify(pack(got)) + '\n');
        found++;
      }
      if (asked % 50 === 0) { saveTried(); console.log(`спрошено ${asked}, найдено ${found}`); }
      await sleep(PAUSE_MS);
    }
  };
  try {
    await Promise.all([worker(), worker()]);
  } finally { saveTried(); }
  console.log(`Готово: спрошено ${asked}, найдено ${found}.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
