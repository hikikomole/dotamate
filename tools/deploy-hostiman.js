#!/usr/bin/env node
/**
 * Выкладка deploy/ на хостинг Hostiman (dotamate.ru, с 25.09.2026 вместо Cloudflare).
 *
 * Одно SSH-подключение на выкладку: хостинг блокирует IP после нескольких
 * подключений подряд. Архив распаковывается в соседнюю папку и подменяет
 * корень сайта одним переименованием, поэтому посетитель не застаёт
 * полувыложенный сайт, а удалённые из deploy/ страницы не остаются на сервере.
 *
 * Параметры берутся из .env (секретов тут нет, вход только по ключу):
 *   HOSTIMAN_SSH_HOST=ruvip72.hostiman.ru
 *   HOSTIMAN_SSH_PORT=8228
 *   HOSTIMAN_SSH_USER=s278486
 *   HOSTIMAN_SSH_KEY=C:\Users\<вы>\.ssh\dotamate_hostiman   (по умолчанию ~/.ssh/dotamate_hostiman)
 *   HOSTIMAN_WEBROOT=www/dotamate.ru                          (относительно домашней папки)
 *
 * Запуск: node tools/deploy-hostiman.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');
// Файлы Cloudflare, которым нечего делать на обычном хостинге.
const EXCLUDE = ['./worker.js', './wrangler.jsonc', './.wrangler', './.assetsignore', './_headers', './node_modules'];

function readEnv() {
  const f = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function fail(msg) { console.error('\nВыкладка не выполнена: ' + msg); process.exit(1); }

const env = Object.assign({}, readEnv(), process.env);
const host = env.HOSTIMAN_SSH_HOST || 'ruvip72.hostiman.ru';
const port = String(env.HOSTIMAN_SSH_PORT || '8228');
const user = env.HOSTIMAN_SSH_USER || 's278486';
const key = env.HOSTIMAN_SSH_KEY || path.join(os.homedir(), '.ssh', 'dotamate_hostiman');
const webroot = (env.HOSTIMAN_WEBROOT || 'www/dotamate.ru').replace(/^\/+|\/+$/g, '');
if (!/^[\w.\/-]+$/.test(webroot) || webroot.includes('..')) fail('недопустимый HOSTIMAN_WEBROOT: ' + webroot);

if (!fs.existsSync(path.join(DEPLOY, 'index.html'))) fail('в deploy/ нет index.html — сначала сборка и tools/sync-deploy.js');
if (!fs.existsSync(path.join(DEPLOY, '.htaccess'))) fail('в deploy/ нет .htaccess (заголовки безопасности) — без него не выкладываю');
// На самом хостинге (cron, DOTAMATE_SERVER=1) SSH не нужен: те же команды выполняются локально.
const LOCAL = env.DOTAMATE_SERVER === '1';
if (!LOCAL && !fs.existsSync(key)) fail('не найден SSH-ключ ' + key);

// ---------- Версия сайта: каждая выкладка = +1 ----------
// Хостинг не отдаёт Cache-Control для js/css, и браузеры держат старые скрипты при новой разметке.
// Поэтому при КАЖДОЙ выкладке номер версии растёт на 1 и пишется во все страницы deploy/:
// ко всем своим /js/*.js, /css/*.css и /security.js добавляется ?v=<версия>, в <head> — <meta name="dotamate-version">,
// в корень — version.json. Счётчик живёт на сервере (~/dotamate-data/site-version.json), поэтому выкладка — только
// с сервера (DOTAMATE_SERVER=1): с рабочего компьютера счётчик и данные разошлись бы с сайтом.
if (!LOCAL && !process.argv.includes('--from-pc')) fail('выкладка только с сервера: сначала node tools/push-server.js, затем на сервере ' +
  'DOTAMATE_SERVER=1 node build-pages.js && node tools/sync-deploy.js && node tools/deploy-hostiman.js (см. claude/versiya-sayta.md в проекте)');
const VERSION_FILE = path.join(os.homedir(), 'dotamate-data', 'site-version.json');
let version = 1;
try { version = (JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version || 0) + 1; } catch { /* первая выкладка с версией */ }
function stampHtml(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'data' && e.name !== 'assets') n += stampHtml(f); continue; }
    if (!e.name.endsWith('.html')) continue;
    const html = fs.readFileSync(f, 'utf8');
    let out = html.replace(/(src|href)="(\/(?:js|css)\/[\w.\/-]+\.(?:js|css)|\/security\.js)(?:\?v=[^"]*)?"/g, (m, attr, url) => `${attr}="${url}?v=${version}"`);
    out = out.replace(/<meta name="dotamate-version" content="\d*">\n?/, '');
    out = out.replace(/<head>/i, `<head>\n<meta name="dotamate-version" content="${version}">`);
    if (out !== html) { fs.writeFileSync(f, out); n++; }
  }
  return n;
}
const stamped = stampHtml(DEPLOY);
fs.writeFileSync(path.join(DEPLOY, 'version.json'), JSON.stringify({ version, deployedAt: new Date().toISOString() }));
console.log(`Версия сайта: ${version} (страниц с метками: ${stamped})`);

