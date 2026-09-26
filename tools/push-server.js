#!/usr/bin/env node
/**
 * Отправка кода проекта на хостинг (~/dotamate-src), где по cron идёт ежедневное
 * обновление сайта (с 26.09.2026 — без компьютера владельца).
 *
 * Сервер — хозяин данных: база матчей и всё, что из неё пересчитывается, живёт
 * там. Поэтому обычная отправка НЕ трогает data/ и страницы, которые обновление
 * пересобирает само (deploy/data, deploy/hero, deploy/guide).
 *
 *   node tools/push-server.js              — код, страницы, стили, скрипты
 *   node tools/push-server.js --with-data  — плюс data/ (кроме сырых баз матчей),
 *                                            если руками поменяли исходные данные
 *   node tools/push-server.js --bootstrap  — первичная полная копия, включая базы
 *                                            матчей и токен Stratz
 *
 * После отправки сайт не пересобирается: изменения уйдут на сайт при ближайшем
 * ночном обновлении. Выложить сразу: node tools/deploy-hostiman.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const host = process.env.HOSTIMAN_SSH_HOST || 'ruvip72.hostiman.ru';
const port = process.env.HOSTIMAN_SSH_PORT || '8228';
const user = process.env.HOSTIMAN_SSH_USER || 's278486';
const key = process.env.HOSTIMAN_SSH_KEY || path.join(os.homedir(), '.ssh', 'dotamate_hostiman');

// Никогда: секреты и мусор рабочей машины.
const EXCLUDE = ['./.git', './node_modules', './Claude outputs', './.wrangler', './deploy/.wrangler', './logs',
  './.d2h-data-cache-v43', './.env', './secrets', './github.pat.txt', './__pycache__', './netlify-site', './.netlify'];
if (!ARGS.has('--bootstrap')) {
  EXCLUDE.push('./stratz.capi.txt', './data/public-matches', './data/meta-matches', './data/meta-match',
    './deploy/data', './deploy/hero', './deploy/guide');
  if (!ARGS.has('--with-data')) EXCLUDE.push('./data');
}

const tarFile = path.join(os.tmpdir(), 'dotamate-src-' + process.pid + '.tar');
const tarArgs = ['-cf', tarFile];
for (const e of EXCLUDE) tarArgs.push('--exclude=' + e);
tarArgs.push('-C', ROOT, '.');
console.log('=== Архив проекта (' + (ARGS.has('--bootstrap') ? 'полная копия' : ARGS.has('--with-data') ? 'код + data' : 'код') + ') ===');
let r = spawnSync('tar', tarArgs, { stdio: 'inherit' });
if (r.status !== 0) { console.error('tar завершился с ошибкой'); process.exit(1); }
console.log('Размер: ' + (fs.statSync(tarFile).size / 1048576).toFixed(1) + ' МБ');

const remote = 'set -e; mkdir -p ~/dotamate-src ~/dotamate-src/logs && tar -xf - -C ~/dotamate-src'
  + ' && chmod 600 ~/dotamate-src/stratz.capi.txt 2>/dev/null; echo "files: $(find ~/dotamate-src -type f | wc -l)"';
for (let attempt = 1; attempt <= 6; attempt++) {
  r = spawnSync('ssh', ['-i', key, '-p', port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
    '-o', 'StrictHostKeyChecking=accept-new', user + '@' + host, remote],
    { stdio: [fs.openSync(tarFile, 'r'), 'inherit', 'inherit'], timeout: 30 * 60 * 1000 });
  if (r.error || r.status !== 255 || attempt === 6) break;
  console.log('Соединение не установилось, попытка ' + (attempt + 1) + ' через 15 с…');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},15000)']);
}
try { fs.unlinkSync(tarFile); } catch (e) { /* временный файл */ }
if (r.error || r.status !== 0) { console.error('Отправка не удалась, код ' + (r.error ? r.error.message : r.status)); process.exit(1); }
console.log('Код на сервере обновлён.');
