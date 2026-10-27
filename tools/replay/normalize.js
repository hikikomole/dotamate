#!/usr/bin/env node
// Нормализатор: вывод odota/parser (JSON lines) -> компактный файл матча для архива и эфира /live.
// Использование: node tools/replay/normalize.js <parsed.jsonl> <out.json>
// Имена игроков и SteamID из epilogue НЕ сохраняются: в файл попадают только герои, команды и игровые события.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { slugForHero } = require('../hero-common');

const SCHEMA = 3;
const ECON_STEP = 10; // золото/опыт/LH/уровень — срез раз в 10 с
let gaps = 0, foreign = 0, qaPurch = 0;
const r1 = v => Math.round(v * 10) / 10;

const heroesFile = path.join(__dirname, '..', '..', 'data', 'heroes.json');
const HEROES = new Map(JSON.parse(fs.readFileSync(heroesFile, 'utf8')).heroes.map(h => [h.id, h]));
const HERO_BY_NAME = new Map([...HEROES.values()].map(h => [h.name, h]));

// Инвентарь по покупкам. Combat log пишет «покупку» и для собранного предмета (item_basher
// приходит вместе с item_recipe_basher), поэтому при такой записи убираем из сумки его компоненты
// и рецепт по data/items-ru.json (поле comp). Продажу, выброс и расход предметов парсер не отдаёт —
// это приближение «по покупкам», так и подписано на странице.
const ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'items-ru.json'), 'utf8')).items;
function inventory(list) {
  const bag = [], snaps = [];
  for (const [t, key] of list) {
    const it = ITEMS[key];
    if (!it || it.cat === 'consumable') continue;
    if (it.cat !== 'recipe' && it.comp && it.comp.length) {
      for (const c of it.comp.concat(['recipe_' + key])) { const i = bag.indexOf(c); if (i >= 0) bag.splice(i, 1); }
    }
    bag.push(key);
    const shown = bag.filter(k => ITEMS[k] && ITEMS[k].cat !== 'recipe').sort((a, b) => ITEMS[b].cost - ITEMS[a].cost).slice(0, 9);
    const last = snaps[snaps.length - 1];
    if (!last || last[1].join() !== shown.join()) snaps.push([t, shown]);
  }
  return snaps;
}

