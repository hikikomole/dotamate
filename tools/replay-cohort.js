'use strict';
const fs = require('fs');
const path = require('path');
const { label } = require('./archive-positions');

function startTime(m) {
  return Number.isFinite(m.startTime) ? m.startTime : Number.isFinite(m.endTime) && Number.isFinite(m.duration) ? m.endTime - m.duration : null;
}

function inspectReplay(m, { patchFrom, patchTo = Infinity, known, rankedIds }) {
  if (!m || !Array.isArray(m.players) || m.players.length !== 10) return 'invalidPlayers';
  if (m.pro === true || m.isPro === true) return 'pro';
  if (m.gameMode !== 22) return 'notRanked';
  const lobby = m.lobbyType ?? m.lobby_type ?? m.lobby ?? (rankedIds?.has(String(m.matchId ?? m.id)) ? 7 : null);
  if (lobby == null) return 'lobbyUnknown';
  if (lobby !== 7) return 'notRanked';
  if (!Number.isFinite(m.duration) || m.duration < 900) return 'short';
  const start = startTime(m);
  if (!Number.isFinite(start) || start < patchFrom || start >= patchTo) return 'outsidePatch';
  if (typeof m.radiantWin !== 'boolean') return 'missingResult';
  const heroes = m.players.map(p => p && p.heroId);
  if (heroes.some(id => !Number.isInteger(id) || id <= 0 || (known && !known.has(id))) || new Set(heroes).size !== 10) return 'invalidHeroes';
  const slots = m.players.map(p => p && p.slot);
  if (new Set(slots).size !== 10 || slots.some(s => !Number.isInteger(s))) return 'invalidSlots';
  const lastCoordinate = 480 - m.t0;
  if (!Number.isInteger(m.t0) || lastCoordinate < 0 || m.players.some(p => !Array.isArray(p.x) || !Array.isArray(p.y) ||
      p.x.length <= lastCoordinate || p.y.length <= lastCoordinate || !Array.isArray(p.dead) ||
      !p.econ || !Array.isArray(p.econ.lh)) || !Number.isFinite(m.econFrom) || !Number.isFinite(m.econStep) || m.econStep <= 0) return 'missingEvidence';
  const k = Math.floor((600 - m.econFrom) / m.econStep);
  if (k < 0 || m.players.some(p => p.econ.lh[k] == null)) return 'missingEconomy';
  return null;
}

function labelReplay(m, options) {
  const reason = inspectReplay(m, options);
  if (reason) return { reason, labels: null };
  const labels = label(m);
  const valid = [1, 2, 3, 4, 5];
  for (const team of ['radiant', 'dire']) {
    const slots = new Set(m.players.filter(p => p.team === team).map(p => p.slot));
    if (slots.size !== 5) return { reason: 'invalidTeams', labels: null };
    const teamLabels = labels.filter(p => slots.has(p.s));
    if (teamLabels.length !== 5 || valid.some(pos => teamLabels.filter(p => p.pos === pos).length > 1)) return { reason: 'ambiguous', labels: null };
  }
  return { reason: null, labels };
}

function* archiveMatches(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const ids = new Set();
  for (const entry of index.matches || []) {
    const id = String(entry.matchId);
    if (!/^\d+$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'matches', id + '.json'), 'utf8'));
    m.pro = entry.pro === true || m.pro === true;
    m.matchId = m.matchId || id;
    m.lobbyType = m.lobbyType ?? m.lobby_type ?? m.lobby ?? entry.lobbyType ?? entry.lobby_type ?? entry.lobby;
    yield m;
  }
}

module.exports = { startTime, inspectReplay, labelReplay, archiveMatches };
