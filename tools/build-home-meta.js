#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./match-source');
const { assertProvenance } = require('./stats-cohort');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const fixture = args.includes('--fixture');
if (fixture && !arg('--input-dir')) throw new Error('--fixture requires --input-dir');
const input = path.resolve(arg('--input-dir') || path.join(ROOT, 'data'));
const output = path.resolve(arg('--out-dir') || input);
const read = name => JSON.parse(fs.readFileSync(path.join(input, name), 'utf8'));
const stats = read('stats.json');
const patch = read('patch-notes.json');
const cohort = assertProvenance(stats.rankedSummary, patch.version);
if (cohort.patchFrom !== Number(patch.timestamp) || !Number.isInteger(cohort.matches) || cohort.matches < 0 ||
    !Number.isInteger(cohort.radiantWins) || cohort.radiantWins < 0 || cohort.radiantWins > cohort.matches ||
    !Number.isInteger(cohort.banRecorded) || cohort.banRecorded < 0 || cohort.banRecorded > cohort.matches ||
    !Array.isArray(cohort.heroes)) throw new Error('Invalid ranked summary');

const heroes = new Map(read('heroes.json').heroes.map(h => [Number(h.id), h]));
const slugs = {};
if (!fixture) try {
  for (const u of JSON.parse(fs.readFileSync(path.join(ROOT, 'hero-urls.json'), 'utf8'))) {
    const m = String(u.loc || '').match(/\/hero\/([^/]+)\//);
    if (m && u.name) slugs[u.name] = m[1];
  }
} catch { /* fallback to internal names */ }
const rows = cohort.heroes.filter(r => heroes.has(Number(r.id)) && Number.isInteger(r.picks) && r.picks >= 0 &&
  Number.isInteger(r.wins) && r.wins >= 0 && r.wins <= r.picks && Number.isInteger(r.bans) && r.bans >= 0)
  .map(r => ({ id: r.id, n: r.picks, wr: r.picks ? Math.round(1000 * r.wins / r.picks) / 10 : null, bn: r.bans }));
if (cohort.matches && rows.reduce((n, r) => n + r.n, 0) !== cohort.matches * 10) throw new Error('Hero appearances do not match ranked matches');
const pick = (r, extra) => {
  const h = heroes.get(Number(r.id));
  const slug = slugs[h.localized_name] || String(h.name || '').replace(/^npc_dota_hero_/, '');
  return { id: Number(r.id), name: h.localized_name, slug, img: '/assets/heroes/' + slug + '.webp', ...extra };
};
const TOP = 6, MIN_MATCHES = 2000;
const carry = rows.filter(r => r.n >= MIN_MATCHES).sort((a, b) => b.wr - a.wr || b.n - a.n || a.id - b.id)
  .slice(0, TOP).map(r => pick(r, { wr: r.wr, matches: r.n }));
const picked = rows.filter(r => r.n > 0).sort((a, b) => b.n - a.n || a.id - b.id).slice(0, TOP)
  .map(r => pick(r, { matches: r.n, wr: r.wr }));
const banKnown = cohort.matches > 0 && cohort.banRecorded === cohort.matches;
const banned = banKnown ? rows.filter(r => r.bn > 0).sort((a, b) => b.bn - a.bn || a.id - b.id)
  .slice(0, TOP).map(r => pick(r, { bans: r.bn, picks: r.n })) : [];
const contested = banKnown ? [...rows].map(r => ({ id: r.id, picks: r.n, bans: r.bn, total: r.n + r.bn }))
  .sort((a, b) => b.total - a.total || a.id - b.id)[0] || null : null;
const now = new Date(), patchFrom = Number(patch.timestamp);
const ageOk = patchFrom <= now.getTime() / 1000;
const summary = { patch: patch.version, releasedAt: ageOk ? new Date(patchFrom * 1000).toISOString() : null,
  asOf: now.toISOString(), patchDays: ageOk ? Math.floor((now.getTime() / 1000 - patchFrom) / 86400) : null,
  matches: cohort.matches, from: cohort.from, to: cohort.to, radiantWins: cohort.radiantWins,
  radiantWr: cohort.matches ? Math.round(10000 * cohort.radiantWins / cohort.matches) / 100 : null,
  banCoverage: { recorded: cohort.banRecorded, matches: cohort.matches, known: banKnown }, contested };
const out = {
  schemaVersion: 1, builtAt: now.toISOString(), status: cohort.matches ? 'ok' : 'insufficient',
  meta: { source: 'steam', cohort: 'ranked-all-ranks', patch: patch.version, patchFrom, from: cohort.from,
    to: cohort.to, matches: cohort.matches, players: cohort.matches * 10, methodVersion: 1,
    exclusions: cohort.exclusions || {}, coverage: { seen: cohort.seen, banRecorded: cohort.banRecorded, banPresenceKnown: banKnown } },
  summary,
  source: 'Steam Web API, Ranked All Pick, все ранги', stampLabel: 'Steam, все ранги',
  bracket: 'ALL', fetchedAt: cohort.to || stats.builtAt, patch: patch.version,
  minMatches: MIN_MATCHES, heroCount: rows.length, matchesApprox: cohort.matches,
  carry, picked, banned
};
fs.mkdirSync(output, { recursive: true });
writeJsonAtomic(path.join(output, 'home-meta.json'), JSON.stringify(out, null, 2) + '\n');
console.log('home-meta.json: ' + out.status + ', ' + cohort.matches + ' matches');
