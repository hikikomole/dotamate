// Фоновое видео первого экрана главной.
//
// Файл тяжёлый (~21 МБ с CDN Valve), поэтому он не грузится вместе со
// страницей: у <video> стоит preload="none", а до запуска виден poster —
// первый кадр того же ролика, 62 КБ. Подмены не видно, потому что кадр
// совпадает с началом видео.
//
// Запускаем только когда все условия сошлись: первый экран действительно на
// виду, браузер не просит экономить трафик, человек не включал «меньше
// движения». Выбор «выключить» запоминаем, чтобы не навязывать при каждом
// заходе.
(function () {
  var box = document.getElementById('homeBg');
  var vid = document.getElementById('homeBgVideo');
  var btn = document.getElementById('homeBgToggle');
  if (!box || !vid) return;

  var KEY = 'd2hHomeBg';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  var conn = navigator.connection || navigator.webkitConnection || {};
  var thrifty = conn.saveData === true || /(^|\-)2g$/.test(conn.effectiveType || '');
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  // Экономный режим и системная настройка перевешивают всё, кроме прямого
  // «включить» от самого человека.
  if (reduce || (thrifty && stored !== 'on')) return;
  if (stored === 'off') { show(false); return; }

  var started = false, watching = null;

  function play() {
    var p = vid.play();
    if (p && p.catch) p.catch(function () { started = false; }); // автозапуск может быть запрещён — тогда остаётся кадр
  }
  function label(on) {
    if (!btn) return;
    btn.innerHTML = on ? '&#10074;&#10074;' : '&#9654;';
    btn.setAttribute('aria-label', on ? 'Остановить фоновое видео' : 'Запустить фоновое видео');
  }
  function show(on) { if (btn) { btn.hidden = false; label(on); } }

  function begin() {
    if (started) return;
    started = true;
    vid.setAttribute('preload', 'auto');
    play();
    show(true);
  }

  // Пока первый экран не на виду — не тратим трафик.
  if ('IntersectionObserver' in window) {
    watching = new IntersectionObserver(function (rows) {
      rows.forEach(function (r) {
        if (r.isIntersecting) { begin(); watching.disconnect(); }
        });
    }, { rootMargin: '120px' });
    watching.observe(box);
  } else {
    begin();
  }

  // Ушли на другую вкладку — ставим на паузу, вернулись — продолжаем.
  document.addEventListener('visibilitychange', function () {
    if (!started) return;
    if (document.hidden) vid.pause();
    else if (!btn || btn.getAttribute('aria-label').indexOf('Остановить') === 0) play();
  });

  if (btn) btn.addEventListener('click', function () {
    if (!started) { begin(); try { localStorage.setItem(KEY, 'on'); } catch (e) {} return; }
    if (vid.paused) { play(); label(true); try { localStorage.setItem(KEY, 'on'); } catch (e) {} }
    else { vid.pause(); label(false); try { localStorage.setItem(KEY, 'off'); } catch (e) {} }
  });
})();
