'use strict';

// CMsgDOTAMatch from @blastorg/gamecoordinator-dota-communicator typings.
// v3 fields stay unchanged (shared contract with /me/ and js/match.js); GC-only data goes to p.x / x.
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dmg = list => [0, 1, 2].map(t => num((Array.isArray(list) ? list : []).find(d => num(d.damageType) === t)?.postReduction));

function normalize(match, id) {
  if (!match || String(match.matchId) !== String(id) || !Array.isArray(match.players) || match.players.length !== 10) throw new Error('not_found');
  const fields = { kills: 'k', deaths: 'd', assists: 'a', goldPerMin: 'gpm', xpPerMin: 'xpm', lastHits: 'lh', netWorth: 'nw', heroDamage: 'hd', denies: 'dn', towerDamage: 'td', heroHealing: 'hh', level: 'lvl' };
  // Party ids are replaced by small group numbers (only parties of 2+ players are kept).
  const partyCount = new Map();
  for (const p of match.players) { const k = String(p.partyId ?? '0'); if (k !== '0') partyCount.set(k, (partyCount.get(k) || 0) + 1); }
  const partyIndex = new Map(); for (const [k, n] of partyCount) if (n > 1) partyIndex.set(k, partyIndex.size + 1);
  const players = match.players.map(p => {
    const slot = Number(p.playerSlot);
    if (!Number.isInteger(slot) || !((slot >= 0 && slot < 5) || (slot >= 128 && slot < 133))) throw new Error('invalid_slot');
    const row = { id: Number(p.accountId || 0), slot, hero: Number(p.heroId || 0), leaverStatus: p.leaverStatus == null ? null : Number(p.leaverStatus) };
    for (const [source, dest] of Object.entries(fields)) row[dest] = Number(p[source] || 0);
    row.items = Array.from({ length: 6 }, (_, i) => Number(p['item' + i] || 0));
    const pro = typeof p.proName === 'string' && p.proName.trim() ? p.proName.trim() : null;
    row.name = pro || (typeof p.playerName === 'string' ? p.playerName : null);
    row.missing = ['kills', 'deaths', 'assists', 'goldPerMin', 'xpPerMin', 'lastHits', 'denies', 'netWorth', 'heroDamage', 'heroHealing'].filter(k => p[k] == null).map(k => ({ goldPerMin: 'gold_per_min', xpPerMin: 'xp_per_min', lastHits: 'last_hits', netWorth: 'net_worth', heroDamage: 'hero_damage', heroHealing: 'hero_healing' })[k] || k);
    const ups = (Array.isArray(p.abilityUpgrades) ? p.abilityUpgrades : []).slice(0, 25);
    row.ab = ups.map(u => Number(u.ability || 0));
    row.x = {
      bp: [6, 7, 8].map(i => num(p['item' + i])),           // backpack
      nt: num(p.item9 ?? p.itemNeutral),                       // neutral item
      gs: num(p.goldSpent), g: num(p.gold),
      sd: num(p.secondsDead), gl: num(p.goldLostToDeath),
      br: num(p.bountyRunes), op: num(p.outpostsCaptured),
      sg: num(p.supportGold), ln: num(p.laneSelectionFlags),
      po: num(p.heroPickOrder), rnd: !!p.heroWasRandomed,
      lv: p.leaverStatus == null ? null : num(p.leaverStatus), fc: num(p.selectedFacet),
      pt: partyIndex.get(String(p.partyId ?? '0')) || 0,
      di: dmg(p.heroDamageDealt), dr: dmg(p.heroDamageReceived), // [physical, magical, pure] post-reduction
      at: ups.map(u => num(u.time)),
      pb: (Array.isArray(p.permanentBuffs) ? p.permanentBuffs : []).map(b => [num(b.permanentBuff), num(b.stackCount)]).filter(b => b[0] > 0).slice(0, 10)
    };
    return row;
  });
  if (new Set(players.map(p => p.slot)).size !== 10) throw new Error('invalid_slot');
  // EMatchOutcome: RADIANT_VICTORY=2, DIRE_VICTORY=3 (protobuf enum).
  if (![2, 3].includes(match.matchOutcome)) throw new Error('invalid_outcome');
  const str = v => typeof v === 'string' && v.trim() ? v.trim() : null;
  const x = {
    src: 'gc',
    score: [num(match.radiantTeamScore), num(match.direTeamScore)],
    fb: num(match.firstBloodTime), pre: num(match.preGameDuration),
    lobby: num(match.lobbyType), cluster: num(match.cluster),
    towers: Array.isArray(match.towerStatus) ? match.towerStatus.map(num).slice(0, 2) : [0, 0],
    rax: Array.isArray(match.barracksStatus) ? match.barracksStatus.map(num).slice(0, 2) : [0, 0],
    draft: (Array.isArray(match.picksBans) ? match.picksBans : []).slice(0, 30).map(d => [d.isPick ? 1 : 0, num(d.team), num(d.heroId)]),
    league: num(match.leagueid), series: [num(match.seriesId), num(match.seriesType)],
    teams: [
      { id: num(match.radiantTeamId), tag: str(match.radiantTeamTag), logo: str(match.radiantTeamLogoUrl) },
      { id: num(match.direTeamId), tag: str(match.direTeamTag), logo: str(match.direTeamLogoUrl) }
    ]
  };
  return { v: 3, start: Number(match.starttime || 0), duration: Number(match.duration || 0), gameMode: Number(match.gameMode || 0), lobbyType: match.lobbyType == null ? null : Number(match.lobbyType), radiantWin: match.matchOutcome === 2, players, radiantName: str(match.radiantTeamName), direName: str(match.direTeamName), x };
}
module.exports = { normalize };
