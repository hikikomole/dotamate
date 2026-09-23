/**
 * Пять ролей Dota 2: определения, иконки и строка статистики на странице героя.
 *
 * Файл работает и в браузере (window.D2HRoles), и в сборочных скриптах
 * (require('./js/hero-roles.js')) — поэтому без import/export.
 *
 * Данные: Stratz GraphQL, брекет DIVINE_IMMORTAL, разбивка по позициям.
 * Снимок лежит в data/hero-positions.json; Worker обновляет его раз в сутки.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.D2HRoles = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // Порядок = порядок на линии: 1 керри … 5 полная поддержка
  const ROLES = [
    { id: 'POSITION_1', key: 'carry',       ru: 'Керри',            short: 'Поз. 1' },
    { id: 'POSITION_2', key: 'mid',         ru: 'Мид',              short: 'Поз. 2' },
    { id: 'POSITION_3', key: 'offlane',     ru: 'Оффлейн',          short: 'Поз. 3' },
    { id: 'POSITION_4', key: 'support',     ru: 'Поддержка',        short: 'Поз. 4' },
    { id: 'POSITION_5', key: 'hardsupport', ru: 'Полная поддержка', short: 'Поз. 5' }
  ];

  const byId = {};
  for (const r of ROLES) byId[r.id] = r;

  /**
   * Иконки ролей — инлайновый SVG, без внешних файлов и запросов.
   * Рисунок читается по силуэту: меч, посох, щит, пламя, крест лечения.
   */
  /**
   * Иконки ролей — файлы, присланные пользователем, лежат в assets/roles/.
   * Керри — вектор (carry.svg), остальные четыре — растр 25px (исходники были
   * WebP под расширением .png, сконвертированы в PNG). Собственные цвета
   * иконок не перекрашиваем: это готовые изображения, а не контуры.
   */
  const ICON_FILES = {
    carry: '/assets/roles/carry.svg',
    mid: '/assets/roles/mid.png',
    offlane: '/assets/roles/offlane.png',
    support: '/assets/roles/support.png',
    hardsupport: '/assets/roles/hardsupport.png'
  };
  const ICONS = {};

  function icon(key) {
    const src = ICON_FILES[key];
    if (!src) return '';
    return '<img src="' + src + '" alt="" loading="lazy" decoding="async" width="20" height="20">';
  }

  /** «5 118» — узкий пробел между разрядами, чтобы число не слипалось */
  function fmtMatches(n) {
    return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** «54,5%» — запятая как десятичный разделитель, по-русски */
  function fmtWinrate(w) {
    return w == null ? '—' : String(w.toFixed(1)).replace('.', ',') + '%';
  }

  /**
   * Собирает строку ролей. entry — объект героя из hero-positions.json.
   * Возвращает HTML; при отсутствии данных — пустую строку, чтобы страница
   * не показывала пустую рамку вместо статистики.
   */
  function rowHtml(entry, opts) {
    if (!entry || !entry.positions) return '';
    const o = opts || {};
    const esc = o.escapeHtml || (s => String(s));
    const top = entry.topPosition;

    const cells = ROLES.map(r => {
      const p = entry.positions[r.id];
      const isTop = r.id === top;
      const wr = p ? fmtWinrate(p.winrate) : '—';
      const m = p ? fmtMatches(p.matches) : '—';
      const share = p ? Math.max(0, Math.min(100, p.share || 0)) : 0;
      return '<div class="hr-cell' + (isTop ? ' is-top' : '') + '"' +
        (isTop ? ' data-top="Самая популярная"' : '') + '>' +
        '<span class="hr-role"><i class="hr-ico hr-ico-' + r.key + '">' + icon(r.key) + '</i>' +
        esc(r.ru) + '</span>' +
        '<span class="hr-nums"><b>' + wr + '</b><i>' + m + '</i></span>' +
        '<span class="hr-bar" aria-hidden="true"><span style="width:' + share.toFixed(1) + '%"></span></span>' +
        '</div>';
    }).join('');

    const totalWr = entry.totalMatches
      ? fmtWinrate(entry.totalWins / entry.totalMatches * 100)
      : '—';

    return '<div class="hr-row" data-hero-roles>' +
      '<div class="hr-cell hr-all">' +
        '<span class="hr-role">Все роли</span>' +
        '<span class="hr-nums"><b>' + totalWr + '</b><i>' + fmtMatches(entry.totalMatches) + '</i></span>' +
      '</div>' + cells + '</div>';
  }

  /** Подпись об источнике и свежести данных — под строкой */
  function sourceNote(snapshot) {
    const d = snapshot && snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : null;
    const when = d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : '';
    return 'Матчи ранга Divine/Immortal по данным Stratz' + (when ? ', обновлено ' + when : '') +
      '. Проценты — винрейт на позиции, ниже — число матчей.';
  }

  return { ROLES, byId, ICON_FILES, icon, rowHtml, sourceNote, fmtMatches, fmtWinrate };
});

/**
 * Обновление строки ролей в браузере.
 *
 * Страница уже приходит с числами из снимка — поэтому сначала пользователь
 * видит данные, а не спиннер. Этот код только заменяет их на свежие, если
 * Worker отдал более новый срез. Любая ошибка сети оставляет снимок как есть:
 * показать вчерашние честные цифры лучше, чем пустую рамку.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function refresh() {
    const host = document.getElementById('heroRoles');
    if (!host) return;
    const heroId = host.getAttribute('data-hero-id');
    if (!heroId) return;

    fetch('/api/dota/hero-positions', { headers: { 'Accept': 'application/json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(snap => {
        const entry = snap && snap.heroes && snap.heroes[heroId];
        if (!entry || !entry.positions) return;
        const html = window.D2HRoles.rowHtml(entry, { escapeHtml: s => String(s) });
        if (!html) return;
        const oldRow = host.querySelector('[data-hero-roles]');
        if (oldRow) oldRow.outerHTML = html;
        const note = host.querySelector('.hr-note');
        if (note) note.textContent = window.D2HRoles.sourceNote(snap);
      })
      .catch(() => { /* снимок на странице остаётся актуальным ответом */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
