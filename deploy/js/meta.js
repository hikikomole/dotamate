/*
 * Раздел META: /meta/ (витрина необычных сборок) и /meta/match/?id= (матч).
 * Данные статические, их собирает tools/build-meta.js:
 *   /data/meta-escape.json      — витрина
 *   /data/meta-match/<id>.json  — матчи, на которые витрина ссылается
 * Один файл на обе страницы: какая секция есть в разметке, ту и рисуем.
 */
(function () {
  'use strict';

  var POS = {
    1: { ru: 'Керри', icon: '/assets/roles/carry.svg' },
    2: { ru: 'Мид', icon: '/assets/roles/mid.png' },
    3: { ru: 'Оффлейн', icon: '/assets/roles/offlane.png' },
    4: { ru: 'Поддержка', icon: '/assets/roles/support.png' },
    5: { ru: 'Полная поддержка', icon: '/assets/roles/hardsupport.png' }
  };
  var PAGE = 24;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, d) { return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function k(n) { return n >= 1000 ? num(n / 1000, 1) + ' тыс.' : num(n); }
  function date(t) { return new Date(t * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); }
  function ago(t, now) {
    var h = Math.round((now - t) / 3600);
    if (h < 1) return 'меньше часа назад';
    if (h < 24) return h + ' ч назад';
    var d = Math.round(h / 24); return d + ' дн. назад';
  }

  // Загрузка с таймаутом: пустой ответ, битый JSON и HTTP-ошибка — разные сообщения.
  function getJson(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 15000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (r.status === 404) throw new Error('Данных нет (404).');
      if (!r.ok) throw new Error('Сервер ответил ' + r.status + '.');
      return r.text();
    }).then(function (t) {
      if (!t) throw new Error('Пустой ответ сервера.');
      try { return JSON.parse(t); } catch (e) { throw new Error('Данные повреждены.'); }
    }).catch(function (e) {
      if (e.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд.');
      if (e instanceof TypeError) throw new Error('Нет соединения с сервером.');
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function fail(el, e) { if (el) el.innerHTML = '<p class="mx-error">Не удалось загрузить данные. ' + esc(e.message) + '</p>'; }

  function heroImg(d, id, cls) {
    var h = d.heroes[id]; if (!h) return '';
    return '<img class="' + cls + '" loading="lazy" src="' + esc(h.img) + '" alt="' + esc(h.n) + '">';
  }
  function itemIcon(d, id, share) {
    if (!id) return '<span class="mx-item mx-item-empty"></span>';
    var it = d.items[id];
    if (!it) return '<span class="mx-item mx-item-empty" title="Предмет ' + id + '"></span>';
    var rare = share !== null && share !== undefined && share < 5;
    var tip = it.n + (share !== null && share !== undefined ? ' — в ' + num(share, 1) + '% других сборок героя' : '');
    var img = '<img loading="lazy" src="' + esc(it.img) + '" alt="' + esc(it.n) + '">';
    var cap = share !== null && share !== undefined ? '<i>' + num(share, share < 10 ? 1 : 0) + '%</i>' : '<i>&nbsp;</i>';
    var inner = img + cap;
    return it.slug
      ? '<a class="mx-item' + (rare ? ' rare' : '') + '" href="/item/' + esc(it.slug) + '/" title="' + esc(tip) + '">' + inner + '</a>'
      : '<span class="mx-item' + (rare ? ' rare' : '') + '" title="' + esc(tip) + '">' + inner + '</span>';
  }
  function roleTag(pos) {
    var p = POS[pos]; if (!p) return '';
    return '<span class="mx-role"><img src="' + p.icon + '" alt="">' + p.ru + '</span>';
  }
  function result(win) { return '<span class="mx-res ' + (win ? 'win' : 'loss') + '">' + (win ? 'Победа' : 'Поражение') + '</span>'; }

  function card(d, b) {
    var h = d.heroes[b.hero] || { n: '—', slug: '' };
    return '<article class="mx-card">' +
      '<div class="mx-card-top">' + heroImg(d, b.hero, 'mx-card-hero') +
        '<div class="mx-card-id"><a href="/hero/' + esc(h.slug) + '/">' + esc(h.n) + '</a>' + roleTag(b.pos) + '</div>' +
        '<div class="mx-score" title="Оценка необычности' + (b.byPos ? '' : ': на этой позиции мало матчей, база — все позиции героя') + '"><small>Необычность</small><b>' + num(b.score, 2) + (b.byPos ? '' : '*') + '</b></div>' +
      '</div>' +
      '<div class="mx-items">' + b.items.map(function (id, i) { return itemIcon(d, id, b.share[i]); }).join('') + '</div>' +
      '<div class="mx-card-foot">' + result(b.win) +
        '<span class="mx-kda">' + b.k + ' / ' + b.d + ' / ' + b.a + '</span>' +
        '<a class="mx-link" href="/meta/match/?id=' + b.match + '">Матч →</a>' +
      '</div></article>';
  }
  function table(d, rows) {
    return '<div class="table-wrap"><table class="mx-table"><thead><tr><th>Герой</th><th>Роль</th><th>Итог</th><th>Необычность</th><th>Предметы</th><th>K / D / A</th><th>Ранг</th><th></th></tr></thead><tbody>' +
      rows.map(function (b) {
        var h = d.heroes[b.hero] || { n: '—', slug: '' };
        return '<tr><td><a class="mx-thero" href="/hero/' + esc(h.slug) + '/">' + heroImg(d, b.hero, '') + esc(h.n) + '</a></td><td>' + roleTag(b.pos) + '</td><td>' + result(b.win) + '</td>' +
          '<td class="mx-tscore">' + num(b.score, 2) + (b.byPos ? '' : '*') + '</td><td><div class="mx-items mx-items-sm">' + b.items.map(function (id, i) { return itemIcon(d, id, b.share[i]); }).join('') + '</div></td>' +
          '<td>' + b.k + ' / ' + b.d + ' / ' + b.a + '</td><td>' + esc(b.rank) + '</td><td><a class="mx-link" href="/meta/match/?id=' + b.match + '">Матч →</a></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- /meta/
  function initMeta(root) {
    var st = { pos: 0, hero: '', wins: false, view: 'cards', shown: PAGE };
    var stamp = document.getElementById('mxStamp');
    getJson('/data/meta-escape.json').then(function (d) {
      var span = date(d.window.from) === date(d.window.to) ? 'матчи за ' + date(d.window.from) : 'матчи с ' + date(d.window.from) + ' по ' + date(d.window.to);
      var upd = new Date(d.generatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      stamp.innerHTML = '<b>' + num(d.matches) + '</b> матчей · <b>' + num(d.scored) + '</b> оценённых сборок<br>' +
        esc(d.slice) + '<br>' + span + ' · обновлено ' + esc(upd);
      fill('mxDay', d, d.day, 'За последние сутки необычных сборок не набралось.');
      fill('mxFive', d, d.five, 'Пока нет оценённых сборок.');
      heroList(d);
      niche(d);
      method(d);
      bindList(d);
      renderList(d);
    }).catch(function (e) { stamp.textContent = ''; fail(document.getElementById('mxDay'), e); });

    root.querySelectorAll('.mx-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('.mx-tab').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        root.querySelectorAll('.mx-pane').forEach(function (p) { p.hidden = p.getAttribute('data-mx-pane') !== b.getAttribute('data-mx-tab'); });
      });
    });

    function fill(id, d, rows, empty) {
      var el = document.getElementById(id);
      el.innerHTML = rows.length ? rows.map(function (b) { return card(d, b); }).join('') : '<p class="mx-note">' + empty + '</p>';
    }
    function heroList(d) {
      var ids = {}; d.list.forEach(function (b) { ids[b.hero] = 1; });
      document.getElementById('mxHeroList').innerHTML = Object.keys(ids).map(function (id) { return d.heroes[id] ? d.heroes[id].n : ''; })
        .filter(Boolean).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    }
    function bindList(d) {
      var more = document.getElementById('mxMore');
      document.getElementById('mxHero').addEventListener('input', function (e) { st.hero = e.target.value.trim().toLowerCase(); st.shown = PAGE; renderList(d); });
      document.getElementById('mxWins').addEventListener('change', function (e) { st.wins = e.target.checked; st.shown = PAGE; renderList(d); });
      chips('mxRoles', 'data-pos', function (v) { st.pos = +v; });
      var toTop = function () { document.getElementById('mxScroll').scrollTop = 0; };
      root.querySelector('.mx-filters').addEventListener('change', toTop);
      root.querySelector('.mx-filters').addEventListener('click', function (e) { if (e.target.closest('.chip')) toTop(); });
      chips(null, 'data-view', function (v) { st.view = v; });
      // Подгрузка при прокрутке списка: следующая порция, когда низ контейнера виден.
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) {
          if (en[0].isIntersecting && !more.hidden) { st.shown += PAGE; renderList(d); }
        }, { root: document.getElementById('mxScroll'), rootMargin: '200px' }).observe(more);
      } else {
        more.textContent = 'Показать ещё'; more.classList.add('mx-more-btn');
        more.addEventListener('click', function () { st.shown += PAGE; renderList(d); });
      }
      function chips(id, attr, set) {
        var box = id ? document.getElementById(id) : root.querySelector('.mx-view');
        box.addEventListener('click', function (e) {
          var b = e.target.closest('[' + attr + ']'); if (!b) return;
          box.querySelectorAll('[' + attr + ']').forEach(function (x) { x.classList.toggle('active', x === b); });
          set(b.getAttribute(attr)); st.shown = PAGE; renderList(d);
        });
      }
    }
    function renderList(d) {
      var rows = d.list.filter(function (b) {
        if (st.pos && b.pos !== st.pos) return false;
        if (st.wins && !b.win) return false;
        if (st.hero) { var h = d.heroes[b.hero]; if (!h || h.n.toLowerCase().indexOf(st.hero) < 0) return false; }
        return true;
      });
      var el = document.getElementById('mxList'), part = rows.slice(0, st.shown);
      document.getElementById('mxCount').textContent = num(rows.length) + ' из ' + num(d.list.length);
      el.innerHTML = !rows.length ? '<p class="mx-note">По этим фильтрам сборок нет.</p>'
        : st.view === 'table' ? table(d, part) : '<div class="mx-grid">' + part.map(function (b) { return card(d, b); }).join('') + '</div>';
      document.getElementById('mxMore').hidden = rows.length <= st.shown;
    }
    function niche(d) {
      document.getElementById('mxNicheNote').textContent = 'Герой считается нишевым на позиции, если там сыграно не больше ' + num(d.rules.nicheShare) +
        '% его матчей, но не меньше ' + d.rules.nicheMin + ' матчей, и он выигрывает больше половины. Порядок — по нижней границе доверительного интервала Уилсона (95%), чтобы три удачные игры не обгоняли тридцать.';
      document.getElementById('mxNiche').innerHTML = [1, 2, 3, 4, 5].map(function (pos) {
        var rows = d.niche[pos] || [];
        return '<div class="mx-ncol"><div class="mx-ncol-head">' + roleTag(pos) + '</div>' +
          (rows.length ? rows.map(function (r) {
            var h = d.heroes[r.hero] || { n: '—', slug: '' };
            return '<a class="mx-nrow" href="/hero/' + esc(h.slug) + '/">' + heroImg(d, r.hero, '') +
              '<span class="mx-nname"><b>' + esc(h.n) + '</b><small>' + num(r.share, 1) + '% его матчей · ' + num(r.games) + ' игр' +
              (r.player ? '<br>' + esc(r.player.name) + ': ' + r.player.w + ' из ' + r.player.n : '') + '</small></span>' +
              '<strong>' + num(100 * r.wins / r.games, 1) + '%</strong></a>';
          }).join('') : '<p class="mx-note">Пока недостаточно матчей.</p>') + '</div>';
      }).join('');
    }
    function method(d) {
      document.getElementById('mxMethod').innerHTML =
        '<p>Для каждого предмета из финального инвентаря считаем долю сборок того же героя на той же позиции, где этот предмет тоже есть. Оценка — сумма <code>−ln(доля)</code> по всем предметам сборки: чем реже предмет, тем больше он добавляет. Предмет из половины сборок даёт 0,69, из одной сотой — 4,6.</p>' +
        '<p>Сама сборка из подсчёта долей исключается, расходники не учитываются, сборки меньше чем из ' + d.rules.minItems + ' предметов и матчи короче 20 минут не оцениваются. Если на позиции у героя меньше ' + d.rules.minBase + ' сборок, база берётся по всем его позициям — такая оценка помечена звёздочкой. Процент под предметом — в скольких других сборках героя он встречается.</p>' +
        '<p>Формула своя: у Dota2ProTracker формула Off-Meta Score не опубликована, поэтому числа между сайтами не сравниваются. Источник матчей — ' + esc(d.source) + '. Позиция игрока — определение Stratz.</p>';
    }
  }

  // ---------- /meta/match/?id=
  var LANE = {
    RADIANT_STOMP: ['Разгром Сил Света', 'rad'], RADIANT_VICTORY: ['Победа Сил Света', 'rad'], TIE: ['Ничья', ''],
    DIRE_VICTORY: ['Победа Сил Тьмы', 'dire'], DIRE_STOMP: ['Разгром Сил Тьмы', 'dire']
  };
  function initMatch(root) {
    var id = (location.search.match(/[?&]id=(\d{6,12})\b/) || [])[1];
    if (!id) { root.innerHTML = '<p class="mx-error">Не указан номер матча.</p>'; return; }
    getJson('/data/meta-match/' + id + '.json').then(function (m) { renderMatch(root, m); })
      .catch(function (e) {
        root.innerHTML = '<p class="mx-error">Матча ' + esc(id) + ' нет в разделе META. ' + esc(e.message) + '</p>' +
          '<p><a class="btn ghost" href="https://stratz.com/matches/' + esc(id) + '" target="_blank" rel="noopener">Открыть на Stratz →</a></p>';
      });
  }
  function renderMatch(root, m) {
    document.title = 'Матч ' + m.id + ' — META | Dota Mate';
    var rad = m.p.filter(function (p) { return p.r; }), dire = m.p.filter(function (p) { return !p.r; });
    var sum = function (arr, f) { return arr.reduce(function (s, p) { return s + p[f]; }, 0); };
    var rk = sum(rad, 'k'), dk = sum(dire, 'k'), rnw = sum(rad, 'nw'), dnw = sum(dire, 'nw');
    var dur = Math.floor(m.dur / 60) + ':' + ('0' + m.dur % 60).slice(-2);
    var exp = m.draftRadiant, fav = exp === null ? null : exp >= 50 ? 1 : 0;
    var nwDiff = rnw - dnw;
    root.innerHTML =
      '<div class="mm-head">' +
        '<div class="mm-side rad' + (m.rw ? ' won' : '') + '"><span>Силы Света</span><b>' + rk + '</b>' + (m.rw ? '<em>Победа</em>' : '') + '</div>' +
        '<div class="mm-mid"><h1>Матч ' + m.id + '</h1><span>' + dur + ' · ' + esc(m.rankName || '') + ' · ' + date(m.t) + '</span></div>' +
        '<div class="mm-side dire' + (m.rw ? '' : ' won') + '"><span>Силы Тьмы</span><b>' + dk + '</b>' + (m.rw ? '' : '<em>Победа</em>') + '</div>' +
      '</div>' +
      '<div class="mm-facts">' +
        (exp === null ? '' : '<div class="mm-fact"><small>Прогноз драфта Dota Mate</small><b>Силы Света ' + num(exp, 1) + '% / Силы Тьмы ' + num(100 - exp, 1) + '%</b>' +
          '<div class="mm-bar"><i class="rad" style="width:' + exp + '%"></i></div><span>' + (fav === m.rw ? 'Фаворит драфта победил' : 'Победил андердог драфта') + ' · только герои, без позиций</span></div>') +
        '<div class="mm-fact"><small>Итоговый капитал</small><b>' + k(rnw) + ' / ' + k(dnw) + '</b>' +
          '<div class="mm-bar"><i class="rad" style="width:' + (100 * rnw / (rnw + dnw)).toFixed(1) + '%"></i></div><span>' + (nwDiff >= 0 ? 'Силы Света +' : 'Силы Тьмы +') + k(Math.abs(nwDiff)) + '</span></div>' +
        '<div class="mm-fact"><small>Линии</small>' + ['Топ', 'Мид', 'Бот'].map(function (n, i) {
          var o = LANE[m.lanes[i]] || ['—', '']; return '<div class="mm-lane"><span>' + n + '</span><b class="' + o[1] + '">' + o[0] + '</b></div>';
        }).join('') + '<span>итог линий по Stratz</span></div>' +
      '</div>' +
      team('Силы Света', rad, m, 'rad') + team('Силы Тьмы', dire, m, 'dire') +
      (m.wr && m.wr.length > 2 ? chart('Вероятность победы Сил Света', m.wr.map(function (x) { return x * 100 - 50; }), 50, function (v) { return num(v + 50, 0) + '%'; }) : '') +
      (m.nw && m.nw.length > 2 ? chart('Перевес по капиталу', m.nw, null, function (v) { return (v >= 0 ? 'Силы Света +' : 'Силы Тьмы +') + k(Math.abs(v)); }) : '') +
      (m.bans.length ? '<div class="mx-block"><div class="mx-block-head"><h2>Баны</h2><span>' + m.bans.length + '</span></div><div class="mm-bans">' +
        m.bans.map(function (b) { return heroImg(m, b, ''); }).join('') + '</div></div>' : '') +
      '<div class="mm-out"><a class="btn red" href="https://stratz.com/matches/' + m.id + '" target="_blank" rel="noopener">Подробная аналитика на Stratz →</a>' +
      '<a class="btn ghost" href="https://www.opendota.com/matches/' + m.id + '" target="_blank" rel="noopener">OpenDota →</a></div>';
    bindCharts(root);
  }
  function team(name, ps, m, side) {
    var won = (side === 'rad') === !!m.rw;
    ps = ps.slice().sort(function (a, b) { return (a.pos || 9) - (b.pos || 9); });
    return '<div class="mx-block"><div class="mx-block-head"><h2 class="' + side + '">' + name + '</h2><span>' + (won ? 'Победитель' : 'Поражение') + '</span></div>' +
      '<div class="table-wrap"><table class="mx-table mm-table"><thead><tr><th>Игрок</th><th>K / D / A</th><th>GPM</th><th>XPM</th><th>Добито</th><th>Урон</th><th>Капитал</th><th>Предметы</th></tr></thead><tbody>' +
      ps.map(function (p) {
        var h = m.heroes[p.h] || { n: '—', slug: '' };
        return '<tr><td><a class="mx-thero" href="/hero/' + esc(h.slug) + '/">' + heroImg(m, p.h, '') + '<span><b>' + esc(h.n) + '</b><small>' + (POS[p.pos] ? POS[p.pos].ru + ' · ' : '') + (p.name ? esc(p.name) : 'Скрытый профиль') + '</small></span></a></td>' +
          '<td>' + p.k + ' / ' + p.d + ' / ' + p.a + '</td><td>' + num(p.gpm) + '</td><td>' + num(p.xpm) + '</td><td>' + p.lh + ' / ' + p.dn + '</td><td>' + k(p.hd) + '</td><td class="mx-tscore">' + k(p.nw) + '</td>' +
          '<td><div class="mx-items mx-items-sm">' + p.it.map(function (i) { return itemIcon(m, i, null); }).join('') + (p.nt ? itemIcon(m, p.nt, null).replace('mx-item', 'mx-item mx-neutral') : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  // Линейный график по минутам: одна ось, центр — равенство сторон.
  function chart(title, vals, fixed, fmt) {
    var W = 800, H = 180, pad = 8, n = vals.length;
    var max = fixed || Math.max.apply(null, vals.map(Math.abs)) || 1;
    var x = function (i) { return pad + i * (W - 2 * pad) / (n - 1); };
    var y = function (v) { return H / 2 - v / max * (H / 2 - pad); };
    var line = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
    var area = line + 'L' + x(n - 1).toFixed(1) + ' ' + H / 2 + 'L' + x(0).toFixed(1) + ' ' + H / 2 + 'Z';
    var ticks = ''; for (var t = 10; t < n; t += 10) ticks += '<text x="' + x(t).toFixed(1) + '" y="' + (H - 2) + '">' + t + ':00</text><line class="g" x1="' + x(t).toFixed(1) + '" x2="' + x(t).toFixed(1) + '" y1="0" y2="' + H + '"/>';
    var last = vals[n - 1];
    return '<div class="mx-block mm-chart" data-vals="' + esc(JSON.stringify(vals)) + '" data-fixed="' + (fixed || '') + '">' +
      '<div class="mx-block-head"><h2>' + title + '</h2><span>в конце: ' + esc(fmt(last)) + '</span></div>' +
      '<div class="mm-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(title) + ' по минутам">' +
      '<defs><clipPath id="c' + title.length + 'a"><rect x="0" y="0" width="' + W + '" height="' + H / 2 + '"/></clipPath><clipPath id="c' + title.length + 'b"><rect x="0" y="' + H / 2 + '" width="' + W + '" height="' + H / 2 + '"/></clipPath></defs>' +
      ticks + '<line class="mid" x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '"/>' +
      '<path class="a rad" d="' + area + '" clip-path="url(#c' + title.length + 'a)"/><path class="a dire" d="' + area + '" clip-path="url(#c' + title.length + 'b)"/>' +
      '<path class="l" d="' + line + '"/><line class="cross" x1="0" x2="0" y1="0" y2="' + H + '" hidden/></svg>' +
      '<div class="mm-tip" hidden></div><span class="mm-lab top">Силы Света</span><span class="mm-lab bot">Силы Тьмы</span></div></div>';
  }
  function bindCharts(root) {
    root.querySelectorAll('.mm-chart').forEach(function (c) {
      var vals = JSON.parse(c.getAttribute('data-vals')), fixed = +c.getAttribute('data-fixed') || 0;
      var plot = c.querySelector('.mm-plot'), tip = c.querySelector('.mm-tip'), cross = c.querySelector('.cross');
      function move(e) {
        var r = plot.getBoundingClientRect(), f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
        var i = Math.round(f * (vals.length - 1)), v = vals[i], X = 8 + i * (800 - 16) / (vals.length - 1);
        cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.hidden = false;
        tip.hidden = false; tip.style.left = (100 * X / 800) + '%';
        tip.innerHTML = '<b>' + i + ':00</b> ' + (fixed ? 'Силы Света ' + num(v + 50, 0) + '%' : (v >= 0 ? 'Силы Света +' : 'Силы Тьмы +') + k(Math.abs(v)));
      }
      plot.addEventListener('pointermove', move);
      plot.addEventListener('pointerleave', function () { tip.hidden = true; cross.hidden = true; });
    });
  }

  var meta = document.getElementById('meta'), match = document.getElementById('metaMatch');
  if (meta) initMeta(meta);
  if (match) initMatch(document.getElementById('mmRoot'));
})();
