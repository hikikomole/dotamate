#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./match-source');

function buildGrid(data, known) {
  if (data.schemaVersion !== 1 || data.status !== 'ok' || !data.meta?.coverage?.gatePassed || !data.positions) throw new Error('Verified role meta required');
  let y = 0;
  const categories = [1, 2, 3, 4, 5].map(pos => {
    const rows = data.positions[pos]?.heroes;
    if (!Array.isArray(rows) || !rows.some(h => h.n >= 100)) throw new Error(`Position ${pos} has no eligible heroes`);
    const ids = rows.filter(h => h.n >= 100).map(h => h.id);
    if (ids.some(id => !Number.isInteger(id) || !known.has(id)) || new Set(ids).size !== ids.length) throw new Error(`Invalid hero IDs at position ${pos}`);
    const height = Math.max(160, Math.ceil(ids.length / 12) * 90 + 40);
    const category = { category_name: `Position ${pos}`, x_position: 0, y_position: y, width: 1100, height, hero_ids: ids };
    y += height + 16;
    return category;
  });
  return { version: 3, configs: [{ config_name: 'DotaMate', categories }] };
}

function main() {
  const args = process.argv.slice(2), arg = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  if (args.includes('--fixture') && !arg('--input-dir')) throw new Error('--fixture requires --input-dir');
  const input = path.resolve(arg('--input-dir') || path.join(__dirname, '..', 'data'));
  const output = path.resolve(arg('--out-dir') || input);
  const data = JSON.parse(fs.readFileSync(path.join(input, 'role-meta.json'), 'utf8'));
  const heroes = JSON.parse(fs.readFileSync(path.join(input, 'heroes.json'), 'utf8')).heroes;
  const grid = buildGrid(data, new Set(heroes.map(h => Number(h.id))));
  fs.mkdirSync(output, { recursive: true });
  writeJsonAtomic(path.join(output, 'hero_grid_config.json'), JSON.stringify(grid, null, 2) + '\n');
  console.log(`hero grid: ${grid.configs[0].categories.length} positions`);
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { buildGrid, main };