async function normalize(input) {
  gaps = 0; foreign = 0;
  const iv = new Map();            // slot -> Map(time -> interval)
  const kills = [], buildings = [], wards = new Map(), purchases = [], roshan = [], runes = [], chat = [], chatwheel = [];
  let epilogue = null, maxTime = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (line[0] !== '{') { foreign++; continue; } // предупреждения JVM в stdout — не данные
    let e; try { e = JSON.parse(line); } catch { throw new Error('битая строка JSON в выводе парсера'); }
    switch (e.type) {
      case 'interval':
        if (e.x == null || e.hero_id == null) break;
        if (!iv.has(e.slot)) iv.set(e.slot, new Map());
        iv.get(e.slot).set(e.time, e);
        if (e.time > maxTime) maxTime = e.time;
        break;
      case 'CHAT_MESSAGE_HERO_KILL': kills.push({ t: e.time, victim: e.player1, killer: e.player2, gold: e.value }); break;
      case 'DOTA_COMBATLOG_TEAM_BUILDING_KILL':
        if (/_(tower|rax|fort)/.test(e.targetname)) buildings.push({ t: e.time, name: e.targetname.replace(/^npc_dota_/, '') });
        break;
      case 'DOTA_COMBATLOG_DEATH': if (e.targetname === 'npc_dota_roshan') roshan.push({ t: e.time }); break;
      case 'CHAT_MESSAGE_RUNE_PICKUP': if (e.player1 >= 0) runes.push({ t: e.time, slot: e.player1, rune: e.value }); break;
      case 'obs': case 'sen':
        wards.set(e.ehandle, { t: e.time, slot: e.slot, kind: e.type, x: r1(e.x), y: r1(e.y), end: null });
        break;
      case 'obs_left': case 'sen_left': { const w = wards.get(e.ehandle); if (w) w.end = e.time; break; }
      case 'DOTA_COMBATLOG_PURCHASE':
        // слот у покупки есть не всегда (в выводе парсера — только у первых покупок); иначе определяем по герою
        if (e.valuename) purchases.push({ t: e.time, slot: e.slot != null ? e.slot : null, hero: e.targetname || '', item: e.valuename.replace(/^item_/, '') });
        break;
      // Чат игроков: только время, слот и текст — без ника и SteamID (для будущей статистики «самые частые слова»).
      case 'chat': if (typeof e.key === 'string' && e.slot >= 0 && e.slot <= 9) chat.push([e.time, e.slot, e.key.slice(0, 200)]); break;
      case 'chatwheel': if (e.slot >= 0 && e.slot <= 9) chatwheel.push([e.time, e.slot, Number(e.key)]); break;
      case 'epilogue': epilogue = JSON.parse(e.key); break;
    }
  }
  if (!epilogue) throw new Error('в выводе парсера нет epilogue (реплей оборван?)');
  if (iv.size !== 10) throw new Error('ожидалось 10 героев с координатами, найдено ' + iv.size);
  const dota = epilogue.gameInfo_.dota_;

  // Общая шкала времени: с первой секунды, когда у всех 10 героев есть координаты, до конца.
  const t0 = Math.max(...[...iv.values()].map(m => Math.min(...m.keys())));
  // имя героя в combat log пишется без подчёркиваний (npc_dota_hero_abyssalunderlord) — сравниваем без них
  const flat = n => String(n).replace(/^npc_dota_hero_/, '').replace(/_/g, '');
  const slotByHero = new Map();
  for (const [slot, m] of iv) { const any = m.values().next().value; const h = HEROES.get(any.hero_id); if (h) slotByHero.set(flat(h.name), slot); }
  for (const p of purchases) if (p.slot == null) { const s = slotByHero.get(flat(p.hero)); p.slot = s == null ? -1 : s; }
  qaPurch = purchases.filter(p => p.slot < 0).length;
  const t1 = maxTime;
  // Only a finished parser stream with every purchase assigned to a player can certify the log.
  const purchaseLogComplete = qaPurch === 0 && Number.isFinite(t1) && t1 >= 900 &&
    purchases.every(p => Number.isFinite(p.t) && p.t <= t1 && p.slot >= 0 && p.slot < 10 && ITEMS[p.item]);
  const players = [];
  for (let slot = 0; slot < 10; slot++) {
    const m = iv.get(slot);
    if (!m) throw new Error('нет данных по слоту ' + slot);
    const last = m.get(t1) || [...m.values()].pop();
    const hero = HEROES.get(last.hero_id);
    if (!hero) throw new Error('неизвестный hero_id ' + last.hero_id + ' — обновить data/heroes.json');
    const x = [], y = [], dead = [];
    let prev = null, deadFrom = null;
    for (let t = t0; t <= t1; t++) {
      const s = m.get(t) || prev; // пропуск секунды у парсера — держим прошлую точку (отмечено в qa.gaps)
      if (!m.get(t)) gaps++;
      x.push(r1(s.x)); y.push(r1(s.y));
      const isDead = s.life_state !== 0;
      if (isDead && deadFrom === null) deadFrom = t;
      if (!isDead && deadFrom !== null) { dead.push([deadFrom, t]); deadFrom = null; }
      prev = s;
    }
    if (deadFrom !== null) dead.push([deadFrom, t1]);
    const econ = { gold: [], xp: [], nw: [], lh: [], dn: [], lvl: [] };
    for (let t = Math.ceil(Math.max(t0, 0) / ECON_STEP) * ECON_STEP; t <= t1; t += ECON_STEP) {
      const s = m.get(t); if (!s) { for (const k in econ) econ[k].push(null); continue; }
      econ.gold.push(s.gold); econ.xp.push(s.xp); econ.nw.push(s.networth); econ.lh.push(s.lh); econ.dn.push(s.denies); econ.lvl.push(s.level);
    }
    players.push({
      slot, team: slot < 5 ? 'radiant' : 'dire', heroId: hero.id, hero: hero.localized_name, slug: slugForHero(hero),
      k: last.kills, d: last.deaths, a: last.assists, lh: last.lh, dn: last.denies, nw: last.networth, lvl: last.level,
      obs: last.obs_placed, sen: last.sen_placed, stacks: last.camps_stacked,
      x, y, dead, econ,
      items: purchases.filter(p => p.slot === slot).map(p => [p.t, p.item]),
      purchaseLogComplete,
      inv: inventory(purchases.filter(p => p.slot === slot).map(p => [p.t, p.item])),
    });
  }
  // Проверка привязки: герой из epilogue по слоту должен совпасть с героем из interval.
  dota.playerInfo_.forEach((p, slot) => {
    const name = Buffer.from(p.heroName_.bytes.map(b => b & 255)).toString('utf8');
    const h = HERO_BY_NAME.get(name);
    if (h && players[slot].heroId !== h.id) throw new Error('слот ' + slot + ': interval=' + players[slot].hero + ', epilogue=' + name);
  });

  const teamOf = slot => slot < 5 ? 'radiant' : 'dire';
  const deaths = kills.map(k => {
    const v = iv.get(k.victim)?.get(k.t);
    return { t: k.t, victim: k.victim, killer: k.killer, gold: k.gold, x: v ? r1(v.x) : null, y: v ? r1(v.y) : null };
  });
  // Счёт как у Valve/OpenDota: смерть героя засчитывается команде противника, в т.ч. от крипов/башен.
  // Не засчитываются смерти без убийцы и без награды (отказ/самоубийство). Сверено с OpenDota на 3 матчах.
  const score = { radiant: 0, dire: 0 };
  for (const d of deaths) if (!(d.killer < 0 && !d.gold)) score[d.victim < 5 ? 'dire' : 'radiant']++;
  const adv = { t: [], gold: [], xp: [] };
  for (let t = Math.ceil(Math.max(t0, 0) / 60) * 60; t <= t1; t += 60) {
    let g = 0, xp = 0, ok = true;
    for (let s = 0; s < 10; s++) { const v = iv.get(s).get(t); if (!v) { ok = false; break; } const sign = s < 5 ? 1 : -1; g += sign * v.networth; xp += sign * v.xp; }
    if (ok) { adv.t.push(t); adv.gold.push(g); adv.xp.push(xp); }
  }
  return {
    schema: SCHEMA, source: 'odota/parser (Clarity)',
    matchId: String(dota.matchId_), endTime: dota.endTime_, gameMode: dota.gameMode_,
    radiantWin: dota.gameWinner_ === 2, duration: t1, score,
    coords: 'cell', t0, t1, econStep: ECON_STEP, econFrom: Math.ceil(Math.max(t0, 0) / ECON_STEP) * ECON_STEP,
    players, deaths,
    killerTeamCheck: deaths.every(d => d.killer < 0 || d.killer > 9 || teamOf(d.killer) !== teamOf(d.victim)),
    wards: [...wards.values()].sort((a, b) => a.t - b.t),
    buildings, roshan, runes, adv, chat, chatwheel,
    qa: { gaps, foreign, unmatchedPurchases: qaPurch },
  };
}

