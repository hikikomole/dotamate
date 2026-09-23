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
  const ICONS = {
    carry: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 2.6 19 8.2l-8.6 8.6-2.2-2.2L16.8 6z" fill="currentColor" fill-opacity=".25"/><path d="M20.5 2.6 19 8.2l-8.6 8.6-2.2-2.2L16.8 6z"/><path d="m9.9 15.1-2.6 2.6"/><path d="M6.2 13.6 4.4 15.4l4.2 4.2 1.8-1.8z" fill="currentColor" fill-opacity=".35"/><path d="m5.1 18.6-2.4 2.4"/></g></svg>',
    mid: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 19.4C4.6 11.3 11.3 4.6 19.4 4.6"/><path d="M4.6 19.4 19.4 4.6"/><path d="M15.4 4.6h4v4"/><path d="M4.6 15.4v4h4"/><path d="m11 13 2.6 2.6" stroke-opacity=".55"/></g></svg>',
    offlane: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.4 4 5.2v6.4c0 4.6 3.2 8.6 8 10.4 4.8-1.8 8-5.8 8-10.4V5.2z" fill="currentColor" fill-opacity=".22"/><path d="M12 2.4 4 5.2v6.4c0 4.6 3.2 8.6 8 10.4 4.8-1.8 8-5.8 8-10.4V5.2z"/><path d="M13.2 7.2 9.6 12.6h2.8l-1.2 4.2 3.8-5.6h-2.9z" fill="currentColor" fill-opacity=".9" stroke-width="1.1"/></g></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.2c2.7 3.9 1.3 5.9.3 7.2-.9 1.2-2.4 2.2-2.4 4.3a4.1 4.1 0 0 0 8.2 0c0-1-.3-1.8-.7-2.5 2.2 1.3 3.4 3.3 3.4 5.6A8.8 8.8 0 0 1 12 21.8a8.8 8.8 0 0 1-8.8-5c0-6.6 6.9-8.4 8.8-14.6" fill="currentColor" fill-opacity=".22"/><path d="M12 2.2c2.7 3.9 1.3 5.9.3 7.2-.9 1.2-2.4 2.2-2.4 4.3a4.1 4.1 0 0 0 8.2 0c0-1-.3-1.8-.7-2.5 2.2 1.3 3.4 3.3 3.4 5.6A8.8 8.8 0 0 1 12 21.8a8.8 8.8 0 0 1-8.8-5c0-6.6 6.9-8.4 8.8-14.6"/></g></svg>',
    hardsupport: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 12.4V7.9a1.35 1.35 0 0 1 2.7 0v3.3M9.1 11.2V6.4a1.35 1.35 0 0 1 2.7 0v4.6M11.8 11.2V7.4a1.35 1.35 0 0 1 2.7 0v4M14.5 11.6v-2a1.3 1.3 0 0 1 2.6 0v5.1c0 3.6-2.2 6.5-5.4 6.5-3.1 0-5.3-2-5.3-5.2v-2.3l-1.9-1.5a1.3 1.3 0 0 1 1.5-2.1l1.4 1" fill="currentColor" fill-opacity=".22"/><path d="M18.6 3.2 19.3 5l1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" fill-opacity=".85" stroke-width="1"/><path d="m4.4 2.6.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" fill-opacity=".7" stroke-width=".9"/></g></svg>'
  };

  function icon(key) { return ICONS[key] || ''; }

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

  return { ROLES, byId, ICONS, icon, rowHtml, sourceNote, fmtMatches, fmtWinrate };
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
