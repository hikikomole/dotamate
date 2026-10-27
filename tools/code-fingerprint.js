#!/usr/bin/env node
/**
 * Отпечаток кода сайта (U3, 04.10.2026): ежедневное обновление выкладывает только данные.
 *
 * Код приходит на сервер через tools/push-server.js и уходит на сайт только по команде владельца
 * («выкладывай» → build → sync → tools/deploy-hostiman.js). Каждая успешная выкладка на сервере
 * записывает отпечаток (md5 каждого файла кода) в ~/dotamate-data/code-fingerprint.json.
 * tools/daily-update.js сверяет текущий код с этим отпечатком в начале и перед выкладкой:
 * есть расхождение — данные пересчитываются, но выкладка не делается (журнал logs/daily-*.log).
 *
 * Что считается кодом: *.js, *.mjs, *.css вне служебных папок; page-shell.html и page-sections.html
 * (из них build-pages.js собирает страницы); deploy/api/*.php и .htaccess; seo/*.json (тексты для
 * сборщиков); assets/** (картинки). НЕ код: data/, deploy/ (кроме api и .htaccess), logs/, сгенерированные
 * страницы и *-urls.json, sitemap.xml — их пишут сами сборщики.
 *
 *   node tools/code-fingerprint.js --check    сверить с записанным (код выхода 0 — совпадает, 1 — нет)
 *   node tools/code-fingerprint.js --record   записать текущий (делает deploy-hostiman.js после выкладки)
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = process.env.DOTAMATE_FINGERPRINT || path.join(os.homedir(), 'dotamate-data', 'code-fingerprint.json');
const SKIP = new Set(['data', 'deploy', 'logs', 'node_modules', 'outputs', 'Claude', 'Claude outputs', 'secrets',
  'match-archive', 'netlify-site', 'db', 'docs']);
const CODE_EXT = /\.(m?js|css)$/;
// Ежедневная сборка пересоздаёт этот модуль из данных; его изменение не является правкой кода.
const GENERATED_CODE = new Set(['js/games/data/tactics.js']);

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .git, .env, .fuse_hidden* и т.п.
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!(rel === '' && SKIP.has(e.name))) walk(path.join(dir, e.name), r, out); continue; }
    if (!e.isFile() || GENERATED_CODE.has(r)) continue;
    const top = r.split('/')[0];
    if (CODE_EXT.test(e.name) || top === 'assets' || (top === 'seo' && e.name.endsWith('.json'))
      || r === 'page-shell.html' || r === 'page-sections.html') out.push(r);
  }
}

function compute(root = ROOT) {
  const list = [];
  walk(root, '', list);
  const api = path.join(root, 'deploy', 'api');
  if (fs.existsSync(api)) for (const n of fs.readdirSync(api)) if (n.endsWith('.php') || n === '.htaccess') list.push('deploy/api/' + n);
  if (fs.existsSync(path.join(root, 'deploy', '.htaccess'))) list.push('deploy/.htaccess');
  const files = {};
  for (const r of list.sort()) files[r] = crypto.createHash('md5').update(fs.readFileSync(path.join(root, r))).digest('hex');
  return files;
}

/** Сверка с записанным: { ok, recorded, changed: [пути], missing: bool }. */
function check(root = ROOT) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { ok: false, missing: true, changed: [], recorded: null }; }
  const cur = compute(root), old = rec.files || {};
  const changed = [];
  for (const k of new Set([...Object.keys(cur), ...Object.keys(old)])) {
    if (cur[k] !== old[k]) changed.push((old[k] ? (cur[k] ? 'изменён ' : 'удалён ') : 'новый ') + k);
  }
  return { ok: changed.length === 0, missing: false, changed: changed.sort(), recorded: { version: rec.version, at: rec.at } };
}

function record(version, root = ROOT) {
  const files = compute(root);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify({ version: version || null, at: new Date().toISOString(), count: Object.keys(files).length, files }));
  fs.renameSync(FILE + '.tmp', FILE);
  return Object.keys(files).length;
}

module.exports = { compute, check, record, FILE };

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('--record')) { console.log('Отпечаток кода записан: ' + record(null) + ' файлов → ' + FILE); }
  else {
    const r = check();
    if (r.missing) { console.log('Отпечатка нет (' + FILE + ') — код ещё не выкладывался с проверкой.'); process.exit(1); }
    console.log(r.ok ? 'Код совпадает с выложенным (версия ' + r.recorded.version + ').'
      : 'Код изменён после выкладки версии ' + r.recorded.version + ' (' + r.changed.length + ' файлов):\n  ' + r.changed.slice(0, 30).join('\n  '));
    process.exit(r.ok ? 0 : 1);
  }
}
