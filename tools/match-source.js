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
 * Срезы для steam: base — ранг неизвестен или ≤ 65 (известный ранг выше Властелина исключается),
 * top — известный ранг 75–85 (Divine 5 и Immortal), all — все рейтинговые матчи всех рангов.
 *
 * steamStream() — потоковое чтение (gunzip + readline) для боевых объёмов: сотни тысяч матчей в день
 * × 30 дней не помещаются в память целиком (claude/steam-U1-itog.md). Матч попадает в дневной файл по
 * start_time, поэтому повторы match_id возможны только внутри одного файла — проверка по файлу.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
// Файл текущего дня сборщик Steam дописывает gzip-членами каждые 10 минут, и чтение может застать член недописанным.
// Z_SYNC_FLUSH: распаковать всё, что есть, без ошибки «unexpected end of file» (п. 1.2 плана, 11.10.2026); оборванная
// последняя строка отсеется на JSON.parse.
const GZ = { finishFlush: zlib.constants.Z_SYNC_FLUSH };

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
  return zlib.gunzipSync(fs.readFileSync(file), GZ).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/**
 * Начало текущего патча (unix-время из data/patch-notes.json, решение владельца 11.10.2026): все сборщики
 * читают только матчи текущего патча — тир-лист, контрпики, DraftMate, META и прокачка считаются по одному срезу.
 * MATCH_ALL_PATCHES=1 — без отсечки (диагностика). Нет файла или времени — без отсечки (0).
 * Версию патча файл получает только от tools/fetch-patch-notes.js; tools/check-reference-data.js сообщает, когда он устарел.
 */
let PATCH_SINCE = null;
function patchSince() {
  if (PATCH_SINCE !== null) return PATCH_SINCE;
  PATCH_SINCE = 0;
  if (process.env.MATCH_ALL_PATCHES === '1') return PATCH_SINCE;
  try { PATCH_SINCE = Number(JSON.parse(fs.readFileSync(path.join(DATA, 'patch-notes.json'), 'utf8')).timestamp) || 0; } catch { /* без отсечки */ }
  return PATCH_SINCE;
}
const inPatch = start => !(start < patchSince());

/** Файлы дневной базы Steam по порядку (дни раньше начала патча не берутся); days > 0 — только последние N. */
function steamFiles({ turbo = false, days = 0 } = {}) {
  const dir = path.join(DATA, turbo ? 'steam-matches-turbo' : 'steam-matches');
  if (!fs.existsSync(dir)) return [];
  const since = patchSince(), firstDay = since ? new Date(since * 1000).toISOString().slice(0, 10) : '';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz') && f.slice(0, 10) >= firstDay).sort().map(f => path.join(dir, f));
  return days > 0 ? files.slice(-days) : files;
}

/**
 * Сырые строки Steam синхронно, по одной: filter/map применяются к каждой строке сразу, в памяти
 * остаётся только результат map (дневной файл распаковывается в Buffer, без строки на весь файл —
 * ranked-день ≈ 0,9 ГБ больше предела длины строки V8). Повтор match_id проверяется внутри файла
 * (матч попадает в дневной файл по start_time), как в steamStream(). each — обработать строку и не хранить.
 */
function steamRows({ turbo = false, days = 0, filter = null, map = null, each = null } = {}) {
  const out = [];
  for (const file of steamFiles({ turbo, days })) {
    const buf = zlib.gunzipSync(fs.readFileSync(file), GZ); // склеенные gzip-члены читаются целиком
    const seen = new Set();
    for (let s = 0; s < buf.length;) {
      let e = buf.indexOf(10, s); if (e < 0) e = buf.length;
      if (e > s) {
        let r = null; try { r = JSON.parse(buf.toString('utf8', s, e)); } catch { /* оборванная строка */ }
        if (r && !seen.has(r[0]) && inPatch(r[2])) { seen.add(r[0]); if (!filter || filter(r)) { if (each) each(r); else out.push(map ? map(r) : r); } }
      }
      s = e + 1;
    }
  }
  return out;
}

/** Сырые строки Steam (формат collect-steam-matches.js), без повторов match_id. */
function steamMatches({ turbo = false, days = 0 } = {}) {
  return steamRows({ turbo, days });
}

/** Сырые строки Steam потоком (async-итератор), без повторов match_id. days — только последние N файлов. */
async function* steamStream({ turbo = false, days = 0 } = {}) {
  for (const file of steamFiles({ turbo, days })) {
    const seen = new Set();
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip(GZ)), crlfDelay: Infinity });
    for await (const l of rl) {
      if (!l) continue;
      let r; try { r = JSON.parse(l); } catch { continue; } // оборванная строка
      if (seen.has(r[0]) || !inPatch(r[2])) continue;
      seen.add(r[0]); yield r;
    }
  }
}

