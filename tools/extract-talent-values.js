#!/usr/bin/env node
/**
 * Значения талантов из файлов игры Dota 2.
 *
 * Зачем: у 141 таланта название вида «-{s:bonus_AbilityCooldown}s Borrowed
 * Time Cooldown», и само число не отдаёт НИ ОДИН публичный источник —
 * проверено: datafeed Valve возвращает для них пустой special_values,
 * у OpenDota только шаблон, а связанный атрибут Stratz
 * (linkedSpecialBonusAbilityId) указывает на БАЗОВОЕ значение способности
 * (у Abaddon это «85 75 65» — перезарядка Borrowed Time), а не на величину
 * таланта. Настоящее значение лежит только в scripts/npc/heroes/<герой>.txt
 * внутри pak01_dir.vpk: там в блоке AbilityValues родительской способности
 * стоит пара "special_bonus_unique_abaddon_borrowed_time_cd" "-10".
 *
 * Вход: папка с распакованными scripts/npc (см. README рядом).
 * Запуск: node tools/extract-talent-values.js <папка>
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = path.join(__dirname, '..', 'data', 'talent-values.json');

if (!SRC || !fs.existsSync(SRC)) {
  console.error('Укажи папку с файлами scripts/npc из pak01_dir.vpk');
  process.exit(1);
}

// Ключ — имя таланта, значение — число. Тонкости, на которых легко ошибиться:
//  1) строки "Ability12" "special_bonus_..." — это НЕ значение, там талант
//     стоит справа, поэтому берём только пары, где талант является КЛЮЧОМ;
//  2) значение может быть со знаком плюс: "+2";
//  3) файл npc_ability_ids.txt содержит пары «имя таланта -> ЧИСЛОВОЙ ID»
//     и по форме неотличим от значения. Именно он давал «+1699s Illusory
//     Armaments Duration» вместо настоящих «+2». Такие файлы пропускаем.
const RE = /"(special_bonus_[A-Za-z0-9_]+)"\s+"([+-]?\d+(?:\.\d+)?(?:\s+[+-]?\d+(?:\.\d+)?)*)"/g;
const SKIP = /ability_ids/i;

const values = {};
let files = 0, pairs = 0, skipped = 0;
for (const name of fs.readdirSync(SRC)) {
  if (!name.endsWith('.txt')) continue;
  if (SKIP.test(name)) { skipped++; continue; }
  const text = fs.readFileSync(path.join(SRC, name), 'utf8');
  files++;
  let m;
  while ((m = RE.exec(text))) {
    const key = m[1];
    // У талантов, растущих по уровням, стоит список — берём первое значение
    const first = m[2].trim().split(/\s+/)[0];
    if (values[key] === undefined) { values[key] = first; pairs++; }
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  source: 'scripts/npc/heroes/*.txt из pak01_dir.vpk',
  extractedAt: new Date().toISOString(),
  count: pairs,
  values
}, null, 1));
console.log(`Файлов прочитано: ${files} (пропущено ${skipped}). Значений талантов: ${pairs} -> ${path.relative(path.join(__dirname,'..'), OUT)}`);
