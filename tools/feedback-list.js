#!/usr/bin/env node
// Показывает обращения из формы обратной связи (таблица feedback в D1).
//   node tools/feedback-list.js            — новые
//   node tools/feedback-list.js all        — последние 50 любых
//   node tools/feedback-list.js done 12    — пометить обращение 12 как отвеченное
//   node tools/feedback-list.js delete 12  — удалить обращение 12 (отзыв согласия)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

function d1(sql) {
  const args = ['wrangler', 'd1', 'execute', 'dotamate', '--remote', '--json', '--command', sql];
  const opts = { cwd: path.join(root, 'deploy'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  // В Windows npx — это npx.cmd, его запускает cmd.exe и режет аргументы по пробелам.
  // Поэтому там собираем одну строку и берём каждый аргумент в двойные кавычки
  // (в SQL двойных кавычек нет — только одинарные).
  const out = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', '"npx ' + args.map(a => '"' + a + '"').join(' ') + '"'], { ...opts, windowsVerbatimArguments: true })
    : execFileSync('npx', args, opts);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results || [];
}

const [cmd, arg] = process.argv.slice(2);
const TOPIC = { question: 'Вопрос', bug: 'Ошибка', personal_data: 'ПЕРСОНАЛЬНЫЕ ДАННЫЕ', other: 'Другое' };

if (cmd === 'done' || cmd === 'delete') {
  const id = Number(arg);
  if (!Number.isInteger(id) || id <= 0) { console.error('Укажите номер обращения, например: done 12'); process.exit(1); }
  d1(cmd === 'done' ? `UPDATE feedback SET status='done' WHERE id=${id}` : `DELETE FROM feedback WHERE id=${id}`);
  console.log(cmd === 'done' ? `Обращение ${id} отмечено как отвеченное.` : `Обращение ${id} удалено.`);
  process.exit(0);
}

const rows = d1(cmd === 'all'
  ? 'SELECT id, created_at, topic, name, contact, message, status FROM feedback ORDER BY id DESC LIMIT 50'
  : "SELECT id, created_at, topic, name, contact, message, status FROM feedback WHERE status='new' ORDER BY id");
if (!rows.length) { console.log('Новых обращений нет.'); process.exit(0); }
for (const r of rows) {
  const when = new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  console.log(`\n#${r.id} · ${when} МСК · ${TOPIC[r.topic] || r.topic}${r.status === 'done' ? ' · отвечено' : ''}`);
  console.log(`От: ${r.name || 'без имени'} · Контакт: ${r.contact || 'не указан'}`);
  console.log(r.message);
}
console.log(`\nВсего: ${rows.length}. Запросы по персональным данным — ответить в течение 10 рабочих дней.`);
