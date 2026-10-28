#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Dota } = require('@blastorg/gamecoordinator-dota-communicator');
const SteamUser = require('steam-user');
const { normalize } = require('./replay/gc-normalize');
const accounts = require('./replay/gc-accounts');
const ROOT = path.join(__dirname, '..');
const DATA = process.env.DOTAMATE_DATA || path.join(os.homedir(), 'dotamate-data');
const QUEUE = path.join(DATA, 'cache', 'steam', 'gc-queue');
const CACHE = path.join(DATA, 'cache', 'steam', 'm');
const LOCK = path.join(QUEUE, 'worker.lock');
const IDLE_MS = Math.max(0, Number(process.env.DOTAMATE_GC_IDLE_MS ?? 600000) || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function atomic(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(temp, data, { mode: 0o600 }); fs.renameSync(temp, file); }
function credentials(i) { const lines = fs.readFileSync(path.join(ROOT, 'secrets', 'Steam.txt'), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean); return { accountName: lines[i * 2], password: lines[i * 2 + 1] }; }
function connect(i) {
  return new Promise((resolve, reject) => {
    const client = new SteamUser({ webCompatibilityMode: true, dataDirectory: path.join(ROOT, 'secrets', 'steam-session', String(i)) });
    const dota = new Dota(client); let done = false;
    const fail = kind => { if (done) return; done = true; try { client.disconnect(); } catch {} reject(new Error(kind)); };
    const timer = setTimeout(() => fail('gc_unavailable'), 45000);
    client.once('error', () => fail('gc_unavailable'));
    client.on('steamGuard', () => { accounts.guard(i); fail('guard'); });
    client.once('loggedOn', () => client.gamesPlayed([570], true));
    dota.customEvents.once('connectedToGc', () => { if (done) return; done = true; clearTimeout(timer); resolve({ client, dota }); });
    client.logOn(credentials(i));
  });
}
function nextJob() {
  for (const name of fs.readdirSync(QUEUE)) if (/^\d+\.processing$/.test(name)) {
    const file = path.join(QUEUE, name);
    if (Date.now() - fs.statSync(file).mtimeMs > 120000) fs.renameSync(file, file.replace('.processing', '.job'));
  }
  const jobs = fs.readdirSync(QUEUE).filter(n => /^\d+\.job$/.test(n)).map(n => ({ n, t: fs.statSync(path.join(QUEUE, n)).mtimeMs })).sort((a, b) => a.t - b.t);
  for (const { n } of jobs) { const from = path.join(QUEUE, n), to = from.replace('.job', '.processing'); try { fs.renameSync(from, to); return { id: n.slice(0, -4), file: to }; } catch {} }
  return null;
}
async function main() {
  fs.mkdirSync(QUEUE, { recursive: true });
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); } catch { return; }
  let client;
  try {
    let job = nextJob(); if (!job) return;
    const account = accounts.reserve();
    if (account === null) { fs.renameSync(job.file, job.file.replace('.processing', '.job')); return; }
    let dota;
    try { ({ client, dota } = await connect(account)); } catch (e) {
      atomic(path.join(QUEUE, job.id + '.fail'), e.message === 'guard' ? 'gc_unavailable' : 'gc_unavailable'); fs.unlinkSync(job.file); return;
    }
    let emptySince = Date.now(); let first = true;
    while (true) {
      if (!job) { if (Date.now() - emptySince > IDLE_MS) break; await sleep(2500); job = nextJob(); continue; }
      emptySince = Date.now();
      if (!first && !accounts.reserveSpecific(account)) { fs.renameSync(job.file, job.file.replace('.processing', '.job')); break; }
      first = false;
      const start = Date.now(); let result = 'gc_unavailable';
      try {
        const response = await Promise.race([dota.getMatchDetails(job.id), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))]);
        const cache = normalize(response.matchDetails, job.id);
        atomic(path.join(CACHE, job.id + '.json'), JSON.stringify(cache));
        if (response.matchDetails.replaySalt != null && response.matchDetails.cluster != null) atomic(path.join(ROOT, 'secrets', 'replays', job.id + '.json'), JSON.stringify({ replayUrl: response.replayUrl, cluster: response.matchDetails.cluster, lobbyType: cache.lobbyType }));
        result = 'ok';
      } catch (e) { result = e.message === 'not_found' ? 'not_found' : 'gc_unavailable'; atomic(path.join(QUEUE, job.id + '.fail'), result); }
      fs.unlinkSync(job.file); console.log(job.id, Date.now() - start + 'ms', result);
      await sleep(1500); job = nextJob();
    }
  } finally { try { if (client) client.logOff(); } catch {} try { fs.unlinkSync(LOCK); } catch {} }
}
main().catch(() => { console.error('match GC worker unavailable'); process.exitCode = 1; });
