#!/usr/bin/env node
// Поточная локальная распаковка Zstandard replay для проверки демо и Clarity.
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'secrets', 'replays');
const MAX_OUTPUT = 2 * 1024 * 1024 * 1024;

async function main() {
  const id = process.argv[2];
  if (!id || !/^\d{6,12}$/.test(id) || process.argv.length !== 3) throw new Error('Использование: node tools/decompress-replay-poc.js <match_id>');
  const input = path.join(DIR, id + '.dem.zst');
  const partial = path.join(DIR, id + '.dem.part');
  const output = path.join(DIR, id + '.dem');
  if (!fs.existsSync(input)) throw new Error('Не найден Zstandard replay ' + path.basename(input));
  const meter = new Transform({ transform(chunk, enc, cb) {
    this.bytes = (this.bytes || 0) + chunk.length;
    cb(this.bytes > MAX_OUTPUT ? new Error('Распакованный файл превысил лимит 2 ГБ') : null, chunk);
  }});
  try {
    await pipeline(fs.createReadStream(input), zlib.createZstdDecompress(), meter, fs.createWriteStream(partial, { flags: 'wx' }));
    const fd = fs.openSync(partial, 'r');
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);
    if (header.toString('ascii', 0, 4) !== 'PBDE') throw new Error('Распакованный поток не начинается с заголовка Dota demo (PBDE)');
    try { fs.unlinkSync(output); } catch {}
    fs.renameSync(partial, output);
    console.log('Демо распаковано: secrets/replays/' + path.basename(output) + ' (' + fs.statSync(output).size + ' байт)');
  } catch (error) {
    try { fs.unlinkSync(partial); } catch {}
    throw error;
  }
}

main().catch(error => { console.error('Распаковка не удалась:', error.message); process.exitCode = 1; });
