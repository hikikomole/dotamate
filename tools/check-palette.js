#!/usr/bin/env node
// Report legacy visual palette literals in built pages and source assets.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const targets = [
  { dir: 'deploy', ext: '.html' },
  { dir: 'css', ext: '.css' },
  { dir: 'js', ext: '.js' },
];
const forbidden = /#(?:07080a|07090d|070a10|090b12|080b11|d9c187|8d7b4f|e2b660|8b5cf6|a970ff|a78bfa|9b6cff|aa8aff|b68cff|4f46e5|7c4dff|6339db|7042df|6d45e8|6438d8)\b|rgba?\(\s*(?:217\s*,\s*193\s*,\s*135|139\s*,\s*92\s*,\s*246|111\s*,\s*77\s*,\s*246|99\s*,\s*102\s*,\s*241|7\s*,\s*8\s*,\s*10)\b/ig;
let total = 0;
function walk(dir, ext) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'games' && dir === path.join(root, 'js')) continue;
    if (entry.name === 'games.css') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, ext); continue; }
    if (!entry.name.endsWith(ext)) continue;
    fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (/palette-allow: data-color/.test(line)) return;
      for (const match of line.matchAll(forbidden)) {
        console.log(`${path.relative(root, full).replace(/\\/g, '/')}:${index + 1}: ${match[0]}`);
        total++;
      }
    });
  }
}
for (const target of targets) walk(path.join(root, target.dir), target.ext);
console.log(`Palette offenders: ${total}`);
process.exitCode = total ? 1 : 0;
