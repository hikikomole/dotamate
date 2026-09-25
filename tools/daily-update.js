#!/usr/bin/env node
/**
 * Ежедневное обновление dotamate.ru одной командой.
 *
 * Заменяет четыре ручных запуска: «Собрать матчи», «Собрать META»,
 * «Обновить способности», «Обновить сайт». Порядок:
 *   1. Публичные матчи OpenDota (сырьё для матриц и кандидатов META).
 *   2. Детали матчей Stratz для META + пересборка витрины META.
 *   3. Способности героев — только когда снимок устарел (сам скрипт следит
 *      за сроком), или всегда с флагом --force-abilities.
 *   4. Матрицы и калибровка по свежей базе.
 *   4a. Контрпики (data/hero-counters.json) и страницы, которые их показывают:
 *       герои, гайды героев, статьи /guide/. Все цифры контрпиков на сайте —
 *       из одного расчёта, поэтому пересобираются вместе.
 *   5. Раскладка в deploy/ и ОДИН wrangler deploy на всё.
 *
 * Сбои сбора не останавливают выкладку: пропуски лента доберёт завтра, а
 * пересчёт идёт по тому, что уже есть. Сбой пересчёта — останавливает.
 *
 * Флаги:
 *   --auto              запуск из планировщика: пропуск, если сегодня уже
 *                       было успешное обновление.
 *   --force-abilities   обновить способности, даже если срок не подошёл.
 *   --no-deploy         всё пересчитать, но не выкатывать.
 *
 * Журнал: logs/daily-ГГГГ-ММ-ДД.log, отметка успеха: logs/last-success.txt.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');
const LOGS = path.join(ROOT, 'logs');
const LOCK = path.join(LOGS, 'daily.lock');
const STAMP = path.join(LOGS, 'last-success.txt');
const ARGS = new Set(process.argv.slice(2));
const IS_WIN = process.platform === 'win32';
const HOUR = 3600000;

fs.mkdirSync(LOGS, { recursive: true });
const today = new Date().toLocaleDateString('sv-SE'); // ГГГГ-ММ-ДД по местному времени
const logFile = fs.createWriteStream(path.join(LOGS, `daily-${today}.log`), { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${msg}`;
  console.log(line);
  logFile.write(line + '\n');
}

function readEnv() {
  const env = Object.assign({}, process.env);
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return env;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// Токены из .env не должны попасть в журнал даже в тексте ошибки.
const SECRETS = Object.entries(readEnv())
  .filter(([k, v]) => /TOKEN|SECRET|KEY|PASS/i.test(k) && v && v.length >= 8)
  .map(([, v]) => v);
function scrub(s) {
  for (const v of SECRETS) s = s.split(v).join('***');
  return s.replace(/(ghp_|github_pat_)[A-Za-z0-9_]+/g, '$1***').replace(/\/\/[^/@\s]+@/g, '//***@');
}

function run(title, cmd, args, opts = {}) {
  return new Promise(resolve => {
    log(`=== ${title} ===`);
    const t0 = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: opts.env || process.env,
      shell: !!opts.shell,
      windowsHide: true
    });
    const pipe = (src, dst) => src.on('data', d => { const s = scrub(d.toString()); dst.write(s); logFile.write(s); });
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    const timer = setTimeout(() => {
      log(`Шаг «${title}» идёт дольше ${Math.round(opts.timeout / 60000)} мин — останавливаю.`);
      child.kill();
    }, opts.timeout || HOUR);
    child.on('error', e => log(`Не удалось запустить: ${e.message}`));
    child.on('close', code => {
      clearTimeout(timer);
      log(`«${title}»: ${code === 0 ? 'ок' : 'код ' + code}, ${Math.round((Date.now() - t0) / 60000)} мин.`);
      resolve(code === 0);
    });
  });
}
const node = (title, script, args = [], opts = {}) => run(title, process.execPath, [script, ...args], opts);

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    // Замок старше 6 часов — остался от выключенного посреди работы компьютера.
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age > 6 * HOUR) { fs.unlinkSync(LOCK); return acquireLock(); }
    return false;
  }
}

function findGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch { /* нет в PATH */ }
  const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('app-')).sort().reverse()) {
      const g = path.join(base, d, 'resources', 'app', 'git', 'cmd', 'git.exe');
      if (fs.existsSync(g)) return g;
    }
  }
  return null;
}

