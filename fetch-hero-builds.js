#!/usr/bin/env node
/**
 * Билды героев из Stratz: прокачка способностей, таланты и тайминги предметов
 * по трём самым популярным позициям каждого героя.
 *
 * Оговорка по методике (важно, чтобы подпись на сайте не врала):
 * Stratz не отдаёт готовую «самую популярную последовательность 1–10» как
 * единую цепочку — он отдаёт abilityMinLevel: сколько матчей та или иная
 * способность была ВПЕРВЫЕ взята на данном уровне. Поэтому «популярный
 * вариант» мы считаем как самый частый выбор НА КАЖДОМ уровне, а «вариант по
 * винрейту» — как лучший по проценту побед выбор на каждом уровне среди тех,
 * что набрали хотя бы MIN_MATCHES матчей. Это не наблюдённая цепочка целиком,
 * а поуровневый срез, и подписи на сайте сформулированы именно так.
 *
 * Запуск: node fetch-hero-builds.js
 * Результат: data/builds/<heroId>.json (по файлу на героя — воркер отдаёт
 * билд конкретного героя, а не весь массив на 2,5 МБ).
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://api.stratz.com/graphql';
const BRACKET = 'DIVINE_IMMORTAL';
const TOP_POSITIONS = 3;      // максимум позиций героя (решение пользователя)
// Пороги отсечения позиций-шума. Без них в выборку попадали блоки вроде
// «Drow Ranger на поз.4»: 16 матчей, 0,4% её игр — по таким числам Stratz не
// набирает даже 10 уровней прокачки, и страница показывала бы дыры вместо
// билда. На 300 матчах и 5% доли брак нулевой (проверено по всем 127 героям).
const MIN_POSITION_MATCHES = 300;
const MIN_POSITION_SHARE = 5;
const MIN_MATCHES = 30;       // порог, ниже которого винрейт — шум, а не сигнал
const MAX_LEVEL = 10;         // глубина прокачки, как на эталоне
const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'data', 'builds');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const raw = fs.readFileSync(path.join(ROOT, 'stratz.capi.txt'), 'utf8').trim();
  return (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
}

async function gql(token, query, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API' },
        body: JSON.stringify({ query })
      });
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
      return j.data;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

const pct = (w, m) => (m ? Number((w / m * 100).toFixed(1)) : null);

/** Поуровневая прокачка: что берут чаще всего и что даёт лучший винрейт */
function buildProgression(rows) {
  const popular = [], best = [];
  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    const at = rows.filter(r => r.level === lvl && r.matchCount > 0);
    if (!at.length) { popular.push(null); best.push(null); continue; }

    const top = at.slice().sort((a, b) => b.matchCount - a.matchCount)[0];
    popular.push({ abilityId: top.abilityId, matches: top.matchCount, winrate: pct(top.winCount, top.matchCount) });

    const eligible = at.filter(r => r.matchCount >= MIN_MATCHES);
    const bw = (eligible.length ? eligible : at).slice()
      .sort((a, b) => (b.winCount / b.matchCount) - (a.winCount / a.matchCount))[0];
    best.push({ abilityId: bw.abilityId, matches: bw.matchCount, winrate: pct(bw.winCount, bw.matchCount) });
  }
  const sum = arr => arr.filter(Boolean).reduce((s, x) => s + x.matches, 0);
  const avg = arr => { const a = arr.filter(Boolean); return a.length ? Number((a.reduce((s, x) => s + x.winrate, 0) / a.length).toFixed(1)) : null; };
  return {
    popular: { steps: popular, matches: sum(popular), winrate: avg(popular) },
    highestWin: { steps: best, matches: sum(best), winrate: avg(best) }
  };
}

/** Таланты по уровням 10/15/20/25: самый частый и лучший по винрейту */
function buildTalents(rows, talentLevels) {
  const out = [];
  for (const lvl of [10, 15, 20, 25]) {
    const ids = talentLevels[lvl] || [];
    const at = rows.filter(r => ids.includes(r.abilityId) && r.matchCount > 0);
    if (at.length < 1) continue;
    const total = at.reduce((s, r) => s + r.matchCount, 0);
    const opts = at.map(r => ({
      abilityId: r.abilityId,
      matches: r.matchCount,
      pick: total ? Number((r.matchCount / total * 100).toFixed(1)) : null,
      winrate: pct(r.winCount, r.matchCount)
    })).sort((a, b) => b.matches - a.matches);
    const mostPicked = opts[0]?.abilityId ?? null;
    const eligible = opts.filter(o => o.matches >= MIN_MATCHES);
    const highestWin = (eligible.length ? eligible : opts).slice().sort((a, b) => b.winrate - a.winrate)[0]?.abilityId ?? null;
    out.push({ level: lvl, options: opts, mostPicked, highestWin });
  }
  return out;
}

/**
 * Предметы. «Прогресс» — то, что покупают почти всегда (частота от 40%),
 * в порядке среднего времени покупки. «Ситуативные» — от 10 до 40%:
 * их берут по ситуации, и именно это делает блок полезным.
 */
