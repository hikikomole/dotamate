#!/usr/bin/env node
/**
 * Ежедневное обновление dotamate.ru одной командой.
 *
 * Заменяет четыре ручных запуска: «Собрать матчи», «Собрать META»,
 * «Обновить способности», «Обновить сайт». Порядок:
 *   1. Свежие публичные матчи OpenDota (ранг Steam-матчей, кандидаты Stratz) и срез Divine 5/Immortal.
 *   2. Детали матчей Stratz — малый бюджет (время покупок, линии, эталон позиций 4/5).
 *   С U5 (09.10.2026) матрица пар, турбо, калибровка, META и прокачка считаются по Steam
 *   (data/steam-matches, сбор отдельной строкой crontab — tools/collect-steam-matches.js).
 *   3. Способности героев — только когда снимок устарел (сам скрипт следит
 *      за сроком), или всегда с флагом --force-abilities.
 *   4. Матрицы и калибровка по свежей базе.
 *   4a. Контрпики (data/hero-counters.json) и страницы, которые их показывают:
 *       герои, гайды героев, статьи /guide/. Все цифры контрпиков на сайте —
 *       из одного расчёта, поэтому пересобираются вместе.
 *   5. Раскладка в deploy/ и ОДНА выкладка на Hostiman (tools/deploy-hostiman.js).
 *      Выкладываются только данные и страницы из них: на сервере код сверяется с отпечатком
 *      последней выкладки (tools/code-fingerprint.js) в начале и перед выкладкой. Код изменён
 *      (push-server без «выкладывай») — всё пересчитывается, но выкладка блокируется.
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
// С 26.09.2026 обновление идёт по cron на самом хостинге (~/dotamate-src), без компьютера владельца.
const ON_SERVER = process.env.DOTAMATE_SERVER === '1';
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
// opts.heap (МБ): предел кучи для тяжёлых шагов Steam — общий лимит памяти аккаунта на хостинге ≈ 1,5–2 ГБ (LVE, сверх — SIGKILL)
const node = (title, script, args = [], opts = {}) => run(title, process.execPath, [...(opts.heap ? ['--max-old-space-size=' + opts.heap] : []), script, ...args], opts);
const STEAM_HEAP = 1200;

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    // Замок брошен, если его процесс уже не живёт (сбой, перезагрузка); живой процесс замок держит,
    // сколько бы он ни шёл, — второй прогон параллельно не стартует. Старше 12 ч — снимаем в любом случае.
    let pid = 0; try { pid = Number(fs.readFileSync(LOCK, 'utf8')) || 0; } catch { /* пустой замок */ }
    let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (!alive || age > 12 * HOUR) { fs.unlinkSync(LOCK); return acquireLock(); }
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

