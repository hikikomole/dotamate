// Адаптер архива: только события покупок; позиции — та же эвристика, что archive-positions.
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { label } = require('./archive-positions');
const { publicFeedStream } = require('./match-source');
const archive = path.join(process.env.DOTAMATE_COLLECTOR || path.join(os.homedir(), 'dotamate-collector'), 'archive');
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || fallback === undefined) throw error;
    return fallback;
  }
};

async function* replayMatches(options = {}) {
  if (!options.itemIds || typeof options.itemIds.get !== 'function') {
    console.log('Replay source skipped: missing/invalid itemIds map; Stratz-only build.');
    return;
  }
  const dir = options.archive || archive;
  const file = options.file || path.join(dir, 'purchases.jsonl');
  // Проверяем доступность до чтения дополнительных файлов и до добавления реплеев.
  let handle;
  try { handle = await fs.promises.open(file, 'r'); }
  catch (error) {
    console.log(`Реплеи недоступны (${error.code || error.message}); сборка только Stratz.`);
    return;
  }
  try {
    let positions, rankedIds, blocked;
    try {
      positions = options.positions || readJson(path.join(dir, 'positions-cache.json'), {});
      if (!positions || typeof positions !== 'object' || Array.isArray(positions)) throw new Error('invalid positions-cache.json');
      // compact() не хранит lobby. Подтверждаем ranked по исходной публичной ленте;
      // при утрате этой записи пропускаем матч, а не считаем mode=22 доказательством ранкеда.
      rankedIds = options.rankedIds;
      if (!rankedIds) {
        // Any qualifying occurrence proves ranked mode, as before. Replay supplies rank.
        rankedIds = new Map();
        for (const tier of ['base', 'top']) {
          for await (const row of publicFeedStream({ tier })) {
            if (row[4] === 7 && row[5] === 22) rankedIds.set(String(row[0]), [row[4], row[5], row[3]]);
          }
        }
      }
      const index = readJson(path.join(dir, 'index.json'));
      const schedule = options.blocked ? { items: [] } : readJson(path.join(os.homedir(), 'dotamate-data', 'live-schedule.json'));
      if (!Array.isArray(index?.matches) || !Array.isArray(schedule?.items) || typeof rankedIds?.has !== 'function') throw new Error('invalid replay index/schedule/rankedIds');
      blocked = new Set(options.blocked || schedule.items.map(row => String(row.id)));
      for (const row of index.matches) if (row.pro || row.leagueid || row.leagueId) blocked.add(String(row.matchId));
    } catch (error) {
      console.log(`Replay source skipped: optional input unavailable/invalid (${error.code || error.message}: ${error.path || dir}); Stratz-only build.`);
      return;
    }
    const seen = new Set(options.seen);
    const input = handle.createReadStream({ encoding: 'utf8', autoClose: false });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let m;
        try { m = JSON.parse(line); } catch { continue; } // в том числе оборванная последняя строка
        if (!m || m.id == null) continue;
        const id = String(m.id);
        if (seen.has(id) || blocked.has(id) || m.pro || m.leagueid || m.leagueId || m.league ||
            m.mode !== 22 || (m.lobby != null ? m.lobby !== 7 : !rankedIds.has(id)) ||
            !Number.isFinite(m.end) || !Number.isFinite(m.dur) || m.dur < 900 ||
            m.end - m.dur < options.since || !Array.isArray(m.p)) continue;
        let labels = positions[id]?.p;
        if (!Array.isArray(labels)) {
          try {
            const full = readJson(path.join(dir, 'matches', id + '.json'), null);
            if (full?.pro || full?.leagueid || full?.leagueId) continue;
            labels = full ? label(full) : [];
          } catch { labels = []; } // нет координат — только общая позиция
        }
        if (!Array.isArray(labels)) labels = [];
        const p = m.p.filter(Array.isArray).map(player => {
          const q = labels.find(q => q && q.h === player[0] && (q.s < 5 ? 0 : 1) === player[1]);
          const pos = q && Number.isInteger(q.pos) && q.pos >= 1 && q.pos <= 5 &&
            (q.confidence == null || (typeof q.confidence === 'number' ? q.confidence >= 0.8 : q.confidence === 'high')) ? q.pos : 0;
          const b = (Array.isArray(player[10]) ? player[10] : []).filter(Array.isArray)
            .map(([t, key]) => [t, options.itemIds.get(String(key).replace(/^item_/, ''))]);
          return { h: player[0], r: player[1] === 0 ? 1 : 0, pos, b };
        });
        if (!p.some(player => player?.b.length)) continue;
        // Сохраняем весь состав врагов; игроки без уверенной позиции не входят в знаменатели.
        const enemies = m.p.filter(Array.isArray).map(player => ({ h: player[0], r: player[1] === 0 ? 1 : 0 }));
        seen.add(id);
        yield { id, t: m.end - m.dur, rank: m.rank ?? null, p: p.filter(Boolean), enemies };
      }
    } finally { lines.close(); input.destroy(); }
  } finally { await handle.close(); }
}
module.exports = { replayMatches };
