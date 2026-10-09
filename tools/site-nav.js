// Единое меню сайта для всех сборщиков страниц (build-pages.js и build-*-pages/guides).
// Раньше меню было переписано вручную в восьми файлах и расходилось: где-то не было META и «Эфира».
// На главную ведёт логотип DOTAMATE в шапке, отдельного пункта «Главная» нет.
'use strict';
const NAV = [
  { key: 'heroes', href: '/heroes/', label: 'Герои' },
  { key: 'items',  href: '/items/',  label: 'Предметы' },
  { key: 'stats',  href: '/stats/',  label: 'Статистика' },
  { key: 'guides', href: '/guides/', label: 'Гайды' },
  { key: 'meta',   href: '/meta/',   label: 'META' },
  // «Эфир» — выпадающее меню (09.10.2026): трансляция, про-матчи, частые слова. keys — какие страницы подсвечивают пункт.
  { key: 'live',   href: '/live/',   label: 'Эфир', keys: ['live', 'pro', 'words'], sub: [
    { key: 'live',  href: '/live/',       label: 'Трансляция' },
    { key: 'pro',   href: '/pro/',        label: 'Про-матчи' },
    { key: 'words', href: '/live/words/', label: 'Частые слова' },
  ] },
  { key: 'me',     href: '/me/',     label: 'Мой профиль' },
];
function navHtml(activeKey) {
  const links = NAV.map(n => {
    if (!n.sub) {
      const current = n.key === activeKey ? ' aria-current="page" class="active"' : '';
      return `<a href="${n.href}"${current}>${n.label}</a>`;
    }
    // Без JS: на компьютере подменю открывается наведением и фокусом (Tab), на телефоне в раскрытом меню показано всегда.
    const on = n.keys.includes(activeKey) ? ' class="active"' : '';
    const sub = n.sub.map(x => `<a href="${x.href}"${x.key === activeKey ? ' aria-current="page" class="active"' : ''}>${x.label}</a>`).join('');
    return `<div class="nav-dd"><a href="${n.href}"${on}>${n.label}<span class="nav-dd-arrow" aria-hidden="true">▾</span></a><div class="nav-dd-menu">${sub}</div></div>`;
  }).join('');
  // Telegram-канал — только в подвале (решение владельца 03.10.2026).
  return `<nav id="navMenu">${links}</nav>`;
}
module.exports = { NAV, navHtml };
