/* Dota Mate — каталог /guides/: поиск и фильтр по темам.
   Карточки уже лежат в HTML (build-pages.js), здесь их только показываем/скрываем
   и сортируем по релевантности. Состояние — в адресе: /guides/?q=вард&t=map. */
(function () {
  'use strict';
  var grid = document.getElementById('gdGrid');
  if (!grid) return;
  var input = document.getElementById('gdQuery');
  var countEl = document.getElementById('gdCount');
  var emptyEl = document.getElementById('gdEmpty');
  var featWrap = document.getElementById('gdFeatWrap');
  var titleEl = document.getElementById('gdListTitle');
  var listHead = titleEl.parentNode;
  var heroWrap = document.getElementById('gdHeroes');
  var heroList = document.getElementById('gdHeroList');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.gd-chip[data-grp]'));
  var subWrap = document.getElementById('gdSubs');
  var subs = Array.prototype.slice.call(document.querySelectorAll('.gd-sub[data-sub]'));
  var EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`', RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
  var heroes = [];
  try { heroes = JSON.parse(document.getElementById('gdHeroData').textContent); }
  catch (e) { console.error('[guides] список героев не прочитан:', e); }

  function low(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function words(s) { return low(s).split(/[^a-z0-9а-я]+/).filter(Boolean); }
  function swap(s) {
    var out = '', i, c, j; s = String(s).toLowerCase();
    for (i = 0; i < s.length; i++) { c = s[i]; j = EN.indexOf(c); if (j < 0) { j = RU.indexOf(c); out += j < 0 ? c : EN[j]; } else out += RU[j]; }
    return out;
  }
  // Грубое отсечение окончаний: «вардов» → «вард», «рошана» → «рош»+… — ищем по началу слова.
  function stem(t) { return t.length > 5 ? t.slice(0, t.length - 2) : t.length > 4 ? t.slice(0, t.length - 1) : t; }

  var cards = Array.prototype.slice.call(grid.children).map(function (el, i) {
    return { el: el, i: i, grp: el.dataset.grp, sub: el.dataset.sub || '', t: words(el.dataset.t), h: words(el.dataset.h), e: words(el.dataset.e) };
  });

  function hit(ws, tok) { for (var i = 0; i < ws.length; i++) if (ws[i].indexOf(tok) === 0) return true; return false; }
  // Очки карточки: каждое слово запроса обязано найтись; в заголовке ценнее, чем в подзаголовках и описании.
  function scoreCard(c, toks) {
    var s = 0, i, t;
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (hit(c.t, t)) s += 10; else if (hit(c.h, t)) s += 4; else if (hit(c.e, t)) s += 2; else return 0;
    }
    return s;
  }
  function tokens(q) { return words(q).filter(function (w) { return w.length >= 2 || /\d/.test(w); }).map(stem); }

  var state = { q: '', grp: 'all', sub: 'all' };

  function apply(push) {
    var toks = tokens(state.q), ranked = [], i, c, s;
    if (toks.length) {
      for (i = 0; i < cards.length; i++) { c = cards[i]; s = scoreCard(c, toks); if (s) ranked.push({ c: c, s: s }); }
      if (!ranked.length) { // запрос в другой раскладке: «dfhl» → «вард»
        var alt = tokens(swap(state.q));
        for (i = 0; i < cards.length; i++) { c = cards[i]; s = scoreCard(c, alt); if (s) ranked.push({ c: c, s: s }); }
      }
    } else {
      ranked = cards.map(function (x) { return { c: x, s: 1 }; });
    }
    ranked.sort(function (a, b) { return b.s - a.s || a.c.i - b.c.i; });
    var shown = 0, frag = document.createDocumentFragment(), set = new Set();
    ranked.forEach(function (r) {
      if (state.grp !== 'all' && r.c.grp !== state.grp) return;
      if (state.grp === 'items' && state.sub !== 'all' && r.c.sub !== state.sub) return;
      set.add(r.c); frag.appendChild(r.c.el); shown++;
    });
    cards.forEach(function (x) { x.el.hidden = !set.has(x); if (!set.has(x)) frag.appendChild(x.el); });
    grid.appendChild(frag);

    var heroHits = renderHeroes();
    countEl.textContent = shown + ' ' + plural(shown, 'гайд', 'гайда', 'гайдов');
    emptyEl.hidden = shown > 0 || heroHits > 0;
    listHead.hidden = !shown && heroHits > 0;
    featWrap.hidden = !!state.q || state.grp !== 'all';
    var chip = chips.filter(function (b) { return b.dataset.grp === state.grp; })[0];
    titleEl.textContent = state.q ? 'Результаты поиска' : state.grp === 'all' ? 'Все гайды' : chip.textContent.replace(/\s*\d+\s*$/, '');
    // Быстрые запросы под полем: без перезагрузки страницы.
  Array.prototype.forEach.call(document.querySelectorAll('.gd-top [data-q]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); input.value = state.q = a.dataset.q; apply(true); input.focus(); });
  });
  if (subWrap) subWrap.hidden = state.grp !== 'items';
    subs.forEach(function (b) { var on = b.dataset.sub === state.sub; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    chips.forEach(function (b) { var on = b.dataset.grp === state.grp; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    syncUrl(push);
  }

  function renderHeroes() {
    var q = state.q.trim();
    if (q.length < 2 || !window.D2HSearch || state.grp !== 'all') { heroWrap.hidden = true; heroList.textContent = ''; return 0; }
    // Только совпадение с начала слова: иначе «лес» находит Faceless Void.
    var S = window.D2HSearch;
    var list = S.heroes(heroes, q).filter(function (h) { return !S.heroScore || S.heroScore(h, q) <= 2; }).slice(0, 6);
    heroList.textContent = '';
    list.forEach(function (h) {
      var a = document.createElement('a'); a.className = 'gd-hero-pill'; a.href = h.u;
      var img = document.createElement('img'); img.src = h.img; img.alt = ''; img.width = 48; img.height = 27; img.loading = 'lazy'; img.decoding = 'async';
      var b = document.createElement('span'); b.textContent = h.localized_name;
      a.appendChild(img); a.appendChild(b); heroList.appendChild(a);
    });
    heroWrap.hidden = !list.length;
    return list.length;
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
  }

  function syncUrl(push) {
    if (!window.history || !history.replaceState) return;
    var p = new URLSearchParams();
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.grp !== 'all') p.set('t', state.grp);
    if (state.grp === 'items' && state.sub !== 'all') p.set('s', state.sub);
    var url = location.pathname + (p.toString() ? '?' + p.toString() : '') + location.hash;
    try { (push ? history.pushState : history.replaceState).call(history, state, '', url); } catch (e) { /* file:// превью */ }
  }

  function readUrl() {
    var p = new URLSearchParams(location.search), t = p.get('t');
    state.q = p.get('q') || '';
    state.grp = chips.some(function (b) { return b.dataset.grp === t; }) ? t : 'all';
    var sb = p.get('s');
    state.sub = state.grp === 'items' && subs.some(function (b) { return b.dataset.sub === sb; }) ? sb : 'all';
    input.value = state.q;
  }

  var timer = 0;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = input.value; apply(false); }, 120);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; state.q = ''; apply(false); }
    if (e.key === 'Enter') { var first = grid.querySelector('.gd-card:not([hidden])') || heroList.querySelector('a'); if (first && state.q) first.click(); }
  });
  chips.forEach(function (b) {
    b.addEventListener('click', function () { state.grp = b.dataset.grp; state.sub = 'all'; apply(true); });
  });
  subs.forEach(function (b) {
    b.addEventListener('click', function () { state.sub = b.dataset.sub; apply(true); });
  });
  document.getElementById('gdReset').addEventListener('click', function () {
    state.q = ''; state.grp = 'all'; state.sub = 'all'; input.value = ''; apply(true); input.focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    e.preventDefault(); input.focus();
  });
  window.addEventListener('popstate', function () { readUrl(); apply(false); });
  if (window.D2HSearch) window.D2HSearch.onReady(function () { if (state.q) apply(false); });

  readUrl();
  apply(false);
})();
