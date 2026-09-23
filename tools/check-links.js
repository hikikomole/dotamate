#!/usr/bin/env node
/**
 * Сквозная проверка внутренних ссылок по всем собранным страницам.
 *
 * Что считается битой ссылкой: href на свой домен, для которого в deploy/
 * нет ни каталога с index.html, ни файла. Внешние ссылки, якоря, mailto и
 * tel не трогаем — их проверка это другая задача.
 *
 * Запуск: node tools/check-links.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function exists(p) {
  const clean = p.replace(/[?#].*$/, '');
  const asDir = path.join(DEPLOY, clean, 'index.html');
  const asFile = path.join(DEPLOY, clean);
  try { if (fs.existsSync(asDir)) return true; } catch {}
  try { if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return true; } catch {}
  return false;
}

const files = walk(DEPLOY);
const broken = new Map();
let checked = 0;

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const from = '/' + path.relative(DEPLOY, f).replace(/\\/g, '/');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (!url.startsWith('/')) continue;       // внешние и относительные пропускаем
    if (url.startsWith('//')) continue;       // протокол-относительные — внешние
    checked++;
    if (exists(url)) continue;
    const key = url.replace(/[?#].*$/, '');
    if (!broken.has(key)) broken.set(key, new Set());
    broken.get(key).add(from);
  }
}

console.log(`Страниц проверено: ${files.length}, внутренних ссылок: ${checked}.`);
if (!broken.size) { console.log('Битых внутренних ссылок нет.'); process.exit(0); }

console.log(`\nБитых адресов: ${broken.size}`);
for (const [url, where] of [...broken].sort((a, b) => b[1].size - a[1].size)) {
  const list = [...where];
  console.log(`  ${url} — ${list.length} стр., напр.: ${list.slice(0, 2).join(', ')}`);
}
process.exit(1);
