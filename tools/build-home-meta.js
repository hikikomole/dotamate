#!/usr/bin/env node
/**
 * Три списка меты на первом экране главной (build-pages.js → {{HOME_META_LISTS}}) — свой расчёт вместо снимка
 * OpenDota heroStats (tools/fetch-home-meta.js, решение владельца 11.10.2026, план исправлений п. 3.2).
 *
 * Источник — data/stats.json (tools/build-stats.js, своя база рейтинговых матчей Steam, все ранги, текущий патч),
 * поэтому главная показывает те же цифры, что тир-лист /stats/:
 *   carry  — лучший винрейт среди героев с ≥ MIN_MATCHES матчей;
 *   picked — больше всего матчей;
 *   banned — больше всего банов в этих же матчах (поле bn) и сколько раз героя взяли.
 * Формат data/home-meta.json прежний (читает build-pages.js homeMeta). Запуск: node tools/build-home-meta.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const MS = require('./match-source.js');

const ROOT = path.join(__dirname, '..');
const MIN_MATCHES = 2000;
const TOP = 6;

const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'stats.json'), 'utf8'));
const heroes = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heroes.json'), 'utf8')).heroes.map(h => [Number(h.id), h]));
const slugs = {};
try {
  for (const u of require(path.join(ROOT, 'hero-urls.json'))) { const m = String(u.loc || '').match(/\/hero\/([^/]+)\//); if (m && u.name) slugs[u.name] = m[1]; }
} catch (e) { console.warn('hero-urls.json не прочитан, слаги — из внутренних имён:', e.message); }

function pick(r, extra) {
  const h = heroes.get(Number(r.id));
  if (!h) return null;
  const slug = slugs[h.localized_name] || String(h.name || '').replace(/^npc_dota_hero_/, '');
  return Object.assign({ id: h.id, name: h.localized_name, slug, img: `/assets/heroes/${slug}.webp` }, extra);
}
const rows = (S.heroes || []).filter(r => r.n > 0 && heroes.has(Number(r.id)));
if (!rows.length) throw new Error('stats.json без героев — прежний home-meta.json оставлен');
if (!rows.some(r => typeof r.bn === 'number')) throw new Error('в stats.json нет банов (bn) — сначала build-stats.js --source steam');

const carry = rows.filter(r => r.n >= MIN_MATCHES).sort((a, b) => b.wr - a.wr).slice(0, TOP).map(r => pick(r, { wr: r.wr, matches: r.n })).filter(Boolean);
const picked = [...rows].sort((a, b) => b.n - a.n).slice(0, TOP).map(r => pick(r, { matches: r.n, wr: r.wr })).filter(Boolean);
const banned = rows.filter(r => r.bn > 0).sort((a, b) => b.bn - a.bn).slice(0, TOP).map(r => pick(r, { bans: r.bn, picks: r.n })).filter(Boolean);

const out = {
  source: 'Steam — своя база рейтинговых матчей (data/stats.json), все ранги, текущий патч',
  stampLabel: 'Steam, все ранги',
  bracket: 'ALL',
  fetchedAt: S.builtAt,
  patch: S.base && S.base.patch,
  minMatches: MIN_MATCHES,
  heroCount: rows.length,
  matchesApprox: S.base ? S.base.matches : 0,
  carry, picked, banned
};
MS.writeJsonAtomic(path.join(ROOT, 'data', 'home-meta.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`home-meta.json: ${carry.length}+${picked.length}+${banned.length} строк, матчей ${out.matchesApprox}, патч ${out.patch}`);
const miss = [...carry, ...picked, ...banned].filter(r => !fs.existsSync(path.join(ROOT, r.img.replace(/^\//, ''))));
if (miss.length) console.warn('Нет картинок для:', miss.map(r => r.slug).join(', '));
