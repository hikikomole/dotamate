#!/usr/bin/env node
/**
 * Запуск обновления сайта на сервере вне расписания («Обновить всё.cmd»).
 * Обновление идёт на хостинге (~/dotamate-src), компьютер можно выключить сразу
 * после запуска. Ход работы: node tools/server-update.js --log
 */
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const key = process.env.HOSTIMAN_SSH_KEY || path.join(os.homedir(), '.ssh', 'dotamate_hostiman');
const target = (process.env.HOSTIMAN_SSH_USER || 's278486') + '@' + (process.env.HOSTIMAN_SSH_HOST || 'ruvip72.hostiman.ru');
const showLog = process.argv.includes('--log');

const remote = showLog
  ? "grep -a '^\\[' ~/dotamate-src/logs/cron.log | tail -n 25"
  : 'if pgrep -f "tools/daily-update.js" >/dev/null; then echo "Обновление уже идёт на сервере."; exit 0; fi; '
    + 'cd ~/dotamate-src && DOTAMATE_SERVER=1 setsid -f /usr/bin/node tools/daily-update.js >> logs/cron.log 2>&1 < /dev/null; '
    + 'sleep 2; echo "Обновление запущено на сервере. Займёт 1–3 часа, компьютер можно выключить."';

for (let attempt = 1; attempt <= 6; attempt++) {
  const r = spawnSync('ssh', ['-i', key, '-p', process.env.HOSTIMAN_SSH_PORT || '8228', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=20', target, remote], { stdio: 'inherit', timeout: 120000 });
  if (r.status !== 255) process.exit(r.status || 0);
  console.log('Нет соединения с сервером, попытка ' + (attempt + 1) + ' из 6…');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},10000)']);
}
console.log('Не удалось подключиться к серверу. Проверьте интернет или VPN и повторите.');
process.exit(1);
