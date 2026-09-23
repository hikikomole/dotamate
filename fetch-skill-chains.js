#!/usr/bin/env node
/**
 * Точные последовательности прокачки 1-10 из OpenDota.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ЧИСЕЛ НА СТРАНИЦЕ — читать обязательно:
 * все остальные проценты героя берутся из Stratz по матчам ранга
 * Divine/Immortal. Здесь выборка другая: OpenDota — это публичные матчи ВСЕХ
 * рангов, и отфильтровать их по рангу нельзя (в таблице с прокачкой ранга
 * просто нет). Поэтому цепочка и её винрейт подписаны на сайте отдельно и
 * честно, а не подмешаны к числам Stratz.
 *
 * Позиции 1-5 у OpenDota тоже нет — есть линия (lane_role). Кор и поддержку
 * на одной линии различаем по вардам и добиванию крипов; на чистых керри
 * вроде Anti-Mage одни варды давали ложные срабатывания (162 «поддержки»
 * с 388 добиваниями), поэтому добавлен порог по last_hits.
 *
 * Запуск: node fetch-skill-chains.js          (продолжает с места остановки)
 *         node fetch-skill-chains.js --reset  (начать заново)
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.opendota.com/api/explorer';
const ROOT = __dirname;
const OUT = path.join(ROOT, 'data', 'skill-chains.json');
const MIN_SAMPLE = 30;     // ниже этого числа матчей винрейт — шум
const TOP_VARIANTS = 12;   // сколько вариантов тянуть, чтобы было из чего выбирать
const PAUSE_MS = 1300;     // бесплатный лимит OpenDota — 60 запросов в минуту

// Позиция -> условие по данным OpenDota.
// Поддержка = ставит варды И мало добивает: одних вардов мало, керри их тоже ставят.
const SUPPORT = "(coalesce(pm.obs_placed,0)+coalesce(pm.sen_placed,0)>=3 and coalesce(pm.last_hits,0)<150)";
const POSITION_SQL = {
  POSITION_1: `pm.lane_role=1 and not ${SUPPORT}`,
  POSITION_2: `pm.lane_role=2`,
  POSITION_3: `pm.lane_role=3 and not ${SUPPORT}`,
  POSITION_4: `pm.lane_role=3 and ${SUPPORT}`,
  POSITION_5: `pm.lane_role=1 and ${SUPPORT}`
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function query(sql, tries = 4) {
  const url = API + '?sql=' + encodeURIComponent(sql);
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    // 429 — упёрлись в минутный лимит: ждём и повторяем, а не теряем связку
    if (res.status === 429) { await sleep(4000 * (i + 1)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.err) throw new Error(String(j.err).slice(0, 160));
    return j.rows || [];
  }
  throw new Error('лимит запросов не отпустил');
}

function pickChains(rows) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  const norm = rows.map(r => ({
    seq: r.seq.map(Number),
    matches: Number(r.n),
    wins: Number(r.w),
    winrate: Number((Number(r.w) / Number(r.n) * 100).toFixed(1))
  }));
  const popular = norm[0];
  const eligible = norm.filter(x => x.matches >= MIN_SAMPLE);
  const highestWin = (eligible.length ? eligible : norm).slice()
    .sort((a, b) => b.winrate - a.winrate)[0];
  return { popular, highestWin, variantsCounted: rows.length, sampleMatches: total };
}

async function main() {
  const reset = process.argv.includes('--reset');
  const store = (!reset && fs.existsSync(OUT))
    ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
    : { source: 'OpenDota explorer (публичные матчи всех рангов)', startedAt: new Date().toISOString(), heroes: {} };

  const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes;
  const jobs = [];
  for (const h of heroes) {
    let build;
    try { build = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'builds', h.id + '.json'), 'utf8')); }
    catch { continue; }
    for (const pos of build.positionOrder) {
      if (store.heroes[h.id] && store.heroes[h.id][pos] !== undefined) continue; // уже сделано
      jobs.push({ id: h.id, name: h.localized_name, pos });
    }
  }
  if (!jobs.length) { console.log('Всё уже выгружено:', Object.keys(store.heroes).length, 'героев'); return; }
  console.log('Осталось связок:', jobs.length);

  const deadline = Date.now() + 150000; // укладываемся в лимит одного запуска
  let done = 0, failed = 0;

  for (const job of jobs) {
    if (Date.now() > deadline) { console.log('Пауза по времени, запусти скрипт ещё раз.'); break; }
    const where = POSITION_SQL[job.pos];
    const sql = `select (pm.ability_upgrades_arr)[1:10] as seq, count(*) as n, `
      + `sum(case when (pm.player_slot<128)=m.radiant_win then 1 else 0 end) as w `
      + `from player_matches pm join matches m using(match_id) `
      + `where pm.hero_id=${job.id} and ${where} and pm.ability_upgrades_arr is not null `
      + `and array_length(pm.ability_upgrades_arr,1)>=10 group by 1 order by n desc limit ${TOP_VARIANTS}`;
    try {
      const rows = await query(sql);
      store.heroes[job.id] = store.heroes[job.id] || {};
      store.heroes[job.id][job.pos] = pickChains(rows); // null, если данных нет
      done++;
    } catch (e) {
      failed++;
      console.log('  сбой:', job.name, job.pos, '-', e.message);
    }
    if (done % 20 === 0 && done) {
      store.updatedAt = new Date().toISOString();
      fs.writeFileSync(OUT, JSON.stringify(store));
      console.log(`  ...${done} готово`);
    }
    await sleep(PAUSE_MS);
  }

  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(store));
  const left = jobs.length - done;
  console.log(`Выгружено за запуск: ${done}, сбоев: ${failed}, осталось: ${left}`);
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
