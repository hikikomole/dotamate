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
    { side: 'radiant', label: 'Свет', cls: 'us' },
    { side: 'dire', label: 'Тьма', cls: 'them' }
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
    var recs = sum.recs.map(function (r) {
      return '<button type="button" class="hm-rec" data-pick="' + r.id + '" data-side="' + r.side + '">' +
        '<img src="' + r.icon + '" alt="" loading="lazy"><span><b>' + esc(r.name) +
        '</b><small>' + pp(r.all) + '</small></span></button>';
    }).join('');
    // Шанс победы — как в эфире: проценты сторон и полоса. Без калибровки среза (Stratz) — перевес в п.п.
    var pct = function (v) { return v.toFixed(1).replace('.', ',') + '%'; };
    var win = sum.prob != null
      ? '<div class="hm-win"><span class="hm-win-label">Шанс победы по драфту</span>' +
        '<span class="hm-win-row"><b class="hm-win-us">' + pct(sum.prob) + '</b><span class="hm-win-bar"><i class="hm-win-us" style="width:' + sum.prob.toFixed(1) + '%"></i><i class="hm-win-them" style="width:' + (100 - sum.prob).toFixed(1) + '%"></i></span><b class="hm-win-them">' + pct(100 - sum.prob) + '</b></span>' +
        '<small>Свет · Тьма — по синергии и контрпикам, ход матча не учитывается</small></div>'
      : '<div class="hm-win"><span class="hm-win-label">Перевес драфта</span><b class="hm-win-num ' + (sum.advantage >= 0 ? 'hm-up' : 'hm-down') + '">' + pp(sum.advantage) + '&nbsp;п.п.</b>' +
        '<small>Сумма парных отклонений, а не вероятность победы</small></div>';
    verdict.innerHTML = win +
      (recs ? '<div class="hm-recs"><span class="hm-recs-label">Кого добавить</span><div class="hm-recs-row">' + recs + '</div></div>' : '') +
      '<div class="hm-builds" id="hmBuilds"></div>';
    builds(picks);
  }

  // ---------- что собирают выбранные герои (вариант А) ----------
  // Только реальные покупки из нашей базы (data/hero-items.json, Stratz, по фазам матча).
  // «Против этого драфта» честно посчитать пока нечем — показываем, что герой покупает обычно.
  // Файлы грузятся лениво, после первого выбранного героя: ~400 КБ не нужны тем, кто драфт не трогает.
  var itemData = null, itemLoading = null;
  function loadItems() {
    if (itemData) return Promise.resolve(itemData);
    if (!itemLoading) itemLoading = Promise.all(['/data/hero-items.json', '/data/items-ru.json', '/data/item-impact.json'].map(function (u, i) {
      return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .catch(function (e) { if (i === 2) return null; throw e; }); // без файла варианта Б работает вариант А
    })).then(function (r) {
      // items-ru.json: items — объект «ключ → предмет», не массив.
      var byId = {}, byKey = r[1].items || {};
      Object.keys(byKey).forEach(function (k) { byId[byKey[k].id] = byKey[k]; byKey[k].key = k; });
      return (itemData = { heroes: r[0].heroes, src: r[0].source, items: byId, byKey: byKey, impact: r[2] });
    }).catch(function (e) { itemLoading = null; throw e; });
    return itemLoading;
  }
  function slugOf(icon) { var m = /\/assets\/heroes\/([a-z0-9_]+)\.(?:png|webp)/.exec(icon || ''); return m ? m[1] : ''; }
  // Вариант Б: игрок отмечает предметы в сборке героя (не больше MAX_BUILD), рядом — поправка к доле побед
  // по data/item-impact.json (tools/build-item-impact.js). Это относительный эффект «этот предмет против обычной
  // сборки героя» по наблюдениям, он не откалиброван и в прогноз по драфту не входит — показывается отдельно.
  var MAX_BUILD = 6, chosen = {}; // heroId -> [item keys]
  // Ручная замена: place[heroId][ключ выбранного] = ключ предмета обычной сборки, на чьё место он встал.
  // armed — выбранный предмет, для которого ждём нажатия на предмет сборки (второй способ: «куда поставить»).
  var place = {}, armed = null;
  function pp1(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ','); }
  function builds(picks) {
    var box = document.getElementById('hmBuilds');
    var ids = picks.radiant.filter(Boolean).concat(picks.dire.filter(Boolean));
    if (!box || !ids.length) return;
    loadItems().then(function (d) {
      var a = api(), imp = d.impact && d.impact.heroes || {}, total = { radiant: 0, dire: 0 }, used = { radiant: 0, dire: 0 };
      var row = function (id, side) {
        var h = d.heroes[id], hero = a.hero(id); if (!hero) return '';
        // «Обычно»: частые покупки середины и поздней игры без повторов, не больше 5.
        // Выбранный предмет из рамки ставится в эту сборку: если он там уже есть — подсвечивается;
        // сапоги заменяют сапоги; иначе заменяется самый редкий из ещё не заменённых предметов.
        var usual = function (sel) {
          if (!h) return '';
          var seen = {}, slots = [];
          (h.mid || []).slice(0, 3).concat((h.late || []).slice(0, 3)).forEach(function (x) {
            var it = d.items[String(x.i)]; if (!it || seen[x.i] || slots.length >= 5) return; seen[x.i] = 1;
            slots.push({ it: it, pct: Math.round(100 * x.g / h.n), g: x.g, put: null });
          });
          var BOOTS = /boots|treads|greaves/, man = place[id] || {};
          // Сначала ручные замены (игрок сам указал место), потом автоматические.
          sel.forEach(function (k) {
            var it = d.byKey[k], t = man[k] && slots.filter(function (s) { return !s.put && s.it.key === man[k]; })[0];
            if (it && t) { if (t.it.key !== k) t.old = t.it; t.put = it; t.k = k; }
          });
          sel.forEach(function (k) {
            if (slots.some(function (s) { return s.k === k; })) return;
            var it = d.byKey[k]; if (!it) return;
            var same = slots.filter(function (s) { return !s.put && s.it.key === k; })[0];
            if (same) { same.put = same.it; same.k = k; return; }
            var free = slots.filter(function (s) { return !s.put; });
            var boots = BOOTS.test(k) ? free.filter(function (s) { return BOOTS.test(s.it.key || ''); })[0] : null;
            var t = boots || free.sort(function (a, b) { return a.g - b.g; })[0];
            if (t) { t.old = t.it; t.put = it; t.k = k; }
          });
          var arm = armed && armed.hero === id;
          return slots.map(function (s) {
            var key = esc(s.old ? s.old.key : s.it.key), attrs = ' data-hero="' + id + '" data-slot="' + key + '"';
            if (!s.put) {
              var tt = esc(s.it.dname) + ' — в ' + s.pct + '% матчей героя' + (arm ? '. Нажмите, чтобы поставить сюда выбранный предмет' : '');
              return arm ? '<button type="button" class="hm-bi hm-bi-slot"' + attrs + ' title="' + tt + '"><img src="' + esc(s.it.img) + '" alt="' + esc(s.it.dname) + '" loading="lazy"></button>'
                : '<span class="hm-bi" title="' + tt + '"><img src="' + esc(s.it.img) + '" alt="' + esc(s.it.dname) + '" loading="lazy"></span>';
            }
            var t = (s.old ? esc(s.put.dname) + ' вместо ' + esc(s.old.dname) : esc(s.put.dname) + ' — уже в обычной сборке') + '. Нажмите, чтобы выбрать другое место';
            return '<button type="button" class="hm-bi hm-bi-put' + (arm && armed.k === s.k ? ' is-armed' : '') + '"' + attrs + ' data-item="' + esc(s.k) + '" title="' + t + '"><img src="' + esc(s.put.img) + '" alt="' + esc(s.put.dname) + '" loading="lazy"></button>';
          }).join('');
        };
        var hi = imp[id], sel = chosen[id] || [], effect = 0;
        sel.forEach(function (k) { if (hi && hi[k]) effect += hi[k][0]; });
        if (sel.length) { total[side] += effect; used[side]++; }
        var opts = hi ? Object.keys(hi).sort(function (x, y) { return hi[x][3] - hi[y][3]; }).map(function (k) {
          var it = d.byKey[k], on = sel.indexOf(k) >= 0; if (!it) return '';
          return '<button type="button" class="hm-bi hm-bi-pick' + (on ? ' on' : '') + '" data-hero="' + id + '" data-item="' + esc(k) + '" aria-pressed="' + on + '" title="' + esc(it.dname) +
            ' — ' + pp1(hi[k][0]) + ' п.п. к доле побед относительно обычной сборки героя (купил к ' + Math.round(hi[k][3] / 60) + '-й мин: ' + hi[k][1] + ' матчей, не покупал: ' + hi[k][2] + ')"><img src="' + esc(it.img) + '" alt="' + esc(it.dname) + '" loading="lazy"></button>';
        }).join('') : '';
        var slug = slugOf(a.icon(hero));
        return '<div class="hm-build hm-build-' + side + '">' +
          (slug ? '<a href="/hero/' + esc(slug) + '/guide/" title="Гайд: ' + esc(hero.localized_name || '') + '">' : '') + '<img class="hm-build-hero" src="' + a.icon(hero) + '" alt="" loading="lazy">' + (slug ? '</a>' : '') +
          '<span class="hm-build-usual">' + usual(sel) + '</span>' +
          (opts ? '<span class="hm-build-pick">' + opts + '</span>' : '') +
          (sel.length ? '<b class="hm-build-eff ' + (effect >= 0 ? 'hm-up' : 'hm-down') + '">' + pp1(effect) + '</b>' : '') + '</div>';
      };
      var radRows = picks.radiant.filter(Boolean).map(function (id) { return row(id, 'radiant'); }).join('');
      var direRows = picks.dire.filter(Boolean).map(function (id) { return row(id, 'dire'); }).join('');
      var head = function (cls, t) { return '<div class="hm-build-head ' + cls + '">' + t + '</div>'; };
      var rows = radRows || direRows ? '<div class="hm-build-cols">' + (radRows ? '<div>' + head('hm-side-us', 'Свет') + radRows + '</div>' : '') + (direRows ? '<div>' + head('hm-side-them', 'Тьма') + direRows + '</div>' : '') + '</div>' : '';
      // Строка поправки есть всегда (место под неё зарезервировано), видна — только когда выбран предмет:
      // иначе при нажатии на предмет весь блок прыгал вниз на высоту строки.
      var on = used.radiant || used.dire;
      var sumLine = '<p class="hm-build-sum' + (on ? '' : ' is-off') + '"' + (on ? '' : ' aria-hidden="true"') + '>Поправка за сборку к доле побед: Свет <b>' + pp1(total.radiant) + '</b> п.п., Тьма <b>' + pp1(total.dire) + '</b> п.п.</p>';
      var n = d.impact ? d.impact.matches.toLocaleString('ru-RU') : '0';
      if (box.isConnected) box.innerHTML = rows ? '<div class="hm-build-legend"><span class="hm-recs-label">Предметы героев</span><span>обычно покупают</span><span class="hm-build-key">в рамке — нажмите, чтобы поставить в сборку; затем можно нажать предмет сборки, чтобы выбрать место</span></div>' + rows + sumLine +
        '<details class="hm-build-how"><summary>Как считается</summary><p>«Обычно» — частые покупки героя в середине и конце игры (' + esc(d.src) + '). «Сборка» — предметы, по которым хватает данных (≥ ' +
        (d.impact ? d.impact.minN : 100) + ' матчей в каждой группе, ' + n + ' детальных матчей Stratz, в основном ниже Divine): поправка показывает, насколько предмет, купленный вовремя, связан с победой сильнее или слабее обычной сборки этого героя. Это наблюдение, а не откалиброванный прогноз, поэтому в вероятность по драфту оно не входит.</p></details>' : '';
    }).catch(function () { if (box.isConnected) box.innerHTML = '<small class="hm-build-src">Не удалось загрузить сборки — попробуйте обновить страницу.</small>'; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.hm-bi-pick'); if (!b) return;
    var id = Number(b.getAttribute('data-hero')), k = b.getAttribute('data-item'), sel = chosen[id] || (chosen[id] = []);
    var i = sel.indexOf(k);
    // Способ 1: нажатие ставит предмет в сборку автоматически и «вооружает» его — следующим нажатием
    // на предмет обычной сборки этого героя (способ 2) можно выбрать место самому.
    if (i >= 0) { sel.splice(i, 1); if (place[id]) delete place[id][k]; if (armed && armed.hero === id && armed.k === k) armed = null; }
    else if (sel.length < MAX_BUILD) { sel.push(k); armed = { hero: id, k: k }; }
    var a = api(); if (a && a.ready()) builds(a.picks());
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.hm-bi-slot, .hm-bi-put'); if (!b) return;
    var id = Number(b.getAttribute('data-hero')), slot = b.getAttribute('data-slot'), k = b.getAttribute('data-item');
    if (b.classList.contains('hm-bi-put')) {
      // Нажатие на уже поставленный предмет — выбрать для него другое место (или снять выбор места).
      armed = armed && armed.hero === id && armed.k === k ? null : { hero: id, k: k };
    } else if (armed && armed.hero === id) {
      var m = place[id] || (place[id] = {});
      Object.keys(m).forEach(function (x) { if (m[x] === slot) delete m[x]; }); // место занято другим выбранным — освобождаем
      m[armed.k] = slot; armed = null;
    } else return;
    var a = api(); if (a && a.ready()) builds(a.picks());
  });

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
            '<span><b>' + esc(h.name) + (window.D2HRoles && window.D2HRoles.badges ? window.D2HRoles.badges(h.id) : '') + '</b><small>' + esc(h.pos) +
            (h.matches ? (h.pos ? ' · ' : '') + h.matches.toLocaleString('ru-RU') + ' матчей' : '') +
            '</small></span></button>';
        }).join('')
      : '<p class="hm-picker-empty">Никого не нашлось</p>';
  }

  function openPicker(side, slot, el) {
    buildPicker();
    open = { side: side, slot: slot, el: el };
    picker.querySelector('.hm-picker-tag').textContent =
      (side === 'radiant' ? 'Свет' : 'Тьма') + ' · слот ' + (slot + 1);
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
