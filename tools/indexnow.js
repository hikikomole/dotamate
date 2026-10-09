#!/usr/bin/env node
/*
 * IndexNow: сообщает Яндексу и Bing (и другим участникам протокола) об изменённых страницах dotamate.ru.
 * Ключ — публичный файл <ключ>.txt в корне сайта (так требует протокол, это не секрет); выкладывается sync-deploy.js.
 * Запуск (на сервере, после выкладки):
 *   node tools/indexnow.js                 — все адреса из sitemap.xml
 *   node tools/indexnow.js /live/ /        — только перечисленные адреса
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const HOST = 'dotamate.ru';
const ENDPOINTS = ['https://yandex.com/indexnow', 'https://api.indexnow.org/IndexNow'];

function findKey() {
  const f = fs.readdirSync(ROOT).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) throw new Error('нет файла ключа <32 hex>.txt в корне проекта');
  const key = fs.readFileSync(path.join(ROOT, f), 'utf8').trim();
  if (key + '.txt' !== f) throw new Error('содержимое файла ключа не совпадает с его именем');
  return key;
}
function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}
function post(endpoint, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request(endpoint, { method: 'POST', timeout: 30000, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text: text.slice(0, 200) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, text: e.message }));
    req.end(data);
  });
}
(async () => {
  const key = findKey();
  const args = process.argv.slice(2);
  let urls = args.length ? args.map((a) => (a.startsWith('http') ? a : 'https://' + HOST + a)) : urlsFromSitemap();
  urls = [...new Set(urls)].filter((u) => new URL(u).host === HOST);
  if (!urls.length) { console.error('нет адресов'); process.exit(1); }
  // Протокол: до 10 000 адресов за запрос.
  let failed = false;
  for (const ep of ENDPOINTS) {
    for (let i = 0; i < urls.length; i += 10000) {
      const r = await post(ep, { host: HOST, key, keyLocation: 'https://' + HOST + '/' + key + '.txt', urlList: urls.slice(i, i + 10000) });
      const ok = r.status === 200 || r.status === 202;
      if (!ok) failed = true;
      console.log(ep, 'адресов', Math.min(10000, urls.length - i), '→ HTTP', r.status, ok ? 'принято' : r.text);
    }
  }
  process.exit(failed ? 1 : 0);
})();