// Перед раскладкой: каждый итоговый data/*.json должен читаться. Обрезанный или битый файл
// на сайт не уходит — выкладка отменяется, на сайте остаются вчерашние данные.
function checkDataJson() {
  const dir = path.join(ROOT, 'data');
  const bad = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  // и вложенные файлы, которые читает сайт: билды героев и страницы матчей META
  for (const sub of ['builds', 'meta-match']) if (fs.existsSync(path.join(dir, sub)))
    for (const f of fs.readdirSync(path.join(dir, sub)).filter(f => f.endsWith('.json'))) files.push(sub + '/' + f);
  for (const f of files) {
    try { JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { bad.push(f + ' (' + e.message.slice(0, 80) + ')'); }
  }
  if (bad.length) throw new Error('битые файлы данных, выкладка отменена: ' + bad.join(', '));
}

// Что раньше попадало в deploy/data, но на сайт идти не должно (sync-deploy только добавляет файлы):
// снимки истории /stats/ (в stats.json уходит только ряд) и недописанные .tmp.
function pruneUnpublished() {
  const hist = path.join(DEPLOY, 'data', 'stats-history-steam');
  if (fs.existsSync(hist)) { fs.rmSync(hist, { recursive: true, force: true }); log('Убраны снимки истории из deploy/data.'); }
  const dd = path.join(DEPLOY, 'data');
  if (fs.existsSync(dd)) for (const f of fs.readdirSync(dd).filter(f => f.endsWith('.tmp'))) fs.unlinkSync(path.join(dd, f));
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

// Ежедневная выкладка — только данные: код на сервере должен совпадать с последней выкладкой.
// Возвращает null (можно выкладывать) или текст причины блокировки.
function codeChanged() {
  try {
    const r = require('./code-fingerprint.js').check();
    if (r.missing) return 'нет отпечатка кода последней выкладки (' + require('./code-fingerprint.js').FILE + ').';
    if (r.ok) { log('Код совпадает с выложенной версией ' + r.recorded.version + ' — выкладка данных разрешена.'); return null; }
    return 'код на сервере изменён после выкладки версии ' + r.recorded.version + ' (' + r.changed.length + ' файлов: ' +
      r.changed.slice(0, 10).join(', ') + (r.changed.length > 10 ? ' …' : '') + ').';
  } catch (e) { return 'не удалось сверить код: ' + e.message; }
}

// Уведомление владельцу о сбое (личный чат, не публичный канал): ~/dotamate-data/telegram.env,
// TG_TOKEN и TG_ALERT_CHAT. Нет TG_ALERT_CHAT — молча ничего не делаем. Ошибки отправки не роняют
// обновление; текст ошибки не пишем в журнал — в нём может оказаться адрес с токеном.
function alertOwner(text) {
  if (!ON_SERVER) return Promise.resolve();
  let env = {};
  try {
    const f = path.join(require('os').homedir(), 'dotamate-data', 'telegram.env');
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  } catch { return Promise.resolve(); }
  if (!env.TG_TOKEN || !env.TG_ALERT_CHAT) return Promise.resolve();
  const body = JSON.stringify({ chat_id: env.TG_ALERT_CHAT, text: 'dotamate.ru: ' + scrub(text).slice(0, 3500), disable_web_page_preview: true });
  return new Promise(resolve => {
    const req = require('https').request({ hostname: 'api.telegram.org', path: '/bot' + env.TG_TOKEN + '/sendMessage', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, res => {
      res.resume(); res.on('end', () => { log(res.statusCode === 200 ? 'Уведомление владельцу отправлено.' : 'Уведомление не отправлено: HTTP ' + res.statusCode); resolve(); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => { log('Уведомление не отправлено (сеть).'); resolve(); });
    req.end(body);
  });
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
    let codeBlock = ON_SERVER ? codeChanged() : null;
    if (codeBlock) log('Внимание: ' + codeBlock + ' Данные пересчитаю, выкладку пропущу.');

    // Сначала свежие матчи (хвост ленты до прошлого захода), история — на
    // остаток дневного лимита. Раньше весь лимит уходил в --back, и база
    // застыла на одних сутках.
    if (!await node('Сбор свежих публичных матчей (OpenDota)', 'tools/collect-public-matches.js', [], { timeout: 2 * HOUR }))
      problems.push('сбор матчей');
    // С U5 (09.10.2026) основная лента OpenDota нужна только свежая: ранг Steam-матчей (--fill-ranks за 3 дня)
    // и кандидаты Stratz. Матрицы, калибровка, META и прокачка считаются по Steam — докачка истории не нужна.
    await node('Состояние базы матчей', 'tools/collect-public-matches.js', ['--stats']);
    // Верхний срез «Divine 5 и Immortal» — своя папка и свой бюджет (400 из общих 1800 запросов
    // OpenDota). Сбой не останавливает обновление: основной срез от него не зависит.
    if (!await node('Сбор матчей Divine 5 / Immortal (OpenDota)', 'tools/collect-public-matches.js', ['--tier', 'top'], { timeout: HOUR }))
      problems.push('сбор верхнего среза');
    await node('Докачка истории Divine 5 / Immortal', 'tools/collect-public-matches.js', ['--tier', 'top', '--back', '400'], { timeout: HOUR });

    // Роли 1–5 и билды (Stratz, Divine/Immortal) — ДО деталей матчей: детали выбирают лимит Stratz до 429,
    // и шедшие после них роли/билды падали во всех запусках с 25.09 по 09.10.2026. Должны быть до пересборки страниц героев,
    // чтобы страница и карточка героя показывали один срез. Сбой оставляет
    // вчерашний снимок.
    if (!await node('Роли героев (Stratz)', 'fetch-hero-positions.js', [], { timeout: 0.25 * HOUR })) problems.push('роли героев');
    if (!await node('Роли по рангам (Stratz)', 'tools/fetch-rank-positions.js', [], { timeout: 0.1 * HOUR })) problems.push('роли по рангам');
    // Stratz пишет в data/builds-stratz/ (предметы по времени); data/builds/ для сайта — прокачка и таланты Steam
    // по позициям модели U2 + предметы Stratz (fetch-hero-builds.js --source steam --site).
    if (!await node('Предметы билдов (Stratz)', 'fetch-hero-builds.js', [], { timeout: 0.75 * HOUR })) problems.push('предметы билдов');

    // Stratz с U5 — малый бюджет: время покупок, линии, эталон позиций 4/5 (разметка Steam-матчей).
    // Запуск 04:17 берёт до 2000 матчей. Запуск 10:17 — страховка: при успехе утром он пропускается
    // (--auto, logs/last-success.txt), а после утреннего фатального сбоя (стоп без выкладки) берёт до 300; пропуски Stratz повтор не запускают — решение владельца 09.10 (В2).
    // META, матрицы и прокачка больше от него не зависят.
    if (!await node('Детали матчей (Stratz, малый бюджет)', 'tools/collect-meta-matches.js', ['--max', new Date().getHours() < 8 ? '2000' : '300'], { timeout: HOUR }))
      problems.push('детали Stratz');
    // Реальные покупки предметов в карточке героя. Сбой не останавливает
    // выкладку: на сайте остаётся прошлый data/hero-items.json.
    if (!await node('Покупки предметов по своей базе', 'tools/build-hero-items.js')) problems.push('покупки предметов');
    if (!await node('Предметы и победа (вариант Б драфта)', 'tools/build-item-impact.js')) problems.push('предметы и победа');
    // Исходы линий DraftMate — свой расчёт по тем же деталям Stratz (вместо снимка heroStats.laneOutcome, 11.10.2026).
    if (!await node('Исходы линий (DraftMate)', 'tools/build-lane-matrix.js')) problems.push('исходы линий');
    // DraftMate: предметы против состава. Сбой (в т.ч. описание предмета у Valve
    // перестало подтверждать правило) оставляет прошлый data/item-counters.json.
    if (!await node('Предметы против состава (DraftMate)', 'tools/build-item-counters.js')) problems.push('предметы против состава');
    // Цифры на страницах предметов: сбой оставляет вчерашние страницы.
    if (!await node('Статистика страниц предметов', 'tools/build-item-stats.js')) problems.push('статистика предметов');
    else if (!await node('Страницы предметов', 'build-item-pages.js')) problems.push('страницы предметов');

    if (!await node('Прокачка и таланты (Steam)', 'fetch-hero-builds.js', ['--source', 'steam', '--site'], { timeout: HOUR, heap: STEAM_HEAP })) problems.push('прокачка и таланты');

    const abil = await abilities();
    if (abil === false) problems.push('способности');

    // Справочники (патч, герои) daily не обновляет сам — только сигнал владельцу. Не стоп: устаревший патч
    // сужает срез Stratz, неизвестный герой выкидывает свои матчи, но остальные цифры верны.
    if (!await node('Проверка справочников (патч, герои)', 'tools/check-reference-data.js', [], { timeout: 0.1 * HOUR })) {
      let msg = ''; try { msg = fs.readFileSync(path.join(LOGS, 'reference-check.txt'), 'utf8').trim(); } catch { /* проверка не дошла до записи */ }
      problems.push('справочники');
      if (msg) await alertOwner('справочники устарели:\n' + msg);
    }

    // Без пересчёта матриц выкатывать нечего — здесь ошибка останавливает всё.
    // С U5: основной срез DraftMate «Все ранги» — все рейтинговые матчи Steam (data/our-matrix.json, our-meta.json,
    // draft-calibration.json). Верхний срез «Divine 5 и Immortal» — по-прежнему лента OpenDota top.
    if (!await node('Матрицы по своей базе (Steam, все ранги)', 'tools/build-our-stats.js', ['--source', 'steam', '--tier', 'all', '--main'], { heap: STEAM_HEAP })) throw new Error('матрицы не пересчитались');
    if (!await node('Калибровка прогноза (Steam, все ранги)', 'tools/build-draft-calibration.js', ['--source', 'steam', '--tier', 'all', '--main'], { heap: STEAM_HEAP })) throw new Error('калибровка не прошла');
    // Срез «Турбо» DraftMate (11.10.2026): матрица и своя калибровка. Сбой оставляет вчерашние файлы.
    if (!await node('Матрица турбо (Steam)', 'tools/build-our-stats.js', ['--source', 'steam', '--turbo'], { heap: STEAM_HEAP })) problems.push('матрица турбо');
    else if (!await node('Калибровка прогноза (турбо)', 'tools/build-draft-calibration.js', ['--source', 'steam', '--tier', 'turbo'], { heap: STEAM_HEAP })) problems.push('калибровка турбо');
    // META после матрицы и калибровки: прогноз на страницах матчей читает их.
    if (!await node('Витрина META (Steam)', 'tools/build-meta.js', ['--source', 'steam'], { timeout: HOUR, heap: STEAM_HEAP })) problems.push('витрина META');
    if (!await node('Матрицы верхнего среза', 'tools/build-our-stats.js', ['--tier', 'top'])) problems.push('матрицы верхнего среза');
    // Прогноз DraftMate по умолчанию считается по срезу Divine 5 и Immortal: своя калибровка и
    // независимая проверка на матчах эфира. Сбой оставляет вчерашние файлы.
    if (!await node('Калибровка прогноза (Divine 5 и Immortal)', 'tools/build-draft-calibration.js', ['--tier', 'top'])) problems.push('калибровка верхнего среза');
    else if (!await node('Проверка прогноза на матчах эфира', 'tools/check-draft-archive.js')) problems.push('проверка прогноза на эфире');
    // Шанс победы по ходу игры (эфир /live, итоги матча): переобучение на архиве эфира — только на сервере, где архив.
    // Сборщик сам не записывает модель, если она не лучше константы 50% (код 3): на сайте остаётся прежняя.
    if (ON_SERVER && !await node('Шанс победы по ходу игры', 'tools/build-live-winprob.js', [], { heap: 500, timeout: 0.25 * HOUR })) problems.push('шанс по ходу игры (оставлена прежняя модель)');
    // Средние по героям для карточек игроков в эфире — тоже по архиву эфира, только на сервере. Сбой оставляет прежний файл.
    if (ON_SERVER && !await node('Средние по героям для эфира', 'tools/build-live-hero-avg.js', [], { heap: 500, timeout: 0.25 * HOUR })) problems.push('средние по героям для эфира (оставлен прежний файл)');

    // Контрпики и страницы с ними. Сбой здесь не ломает выкладку: на сайте
    // остаются вчерашние контрпики, а матрицы и META уедут свежими.
    const countersOk = await node('Контрпики по своей базе', 'tools/build-hero-counters.js');
    // Раздел «Статистика и аналитика» и ежедневный снимок для динамики. Строго
    // после контрпиков (build-stats читает hero-counters.json) и до страниц героев:
    // паспорт и плитки героя берут цифры из того же data/stats.json, что и /stats/.
    // С U3 (04.10.2026) /stats/ считается по своей базе Steam (все рейтинговые матчи всех рангов).
    // Перед этим ранг свежих Steam-матчей дозаполняется из только что собранной ленты OpenDota.
    await node('Ранг Steam-матчей из OpenDota', 'tools/collect-steam-matches.js', ['--fill-ranks', '--days', '3'], { timeout: 0.5 * HOUR });
    if (!await node('Статистика и аналитика', 'tools/build-stats.js', ['--source', 'steam'], { timeout: HOUR })) problems.push('статистика');
    // Главная: три списка меты из того же stats.json (вместо снимка OpenDota, 11.10.2026) и пересборка страниц разделов.
    else if (!await node('Мета на главной', 'tools/build-home-meta.js')) problems.push('мета на главной');
    else if (!await node('Страницы разделов (главная)', 'build-pages.js', [], { timeout: 0.25 * HOUR })) problems.push('страницы разделов');
    if (countersOk) {
      if (!await node('Страницы героев', 'build-hero-pages.js', [], { timeout: 0.5 * HOUR })) problems.push('страницы героев');
      if (!await node('Гайды героев', 'build-hero-guides.js')) problems.push('гайды героев');
      if (!await node('Статьи', 'build-guide-pages.js')) problems.push('статьи');
    } else problems.push('контрпики');
    // Sitemap после всех сборщиков страниц: lastmod — дата реального изменения страницы (build-sitemap.js).
    // Сбой не останавливает выкладку — остаётся прежний sitemap.
    if (!await node('Карта сайта (sitemap)', 'build-sitemap.js')) problems.push('sitemap');


    if (ARGS.has('--no-deploy')) { log('Флаг --no-deploy: выкладку пропускаю.'); return problems.length ? 1 : 0; }

    // На сервере git-копии нет: код туда приходит только через tools/push-server.js,
    // то есть уже проверенным. Проверка чужих правок нужна лишь на рабочем компьютере.
    if (!ON_SERVER) {
      const foreign = foreignDeployChanges();
      if (foreign === null) throw new Error('не найден git — не могу проверить deploy/ на чужие правки');
      if (foreign.length) throw new Error('в deploy/ незакоммиченные правки кода, выкладка отменена:\n  ' + foreign.slice(0, 10).join('\n  '));
    }

    if (ON_SERVER && !codeBlock) codeBlock = codeChanged();
    if (codeBlock) {
      log('ВЫКЛАДКА ЗАБЛОКИРОВАНА: ' + codeBlock + '\nДанные пересчитаны в ~/dotamate-src/data, сайт остался в прежнем виде. ' +
        'Код выкладывается только по команде владельца (claude/versiya-sayta.md), после неё ежедневная выкладка снова пойдёт сама.');
      await alertOwner('ежедневная выкладка данных ЗАБЛОКИРОВАНА — ' + codeBlock + ' Данные на сайте не обновлены. Нужна выкладка кода («выкладывай»).');
      return 2;
    }
    checkDataJson();
    if (!await node('Раскладка в deploy', 'tools/sync-deploy.js')) throw new Error('раскладка в deploy не прошла');
    pruneMetaMatches();
    pruneUnpublished();

    // С 25.09.2026 сайт на Hostiman: одна SSH-выкладка вместо wrangler deploy.
    if (!await node('Выкладка на dotamate.ru', 'tools/deploy-hostiman.js', [], { timeout: 0.25 * HOUR }))
      throw new Error('выкладка на Hostiman не прошла (см. журнал)');

    if (abil === true && !ON_SERVER) { // на сервере нет git и токена GitHub
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
    await alertOwner('ежедневное обновление остановлено: ' + e.message + ' Сайт остался в прежнем виде.');
    return 1;
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* уже нет */ }
  }
}

main().then(code => logFile.end(() => process.exit(code)));
