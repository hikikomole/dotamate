#!/usr/bin/env node
// Копирует статику из корня проекта в deploy/ перед выкладкой (tools/deploy-hostiman.js).
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
const FILES = ['security.js', 'ads.txt', 'robots.txt', '_headers', 'sitemap.xml'].concat(fs.readdirSync(ROOT).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n))); // ключ IndexNow (tools/indexnow.js)
// Сырая база собранных матчей на сайт не выкладывается: она растёт до сотен
// мегабайт, а посетителю нужны только посчитанные по ней матрицы.
const SKIP_DIRS = new Set(['public-matches', 'public-matches-top', 'meta-matches', 'stats-history', 'stats-history-steam', 'steam-matches', 'steam-matches-turbo', 'data-steam', 'builds-stratz']); // builds-stratz — хранилище предметов Stratz (U5), сайт читает data/builds // data-steam — параллельный расчёт U4, на сайт не идёт

function copyDir(src, dst){
  if(!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, {recursive:true});
  let n = 0;
  for(const e of fs.readdirSync(src, {withFileTypes:true})){
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if(e.isDirectory()){ if(SKIP_DIRS.has(e.name)) continue; n += copyDir(s, d); }
    else if (!e.name.endsWith('.tmp')) { fs.copyFileSync(s, d); n++; } // .tmp — недописанный файл writeJsonAtomic
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
