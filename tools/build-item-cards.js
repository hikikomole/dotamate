#!/usr/bin/env node
// Готовит data/item-cards.json — короткие русские описания для карточек
// каталога /items/.
//
// Зачем: сайт статический, официальный русский текст Valve тянется только
// через сервер, которого на проде нет. Поэтому в каталоге у всех 263 карточек
// стоял один и тот же placeholder «Открыть профиль для официального описания
// Valve» — 263 одинаковых абзаца, бесполезных и человеку, и поиску.
//
// Источник — seo/item-descriptions.json, те самые описания, что уже уходят в
// <meta name="description"> статических страниц предметов. У них в конце
// призыв («Изучите характеристики», «Читайте подробное описание») — для
// карточки он лишний, поэтому последнее предложение отбрасывается, если
// начинается с одного из таких оборотов.
//
// Запуск: node tools/build-item-cards.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'seo', 'item-descriptions.json');
const LIMIT = 132;

// Обороты, с которых начинается «хвост для поисковика», а не факт о предмете.
const CTA = /^(изучите|читайте|ознакомьтесь|узнайте|посмотрите|смотрите|полный|полное|полные|все детали|все бонусы|все показатели|все характеристики|на странице|внутри вы|подробн)/i;

function shorten(text) {
  const parts = String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length > 1 && CTA.test(parts[parts.length - 1])) parts.pop();
  let out = parts.join(' ').trim();
  if (out.length > LIMIT) {
    const cut = out.slice(0, LIMIT);
    const space = cut.lastIndexOf(' ');
    out = (space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }
  return out;
}

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = {};
for (const [slug, text] of Object.entries(src)) {
  const s = shorten(text);
  if (s) out[slug] = s;
}

const json = JSON.stringify(out);
for (const base of [ROOT, path.join(ROOT, 'deploy')]) {
  const dir = path.join(base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'item-cards.json'), json, 'utf8');
}
console.log(`item-cards.json: ${Object.keys(out).length} описаний, ${(json.length / 1024).toFixed(1)} КБ`);
