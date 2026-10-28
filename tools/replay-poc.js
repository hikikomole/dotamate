#!/usr/bin/env node
// Ограниченный локальный PoC получения match details / replay salt через Dota GC.
// Пароли, токены и protobuf-ответы в логи не выводятся.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CREDENTIALS = path.join(ROOT, 'secrets', 'Steam.txt');
const MAX_MATCHES = 5;
const TIMEOUT_MS = 90000;
const MATCH_ID = /^\d{6,12}$/;

function readCredentials() {
  if (!fs.existsSync(CREDENTIALS)) throw new Error('Не найден secrets/Steam.txt');
  const lines = fs.readFileSync(CREDENTIALS, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('В secrets/Steam.txt ожидаются логин и пароль в первых двух строках');
  if (lines[0].includes('=') && lines[1].includes('=')) {
    const values = Object.fromEntries(lines.map(line => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
    }));
    const accountName = values.username || values.accountname || values.steam_user;
    const password = values.password || values.steam_pass;
    if (accountName && password) return { accountName, password };
  }
  // Несколько аккаунтов: пары строк логин/пароль подряд. Номер пары — STEAM_ACCOUNT (с 0).
  const idx = Number(process.env.STEAM_ACCOUNT || 0);
  if (!Number.isInteger(idx) || idx < 0 || lines.length < idx * 2 + 2) throw new Error('В secrets/Steam.txt нет аккаунта №' + idx);
  return { accountName: lines[idx * 2], password: lines[idx * 2 + 1], index: idx };
}

function parseIds(args) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--match' && args[i + 1]) values.push(args[++i]);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Использование: node tools/replay-poc.js --match <match_id> [--match <match_id> ...]');
      process.exit(0);
    } else throw new Error('Неизвестный аргумент: ' + args[i]);
  }
  if (!values.length || values.length > MAX_MATCHES || values.some(id => !MATCH_ID.test(id))) {
    throw new Error('Укажите от 1 до ' + MAX_MATCHES + ' корректных match_id');
  }
  return [...new Set(values)];
}

async function main() {
  const ids = parseIds(process.argv.slice(2));
  const credentials = readCredentials();
  let steamUser, Dota, client, dota, active = false, shuttingDown = false;
  try {
    steamUser = require('steam-user');
    Dota = require('@blastorg/gamecoordinator-dota-communicator').Dota;
  } catch {
    throw new Error('Зависимости PoC не установлены: выполните npm install');
  }

  client = new steamUser({ webCompatibilityMode: true, dataDirectory: path.join(ROOT, 'secrets', 'steam-session', String(credentials.index || 0)) });
  dota = new Dota(client);
  const results = new Map();

  const finish = (error) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(timer);
    try { if (client.steamID) client.logOff(); } catch {}
    try { client.disconnect(); } catch {}
    if (error) { console.error('PoC остановлен:', error.message); process.exitCode = 1; }
    else {
      for (const id of ids) {
        const response = results.get(id);
        const match = response && response.matchDetails;
        const salt = match && (match.replay_salt ?? match.replaySalt);
        const cluster = match && match.cluster;
        if (salt != null && cluster != null) {
          const dir = path.join(ROOT, 'secrets', 'replays');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ replayUrl: response.replayUrl, cluster, lobbyType: match.lobbyType ?? match.lobby_type ?? null }), { mode: 0o600 });
          console.log(id + ': salt получен, cluster=' + cluster + '; URL сохранён локально в secrets/replays');
        }
        else console.log(id + ': GC ответил без replay salt');
      }
    }
  };
  const timer = setTimeout(() => finish(new Error('истёк общий таймаут ' + TIMEOUT_MS / 1000 + ' с')), TIMEOUT_MS);
  client.once('error', err => {
    const code = err && (err.eresult ?? err.code);
    const resultName = Number.isInteger(Number(code)) && steamUser.EResult ? steamUser.EResult[Number(code)] : '';
    const name = err && err.name;
    finish(new Error((resultName ? 'Steam: ' + resultName : 'ошибка соединения или авторизации Steam') + (name ? ' (' + String(name).slice(0, 60) + ')' : '') + (code != null ? ', код ' + String(code).slice(0, 30) : '')));
  });
  client.on('loggedOn', () => {
    active = true;
    client.gamesPlayed([570], true);
  });
  client.on('steamGuard', (domain, callback, lastCodeWrong) => {
    if (!process.stdin.isTTY) return finish(new Error('Steam запросил Steam Guard код; запустите PoC из интерактивного терминала'));
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = domain ? `Введите Steam Guard код из письма на ${domain}: ` : 'Введите код мобильного Steam Guard: ';
    rl.question((lastCodeWrong ? 'Код не подошёл. ' : '') + prompt, code => {
      rl.close();
      try { callback(code.trim()); }
      catch { finish(new Error('не удалось передать Steam Guard код')); }
    });
  });
  dota.customEvents.once('connectedToGc', async () => {
    if (!active || shuttingDown) return;
    try {
      for (const id of ids) {
        const response = await dota.getMatchDetails(id);
        results.set(id, response);
      }
      finish();
    } catch {
      finish(new Error('Game Coordinator не вернул детали одного из матчей; ответ скрыт'));
    }
  });
  client.logOn({ accountName: credentials.accountName, password: credentials.password });
}

main().catch(err => { console.error('PoC не запущен:', err.message); process.exitCode = 1; });
