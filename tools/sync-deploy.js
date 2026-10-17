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
    if(e.isDirectory()){ if(SKIP_DIRS.has(e.name) || e.name === 'ingame-guides' || /^ingame-guides\.(tmp-.*|old)$/.test(e.name)) continue; n += copyDir(s, d); } // недособранная публикация внутриигровых гайдов
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
// Внутриигровые гайды (tools/build-ingame-guides.js --publish): набор файлов меняется (герой ушёл ниже порога — гайда нет),
// поэтому deploy/data/ingame-guides повторяет data/ingame-guides точно — лишние .build и manifest не остаются.
const ig = path.join(dd, 'ingame-guides'), igSrc = path.join(ROOT, 'data', 'ingame-guides');
let igCopied = 0, igRemoved = 0;
try {
  if (fs.existsSync(igSrc)) {
    let dst; try { dst = fs.lstatSync(ig); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (dst?.isSymbolicLink()) throw new Error('deploy/data/ingame-guides — симлинк, пропущен');
    fs.mkdirSync(ig, {recursive:true});
    const entries = fs.readdirSync(igSrc, {withFileTypes:true}), names = new Set(entries.map(e => e.name));
    for (const n of [...entries.filter(e => e.isFile() && e.name.endsWith('.build')).map(e => e.name), 'manifest.json']) {
      const d = path.join(ig, n);
      let st; try { st = fs.lstatSync(d); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (st && !st.isFile()) throw new Error('не обычный файл: ' + d);
      const before = same; copyIfChanged(path.join(igSrc, n), d); total++; if (same === before) igCopied++;
    }
    for (const e of fs.readdirSync(ig, {withFileTypes:true})) {
      if (e.isFile() && !names.has(e.name)) { fs.unlinkSync(path.join(ig, e.name)); igRemoved++; removed++; }
    }
  }
} catch (e) { console.warn('внутриигровые гайды не обновлены: ' + e.message); }
console.log(`Внутриигровые гайды: скопировано ${igCopied}, удалено ${igRemoved}`);
console.log(`Итого скопировано: ${total} (без изменений, не перезаписаны: ${same})${removed ? ', убрано устаревших: ' + removed : ''}`);
