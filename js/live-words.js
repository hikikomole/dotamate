// Частые слова в чате эфира (/live/words/): облако кругов по общему накопительному счётчику /api/live/words-all.
// Площадь круга пропорциональна числу употреблений; круги раскладываются по спирали от центра без наложений
// и перекладываются при смене ширины экрана.
(function () {
  'use strict';
  var cloud = document.getElementById('lwCloud'), meta = document.getElementById('lwMeta');
  if (!cloud) return;
  var data = null, lastW = 0, timer = null;
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return Number(n).toLocaleString('ru-RU'); };
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; }

  function load() {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl && setTimeout(function () { ctl.abort(); }, 20000);
    fetch('/api/live/words-all', ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (!r.ok) throw new Error(r.status === 503 ? 'Статистика временно недоступна.' : 'Сервер ответил ' + r.status + '.');
      return r.json();
    }).then(function (j) {
      if (t) clearTimeout(t);
      if (!j || !Array.isArray(j.words)) throw new Error('Неверный ответ сервера.');
      data = j; showMeta(j); lastW = 0; layout();
    }).catch(function (e) {
      if (t) clearTimeout(t);
      meta.textContent = '';
      cloud.innerHTML = '<p class="lv-muted lw-empty">Не удалось загрузить слова: ' + esc(e.name === 'AbortError' ? 'сервер не ответил за 20 секунд.' : e.message) + ' Обновите страницу позже.</p>';
      if (window.console) console.warn('Частые слова:', e);
    });
  }

  function showMeta(j) {
    var s = 'Учтено <b>' + num(j.matches) + '</b> ' + plural(j.matches, 'матч', 'матча', 'матчей') + ', <b>' + num(j.msgs) + '</b> ' + plural(j.msgs, 'сообщение', 'сообщения', 'сообщений') + ' в чате';
    if (j.since) s += ' · счёт ведётся с ' + new Date(j.since * 1000).toLocaleDateString('ru-RU');
    if (j.pending) s += ' · ещё ' + num(j.pending) + ' ' + plural(j.pending, 'матч', 'матча', 'матчей') + ' в очереди, добавятся в ближайшие обновления';
    meta.innerHTML = s + '.';
  }

  // Раскладка: радиусы ∝ √n, масштаб подбирается под площадь поля; затем спираль от центра.
  function layout() {
    if (!data) return;
    var W = cloud.clientWidth; if (!W || W === lastW) return; lastW = W;
    var words = data.words.slice(0, W < 560 ? 45 : W < 1000 ? 70 : 100);
    if (!words.length) { cloud.style.height = ''; cloud.innerHTML = '<p class="lv-muted lw-empty">В чате матчей пока не набралось слов — загляните позже.</p>'; return; }
    var H0 = W < 560 ? W * 1.25 : W * 0.55, max = words[0][1];
    var sum = words.reduce(function (a, w) { return a + w[1]; }, 0);
    var k = Math.sqrt(H0 * W * 0.5 / (Math.PI * sum)), rMax = Math.min(W * (W < 560 ? 0.2 : 0.12), k * Math.sqrt(max));
    k = rMax / Math.sqrt(max);
    var rMin = W < 560 ? 23 : 24, placed = [], cx = W / 2, cy = H0 / 2, gap = 4;
    words.forEach(function (w) {
      var r = Math.max(rMin, k * Math.sqrt(w[1])), x = cx, y = cy;
      for (var a = 0, i = 0; i < 6000; i++, a += 0.12) {
        var d = 2.2 * a; x = cx + d * Math.cos(a); y = cy + d * Math.sin(a) * (W < 560 ? 1.3 : 0.7);
        if (x - r < 0 || x + r > W) continue;
        var ok = true;
        for (var j = 0; j < placed.length; j++) { var p = placed[j], dx = p.x - x, dy = p.y - y, rr = p.r + r + gap; if (dx * dx + dy * dy < rr * rr) { ok = false; break; } }
        if (ok) break;
      }
      placed.push({ x: x, y: y, r: r, w: w[0], n: w[1] });
    });
    var top = Infinity, bot = -Infinity;
    placed.forEach(function (p) { top = Math.min(top, p.y - p.r); bot = Math.max(bot, p.y + p.r); });
    cloud.style.height = Math.ceil(bot - top + 8) + 'px';
    cloud.innerHTML = placed.map(function (p, i) {
      var len = Math.max(p.w.length, 2), fs = Math.min(p.r * 0.5, (p.r * 1.7) / (len * 0.62)), share = p.n / max;
      var tier = share > 0.5 ? 1 : share > 0.2 ? 2 : share > 0.08 ? 3 : 4;
      return '<div class="lw-b lw-t' + tier + '" role="listitem" title="' + esc(p.w) + ' — ' + num(p.n) + '" aria-label="' + esc(p.w) + ', ' + num(p.n) + ' ' + plural(p.n, 'раз', 'раза', 'раз') + '" style="left:' + (p.x - p.r).toFixed(1) + 'px;top:' + (p.y - p.r - top + 4).toFixed(1) + 'px;width:' + (2 * p.r).toFixed(1) + 'px;height:' + (2 * p.r).toFixed(1) + 'px;animation-delay:' + Math.min(i * 18, 900) + 'ms">'
        + '<span class="lw-w" style="font-size:' + Math.max(10, fs).toFixed(1) + 'px">' + esc(p.w) + '</span>'
        + (p.r >= 34 ? '<span class="lw-n" style="font-size:' + Math.max(10, Math.min(16, p.r * 0.22)).toFixed(1) + 'px">' + num(p.n) + '</span>' : '') + '</div>';
    }).join('');
    var els = cloud.querySelectorAll('.lw-b');
    nodes = placed.map(function (p, i) { return { el: els[i], hx: p.x, hy: p.y - top + 4, r: p.r, x: 0, y: 0, vx: 0, vy: 0 }; });
    bounds = { w: W, h: Math.ceil(bot - top + 8) };
  }

  // Мягкая реакция на курсор/касание: курсор отталкивает ближние круги, они пружиной возвращаются на место.
  // Смещение — CSS translate (transform остаётся у наведения, scale — у анимации появления).
  // Цикл requestAnimationFrame идёт, только пока есть движение; при prefers-reduced-motion отключено.
  var nodes = [], bounds = null, ptr = null, raf = 0;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var FORCE_R = 130, FORCE = 4, SPRING = 0.06, DAMP = 0.82, MAXOFF = 0.45;
  function step() {
    raf = 0; var moving = false, i, j, n, a, b;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]; var cx = n.hx + n.x, cy = n.hy + n.y;
      n.vx -= n.x * SPRING; n.vy -= n.y * SPRING; n.er = n.r;
      if (ptr) {
        var dx = cx - ptr.x, dy = cy - ptr.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, reach = FORCE_R + n.r * 0.5;
        if (d < n.r && ptr.mouse) n.er = n.r * 1.18;   // круг под курсором увеличен :hover — соседи учитывают его размер
        if (d < reach) { var f = FORCE * Math.pow(1 - d / reach, 2) * (40 / (n.r + 20)); n.vx += dx / d * f; n.vy += dy / d * f; }
      }
    }
    // Лёгкие касания соседей: сразу снимаем половину пересечения и даём толчок — перекрытие не задерживается.
    for (i = 0; i < nodes.length; i++) for (j = i + 1; j < nodes.length; j++) {
      a = nodes[i]; b = nodes[j];
      var ex = (b.hx + b.x) - (a.hx + a.x), ey = (b.hy + b.y) - (a.hy + a.y), rr = a.er + b.er;
      if (Math.abs(ex) >= rr || Math.abs(ey) >= rr) continue;
      var dd = Math.sqrt(ex * ex + ey * ey) || 0.01; if (dd >= rr) continue;
      var over = rr - dd, push = over * 0.15, fix = over * 0.5, ux = ex / dd, uy = ey / dd, wa = b.r / rr, wb = a.r / rr;
      a.vx -= ux * push * wa; a.vy -= uy * push * wa; b.vx += ux * push * wb; b.vy += uy * push * wb;
      a.x -= ux * fix * wa; a.y -= uy * fix * wa; b.x += ux * fix * wb; b.y += uy * fix * wb;
    }
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]; n.vx *= DAMP; n.vy *= DAMP; n.x += n.vx; n.y += n.vy;
      var lim = Math.min(48, n.r * MAXOFF + 10), off = Math.sqrt(n.x * n.x + n.y * n.y);
      if (off > lim) { n.x *= lim / off; n.y *= lim / off; }
      n.x = Math.max(n.r - n.hx, Math.min(bounds.w - n.r - n.hx, n.x));   // не за края облака
      n.y = Math.max(n.r - n.hy, Math.min(bounds.h - n.r - n.hy, n.y));
      if (Math.abs(n.vx) > 0.02 || Math.abs(n.vy) > 0.02 || Math.abs(n.x) > 0.2 || Math.abs(n.y) > 0.2) moving = true;
      else { n.x = n.y = n.vx = n.vy = 0; }
      if (!n.x && !n.y && n.er > n.r) moving = true;
      var t = n.x || n.y ? n.x.toFixed(1) + 'px ' + n.y.toFixed(1) + 'px' : '';
      if (n.el._t !== t) { n.el._t = t; n.el.style.translate = t; }
    }
    if (moving || ptr) raf = requestAnimationFrame(step);
  }
  function kick() { if (!raf && nodes.length && !(still && still.matches)) raf = requestAnimationFrame(step); }
  function setPtr(e) { clearTimeout(upT); var r = cloud.getBoundingClientRect(); ptr = { x: e.clientX - r.left, y: e.clientY - r.top, mouse: e.pointerType === 'mouse' }; kick(); }
  function dropPtr() { ptr = null; kick(); }
  cloud.addEventListener('pointermove', setPtr);
  cloud.addEventListener('pointerdown', setPtr);
  cloud.addEventListener('pointerleave', dropPtr);
  cloud.addEventListener('pointercancel', dropPtr);
  var upT = 0;
  cloud.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') { clearTimeout(upT); upT = setTimeout(dropPtr, 350); } });   // касание: короткий толчок, затем возврат
  document.addEventListener('visibilitychange', function () { if (document.hidden) { ptr = null; if (raf) cancelAnimationFrame(raf); raf = 0; nodes.forEach(function (n) { n.x = n.y = n.vx = n.vy = 0; n.el.style.translate = ''; n.el._t = ''; }); } });

  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(layout, 150); });
  load();
})();
