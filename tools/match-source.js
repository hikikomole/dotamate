/**
 * Единое чтение базы матчей для сборщиков статистики (T2 перехода на Steam Web API).
 *
 * Источник выбирается флагом `--source opendota|steam` (или MATCH_SOURCE), по умолчанию opendota —
 * поведение сборщиков без флага не меняется.
 *
 *   opendota — data/public-matches[-top]/*.jsonl (tools/collect-public-matches.js);
 *   steam    — data/steam-matches[-turbo]/*.jsonl.gz (tools/collect-steam-matches.js, формат строки там).
 *
 * publicRows() отдаёт строки в формате ленты OpenDota, чтобы сборщики не менялись:
 *   [match_id, start_time, duration, rank|null, lobby_type, game_mode, radiant_win(0/1), h0…h9]
 * У Steam ранга нет: rank берётся из базы OpenDota по match_id (collect-steam-matches.js), иначе null.
 * Срезы для steam: base — ранг неизвестен или ≤ 65 (известный ранг выше 0–4500 исключается),
 * top — известный ранг 75–85 (Divine 5 и Immortal).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function source() {
  const a = process.argv, i = a.indexOf('--source');
  const s = (i >= 0 ? a[i + 1] : process.env.MATCH_SOURCE || 'opendota').toLowerCase();
  if (s !== 'opendota' && s !== 'steam') { console.error('Неизвестный источник: ' + s + ' (opendota|steam)'); process.exit(2); }
  return s;
}

function readGz(file) {
  // склеенные gzip-члены (дописывание по пачкам) gunzipSync читает целиком
  return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** Сырые строки Steam (формат collect-steam-matches.js), без повторов match_id. */
function steamMatches({ turbo = false } = {}) {
  const dir = path.join(DATA, turbo ? 'steam-matches-turbo' : 'steam-matches');
  if (!fs.existsSync(dir)) return [];
  const seen = new Set(), out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz')).sort()) {
    for (const r of readGz(path.join(dir, f))) {
      if (seen.has(r[0])) continue;
      seen.add(r[0]); out.push(r);
    }
  }
  return out;
}

const STEAM_TIER = { base: r => r == null || r <= 65, top: r => r != null && r >= 75 && r <= 85 };

/** Строки в формате ленты OpenDota. tier: base|top; turbo — турбо (у OpenDota турбо лежит в base). */
function publicRows({ src = source(), tier = 'base', turbo = false } = {}) {
  if (src === 'steam') {
    const keep = STEAM_TIER[tier];
    if (!keep) throw new Error('Неизвестный срез: ' + tier);
    return steamMatches({ turbo }).filter(r => turbo || keep(r[4]))
      .map(r => [r[0], r[2], r[3], r[4], r[7], r[6], r[5], ...r.slice(9, 19).map(p => p[0])]);
  }
  const dir = path.join(DATA, tier === 'top' ? 'public-matches-top' : 'public-matches');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* оборванная строка */ }
    }
  }
  return out;
}

/** Подпись источника для полей source в выходных JSON. */
function sourceLabel(src = source()) {
  return src === 'steam' ? 'Своя база рейтинговых матчей (Steam Web API)' : 'Своя база публичных матчей (OpenDota /publicMatches)';
}

module.exports = { source, publicRows, steamMatches, sourceLabel, readGz };
