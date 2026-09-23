#!/usr/bin/env node
/**
 * Русские названия талантов из официальной локализации Valve.
 *
 * У талантов в Dota нет иконки — ни в игре, ни на CDN. Поэтому в интерфейсе
 * они показываются текстом, и текст должен быть русским, а не английским из
 * Stratz («+50 Jinada Gold Steal» -> «+50 к краже золота Jinada»).
 *
 * Источник — тот же файл локализации abilities_russian.txt, который уже
 * использует deploy/worker.js для описаний способностей.
 *
 * Запуск: node tools/fetch-talent-names-ru.js
 */
const fs = require('fs');
const path = require('path');

const VDF_RU_URL = 'https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/resource/localization/abilities_russian.txt';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'talents-ru.json');

/** Значения в VDF содержат переносы и служебную разметку — чистим */
const clean = t => String(t || '')
  .replace(/<\s*br\s*\/?\s*>/gi, ' ')
  .replace(/\\n/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/%%/g, '%')
  .replace(/\s+/g, ' ')
  .trim();

async function main() {
  const res = await fetch(VDF_RU_URL, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error('локализация недоступна: HTTP ' + res.status);
  const text = (await res.text()).replace(/^﻿/, '');

  // Строки вида  "DOTA_Tooltip_ability_special_bonus_xxx"   "Текст"
  const map = {};
  const re = /"DOTA_Tooltip_[Aa]bility_(special_bonus_[A-Za-z0-9_]+)"\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const key = m[1];
    const val = clean(m[2]);
    // Пропускаем описания (_Description) — нам нужно короткое название
    if (/_Description$/i.test(key)) continue;
    if (val && !map[key]) map[key] = val;
  }

  // Шаблоны содержат плейсхолдеры вида {s:bonus_damage}. Значение к ним
  // лежит в английском названии из Stratz («+30 Damage» -> 30), и для
  // талантов с одним плейсхолдером этого достаточно — проверено на всех 809.
  // Для талантов с несколькими слотами берём числа из datafeed Valve.
  const idx = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ability-index.json'), 'utf8')).abilities; }
    catch { return {}; }
  })();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function valveValues(abilityId) {
    try {
      const r = await fetch(`https://www.dota2.com/datafeed/abilitydata?language=russian&ability_id=${abilityId}`);
      if (!r.ok) return null;
      const a = (await r.json())?.result?.data?.abilities?.[0];
      if (!a) return null;
      const out = {};
      for (const sv of (a.special_values || [])) {
        const v = (sv.values_float || [])[0];
        if (sv.name && v != null) out[sv.name] = Number.isInteger(v) ? v : Number(v.toFixed(2));
      }
      return { name: a.name_loc || null, values: out };
    } catch { return null; }
  }

  const resolved = {};
  let filled = 0, fromValve = 0, fellBack = 0;

  for (const [id, meta] of Object.entries(idx)) {
    if (!meta.isTalent || !meta.name) continue;
    let text = map[meta.name];
    if (!text) { if (meta.title) { resolved[id] = meta.title; fellBack++; } continue; }

    const slots = text.match(/\{s:[a-z_]+\}/gi) || [];
    if (slots.length === 1) {
      const num = (meta.title || '').match(/-?\d+(?:[.,]\d+)?/);
      if (num) {
        // Если знак уже стоит в русском шаблоне («+{s:...} к урону») или
        // шаблон сам говорит о снижении («снижает урон на {s:...}%»), минус
        // из английского названия дал бы «на -30%». Берём модуль числа,
        // когда перед плейсхолдером нет своего знака.
        const at = text.indexOf(slots[0]);
        const signed = at > 0 && '+-−'.includes(text[at - 1]);
        let value = num[0].replace(',', '.');
        if (!signed) value = value.replace(/^-/, '');
        text = text.replace(slots[0], value);
        filled++;
      }
    } else if (slots.length > 1) {
      const v = await valveValues(Number(id));
      if (v) {
        for (const s of slots) {
          const key = s.slice(3, -1);
          if (v.values[key] != null) text = text.replace(s, String(v.values[key]));
        }
        fromValve++;
      }
      await sleep(150);
    }

    // Если что-то осталось незаполненным — честнее показать английское
    // название с настоящими числами, чем русское с «{s:...}».
    if (/\{s:[a-z_]+\}/i.test(text) && meta.title) { text = meta.title; fellBack++; }
    resolved[id] = text;
  }

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'Valve abilities_russian.txt + datafeed',
    fetchedAt: new Date().toISOString(),
    count: Object.keys(resolved).length,
    byAbilityId: resolved,
    byKey: map
  }, null, 1));
  console.log(`Талантов с названием: ${Object.keys(resolved).length} (подставлено из заголовка ${filled}, из datafeed ${fromValve}, откат на английский ${fellBack})`);
}

main().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
