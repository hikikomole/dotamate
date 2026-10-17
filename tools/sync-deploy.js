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
const FILES = ['security.js', 'ads.txt', 'robots.txt', 'favicon.ico', 'sitemap.xml'].concat(fs.readdirSync(ROOT).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n))); // ключ IndexNow (tools/indexnow.js)
// Сырая база собранных матчей на сайт не выкладывается: она растёт до сотен
// мегабайт, а посетителю нужны только посчитанные по ней матрицы.
const SKIP_DIRS = new Set(['public-matches', 'public-matches-top', 'meta-matches', 'stats-history', 'stats-history-steam', 'steam-matches', 'steam-matches-turbo', 'data-steam', 'builds-stratz', 'sitemap-state']); // builds-stratz — хранилище предметов Stratz (U5), сайт читает data/builds // data-steam — параллельный расчёт U4, на сайт не идёт

// Файл с тем же содержимым не перезаписывается: иначе дата изменения сдвигается при каждой выкладке, tar переносит её
// на сайт, ETag у nginx (из даты и размера) меняется — и браузер заново скачивает все картинки и шрифты (замер 15.10.2026).
let same = 0;
function copyIfChanged(s, d){ try { const a = fs.statSync(d); if (a.size === fs.statSync(s).size && fs.readFileSync(d).equals(fs.readFileSync(s))) { same++; return; } } catch { /* нет файла — копируем */ } fs.copyFileSync(s, d); }

function copyDir(src, dst){
  if(!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, {recursive:true});
  let n = 0;
  for(const e of fs.readdirSync(src, {withFileTypes:true})){
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if(e.isDirectory()){ if(SKIP_DIRS.has(e.name)) continue; n += copyDir(s, d); }
    else if (!e.name.endsWith('.tmp')) { copyIfChanged(s, d); n++; } // .tmp — недописанный файл writeJsonAtomic
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
  if(fs.existsSync(s)){ copyIfChanged(s, path.join(OUT, f)); total++; console.log(`${f}`); }
}
// Файлы верхнего уровня deploy/data, которых больше нет в data/ (сборщик выведен из работы), на сайт не идут:
// иначе устаревший файл публикуется вечно. Папки (builds, meta-match …) не трогаем.
let removed = 0;
const dd = path.join(OUT, 'data');
// Только в deploy/data, без пары в data/, живут запасные справочники PHP-API (deploy/api/index.php constantsMap:
// /api/dota/hero/<имя>/abilities, когда OpenDota недоступна) — их не трогаем (v90 их убрал по ошибке, v91 вернул).
const DEPLOY_ONLY = new Set(['abilities.json', 'hero_abilities.json']);
if (fs.existsSync(dd)) for (const e of fs.readdirSync(dd, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith('.json') && !DEPLOY_ONLY.has(e.name) && !fs.existsSync(path.join(ROOT, 'data', e.name))) { fs.unlinkSync(path.join(dd, e.name)); removed++; console.log('убран из deploy/data: ' + e.name); }
}
console.log(`Итого скопировано: ${total} (без изменений, не перезаписаны: ${same})${removed ? ', убрано устаревших: ' + removed : ''}`);
