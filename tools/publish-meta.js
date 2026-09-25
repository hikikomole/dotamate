#!/usr/bin/env node
/**
 * Выкладка данных раздела META на сайт без полной пересборки.
 *
 * Копирует data/meta-escape.json и data/meta-match/ в deploy/data/ (устаревшие
 * файлы матчей убирает) и запускает `wrangler deploy` из deploy/.
 *
 * Данные META в git не хранятся (.gitignore): они меняются после каждого
 * сбора, и коммит на каждый запуск засорил бы историю. Поэтому этой выкладке
 * не нужен пуш.
 *
 * Защита: если в deploy/ есть незакоммиченные правки помимо данных META,
 * выкладка отменяется — иначе вместе с данными на сайт уехала бы чужая
 * недоделанная работа.
 *
 * Запуск: node tools/publish-meta.js   (обычно из «Собрать META.cmd»)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');

function findGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch (e) { /* нет в PATH */ }
  const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('app-')).sort().reverse()) {
      const g = path.join(base, d, 'resources', 'app', 'git', 'cmd', 'git.exe');
      if (fs.existsSync(g)) return g;
    }
  }
  return null;
}

function checkDeployClean() {
  const git = findGit();
  if (!git) throw new Error('Не найден git — не могу проверить, что в deploy/ нет чужих правок.');
  const out = execFileSync(git, ['status', '--porcelain', '--', 'deploy'], { cwd: ROOT, encoding: 'utf8' });
  const dirty = out.split('\n').filter(Boolean);
  if (dirty.length) {
    throw new Error('В deploy/ есть незакоммиченные правки, выкладка отменена:\n  ' + dirty.slice(0, 10).join('\n  ') +
      (dirty.length > 10 ? `\n  …и ещё ${dirty.length - 10}` : ''));
  }
}

function copyData() {
  const src = path.join(ROOT, 'data');
  const dst = path.join(DEPLOY, 'data');
  fs.copyFileSync(path.join(src, 'meta-escape.json'), path.join(dst, 'meta-escape.json'));
  const sm = path.join(src, 'meta-match'), dm = path.join(dst, 'meta-match');
  fs.mkdirSync(dm, { recursive: true });
  const keep = new Set(fs.readdirSync(sm));
  let removed = 0;
  for (const f of fs.readdirSync(dm)) if (!keep.has(f)) { fs.unlinkSync(path.join(dm, f)); removed++; }
  for (const f of keep) fs.copyFileSync(path.join(sm, f), path.join(dm, f));
  console.log(`Скопировано: meta-escape.json и ${keep.size} матчей (устаревших убрано: ${removed}).`);
}

function readEnv() {
  const env = Object.assign({}, process.env);
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) throw new Error('Нет файла .env с CLOUDFLARE_API_TOKEN');
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('В .env нет CLOUDFLARE_API_TOKEN');
  return env;
}

function main() {
  checkDeployClean();
  copyData();
  const r = spawnSync('npx', ['wrangler', 'deploy'], { cwd: DEPLOY, env: readEnv(), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('wrangler deploy завершился с ошибкой');
  console.log('Данные META выложены на сайт.');
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
