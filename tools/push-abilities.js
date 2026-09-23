#!/usr/bin/env node
/**
 * Сохраняет обновлённый снимок способностей в git и отправляет на GitHub.
 *
 * Вынесено из .cmd отдельным скриптом сознательно: сборка заголовка
 * авторизации в батнике требует powershell с вложенными кавычками — место,
 * где легко ошибиться и невозможно проверить заранее. Здесь то же самое
 * делается средствами node и проверяется запуском с ключом --dry.
 *
 * Токен читается из github.pat.txt (формат «github.pat = <токен>») и нигде
 * не печатается: ни в выводе, ни в аргументах команды — только в заголовке.
 *
 * Запуск: node tools/push-abilities.js [--dry]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');
const FILES = ['data/hero-abilities.json', 'deploy/data/hero-abilities.json'];

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit' });

function readToken() {
  const f = path.join(ROOT, 'github.pat.txt');
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, 'utf8').trim();
  const t = (raw.includes('=') ? raw.slice(raw.indexOf('=') + 1) : raw).replace(/[\r\n\s]/g, '');
  return t || null;
}

try { git(['rev-parse', '--git-dir'], { quiet: true }); }
catch { console.log('Это не репозиторий git — пропускаю сохранение.'); process.exit(0); }

const present = FILES.filter(f => fs.existsSync(path.join(ROOT, f)));
if (!present.length) { console.log('Нечего сохранять: файлов снимка нет.'); process.exit(0); }

git(['add', ...present], { quiet: true });

let hasChanges = true;
try { git(['diff', '--cached', '--quiet'], { quiet: true }); hasChanges = false; }
catch { hasChanges = true; }

if (!hasChanges) { console.log('Данные не изменились с прошлого раза — сохранять нечего.'); process.exit(0); }

if (DRY) {
  console.log('Проверка: изменения есть, коммит и отправка прошли бы здесь. Индекс возвращаю как было.');
  git(['reset', 'HEAD', ...present], { quiet: true });
  process.exit(0);
}

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hero-abilities.json'), 'utf8'));
git(['commit', '-q', '-m',
  `Обновлён снимок способностей героев (${snap.heroCount} героев, ${String(snap.fetchedAt).slice(0, 10)})`],
  { quiet: true });
console.log('Коммит создан.');

const token = readToken();
if (!token) {
  console.log('Нет github.pat.txt — коммит сохранён локально, отправьте его вручную.');
  process.exit(0);
}

const auth = 'Basic ' + Buffer.from('x-access-token:' + token).toString('base64');
try {
  execFileSync('git', ['-c', 'http.https://github.com/.extraheader=Authorization: ' + auth,
    'push', 'origin', 'HEAD'], { cwd: ROOT, stdio: 'pipe' });
  console.log('Отправлено на GitHub.');
} catch (e) {
  const msg = String(e.stderr || e.message).replace(/(ghp_|github_pat_)[A-Za-z0-9_]+/g, '<скрыто>');
  console.log('Отправить не вышло — коммит остался на компьютере.');
  console.log('Чаще всего это истёкший токен в github.pat.txt. Ответ git: ' + msg.split('\n')[0]);
}
