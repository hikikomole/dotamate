#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/meta-escape.json'), 'utf8'));
const { card } = require(path.join(root, 'js/meta.js'));
const file = path.join(root, 'meta/index.html');
let html = fs.readFileSync(file, 'utf8');
const rows = '<div class="mx-grid">' + data.list.slice(0, 20).map(row => card(data, row)).join('') + '</div>';
const start = '<div id="mxList">', end = '</div>\n          <div class="mx-sentinel"';
const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
if (a < 0 || b < 0) throw new Error('META list marker missing');
html = html.slice(0, a + start.length) + '<!-- prerender:start -->' + rows + '<!-- prerender:end -->' + html.slice(b);
fs.writeFileSync(file, html);
console.log('Prerendered ' + Math.min(data.list.length, 20) + ' META cards');