const tarFile = path.join(os.tmpdir(), 'dotamate-deploy-' + process.pid + '.tar');
const tarArgs = ['-cf', tarFile];
for (const e of EXCLUDE) tarArgs.push('--exclude=' + e);
tarArgs.push('-C', DEPLOY, '.');
console.log('=== Архив deploy/ ===');
let r = spawnSync('tar', tarArgs, { stdio: 'inherit' });
if (r.status !== 0) fail('tar завершился с ошибкой');
console.log('Размер архива: ' + (fs.statSync(tarFile).size / 1048576).toFixed(1) + ' МБ');

// Всё на сервере — одной командой: распаковать рядом, проверить, подменить, убрать старое.
const w = webroot, n = w + '.new', o = w + '.old';
const remote = [
  'set -e',
  `rm -rf ~/${n} ~/${o}`,
  `mkdir -p ~/${n}`,
  `tar -xf - -C ~/${n}`,
  `test -f ~/${n}/index.html && test -f ~/${n}/.htaccess`,
  `chmod 755 ~/${n}`,
  `mv ~/${w} ~/${o}`,
  `mv ~/${n} ~/${w}`,
  `rm -rf ~/${o}`,
  `echo "files: $(find ~/${w} -type f | wc -l)"`
].join(' && ');

if (LOCAL) {
  console.log('\n=== Выкладка в ~/' + webroot + ' (на сервере) ===');
  r = spawnSync('bash', ['-c', remote], { cwd: os.homedir(), stdio: [fs.openSync(tarFile, 'r'), 'inherit', 'inherit'], timeout: 15 * 60 * 1000 });
} else {
  console.log('\n=== Выкладка на ' + host + ' ===');
  // Код 255 — соединение не установилось (у владельца VPN с меняющимся выходом,
  // часть подключений обрывается на рукопожатии). Повторяем, архив читаем заново.
  const sshArgs = ['-i', key, '-p', port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
    '-o', 'StrictHostKeyChecking=accept-new', user + '@' + host, remote];
  for (let attempt = 1; attempt <= 5; attempt++) {
    r = spawnSync('ssh', sshArgs, { stdio: [fs.openSync(tarFile, 'r'), 'inherit', 'inherit'], timeout: 15 * 60 * 1000 });
    if (r.error || r.status !== 255 || attempt === 5) break;
    console.log('Соединение не установилось, попытка ' + (attempt + 1) + ' из 5 через 15 с…');
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},15000)']);
  }
}
try { fs.unlinkSync(tarFile); } catch (e) { /* временный файл, не критично */ }
if (r.error) fail((LOCAL ? 'bash' : 'ssh') + ' не запустился: ' + r.error.message);
if (r.status !== 0) fail('ssh вернул код ' + r.status + ' (если «Connection closed/timed out» — хостинг временно заблокировал IP, повторить позже)');
fs.mkdirSync(path.dirname(VERSION_FILE), { recursive: true });
fs.writeFileSync(VERSION_FILE, JSON.stringify({ version, deployedAt: new Date().toISOString() }));
console.log('Сайт обновлён: https://dotamate.ru/ — версия ' + version);
// Отпечаток выложенного кода: ежедневное обновление выкладывает только данные и сверяет код с ним
// (tools/code-fingerprint.js, tools/daily-update.js). Только на сервере — там лежит код, который собирал сайт.
if (LOCAL) {
  try { console.log('Отпечаток кода записан: ' + require('./code-fingerprint.js').record(version) + ' файлов'); }
  catch (e) { console.error('Отпечаток кода НЕ записан: ' + e.message + ' — ежедневная выкладка будет заблокирована до следующей выкладки.'); }
}
