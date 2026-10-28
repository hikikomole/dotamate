'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

// Retain only IDs needed by the replay archive, never the whole Steam cohort.
async function rankedReplayIds(dir, wanted, patchFrom, patchTo = Infinity) {
  const ranked = new Set();
  if (!wanted.size || !fs.existsSync(dir)) return ranked;
  const firstDay = new Date(patchFrom * 1000).toISOString().slice(0, 10);
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl.gz') && f.slice(0, 10) >= firstDay).sort()) {
    const input = fs.createReadStream(path.join(dir, name));
    const unzip = zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
    input.on('error', e => unzip.destroy(e));
    const lines = readline.createInterface({ input: input.pipe(unzip), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (!Array.isArray(r)) continue;
        const id = String(r[0]);
        if (wanted.has(id) && r[2] >= patchFrom && r[2] < patchTo && r[6] === 22 && r[7] === 7) ranked.add(id);
      }
    } finally { lines.close(); input.destroy(); unzip.destroy(); }
  }
  return ranked;
}
module.exports = { rankedReplayIds };
