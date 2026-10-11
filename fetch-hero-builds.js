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
 *
 * --source steam --out-dir D: прокачка и таланты из ability_upgrades матчей Steam по позициям
 * модели U2 → D/builds/<heroId>.json (формат data/builds) и сверка D/builds-check.json (см. steamBuilds).
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
// С U5 (09.10.2026) билды Stratz — только хранилище предметов (время покупок) и эталон 4/5: data/builds-stratz/.
// Сайт читает data/builds/ — его собирает --source steam --site (прокачка и таланты Steam + предметы Stratz).
const OUT_DIR = path.join(ROOT, 'data', 'builds-stratz');
const SEQ_KEEP = 400;   // вариантов последовательности 1–10 на героя и позицию в памяти
const SEQ_MIN = 30;     // матчей у варианта, чтобы показать его как «популярный» или «лучший по винрейту»
const SITE_DIR = path.join(ROOT, 'data', 'builds');
// Первый запуск после U5: хранилища Stratz ещё нет — переносим в него прежние data/builds (там билды Stratz).
function ensureStratzStore() {
  if (fs.existsSync(OUT_DIR) || !fs.existsSync(SITE_DIR)) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(SITE_DIR)) if (f.endsWith('.json')) fs.copyFileSync(path.join(SITE_DIR, f), path.join(OUT_DIR, f));
}

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
  // Все попытки ушли на 429: раньше функция возвращала undefined и падало «reading 'constants'».
  throw new Error('Stratz ответил HTTP 429 на все ' + tries + ' попытки');
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

/**
 * Таланты по уровням 10/15/20/25: самый частый и лучший по винрейту.
 *
 * Stratz присылает только те таланты, которые брали хотя бы раз, поэтому на
 * 136 уровнях из 916 приходила одна сторона из двух, и дерево на странице
 * рисовалось наполовину пустым. Недостающую сторону добавляем сами с нулём
 * матчей: «ноль раз взяли» — это тоже факт о таланте, а дырка в дереве нет.
 *
 * Порядок сторон — игровой (слот в дереве талантов), а не по популярности:
 * так дерево на сайте совпадает с тем, что игрок видит в Dota, а золотая
 * подсветка перестаёт всегда оказываться слева.
 */