if (require.main === module) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) { console.error('Использование: node tools/replay/normalize.js <parsed.jsonl> <out.json>'); process.exit(2); }
  normalize(input).then(m => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out + '.part', JSON.stringify(m));
    fs.renameSync(out + '.part', out);
    console.log(`${m.matchId}: ${m.duration} с, счёт ${m.score.radiant}:${m.score.dire}, победа ${m.radiantWin ? 'Radiant' : 'Dire'}, смертей ${m.deaths.length}, вардов ${m.wards.length}, пропусков секунд ${m.qa.gaps}, ${fs.statSync(out).size} байт`);
  }).catch(e => { console.error('Нормализация не удалась:', e.message); process.exitCode = 1; });
}

// Крипы из вывода tools/replay-parser/MapProbe.java (строки {"k":"cr","t":…,"p":[[team,x,y],…]}, раз в секунду).
// Берём кадр раз в CREEP_STEP с, каждый живой крип линии/осадный отдельно. Кадр: плоский массив
// [сторона (0 Radiant, 1 Dire), x, y, …], координаты — целые клетки (1 клетка ≈ 3,5 px на миникарте 512 px).
// Шаг 1 с — решение владельца 02.10.2026 (раньше 2 с: +936 КБ JSON, +211 КБ gzip на 64-мин. матче 9024842732).
// Матчи архива, собранные до этого, остаются с шагом 2 с — js/live.js читает шаг из поля step.
const CREEP_STEP = 1;
async function creepFrames(input) {
  const frames = []; let from = null;
  const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{"k":"cr"')) continue;
    const e = JSON.parse(line);
    if (e.t % CREEP_STEP) continue;
    if (from === null) from = e.t;
    const idx = (e.t - from) / CREEP_STEP;
    if (!Number.isInteger(idx) || idx < frames.length) continue;
    while (frames.length < idx) frames.push([]); // пропуск секунды в выводе — пустой кадр, без выдумывания
    const f = [];
    for (const [team, x, y] of e.p) if (team === 2 || team === 3) f.push(team - 2, Math.round(x), Math.round(y));
    frames.push(f);
  }
  return frames.length ? { step: CREEP_STEP, from, f: frames } : null;
}

module.exports = { normalize, creepFrames };
