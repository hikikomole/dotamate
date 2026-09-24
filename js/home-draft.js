// Полоса драфта на первом экране.
//
// Слоты, выбор героя и вердикт живут здесь же, на первом экране: страница
// никуда не прыгает. Ниже по странице — тот же самый инструмент Ranked All
// Pick: состояние, история и все расчёты у них общие (мост window.D2HDraft
// из js/draft-tool.js), поэтому герой, поставленный наверху, стоит и внизу.
// Перейти к полному инструменту можно только кнопкой «Открыть драфт».
(function () {
  var strip = document.getElementById('homeDraft');
  if (!strip) return;

  var SIDES = [
    { side: 'radiant', label: 'Мы', cls: 'us' },
    { side: 'dire', label: 'Они', cls: 'them' }
  ];
  var LIMIT = 40;
  var open = null;   // { side, slot, el }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pp(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ','); }
  // Перерисовка общего инструмента ниже по странице может утащить прокрутку
  // к себе (там заново собираются слоты, рекомендации и линии). Первый экран
  // от этого прыгал, поэтому вокруг изменений состояния держим позицию.
  function keepScroll(fn) {
    var y = window.pageYOffset;
    fn();
    requestAnimationFrame(function () {
      if (Math.abs(window.pageYOffset - y) > 2) window.scrollTo(0, y);
      setTimeout(function () {
        if (Math.abs(window.pageYOffset - y) > 2) window.scrollTo(0, y);
      }, 60);
    });
  }

  function api() { return window.D2HDraft; }

  var rowsBox = strip.querySelector('.hm-draft-rows');
  var verdict = strip.querySelector('.hm-draft-verdict');
  var picker = null;

  // ---------- слоты и вердикт ----------
  function slotHtml(side, i, id) {
    var a = api();
    var h = id && a ? a.hero(id) : null;
    var cls = 'hm-slot hm-slot-' + (side === 'radiant' ? 'us' : 'them') + (h ? ' is-filled' : '');
    var inner = h
      ? '<img src="' + a.icon(h) + '" alt="" loading="lazy" decoding="async"><span class="hm-slot-x" aria-hidden="true">×</span>'
      : '<span class="hm-slot-plus" aria-hidden="true">+</span>';
    return '<button type="button" class="' + cls + '" data-side="' + side + '" data-slot="' + i +
      '" aria-label="' + (h ? esc(h.localized_name) + ', убрать' : 'Слот ' + (i + 1) + ', выбрать героя') +
      '">' + inner + '</button>';
  }

  function draw() {
    var a = api();
    var picks = a && a.ready() ? a.picks()
      : { radiant: [null, null, null, null, null], dire: [null, null, null, null, null] };

    rowsBox.innerHTML = SIDES.map(function (s) {
      return '<div class="hm-draft-row"><span class="hm-side hm-side-' + s.cls + '">' + s.label + '</span>' +
        picks[s.side].map(function (id, i) { return slotHtml(s.side, i, id); }).join('') + '</div>';
    }).join('');

    var sum = a && a.ready() ? a.summary() : null;
    if (!sum || !sum.any) {
      verdict.innerHTML = '<p class="hm-draft-hint">Нажми на пустой слот — выберешь героя прямо здесь. ' +
        'Посчитаем синергию, контрпики и расклад по линиям по матрице пар из матчей Divine и Immortal.</p>';
      return;
    }
    var share = Math.max(6, Math.min(94, 50 + sum.advantage * 0.6));
    var recs = sum.recs.map(function (r) {
      return '<button type="button" class="hm-rec" data-pick="' + r.id + '" data-side="' + r.side + '">' +
        '<img src="' + r.icon + '" alt="" loading="lazy"><span><b>' + esc(r.name) +
        '</b><small>' + pp(r.all) + '</small></span></button>';
    }).join('');
    verdict.innerHTML =
      '<div class="hm-adv"><span class="hm-adv-label">Перевес драфта</span>' +
      '<b class="hm-adv-num ' + (sum.advantage >= 0 ? 'hm-up' : 'hm-down') + '">' + pp(sum.advantage) + '&nbsp;пп</b>' +
      '<span class="hm-adv-bar"><i style="width:' + share.toFixed(1) + '%"></i></span>' +
      '<small>Сумма парных отклонений, а не вероятность победы</small></div>' +
      (recs ? '<div class="hm-recs"><span class="hm-recs-label">Кого добавить</span><div class="hm-recs-row">' + recs + '</div></div>' : '');
  }

  // ---------- свой выбор героя, прямо в полосе ----------
  function buildPicker() {
    if (picker) return picker;
    picker = document.createElement('div');
    picker.className = 'hm-picker';
    picker.hidden = true;
    picker.innerHTML =
      '<div class="hm-picker-head"><span class="hm-picker-tag"></span>' +
      '<button type="button" class="hm-picker-close" aria-label="Закрыть">×</button></div>' +
      '<label class="hm-picker-search"><input type="search" placeholder="Имя героя…" autocomplete="off" aria-label="Поиск героя"></label>' +
      '<div class="hm-picker-list" role="listbox"></div>';
    strip.appendChild(picker);
    picker.querySelector('.hm-picker-close').addEventListener('click', closePicker);
    picker.querySelector('input').addEventListener('input', function (e) { drawList(e.target.value); });
    picker.querySelector('input').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePicker(); return; }
      if (e.key === 'Enter') {
        var first = picker.querySelector('.hm-picker-list button');
        if (first) first.click();
      }
    });
    picker.querySelector('.hm-picker-list').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-hero]');
      if (!b || !open) return;
      var id = Number(b.dataset.hero), t = open;
      keepScroll(function () { api().set(t.side, t.slot, id); });
      closePicker();
    });
    return picker;
  }

  function drawList(q) {
    var rows = api().candidates(q, LIMIT);
    var box = picker.querySelector('.hm-picker-list');
    box.innerHTML = rows.length
      ? rows.map(function (h) {
          return '<button type="button" data-hero="' + h.id + '"><img src="' + h.icon + '" alt="" loading="lazy">' +
            '<span><b>' + esc(h.name) + '</b><small>' + esc(h.pos) +
            (h.matches ? (h.pos ? ' · ' : '') + h.matches.toLocaleString('ru-RU') + ' матчей' : '') +
            '</small></span></button>';
        }).join('')
      : '<p class="hm-picker-empty">Никого не нашлось</p>';
  }

  function openPicker(side, slot, el) {
    buildPicker();
    open = { side: side, slot: slot, el: el };
    picker.querySelector('.hm-picker-tag').textContent =
      (side === 'radiant' ? 'Мы' : 'Они') + ' · слот ' + (slot + 1);
    var input = picker.querySelector('input');
    input.value = '';
    drawList('');
    picker.hidden = false;
    // Ставим окно у слота, не вылезая за края полосы и за нижний край экрана.
    var sr = strip.getBoundingClientRect(), er = el.getBoundingClientRect();
    var w = picker.offsetWidth || 300, hgt = picker.offsetHeight || 330;
    var left = Math.max(8, Math.min(er.left - sr.left, strip.clientWidth - w - 8));
    picker.style.left = left + 'px';
    // Полоса стоит у нижнего края первого экрана, и окно под слотом часто
    // не помещается в видимую часть. Тогда раскрываем его вверх — иначе
    // браузер сам утаскивает страницу вниз при первом же клике по списку.
    var roomBelow = window.innerHeight - er.bottom;
    if (roomBelow < hgt + 16 && er.top > hgt + 16) {
      picker.style.top = (er.top - sr.top - hgt - 8) + 'px';
    } else {
      picker.style.top = (er.bottom - sr.top + 8) + 'px';
    }
    strip.querySelectorAll('.hm-slot.is-open').forEach(function (b) { b.classList.remove('is-open'); });
    el.classList.add('is-open');
    input.focus();
  }

  function closePicker() {
    if (!picker || picker.hidden) return;
    picker.hidden = true;
    open = null;
    strip.querySelectorAll('.hm-slot.is-open').forEach(function (b) { b.classList.remove('is-open'); });
  }

  // ---------- события ----------
  strip.addEventListener('click', function (e) {
    if (e.target.closest('.hm-picker')) return;
    var slot = e.target.closest('.hm-slot');
    var rec = e.target.closest('.hm-rec');
    var a = api();
    if (!slot && !rec) return;
    e.preventDefault();
    if (!a) return;
    if (!a.ready()) { a.load(); return; }

    if (slot) {
      var side = slot.dataset.side, i = Number(slot.dataset.slot);
      // По крестику на занятом слоте — убрать героя, иначе открыть выбор.
      if (slot.classList.contains('is-filled') && e.target.closest('.hm-slot-x')) {
        keepScroll(function () { a.clear(side, i); }); closePicker(); return;
      }
      if (open && open.side === side && open.slot === i) { closePicker(); return; }
      openPicker(side, i, slot);
      return;
    }
    // Рекомендация — сразу в первый свободный слот своей стороны.
    var rside = rec.dataset.side;
    var free = a.picks()[rside].indexOf(null);
    if (free === -1) return;
    keepScroll(function () { a.set(rside, free, Number(rec.dataset.pick)); });
  });

  document.addEventListener('click', function (e) {
    if (!picker || picker.hidden) return;
    if (!e.target.closest('#homeDraft')) closePicker();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePicker(); });
  window.addEventListener('resize', closePicker);

  function attach() {
    if (window.D2HDraft) { window.D2HDraft.onChange(function () { closePicker(); draw(); }); draw(); return true; }
    return false;
  }
  if (!attach()) {
    var tries = 0;
    var t = setInterval(function () { if (attach() || ++tries > 60) clearInterval(t); }, 100);
  }
  // Данные драфта нужны сразу: полоса стоит выше самого инструмента.
  if (window.D2HDraft) window.D2HDraft.load();
  draw();
})();
