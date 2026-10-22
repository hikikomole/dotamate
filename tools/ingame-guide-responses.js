'use strict';

const MIN_SAMPLE = 150;
const MIN_SHARE = 0.05;
const PHASES = ['start', 'early', 'mid', 'late', 'vlate'];

// Механический справочник, НЕ рейтинг эффективности. Источник каждой записи:
// data/items-ru.json items[key].desc[].t или .attr (Valve itemdata → наш каталог).
// У descOwn=true используем только числовые attr, не авторский текст/советы.
// Регулярное выражение проверяет наличие механики в загруженном каталоге;
// при отсутствии предмета/подтверждения запись не участвует в экспорте.
const RESPONSES = [
  { title: 'Против магии', items: [
    ['black_king_bar', 'desc', /сопротивлению магии/, 'Avatar: сопротивление магии на время действия.'],
    ['pipe', 'desc', /поглощающий .*магического урона/, 'Barrier: барьер от магического урона.'],
    ['glimmer_cape', 'desc', /поглощающий .*магического урона/, 'Glimmer: временный барьер от магического урона.'],
    ['eternal_shroud', 'desc', /сопротивление магии/, 'Eternal Endurance: сопротивление магии при получении урона заклинаниями.'],
    ['mage_slayer', 'desc', /меньше урона заклинаниями/, 'Атакуемый враг временно наносит меньше урона заклинаниями.'],
    ['cloak', 'attr', /сопротивлению магии/, 'Даёт сопротивление магии.']
  ] },
  { title: 'Против невидимости', items: [
    ['dust', 'desc', /раскрывает невидимых/, 'Reveal: раскрытие невидимости в области.'],
    ['gem', 'desc', /видеть невидимых/, 'True Sight: обнаружение невидимости; выпадает при смерти.']
  ] },
  { title: 'Против физического урона', items: [
    ['ghost', 'desc', /защищает от физического урона/, 'Ghost Form: защита от физического урона; нельзя атаковать, получаемый магический урон увеличивается.'],
    ['crimson_guard', 'desc', /заблокировать урон от каждой атаки/, 'Guard: временный блок урона атак.'],
    ['heavens_halberd', 'desc', /не может атаковать/, 'Disarm: цель временно не может атаковать.'],
    ['butterfly', 'attr', /к уклонению/, 'Уклонение от атак; не защищает от всех источников физического урона.'],
    ['assault', 'attr', /к броне/, 'Броня уменьшает физический урон.'],
    ['platemail', 'attr', /к броне/, 'Броня уменьшает физический урон.']
  ] },
  { title: 'Против контроля', items: [
    ['black_king_bar', 'desc', /от действия отрицательных эффектов/, 'Avatar: защита от отрицательных эффектов и нормальное развеивание; не от любого контроля.'],
    ['sphere', 'desc', /Блокирует одно направленное заклинание/, 'Spellblock: блок одного направленного заклинания; некоторые не блокируются.'],
    ['aeon_disk', 'desc', /Тип развеивания: сильное/, 'Combo Breaker: сильное развеивание и временное сопротивление эффектам при срабатывании.'],
    ['manta', 'desc', /Тип развеивания: нормальное/, 'Mirror Image: нормальное развеивание; не снимает любой контроль и требует возможности применить предмет.'],
    ['lotus_orb', 'desc', /Тип развеивания: нормальное/, 'Echo Shell: нормальное развеивание; отражение НЕ блокирует эффекты заклинания.']
  ] }
];

// Sentry отсутствует в текущем items-ru: не добавляем без локального описания.
// vsEnemy оверлея агрегирует ВСЕХ покупателей против врага, без героя покупателя,
// позиции и рангового среза. Это не условная статистика покупок героя гайда.
// lane-matrix содержит исходы линий, но не покупки против соперника на линии.
// Ни один из этих файлов не даёт оснований для раздела о сильном враге на линии.
// Роли/атрибуты не задают тип урона; свободные описания способностей не используем
// как надёжную разметку угроз. Поэтому здесь только механические разделы.

function responseSections(purchases, { catalog, itemsById, variants }) {
  if (!Number.isInteger(purchases?.n) || purchases.n < MIN_SAMPLE) return [];
  const counts = new Map();
  for (const phase of PHASES) {
    for (const row of purchases[phase] || []) {
      if (!Number.isInteger(row.g) || row.g < 0 || row.g > purchases.n) continue;
      const name = itemsById.get(String(variants[row.i] ?? row.i));
      // Максимум — нижняя граница доли за матч. Нельзя суммировать стадии
      // или варианты без match ID: одни и те же покупатели могут повторяться.
      if (name) counts.set(name, Math.max(counts.get(name) || 0, row.g));
    }
  }
  return RESPONSES.map(({ title, items }) => ({ title, items: items.flatMap(([key, field, proof, mechanic]) => {
    const item = catalog[key] || catalog[`item_${key}`];
    if (!item || (field === 'desc' && item.descOwn)) return [];
    const text = field === 'desc' ? (item.desc || []).map(d => d.t).join('\n') : (item.attr || []).join('\n');
    const name = `item_${key}`, g = counts.get(name) || 0;
    if (!proof.test(text) || g < Math.ceil(purchases.n * MIN_SHARE)) return [];
    return [{ name, share: g / purchases.n, mechanic }];
  }).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name)) })).filter(s => s.items.length);
}

module.exports = { responseSections, RESPONSES, MIN_SAMPLE, MIN_SHARE };
