#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { renderTierPages } = require('./tier-page-render');
const { writeJsonAtomic } = require('./match-source');

function main() {
  const args = process.argv.slice(2), arg = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  if (args.includes('--fixture') && !arg('--input-dir')) throw new Error('--fixture requires --input-dir');
  const input = path.resolve(arg('--input-dir') || path.join(__dirname, '..', 'data'));
  const output = path.resolve(arg('--out-dir') || path.join(__dirname, '..'));
  const data = JSON.parse(fs.readFileSync(path.join(input, 'role-meta.json'), 'utf8'));
  const heroes = JSON.parse(fs.readFileSync(path.join(input, 'heroes.json'), 'utf8')).heroes;
  const pages = renderTierPages(data, heroes);
  for (const key of ['index', 'position-1', 'position-2', 'position-3', 'position-4', 'position-5']) {
    const dir = path.join(output, 'tier-list', key === 'index' ? '' : key);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'index.html'), tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, pages[key]); fs.renameSync(tmp, target);
  }
  writeJsonAtomic(path.join(output, 'tier-urls.json'), JSON.stringify(pages.urls, null, 2) + '\n');
  console.log(`tier pages: ${pages.urls.length} sitemap URLs`);
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { main };
