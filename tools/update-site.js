#!/usr/bin/env node
/**
 * Одна команда «пересчитать и выкатить» после пополнения базы матчей.
 *
 * Порядок важен: сначала матрицы по новой базе, потом калибровка (она должна
 * считаться на тех же данных, иначе коэффициент будет от вчерашней матрицы),
 * потом раскладка файлов в deploy/ и деплой воркера.
 *
 * Запуск:  node tools/update-site.js   (или «Обновить сайт.cmd»)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');

function step(title, cmd, args, opts) {
  console.log('\n=== ' + title + ' ===');
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: process.platform === 'win32' }, opts || {}));
  if (r.status !== 0) {
    console.error('\nШаг «' + title + '» завершился с ошибкой. Дальше не иду, чтобы не выкатить полуфабрикат.');
    process.exit(1);
  }
}

function readEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return {};
  const out = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

step('Матрицы по своей базе', 'node', ['tools/build-our-stats.js'], { cwd: ROOT });
step('Калибровка прогноза', 'node', ['tools/build-draft-calibration.js'], { cwd: ROOT });
step('Контрпики по своей базе', 'node', ['tools/build-hero-counters.js'], { cwd: ROOT });
step('Страницы героев', 'node', ['build-hero-pages.js'], { cwd: ROOT });
step('Гайды героев', 'node', ['build-hero-guides.js'], { cwd: ROOT });
step('Статьи', 'node', ['build-guide-pages.js'], { cwd: ROOT });
step('Раскладка файлов в deploy', 'node', ['tools/sync-deploy.js'], { cwd: ROOT });

const env = readEnv();
if (!env.CLOUDFLARE_API_TOKEN) {
  console.error('\nВ .env нет CLOUDFLARE_API_TOKEN — деплой пропускаю.');
  console.error('Данные пересчитаны и разложены, выкатить можно вручную из папки deploy.');
  process.exit(1);
}
step('Деплой на Cloudflare', 'npx', ['wrangler', 'deploy'], {
  cwd: DEPLOY,
  env: Object.assign({}, process.env, env)
});

const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'draft-calibration.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'our-meta.json'), 'utf8'));
console.log('\n=== Готово ===');
console.log('Матчей в срезе: ' + meta.matchesUsed.toLocaleString('ru-RU'));
console.log('Коэффициент калибровки: ' + cal.alpha);
console.log('Угадано исходов на проверке: ' + cal.testAccuracy + '%  (log loss ' + cal.testLogLoss + ' против ' + cal.baselineLogLoss + ')');
console.log('Сайт обновлён.');
