/* Dota Mate — единый поиск героев, предметов и страниц.
   Ищет по оригинальному названию и по синонимам из data/search-aliases.json
   (официальные поисковые синонимы Dota 2). Синонимы на экран не выводятся.
   Понимает: регистр, ё/е, пробелы и дефисы, запрос в английской раскладке
   («gelf» → «пудж»), начало слова, одну опечатку. */
(function () {
  'use strict';
  var EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`', RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
  var data = { heroes: {}, items: {}, pages: [] }, ready = false, waiters = [];

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/g, ''); }
  function swapLayout(s) {
    var out = '', i, c, j; s = String(s).toLowerCase();
    for (i = 0; i < s.length; i++) { c = s[i]; j = EN.indexOf(c); if (j < 0) { j = RU.indexOf(c); out += j < 0 ? c : EN[j]; } else out += RU[j]; }
    return out;
  }
  // расстояние Левенштейна не больше 1 (одна замена, вставка или пропуск)
  function within1(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, e = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return e + (la - i) + (lb - j) <= 1;
  }
  // 0 — точное совпадение, 1 — начало, 2 — начало слова, 3 — внутри, 4 — с опечаткой, -1 — нет
  function scoreOne(name, q) {
    var raw = String(name).toLowerCase().replace(/ё/g, 'е'), n = norm(raw);
    if (!n) return -1;
    if (n === q) return 0;
    if (n.indexOf(q) === 0) return 1;
    var words = raw.split(/[^a-z0-9а-я]+/), w;
    for (w = 0; w < words.length; w++) if (words[w] && words[w].indexOf(q) === 0) return 2;
    if (q.length >= 3 && n.indexOf(q) !== -1) return 3;
    if (q.length >= 4 && (within1(n.slice(0, q.length), q) || within1(n.slice(0, q.length + 1), q) || within1(n, q))) return 4;
    return -1;
  }
  function score(names, query) {
    var qs = [norm(query)], alt = norm(swapLayout(query)), best = -1, i, k, s;
    if (!qs[0]) return -1;
    // раскладка: только если при переводе не потерялись символы (иначе «бкб» → «r»)
    if (alt && alt !== qs[0] && alt.length === String(query).replace(/\s+/g, '').length && alt.length >= 2) qs.push(alt);
    for (k = 0; k < qs.length; k++) for (i = 0; i < names.length; i++) {
      s = scoreOne(names[i], qs[k]);
      if (s >= 0 && (best < 0 || s < best)) best = s;
      if (best === 0) return 0;
    }
    return best;
  }
  function heroNames(h) { return [h.localized_name || ''].concat(data.heroes[h.id] || []); }
  function itemNames(it) {
    var key = String(it.key || it.name || '').replace(/^item_/, '');
    return [it.dname || it.name || ''].concat(data.items[key] || []);
  }
  // Отбор и сортировка: сначала лучшее совпадение, при равенстве — исходный порядок
  // (или order(a,b), если передан).
  function rank(list, query, namesOf, order) {
    if (!norm(query)) return list.slice();
    var out = [], i, s;
    for (i = 0; i < list.length; i++) { s = score(namesOf(list[i]), query); if (s >= 0) out.push({ x: list[i], s: s, i: i }); }
    // совпадения с опечаткой показываем, только если точных нет
    if (out.some(function (r) { return r.s < 4; })) out = out.filter(function (r) { return r.s < 4; });
    out.sort(function (a, b) { return a.s - b.s || (order ? order(a.x, b.x) : a.i - b.i); });
    return out.map(function (r) { return r.x; });
  }

  function load() {
    if (typeof fetch !== 'function') return;
    fetch('/data/search-aliases.json', { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        data = { heroes: d.heroes || {}, items: d.items || {}, pages: Array.isArray(d.pages) ? d.pages : [] };
        ready = true; waiters.splice(0).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
        document.dispatchEvent(new CustomEvent('d2h-search-ready'));
      })
      .catch(function (e) { console.warn('[search] синонимы не загружены, ищем по оригинальным названиям:', e.message); });
  }

  window.D2HSearch = {
    norm: norm, score: score,
    heroes: function (list, q, order) { return rank(list, q, heroNames, order); },
    // при равном совпадении: рецепты в конце, затем предмет с меньшим числом синонимов
    // (Blink Dagger раньше Arcane Blink — у улучшений синонимы базового плюс свои).
    items: function (list, q, order) {
      return rank(list, q, itemNames, order || function (a, b) {
        return (a.cat === 'recipe') - (b.cat === 'recipe') || itemNames(a).length - itemNames(b).length;
      });
    },
    // Страницы: от 3 букв и только по началу слова — иначе «пу» цепляет «пуш», «пуллы».
    pages: function (q) {
      if (norm(q).length < 3) return [];
      var out = [], i, s;
      for (i = 0; i < data.pages.length; i++) { s = score([data.pages[i].t], q); if (s >= 0 && s <= 2) out.push({ p: data.pages[i], s: s, i: i }); }
      out.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
      return out.map(function (r) { return r.p; });
    },
    // 0–2 — совпадение с начала названия/синонима или слова, 3 — внутри, 4 — с опечаткой, -1 — нет
    heroScore: function (h, q) { return score(heroNames(h), q); },
    heroMatch: function (h, q) { return !norm(q) || score(heroNames(h), q) >= 0; },
    itemMatch: function (it, q) { return !norm(q) || score(itemNames(it), q) >= 0; },
    onReady: function (f) { if (ready) f(); else waiters.push(f); }
  };
  load();
})();