// Незакоммиченные правки кода в deploy/ (не данных) без присмотра не выкатываем:
// вместе с данными на сайт уехала бы чья-то недоделанная работа.
// Страницы, которые ежедневное обновление само пересобирает из данных.
// Их незакоммиченные изменения — ожидаемый результат прошлых запусков,
// а не чужие правки, поэтому проверка deploy/ их пропускает.
const GENERATED_DEPLOY = ['deploy/data/', 'deploy/hero/', 'deploy/guide/'];

function foreignDeployChanges() {
  const git = findGit();
  if (!git) return null;
  const out = execFileSync(git, ['status', '--porcelain', '--', 'deploy'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter(l => { const f = l.slice(3).replace(/^"/, ''); return !GENERATED_DEPLOY.some(p => f.startsWith(p)); });
}

// sync-deploy только добавляет файлы; старые страницы матчей META убираем сами.
function pruneMetaMatches() {
  const src = path.join(ROOT, 'data', 'meta-match');
  const dst = path.join(DEPLOY, 'data', 'meta-match');
  if (!fs.existsSync(src) || !fs.existsSync(dst)) return;
  const keep = new Set(fs.readdirSync(src));
  let n = 0;
  for (const f of fs.readdirSync(dst)) if (!keep.has(f)) { fs.unlinkSync(path.join(dst, f)); n++; }
  if (n) log(`Убрано устаревших матчей META из deploy: ${n}.`);
}

async function abilities() {
  const file = path.join(ROOT, 'data', 'hero-abilities.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const args = ARGS.has('--force-abilities') ? ['--force'] : [];
  if (!await node('Способности героев', 'tools/fetch-hero-abilities.js', args, { timeout: 0.25 * HOUR })) return;
  const after = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!after || (before && before.equals(after))) return; // срок не подошёл — файл не менялся
  if (!await node('Проверка способностей', 'tools/check-hero-abilities.js')) {
    if (before) fs.writeFileSync(file, before);
    log('Новый снимок способностей не прошёл проверку — возвращён прежний.');
    return false;
  }
  return true; // снимок обновлён, после выкладки сохраним в GitHub
}

async function main() {
  if (ARGS.has('--auto') && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === today) {
    console.log('Сегодня сайт уже обновлён — пропускаю.');
    return 0;
  }
  if (!acquireLock()) { log('Обновление уже идёт в другом окне — пропускаю.'); return 0; }
  const problems = [];
  try {
    log(`Начало ежедневного обновления (${ARGS.has('--auto') ? 'по расписанию' : 'вручную'}).`);

    // Сначала свежие матчи (хвост ленты до прошлого захода), история — на
    // остаток дневного лимита. Раньше весь лимит уходил в --back, и база
    // застыла на одних сутках.
    if (!await node('Сбор свежих публичных матчей (OpenDota)', 'tools/collect-public-matches.js', [], { timeout: 2 * HOUR }))
      problems.push('сбор матчей');
    await node('Докачка истории (OpenDota)', 'tools/collect-public-matches.js', ['--back', '1800'], { timeout: 2 * HOUR });
    await node('Состояние базы матчей', 'tools/collect-public-matches.js', ['--stats']);

    // 8000 запросов ≈ 1800 матчей в сутки (Stratz знает ~каждый четвёртый наш
    // матч) — на них держится выборка покупок у редких героев. Лимит Stratz
    // 15 000 в сутки, остальным сборщикам остаётся запас.
    if (!await node('Сбор деталей для META (Stratz)', 'tools/collect-meta-matches.js', ['--max', '8000'], { timeout: 2 * HOUR }))
      problems.push('сбор META');
    // Матчи, собранные до того, как сборщик начал сохранять покупки. Когда
    // таких нет, шаг ничего не запрашивает.
    await node('Покупки для старых матчей (Stratz)', 'tools/collect-meta-matches.js', ['--backfill', '--max', '2000'], { timeout: 0.5 * HOUR });
    if (!await node('Витрина META', 'tools/build-meta.js')) problems.push('витрина META');
    // Реальные покупки предметов в карточке героя. Сбой не останавливает
    // выкладку: на сайте остаётся прошлый data/hero-items.json.
    if (!await node('Покупки предметов по своей базе', 'tools/build-hero-items.js')) problems.push('покупки предметов');

    // Роли 1–5 и билды (Stratz, Divine/Immortal) — до пересборки страниц героев,
    // чтобы страница и карточка героя показывали один срез. Сбой оставляет
    // вчерашний снимок.
    if (!await node('Роли героев (Stratz)', 'fetch-hero-positions.js', [], { timeout: 0.25 * HOUR })) problems.push('роли героев');
    if (!await node('Билды героев (Stratz)', 'fetch-hero-builds.js', [], { timeout: 0.75 * HOUR })) problems.push('билды героев');

    const abil = await abilities();
    if (abil === false) problems.push('способности');

    // Без пересчёта матриц выкатывать нечего — здесь ошибка останавливает всё.
    if (!await node('Матрицы по своей базе', 'tools/build-our-stats.js')) throw new Error('матрицы не пересчитались');
    if (!await node('Калибровка прогноза', 'tools/build-draft-calibration.js')) throw new Error('калибровка не прошла');

    // Контрпики и страницы с ними. Сбой здесь не ломает выкладку: на сайте
    // остаются вчерашние контрпики, а матрицы и META уедут свежими.
    if (await node('Контрпики по своей базе', 'tools/build-hero-counters.js')) {
      if (!await node('Страницы героев', 'build-hero-pages.js', [], { timeout: 0.5 * HOUR })) problems.push('страницы героев');
      if (!await node('Гайды героев', 'build-hero-guides.js')) problems.push('гайды героев');
      if (!await node('Статьи', 'build-guide-pages.js')) problems.push('статьи');
    } else problems.push('контрпики');

    // Раздел «Статистика и аналитика» и ежедневный снимок для динамики.
    if (!await node('Статистика и аналитика', 'tools/build-stats.js')) problems.push('статистика');

    if (ARGS.has('--no-deploy')) { log('Флаг --no-deploy: выкладку пропускаю.'); return problems.length ? 1 : 0; }

    const foreign = foreignDeployChanges();
    if (foreign === null) throw new Error('не найден git — не могу проверить deploy/ на чужие правки');
    if (foreign.length) throw new Error('в deploy/ незакоммиченные правки кода, выкладка отменена:\n  ' + foreign.slice(0, 10).join('\n  '));

    if (!await node('Раскладка в deploy', 'tools/sync-deploy.js')) throw new Error('раскладка в deploy не прошла');
    pruneMetaMatches();

    const env = readEnv();
    if (!env.CLOUDFLARE_API_TOKEN) throw new Error('в .env нет CLOUDFLARE_API_TOKEN');
    if (!await run('Выкладка на dotamate.ru', 'npx', ['wrangler', 'deploy'], { cwd: DEPLOY, env, shell: IS_WIN, timeout: 0.25 * HOUR }))
      throw new Error('wrangler deploy завершился с ошибкой (чаще всего истёк токен Cloudflare)');

    if (abil === true) {
      await node('Проверка способностей на сайте', 'tools/verify-live-abilities.js');
      await node('Сохранение способностей в GitHub', 'tools/push-abilities.js');
    }

    fs.writeFileSync(STAMP, today);
    log(problems.length
      ? `Сайт обновлён, но с пропусками: ${problems.join(', ')}. Недобранное доберётся завтра.`
      : 'Готово: сайт обновлён полностью.');
    return 0;
  } catch (e) {
    log('ОШИБКА: ' + scrub(e.message) + '\nСайт остался в прежнем виде. Следующая попытка — при следующем запуске.');
    return 1;
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* уже нет */ }
  }
}

main().then(code => logFile.end(() => process.exit(code)));
