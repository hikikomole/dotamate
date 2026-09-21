#!/usr/bin/env node
// Копирует статику из корня проекта в deploy/ перед `wrangler deploy`.
//
// Зачем: wrangler выкатывает ровно содержимое deploy/ (см. wrangler.jsonc,
// assets.directory = "./"). HTML туда пишут сборщики страниц, а css, js,
// картинки, data и мелкие файлы в корне раньше копировались руками — и
// расходились. Так, например, в deploy/ однажды не доехали новые картинки
// логотипа, а theme-dark.css отставал на версию.
//
// Запускать последним в цепочке сборки, прямо перед деплоем:
//   node build-pages.js && node build-item-pages.js && ... && node tools/sync-deploy.js
//
// Ничего не удаляет: только добавляет и перезаписывает.

const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'deploy');
const DIRS = ['css', 'js', 'assets', 'data'];
const FILES = ['security.js', 'ads.txt', 'robots.txt', '_headers', 'sitemap.xml'];

function copyDir(src, dst){
  if(!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, {recursive:true});
  let n = 0;
  for(const e of fs.readdirSync(src, {withFileTypes:true})){
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if(e.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

let total = 0;
for(const d of DIRS){
  const n = copyDir(path.join(ROOT, d), path.join(OUT, d));
  console.log(`${d}/: ${n} файлов`);
  total += n;
}
for(const f of FILES){
  const s = path.join(ROOT, f);
  if(fs.existsSync(s)){ fs.copyFileSync(s, path.join(OUT, f)); total++; console.log(`${f}`); }
}
console.log(`Итого скопировано: ${total}`);