function buildItems(rows, totalMatches) {
  const agg = new Map();
  for (const r of rows) {
    if (!r.itemId) continue;
    const cur = agg.get(r.itemId) || { itemId: r.itemId, matches: 0, wins: 0, timeSum: 0 };
    cur.matches += r.matchCount;
    cur.wins += r.winCount;
    cur.timeSum += (r.time || 0) * r.matchCount;
    agg.set(r.itemId, cur);
  }
  const all = [...agg.values()].map(x => ({
    itemId: x.itemId,
    matches: x.matches,
    winrate: pct(x.wins, x.matches),
    avgMinute: x.matches ? Math.round(x.timeSum / x.matches) : null,
    share: totalMatches ? Number((x.matches / totalMatches * 100).toFixed(1)) : null
  })).filter(x => x.avgMinute != null);

  const core = all.filter(x => x.share >= 40).sort((a, b) => a.avgMinute - b.avgMinute).slice(0, 8);
  const coreIds = new Set(core.map(x => x.itemId));
  const situational = all.filter(x => !coreIds.has(x.itemId) && x.share >= 10 && x.share < 40)
    .sort((a, b) => b.share - a.share).slice(0, 8);
  return { core, situational };
}

async function main() {
  const token = readToken();
  const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
  const positions = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hero-positions.json'), 'utf8')).heroes;

  // Справочник способностей и талантов: id -> внутреннее имя и название
  const consts = await gql(token, '{ constants { abilities { id name isTalent language { displayName } } } }');
  const abilityById = {};
  for (const a of consts.constants.abilities) {
    abilityById[a.id] = { name: a.name, title: a.language?.displayName || a.name, isTalent: !!a.isTalent };
  }
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'ability-index.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), abilities: abilityById }));

  // Какие таланты на каком уровне — берём из порядка талантов героя в Stratz
  const heroTalents = await gql(token, '{ constants { heroes { id talents { abilityId slot } } } }');
  const talentLevelsByHero = {};
  for (const h of heroTalents.constants.heroes) {
    const lv = { 10: [], 15: [], 20: [], 25: [] };
    for (const t of (h.talents || [])) {
      // slot 0..7: пары снизу вверх -> уровни 10,15,20,25
      const level = [10, 10, 15, 15, 20, 20, 25, 25][t.slot];
      if (level) lv[level].push(t.abilityId);
    }
    talentLevelsByHero[h.id] = lv;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let done = 0, skipped = [];

  // matchLimit:0 обязателен: по умолчанию Stratz отсекает предметы, не набравшие
  // внутреннего порога, и для непопулярных героев отдаёт ПУСТОЙ список вместо
  // данных (Chen поз.5: 0 строк против 848 с matchLimit:0).
  for (const h of heroes) {
    const entry = positions[String(h.id)];
    if (!entry) { skipped.push(h.localized_name + ' (нет позиций)'); continue; }

    let top = Object.entries(entry.positions)
      .sort((a, b) => b[1].matches - a[1].matches)
      .slice(0, TOP_POSITIONS)
      .filter(([, v]) => v.matches >= MIN_POSITION_MATCHES && (v.share || 0) >= MIN_POSITION_SHARE)
      .map(([id, v]) => ({ id, matches: v.matches }));
    // У совсем редких героев может не пройти ни одна позиция — тогда
    // оставляем ведущую, иначе у страницы вообще не будет билда.
    if (!top.length) {
      const best = Object.entries(entry.positions).sort((a, b) => b[1].matches - a[1].matches)[0];
      if (best) top = [{ id: best[0], matches: best[1].matches }];
    }

    const parts = top.map((p, i) => `
      lvl${i}: abilityMinLevel(heroId:${h.id}, positionIds:[${p.id}], bracketBasicIds:[${BRACKET}]) { abilityId level matchCount winCount }
      tal${i}: talent(heroId:${h.id}, positionIds:[${p.id}], bracketBasicIds:[${BRACKET}]) { abilityId matchCount winCount }
      itm${i}: itemFullPurchase(heroId:${h.id}, positionIds:[${p.id}], bracketBasicIds:[${BRACKET}], matchLimit:0) { itemId matchCount winCount time }
    `).join('\n');

    let data;
    try { data = await gql(token, `{ heroStats { ${parts} } }`); }
    catch (e) { skipped.push(h.localized_name + ' (' + e.message.slice(0, 60) + ')'); continue; }

    const s = data.heroStats;
    const byPosition = {};
    top.forEach((p, i) => {
      byPosition[p.id] = {
        matches: p.matches,
        progression: buildProgression(s['lvl' + i] || []),
        talents: buildTalents(s['tal' + i] || [], talentLevelsByHero[h.id] || {}),
        items: buildItems(s['itm' + i] || [], p.matches)
      };
    });

    fs.writeFileSync(path.join(OUT_DIR, h.id + '.json'), JSON.stringify({
      heroId: h.id,
      heroName: h.localized_name,
      bracket: BRACKET,
      fetchedAt: new Date().toISOString(),
      positionOrder: top.map(p => p.id),
      positions: byPosition
    }));

    done++;
    if (done % 25 === 0) console.log(`  ...${done}/${heroes.length}`);
    await sleep(200); // лимит Stratz — 8 запросов в секунду
  }

  console.log(`Готово: ${done} героев -> data/builds/`);
  if (skipped.length) console.log('Пропущено:', skipped.join('; '));
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
