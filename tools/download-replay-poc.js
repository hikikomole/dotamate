#!/usr/bin/env node
// Скачать один реплей для локальной проверки парсера. Временный файл хранится в secrets/replays.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'secrets', 'replays');
const MATCH_ID = /^\d{6,12}$/;
const MAX_BYTES = 512 * 1024 * 1024;

async function main() {
  const id = process.argv[2];
  if (!id || !MATCH_ID.test(id) || process.argv.length !== 3) {
    throw new Error('Использование: node tools/download-replay-poc.js <match_id>');
  }
  const meta = path.join(OUT, id + '.json');
  if (!fs.existsSync(meta)) throw new Error('Сначала получите replay URL командой replay:poc и сохраните его в локальном meta-файле');
  const info = JSON.parse(fs.readFileSync(meta, 'utf8'));
  const url = new URL(info.replayUrl);
  // Китайские кластеры Valve отдают реплеи с другого домена (так же делает odota/core buildReplayUrl).
  if ([413, 415, 417].includes(Number(info.cluster))) url.hostname = url.hostname.replace(/\.valve\.net$/, '.dota2.com.cn');
  if (url.protocol !== 'http:' || !/^replay\d+\.(valve\.net|dota2\.com\.cn)$/.test(url.hostname) || !url.pathname.endsWith('.dem.bz2')) {
    throw new Error('Некорректный адрес реплея');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const partial = path.join(OUT, id + '.download.part');
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'error' }); }
  catch (error) { throw new Error('сетевая ошибка (' + String(error.cause?.code || error.name || 'unknown').slice(0, 60) + ')'); }
  if (!response.ok || !response.body) throw new Error('Сервер реплеев вернул HTTP ' + response.status);
  const max = new Transform({ transform(chunk, enc, cb) {
    this.bytes = (this.bytes || 0) + chunk.length;
    cb(this.bytes > MAX_BYTES ? new Error('Реплей превышает лимит 512 МБ') : null, chunk);
  }});
  try {
    await pipeline(response.body, max, fs.createWriteStream(partial, { flags: 'wx' }));
    const fd = fs.openSync(partial, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    const isBzip2 = magic[0] === 0x42 && magic[1] === 0x5a && magic[2] === 0x68 && magic[3] >= 0x31 && magic[3] <= 0x39;
    const isZstd = magic[0] === 0x28 && magic[1] === 0xb5 && magic[2] === 0x2f && magic[3] === 0xfd;
    if (!isBzip2 && !isZstd) throw new Error('Неизвестная сигнатура ответа replay-сервера');
    const target = path.join(OUT, id + (isZstd ? '.dem.zst' : '.dem.bz2'));
    try { fs.unlinkSync(target); } catch {}
    fs.renameSync(partial, target);
    console.log('Реплей сохранён: secrets/replays/' + path.basename(target) + ' (' + fs.statSync(target).size + ' байт; ' + (isZstd ? 'Zstandard' : 'bzip2') + ')');
  } catch (error) {
    try { fs.unlinkSync(partial); } catch {}
    throw error;
  }
}

main().catch(error => { console.error('Скачать реплей не удалось:', error.message); process.exitCode = 1; });
