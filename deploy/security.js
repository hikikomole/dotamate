/* DotaMate: согласие на cookies (152-ФЗ).
   Счётчик Яндекс.Метрики и реклама РСЯ размечены в HTML как
   <script type="text/plain" data-consent="analytics|ads">.
   Метрика запускается сразу (уведомление с возможностью отказа),
   РСЯ — только после «Принять». Выбор хранится в localStorage (dmConsent).
   Ссылка «Отключить cookies» (data-consent-revoke) выключает Метрику и рекламу.
   Файл подключён в <head> всех страниц, поэтому живёт здесь. */
(function () {
  'use strict';
  var KEY = 'dmConsent';
  var VERSION = 1;

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && v.v === VERSION ? v : null;
    } catch (e) { return null; }
  }
  function save(v) {
    try {
      if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY);
    } catch (e) { /* приватный режим: выбор действует до закрытия вкладки */ }
  }

  function activate(category) {
    var nodes = document.querySelectorAll('script[type="text/plain"][data-consent="' + category + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var old = nodes[i];
      var s = document.createElement('script');
      if (old.getAttribute('data-src')) { s.src = old.getAttribute('data-src'); s.async = true; }
      else { s.text = old.text; }
      old.parentNode.replaceChild(s, old);
    }
  }

  function clearYandexCookies() {
    var host = location.hostname;
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (!/^(_ym|_yasc|yandexuid|ymex|yabs)/.test(n)) return;
      [host, '.' + host].forEach(function (d) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + d;
      });
      document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
  }

  var ICON = '<svg class="dm-consent-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12.5A9 9 0 1 1 11.5 3a3 3 0 0 0 3.5 3.5 3 3 0 0 0 3.5 3.5 3 3 0 0 0 2.5 2.5z"/>' +
    '<circle cx="8.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="9.5" cy="15.5" r=".9" fill="currentColor"/></svg>';

  function show() {
    var banner = document.createElement('div');
    banner.className = 'dm-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Уведомление о cookies');
    banner.innerHTML = ICON +
      '<p class="dm-consent-text">Мы используем <a href="/privacy/#cookies">cookies</a>, чтобы сайт был лучше</p>' +
      '<button type="button" class="dm-consent-btn">Принять</button>';
    banner.querySelector('.dm-consent-btn').addEventListener('click', function () {
      save({ v: VERSION, analytics: true, ads: true, t: new Date().toISOString() });
      banner.remove();
      activate('analytics');
      activate('ads');
    });
    document.body.appendChild(banner);
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-consent-revoke]');
    if (!t) return;
    e.preventDefault();
    save({ v: VERSION, analytics: false, ads: false, t: new Date().toISOString() });
    clearYandexCookies();
    location.reload();
  });

  function init() {
    var c = read();
    if (!c || c.analytics) activate('analytics');
    if (c && c.ads) activate('ads');
    if (!c) show();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
