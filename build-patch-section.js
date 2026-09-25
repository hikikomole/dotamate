// Разметка страницы патча.
//
// Вынесено из build-pages.js отдельным модулем: сборщик страниц и так большой,
// а тут своя вёрстка на сотню строк. Снаружи — одна функция patchSection(p),
// которой скармливают data/patch-notes.json.
//
// Форма подачи повторяет то, как заметки показывает сам клиент Dota 2:
// колонка с версией слева, лента блоков справа, изменения — строками, а не
// карточками. Оформление при этом наше: тёмный фон, золотой капс Oswald,
// никаких оранжевых плашек и чужих шрифтов.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Значки типов изменений. Иконки Valve лежат в файлах игры — берём не их, а
// свои простые символы, различимые по ФОРМЕ, а не только по цвету: щит,
// квадрат, ромб, круг, клинок, двойная стрелка, стрелка, плюс.
// Три атрибута дополнительно красим цветами темы, они уже есть на сайте.
const ICONS = {
  armor: ['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z', null],
  strength: ['M5 5h14v14H5z', 'var(--d2-str,#e4575a)'],
  agility: ['M12 4l8 8-8 8-8-8z', 'var(--d2-agi,#6fc46f)'],
  intelligence: ['M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'var(--d2-int,#5aa9e6)'],
  damage: ['M18 4l2 2-9 9-3 1 1-3zM8 16l-4 4', null],
  attack_speed: ['M5 6l6 6-6 6M13 6l6 6-6 6', null],
  movement: ['M4 12h14M13 7l5 5-5 5', null],
  health_regen: ['M12 5v14M5 12h14', null],
};

function mark(note) {
  const ic = note.icon && ICONS[note.icon];
  if (!ic) return '<span class="pt-dot" aria-hidden="true"></span>';
  const color = ic[1] ? ' style="color:' + ic[1] + '"' : '';
  return '<svg class="pt-gl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + color + '><path d="' + ic[0] + '"></path></svg>';
}

function notes(list) {
  if (!list || !list.length) return '';
  return '<ul class="pt-notes">' + list.map(n =>
    '<li class="pt-n' + (n.aghanims ? ' is-agh' : '') + '"' + (n.level > 1 ? ' data-lvl="' + n.level + '"' : '') + '>' +
    mark(n) + '<span>' + esc(n.text) + '</span></li>').join('') + '</ul>';
}

function itemRow(i) {
  const title = i.slug
    ? '<a href="/item/' + esc(i.slug) + '/">' + esc(i.name) + '</a>'
    : esc(i.name);
  const ico = i.img
    ? '<img class="pt-ico pt-ico-item" src="' + esc(i.img) + '" alt="" width="40" height="30" loading="lazy" decoding="async">'
    : '<span class="pt-ico pt-ico-item pt-ico-none" aria-hidden="true"></span>';
  return '<article class="pt-row">' + ico +
    '<div class="pt-row-body"><h4 class="pt-name">' + title + '</h4>' + notes(i.notes) + '</div></article>';
}

function abilityRow(a) {
  const ico = a.icon
    ? '<img class="pt-ico pt-ico-ab" src="' + esc(a.icon) + '" alt="" width="32" height="32" loading="lazy" decoding="async">'
    : '<span class="pt-ico pt-ico-ab pt-ico-none" aria-hidden="true">' + esc((a.name || '?').slice(0, 1)) + '</span>';
  return '<div class="pt-ab">' + ico +
    '<div class="pt-ab-body"><b class="pt-ab-name">' + esc(a.name) + '</b>' + notes(a.notes) + '</div></div>';
}

function heroBlock(h) {
  const id = 'h-' + (h.slug || h.id);
  const title = h.slug
    ? '<a href="/hero/' + esc(h.slug) + '/">' + esc(h.name) + '</a>'
    : esc(h.name);
  const portrait = h.img
    ? '<img class="pt-portrait" src="' + esc(h.img) + '" alt="" width="64" height="36" loading="lazy" decoding="async">'
    : '<span class="pt-portrait pt-ico-none" aria-hidden="true"></span>';
  const talents = h.talents && h.talents.length
    ? '<div class="pt-ab pt-ab-talents"><span class="pt-ico pt-ico-ab pt-ico-tal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.4" stroke-width="1"></circle><path stroke-width="1.5" d="M12 18.2V6.4"></path><path stroke-width="1.3" d="M12 15.8 7.1 12.6M12 15.8l4.9-3.2M12 12.4 7.8 9.6M12 12.4l4.2-2.8M12 9.2 8.8 7.1M12 9.2l3.2-2.1"></path></svg></span>' +
      '<div class="pt-ab-body"><b class="pt-ab-name">Таланты</b>' + notes(h.talents) + '</div></div>'
    : '';
  return '<article class="pt-hero" id="' + esc(id) + '">' +
    '<header class="pt-hero-head">' + portrait + '<h4 class="pt-hero-name">' + title + '</h4></header>' +
    notes(h.notes) +
    (h.abilities || []).map(abilityRow).join('') +
    talents +
    '</article>';
}

function band(id, title, count, hint) {
  return '<div class="pt-band" id="' + esc(id) + '"><h3>' + esc(title) + '</h3>' +
    '<span class="pt-band-n">' + count + (hint ? ' ' + esc(hint) : '') + '</span></div>';
}

// Русские числительные для подписи в полосе-разделителе.
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function ruDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(' г.', '');
}

function patchSection(p) {
  const c = p.counts || {};
  const hasNeutrals = (p.neutrals || []).length > 0;

  const rail =
    '<aside class="pt-rail"><div class="pt-rail-in">' +
      '<div class="pt-rail-box">' +
        '<p class="pt-rail-label">Обновление</p>' +
        '<p class="pt-rail-ver">' + esc(p.version) + '</p>' +
        '<p class="pt-rail-date">Выпущено ' + esc(ruDate(p.timestamp)) + '</p>' +
      '</div>' +
      '<nav class="pt-rail-nav" aria-label="Разделы патча">' +
        ((p.general || []).length ? '<a href="#pt-general">Общие изменения</a>' : '') +
        ((p.items || []).length ? '<a href="#pt-items">Предметы<b>' + c.items + '</b></a>' : '') +
        (hasNeutrals ? '<a href="#pt-neutrals">Нейтральные<b>' + c.neutrals + '</b></a>' : '') +
        ((p.heroes || []).length ? '<a href="#pt-heroes">Герои<b>' + c.heroes + '</b></a>' : '') +
      '</nav>' +
      ((p.heroes || []).length
        ? '<div class="pt-rail-list"><p class="pt-rail-label">Изменённые герои</p><div class="pt-rail-heroes">' +
          p.heroes.map(h => '<a href="#h-' + esc(h.slug || h.id) + '">' + esc(h.name) + '</a>').join('') +
          '</div></div>'
        : '') +
    '</div></aside>';

  const head =
    '<header class="pt-head">' +
      '<p class="eyebrow">Официальные заметки Valve · ' + esc(ruDate(p.timestamp)) + '</p>' +
      '<h2 class="pt-title">Патч ' + esc(p.version) + '</h2>' +
      '<p class="pt-lead">Изменились ' + c.heroes + ' ' + plural(c.heroes, 'герой', 'героя', 'героев') +
        ' и ' + (c.items + c.neutrals) + ' ' + plural(c.items + c.neutrals, 'предмет', 'предмета', 'предметов') +
        '. Текст изменений — русская локализация Valve с dota2.com/datafeed; имена, значки и ссылки наши.</p>' +
    '</header>';

  const general = (p.general || []).length
    ? band('pt-general', 'Общие изменения', c.general, plural(c.general, 'пункт', 'пункта', 'пунктов')) +
      '<div class="pt-rows"><article class="pt-row pt-row-plain"><div class="pt-row-body">' + notes(p.general) + '</div></article></div>'
    : '';

  const items = (p.items || []).length
    ? band('pt-items', 'Предметы', c.items, plural(c.items, 'предмет', 'предмета', 'предметов')) +
      '<div class="pt-rows">' + p.items.map(itemRow).join('') + '</div>'
    : '';

  const neutrals = hasNeutrals
    ? band('pt-neutrals', 'Нейтральные предметы', c.neutrals, plural(c.neutrals, 'предмет', 'предмета', 'предметов')) +
      '<div class="pt-rows">' + p.neutrals.map(itemRow).join('') + '</div>'
    : '';

  const heroes = (p.heroes || []).length
    ? band('pt-heroes', 'Герои', c.heroes, plural(c.heroes, 'герой', 'героя', 'героев')) +
      '<div class="pt-heroes">' + p.heroes.map(heroBlock).join('') + '</div>'
    : '';

  const source = '<p class="pt-source">Источник: ' + esc(p.source) + '. Снимок от ' +
    esc(new Date(p.fetchedAt).toLocaleDateString('ru-RU')) + '.</p>';

  return '<section class="section patch-page" id="patch-notes"><div class="container pt-wrap">' +
    rail + '<div class="pt-feed">' + head + general + items + neutrals + heroes + source + '</div>' +
    '</div></section>';
}

module.exports = { patchSection };
