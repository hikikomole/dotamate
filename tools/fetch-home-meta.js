#!/usr/bin/env node
// Снимок меты для первого экрана главной: три коротких списка, которые
// подставляются в разметку на сборке (build-pages.js), а не догружаются
// браузером. Так ссылки на героев видит поисковый робот, а первый экран
// рисуется мгновенно и не прыгает.
//
// Почему снимок, а не живой запрос со страницы: /api/dota/hero-stats сейчас
// отдаёт запасной локальный снимок (у воркера не проходит запрос в OpenDota),
// и в нём нет разбивки по бракетам. Здесь мы ходим в OpenDota с машины —
// ровно тем же приёмом, что fetch-draft-matrix.js и fetch-hero-positions.js.
//
// Запуск: node tools/fetch-home-meta.js   →  data/home-meta.json

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'home-meta.json');
const API = 'https://api.opendota.com/api/heroStats';

// Бракеты OpenDota: 7 — Divine, 8 — Immortal. Берём оба: это тот же срез,
// по которому собраны матрица пар и позиции героев, иначе цифры на сайте
// считались бы по разным выборкам.
const BRACKETS = ['7', '8'];
// Порог выборки для списка винрейта. Без него наверх всплывают герои с
// сотней матчей и случайными 60%.
const MIN_MATCHES = 2000;
const TOP = 6;

function slugMap() {
  try {
    const urls = require(path.join(ROOT, 'hero-urls.json'));
    const map = {};
    for (const u of urls) {
      const m = String(u.loc || '').match(/\/hero\/([^/]+)\//);
      if (m && u.name) map[u.name] = m[1];
    }
    return map;
  } catch (e) {
    console.warn('hero-urls.json не прочитан, слаги возьмём из внутренних имён:', e.message);
    return {};
  }
}

function pick(h, slugs, extra) {
  const slug = slugs[h.localized_name] || String(h.name || '').replace(/^npc_dota_hero_/, '');
  return Object.assign({
    id: h.id,
    name: h.localized_name,
    slug,
    img: `/assets/heroes/${slug}.png`,
  }, extra);
}

// Номер актуального патча берём из официального списка Valve — тот же
// источник, по которому разбирались гайды. Руками такую строку вписывать
// нельзя: она молча протухнет на следующем патче.
async function currentPatch() {
  try {
    const r = await fetch('https://www.dota2.com/datafeed/patchnoteslist?language=english');
    if (!r.ok) throw new Error('datafeed ' + r.status);
    const d = await r.json();
    const list = d.patches || d;
    if (!Array.isArray(list) || !list.length) throw new Error('пустой список патчей');
    const last = list[list.length - 1];
    return String(last.patch_name || last.patch_number || '').trim() || null;
  } catch (e) {
    console.warn('Номер патча не получен:', e.message);
    return null;
  }
}

async function main() {
  const res = await fetch(API, { headers: { 'user-agent': 'dotamate/1.0 (+https://dotamate.ru)' } });
  if (!res.ok) throw new Error(`OpenDota ответила ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) throw new Error('OpenDota вернула пустой список героев');

  const patch = await currentPatch();
  const slugs = slugMap();
  const rows = list.map(h => {
    let picks = 0, wins = 0;
    for (const b of BRACKETS) { picks += Number(h[`${b}_pick`] || 0); wins += Number(h[`${b}_win`] || 0); }
    return { h, picks, wins, wr: picks ? wins / picks * 100 : 0 };
  });

  const totalPicks = rows.reduce((s, r) => s + r.picks, 0);

  const carry = rows.filter(r => r.picks >= MIN_MATCHES)
    .sort((a, b) => b.wr - a.wr).slice(0, TOP)
    .map(r => pick(r.h, slugs, { wr: Number(r.wr.toFixed(1)), matches: r.picks }));

  const picked = [...rows].sort((a, b) => b.picks - a.picks).slice(0, TOP)
    .map(r => pick(r.h, slugs, { matches: r.picks, wr: Number(r.wr.toFixed(1)) }));

  const banned = [...list].filter(h => Number(h.pro_ban || 0) > 0)
    .sort((a, b) => Number(b.pro_ban || 0) - Number(a.pro_ban || 0)).slice(0, TOP)
    .map(h => pick(h, slugs, { bans: Number(h.pro_ban || 0), picks: Number(h.pro_pick || 0) }));

  const out = {
    source: 'OpenDota heroStats',
    bracket: 'DIVINE_IMMORTAL',
    fetchedAt: new Date().toISOString(),
    patch,
    minMatches: MIN_MATCHES,
    heroCount: list.length,
    // Суммарные пики делим на десять: в каждом матче десять героев. Это
    // оценка числа матчей в срезе, а не точный счётчик Valve.
    matchesApprox: Math.round(totalPicks / 10),
    carry, picked, banned,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`патч ${patch || "не определён"} · data/home-meta.json: ${carry.length}+${picked.length}+${banned.length} строк, ≈${out.matchesApprox.toLocaleString('ru-RU')} матчей`);
  const miss = [...carry, ...picked, ...banned].filter(r => !fs.existsSync(path.join(ROOT, r.img.replace(/^\//, ''))));
  if (miss.length) console.warn('Нет картинок для:', miss.map(r => r.slug).join(', '));
}

main().catch(e => { console.error('Не собралось:', e.message); process.exit(1); });