const STEAM_TIER = { base: r => r == null || r <= 65, top: r => r != null && r >= 75 && r <= 85, all: () => true };

/** Строка Steam → формат ленты OpenDota [id, start, dur, rank, lobby, mode, rw, h0…h9]. */
const steamToPublic = r => [r[0], r[2], r[3], r[4], r[7], r[6], r[5], ...r.slice(9, 19).map(p => p[0])];

/** Строки в формате ленты OpenDota. tier: base|top; turbo — турбо (у OpenDota турбо лежит в base). */
function publicRows({ src = source(), tier = 'base', turbo = false } = {}) {
  if (src === 'steam') {
    const keep = STEAM_TIER[tier];
    if (!keep) throw new Error('Неизвестный срез: ' + tier);
    return steamRows({ turbo, filter: turbo ? null : r => keep(r[4]), map: steamToPublic });
  }
  const dir = path.join(DATA, tier === 'top' ? 'public-matches-top' : 'public-matches');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (inPatch(r[1])) out.push(r); } catch { /* оборванная строка */ }
    }
  }
  return out;
}

/**
 * Строки в формате ленты OpenDota потоком (async): для steam память не растёт с объёмом базы —
 * на хостинге общий лимит памяти аккаунта ≈ 1,5–2 ГБ (LVE), процесс сверх него снимается SIGKILL.
 */
async function* publicStream({ src = source(), tier = 'base', turbo = false } = {}) {
  if (src !== 'steam') { yield* publicRows({ src, tier, turbo }); return; }
  const keep = STEAM_TIER[tier];
  if (!keep) throw new Error('Неизвестный срез: ' + tier);
  for await (const r of steamStream({ turbo })) if (turbo || keep(r[4])) yield steamToPublic(r);
}

/** Строка Steam (формат collect-steam-matches.js) → запись в формате data/meta-matches (pos: null). */
function steamToMeta(r) {
  return {
    id: r[0], rw: r[5], dur: r[3], t: r[2], rank: r[4], wr: [], nw: [], lanes: [], bans: r[8],
    p: r.slice(9, 19).map(p => ({ h: p[0], r: p[1] < 128 ? 1 : 0, pos: null, k: p[2], d: p[3], a: p[4], gpm: p[7], xpm: p[8],
      lh: p[5], dn: p[6], hd: p[11], td: p[12], hh: p[13], nw: p[10], lvl: p[9], it: p[14], nt: p[16], acc: 0, name: '' }))
  };
}

/** Детальные матчи Stratz data/meta-matches/*.jsonl (collect-meta-matches.js), повтор id — берётся последний. */
function metaMatches() {
  const dir = path.join(DATA, 'meta-matches');
  const byId = new Map();
  if (!fs.existsSync(dir)) return [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const m = JSON.parse(line); byId.set(m.id, m); } catch { /* оборванная строка */ }
    }
  }
  return [...byId.values()];
}

/**
 * Каталог вывода сборщиков: `--out-dir D` (или OUT_DIR), относительный — от корня проекта.
 * По умолчанию data/ — поведение без флага не меняется. Параллельный расчёт на Steam
 * (tools/steam-parallel.js) пишет в data-steam/, сайт его не видит.
 */
function outDir() {
  const a = process.argv, i = a.indexOf('--out-dir');
  const d = i >= 0 ? a[i + 1] : process.env.OUT_DIR;
  if (!d) return DATA;
  const abs = path.resolve(ROOT, d);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * Запись итогового JSON без окна с обрезанным файлом: во временный файл рядом, fsync, затем rename
 * (атомарно в пределах одной файловой системы). Если процесс снимут посреди записи (SIGKILL по лимиту
 * памяти хостинга), на месте останется прежний файл, а не половина нового.
 */
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, typeof data === 'string' ? data : JSON.stringify(data)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Подпись источника для полей source в выходных JSON. */
function sourceLabel(src = source()) {
  return src === 'steam' ? 'Своя база рейтинговых матчей (Steam Web API)' : 'Своя база публичных матчей (OpenDota /publicMatches)';
}

module.exports = { patchSince, writeJsonAtomic, publicStream, DATA, outDir, steamFiles, steamRows, source, publicRows, steamMatches, steamStream, steamToPublic, STEAM_TIER, sourceLabel, readGz, steamToMeta, metaMatches };