function buildTalents(rows, talentLevels) {
  const out = [];
  for (const lvl of [10, 15, 20, 25]) {
    const side = talentLevels[lvl] || [];
    if (side.length !== 2) continue;
    const byId = new Map(rows.filter(r => r.matchCount > 0).map(r => [r.abilityId, r]));
    const total = side.reduce((s, t) => s + (byId.get(t.abilityId)?.matchCount || 0), 0);
    // Даже без единого матча в выборке дерево показываем: у свежих героев
    // (Kez) статистики по талантам ещё нет, но сами таланты существуют, и
    // пустой раздел на странице хуже, чем дерево с пометкой «Решает игрок».

    const opts = side.map(t => {
      const r = byId.get(t.abilityId);
      const m = r ? r.matchCount : 0;
      return {
        abilityId: t.abilityId,
        title: t.title,
        matches: m,
        pick: Number((m / total * 100).toFixed(1)),
        // Винрейт без матчей неизвестен — это не ноль процентов побед
        winrate: m ? pct(r.winCount, m) : null
      };
    });

    const picked = opts.filter(o => o.matches > 0);
    const mostPicked = picked.slice().sort((a, b) => b.matches - a.matches)[0]?.abilityId ?? null;
    const eligible = picked.filter(o => o.matches >= MIN_MATCHES);
    const highestWin = (eligible.length ? eligible : picked).slice()
      .sort((a, b) => b.winrate - a.winrate)[0]?.abilityId ?? null;
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

/**
 * Прокачка и таланты по Steam (--source steam --out-dir D): ability_upgrades всех матчей data/steam-matches
 * (все ранги), позиции — разметка U2 (tools/match-positions.js): 1/2/3 и «саппорт» (4 и 5 вместе; матчи
 * Stratz с позициями 4/5 тоже идут в «саппорт»). Формат — как data/builds/<heroId>.json, ключи позиций
 * POSITION_1/2/3 и POSITION_SUP, те же пороги отбора позиций и функции buildProgression/buildTalents.
 * Времени покупок у Steam нет: items берутся из билда Stratz той же позиции (для саппорта — первой из 4/5
 * в его positionOrder), поле itemsFrom это помечает. Пишет D/builds/ и сверку D/builds-check.json.
 * В data/ не пишет: там билды Stratz, которые показывает сайт.
 */
async function steamBuilds() {
  const MS = require('./tools/match-source.js');
  const MP = require('./tools/match-positions.js');
  const OUT = MS.outDir();
  // --site: запись в data/builds/ для сайта в контракте POSITION_1…5; без него — только в каталог --out-dir (сверка)
  const SITE = process.argv.includes('--site');
  if (!SITE && path.resolve(OUT) === path.resolve(ROOT, 'data')) throw new Error('--source steam: нужен --out-dir (например data-steam) или --site');
  ensureStratzStore();
  const outBuilds = SITE ? SITE_DIR : path.join(OUT, 'builds');
  const heroPos = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hero-positions.json'), 'utf8')).heroes || {}; } catch { return {}; } })();
  const talentTree = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'talent-tree.json'), 'utf8')).heroes;
  const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
  const model = MP.loadModel(), stratz = MP.stratzIndex();
  const KEY = pos => pos === 1 || pos === 2 || pos === 3 ? 'POSITION_' + pos : 'POSITION_SUP';
  // agg[hero] = { n, pos: { KEY: { n, lvl: Map("ability:level" → [матчей, побед]), tal: Map(ability → [матчей, побед]) } } }
  const agg = new Map();
  let matches = 0, first = Infinity, last = 0;
  for await (const r of MS.steamStream()) {
    matches++; if (r[2] < first) first = r[2]; if (r[2] > last) last = r[2];
    const lab = MP.labelSteamRow(r, model, stratz);
    r.slice(9, 19).forEach((p, s) => {
      const won = (p[1] < 128) === (r[5] === 1);
      let a = agg.get(p[0]); if (!a) agg.set(p[0], a = { n: 0, pos: {} });
      a.n++;
      const k = KEY(lab.p[s].pos);
      const x = a.pos[k] || (a.pos[k] = { n: 0, lvl: new Map(), tal: new Map(), seq: new Map() });
      x.n++;
      const up = p[22] || [], firstLvl = new Map();
      // Точная последовательность уровней 1–10 (вместо снимка OpenDota data/skill-chains.json, 11.10.2026).
      if (SITE && up.length >= 20) {
        const key = [up[0], up[2], up[4], up[6], up[8], up[10], up[12], up[14], up[16], up[18]].join(',');
        const v = x.seq.get(key) || [0, 0]; v[0]++; if (won) v[1]++; x.seq.set(key, v);
        // память: держим не больше SEQ_KEEP×2 вариантов, редкие отбрасываем (на верх списка не влияют)
        if (x.seq.size > SEQ_KEEP * 2) x.seq = new Map([...x.seq].sort((a, b) => b[1][0] - a[1][0]).slice(0, SEQ_KEEP));
      }
      for (let i = 0; i < up.length; i += 2) if (!firstLvl.has(up[i])) firstLvl.set(up[i], i / 2 + 1);
      for (const [ab, lvl] of firstLvl) {
        const kk = ab + ':' + lvl, v = x.lvl.get(kk) || [0, 0]; v[0]++; if (won) v[1]++; x.lvl.set(kk, v);
        const t = x.tal.get(ab) || [0, 0]; t[0]++; if (won) t[1]++; x.tal.set(ab, t);
      }
    });
  }
  if (!matches) throw new Error('Нет матчей Steam: сначала node tools/collect-steam-matches.js');

  fs.mkdirSync(outBuilds, { recursive: true });
  const builtAt = new Date().toISOString();
  const cmp = { levels: 0, levelsSame: 0, talents: 0, talentsSame: 0, positions: 0, heroes: 0 };
  const byPos = {};
  const chains = {};   // data/skill-chains.json: heroes[id][POSITION_k] = { popular, highestWin, variantsCounted, sampleMatches }
  const chainOf = x => {
    const list = [...x.seq].map(([k, [n, w]]) => ({ seq: k.split(',').map(Number), matches: n, wins: w, winrate: Math.round(w / n * 1000) / 10 }))
      .sort((a, b) => b.matches - a.matches);
    if (!list.length || list[0].matches < SEQ_MIN) return null;
    const min = Math.max(SEQ_MIN, Math.ceil(list[0].matches * 0.1));
    const best = list.filter(v => v.matches >= min).sort((a, b) => b.winrate - a.winrate || b.matches - a.matches)[0];
    return { popular: list[0], highestWin: best, variantsCounted: list.length, sampleMatches: list.reduce((s, v) => s + v.matches, 0) };
  };
  let written = 0;
  for (const h of heroes) {
    const a = agg.get(h.id); if (!a) continue;
    const ent = Object.entries(a.pos).map(([id, x]) => ({ id, x, share: x.n / a.n * 100 })).sort((p, q) => q.x.n - p.x.n);
    let top = ent.slice(0, TOP_POSITIONS).filter(p => p.x.n >= MIN_POSITION_MATCHES && p.share >= MIN_POSITION_SHARE);
    if (!top.length && ent.length) top = [ent[0]];   // как у Stratz: ведущая позиция, чтобы билд был
    let st = null; try { st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, h.id + '.json'), 'utf8')); } catch { /* нет билда Stratz */ }
    const stratzKey = k => !st ? null : k === 'POSITION_SUP' ? st.positionOrder.find(q => q === 'POSITION_4' || q === 'POSITION_5') || null : (st.positions[k] ? k : null);
    const positions = {};
    let heroCmp = false;
    for (const p of top) {
      const lvlRows = [...p.x.lvl].map(([k, [m, w]]) => { const [ab, lv] = k.split(':').map(Number); return { abilityId: ab, level: lv, matchCount: m, winCount: w }; });
      const talRows = [...p.x.tal].map(([ab, [m, w]]) => ({ abilityId: ab, matchCount: m, winCount: w }));
      const sk = stratzKey(p.id), sp = sk ? st.positions[sk] : null;
      const rec = { matches: p.x.n, progression: buildProgression(lvlRows), talents: buildTalents(talRows, talentTree[h.id] || {}),
        items: sp ? sp.items : { core: [], situational: [] }, itemsFrom: sp ? 'stratz ' + sk : null };
      positions[p.id] = rec;
      byPos[p.id] = (byPos[p.id] || 0) + 1;
      // сверка со Stratz той же позиции (Stratz — Divine/Immortal, Steam — все ранги)
      if (sp) {
        heroCmp = true; cmp.positions++;
        sp.progression.popular.steps.forEach((x, i) => { const y = rec.progression.popular.steps[i]; if (x && y) { cmp.levels++; if (x.abilityId === y.abilityId) cmp.levelsSame++; } });
        for (const t of sp.talents) { const y = rec.talents.find(z => z.level === t.level); if (t.mostPicked && y && y.mostPicked) { cmp.talents++; if (t.mostPicked === y.mostPicked) cmp.talentsSame++; } }
      }
    }
    if (heroCmp) cmp.heroes++;
    let order = top.map(p => p.id), outPos = positions;
    if (SITE) {
      // Сайт ждёт POSITION_1…5. Модель различает только «саппорт» (4 и 5 вместе): его прокачка и таланты
      // идут в те ключи 4/5, что были у героя в билде Stratz; если их нет — в ключ с большим числом матчей
      // по ролям Stratz (data/hero-positions.json). Предметы — Stratz того же ключа (время покупок у Steam нет).
      const hp = (heroPos[String(h.id)] || {}).positions || {};
      const supKeys = (st ? st.positionOrder.filter(q => q === 'POSITION_4' || q === 'POSITION_5') : []);
      if (!supKeys.length) supKeys.push((hp.POSITION_4 || {}).matches > (hp.POSITION_5 || {}).matches ? 'POSITION_4' : 'POSITION_5');
      order = []; outPos = {};
      for (const id of top.map(p => p.id)) {
        for (const k of id === 'POSITION_SUP' ? supKeys : [id]) {
          const sp = st && st.positions[k] ? st.positions[k] : null;
          outPos[k] = Object.assign({}, positions[id], { items: sp ? sp.items : { core: [], situational: [] }, itemsFrom: sp ? 'stratz ' + k : null },
            id === 'POSITION_SUP' ? { supMerged: true } : {});
          const ch = a.pos[id] ? chainOf(a.pos[id]) : null;
          if (ch) (chains[h.id] = chains[h.id] || {})[k] = ch;
          order.push(k);
        }
      }
    }
    fs.writeFileSync(path.join(outBuilds, h.id + '.json'), JSON.stringify({
      heroId: h.id, heroName: h.localized_name, bracket: 'ALL', source: 'Steam Web API, ability_upgrades; позиции — модель U2',
      fetchedAt: builtAt, matches: a.n, positionOrder: order, positions: outPos
    }));
    written++;
  }
  const pc = (x, y) => y ? Math.round(x / y * 1000) / 10 : null;
  if (SITE) {
    // Пустой или почти пустой расчёт прежний файл не затирает: страница героя тогда показывает поуровневый срез.
    if (Object.keys(chains).length >= 100) MS.writeJsonAtomic(path.join(ROOT, 'data', 'skill-chains.json'), {
      source: 'Steam Web API, ability_upgrades (рейтинговые матчи всех рангов, текущий патч); позиции — модель U2, саппорт 4/5 общий',
      updatedAt: builtAt, minMatches: SEQ_MIN, heroes: chains });
    else console.warn('skill-chains.json не обновлён: последовательностей мало (' + Object.keys(chains).length + ' героев)');
  }
  const check = { builtAt, matches, firstMatchAt: new Date(first * 1000).toISOString(), lastMatchAt: new Date(last * 1000).toISOString(),
    heroes: written, positionsByKey: byPos, compare: Object.assign(cmp, { levelsPct: pc(cmp.levelsSame, cmp.levels), talentsPct: pc(cmp.talentsSame, cmp.talents) }) };
  fs.writeFileSync(path.join(OUT, 'builds-check.json'), JSON.stringify(check, null, 1));
  console.log(`Steam: ${matches} матчей, героев ${written}, позиций ${JSON.stringify(byPos)} → ${path.relative(ROOT, outBuilds)}/`);
  console.log(`Сверка со Stratz (та же позиция): уровни 1–10 ${cmp.levelsSame}/${cmp.levels} (${check.compare.levelsPct}%), таланты ${cmp.talentsSame}/${cmp.talents} (${check.compare.talentsPct}%)`);
}

async function main() {
  if (process.argv.includes('--source') && process.argv[process.argv.indexOf('--source') + 1] === 'steam') return steamBuilds();
  ensureStratzStore();
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

  // Дерево талантов берём из своего справочника (tools/build-talent-tree.js):
  // у Stratz список talents дырявый — у Phantom Lancer там 3 слота из 8,
  // и дерево на странице выходило наполовину пустым.
  const talentTree = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'talent-tree.json'), 'utf8')).heroes; }
    catch { throw new Error('нет data/talent-tree.json — сначала запусти tools/build-talent-tree.js'); }
  })();

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
        talents: buildTalents(s['tal' + i] || [], talentTree[h.id] || {}),
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
