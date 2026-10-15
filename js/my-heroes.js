// «Мои герои»: отметка на странице героя (кнопка [data-myhero] в шапке, tools/hero-stat-tiles.js) и блок
// #myHeroes на /heroes/ (page-sections.html): винрейт по своей базе, изменение за последние дни и пометка,
// если героя меняли в последнем патче (ссылка на его раздел /patch/<версия>/#h-<slug>).
// Хранится только в этом браузере: localStorage dotamate.myHeroes.v1 = { version: 1, ids: [id, …] }, до MAX героев.
// Данные (/data/stats.json, /data/heroes.json, /data/patch-notes.json) грузятся, только если отмеченные герои есть.
(function () {
  'use strict';
  var KEY = 'dotamate.myHeroes.v1', MAX = 12, TREND_DAYS = 7;

  function load() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (!raw || raw.version !== 1 || !Array.isArray(raw.ids)) return [];
      var out = [];
      raw.ids.forEach(function (x) { x = Number(x); if (x > 0 && x < 1000 && Math.round(x) === x && out.indexOf(x) === -1 && out.length < MAX) out.push(x); });
      return out;
    } catch (e) { return []; }
  }
  function save(ids) {
    try { window.localStorage.setItem(KEY, JSON.stringify({ version: 1, ids: ids })); return true; } catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f1(v) { return v.toFixed(1).replace('.', ','); }
  function goal(name) { try { if (typeof window.ym === 'function') window.ym(112755250, 'reachGoal', name); } catch (e) { /* без Метрики */ } }

  // ---------- кнопка на странице героя ----------
  function renderButton(btn) {
    var id = Number(btn.getAttribute('data-myhero')), on = load().indexOf(id) !== -1;
    btn.hidden = false;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? '★ В моих героях' : '☆ В мои герои';
    btn.classList.toggle('is-on', on);
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-myhero]');
    if (!btn) return;
    var id = Number(btn.getAttribute('data-myhero')), ids = load(), i = ids.indexOf(id);
    if (i !== -1) ids.splice(i, 1);
    else {
      if (ids.length >= MAX) { btn.textContent = 'Уже ' + MAX + ' героев — убери кого-то на /heroes/'; return; }
      ids.push(id);
      goal('my_hero_add');
    }
    if (!save(ids)) btn.title = 'Браузер не разрешает сайту хранить данные — отметка пропадёт после перезагрузки';
    renderButton(btn);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-myhero]'), renderButton);

  // ---------- блок на /heroes/ ----------
  var box = document.getElementById('myHeroes');
  if (!box) return;
  var body = box.querySelector('[data-mh-body]');
  function getJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  var dataPromise = null;
  function data() {
    if (!dataPromise) dataPromise = Promise.all([getJson('/data/heroes.json'), getJson('/data/stats.json'), getJson('/data/patch-notes.json').catch(function () { return null; })]);
    return dataPromise;
  }
  function slugOf(h) {
    return (typeof window.slugForHero === 'function' ? window.slugForHero(h) : '') || String(h.name || '').replace(/^npc_dota_hero_/, '');
  }
  // Изменение винрейта: последний снимок против самого раннего снимка не старше TREND_DAYS дней
  // (снимки ежедневные, но дни бывают пропущены — поэтому по датам, а не по номеру снимка).
  function trend(stats, id) {
    var H = stats.history, row = H && H.heroes && H.heroes[String(id)];
    if (!row || !Array.isArray(H.days) || row.length < 2) return null;
    var last = row.length - 1, end = Date.parse(H.days[last]), from = 0;
    while (from < last && (!row[from] || end - Date.parse(H.days[from]) > TREND_DAYS * 864e5)) from++;
    if (!row[last] || from >= last) return null;
    var days = Math.round((end - Date.parse(H.days[from])) / 864e5);
    return days > 0 ? { d: row[last][0] - row[from][0], days: days } : null;
  }
  function render() {
    var ids = load();
    box.hidden = false;
    if (!ids.length) {
      body.innerHTML = '<p class="mh-hint">Отметь героев кнопкой «☆ В мои герои» на их страницах — здесь появятся их винрейт, изменения за неделю и правки в патче.</p>';
      return;
    }
    body.innerHTML = '<p class="mh-hint">Загружаем…</p>';
    data().then(function (r) {
      var heroes = {}, stats = r[1] || {}, patch = r[2];
      (r[0].heroes || []).forEach(function (h) { heroes[Number(h.id)] = h; });
      var st = {};
      (stats.heroes || []).forEach(function (h) { st[Number(h.id)] = h; });
      var changed = {};
      if (patch && Array.isArray(patch.heroes)) patch.heroes.forEach(function (h) { changed[Number(h.id)] = h.slug; });
      var cards = load().map(function (id) {
        var h = heroes[id];
        if (!h) return '';
        var slug = slugOf(h), s = st[id], t = trend(stats, id);
        var wr = s && typeof s.wr === 'number' ? '<b>' + f1(s.wr) + '&nbsp;%</b> побед' : 'нет данных';
        var tr = t ? '<span class="mh-trend ' + (t.d > 0.05 ? 'up' : t.d < -0.05 ? 'down' : '') + '">' + (t.d > 0 ? '+' : t.d < 0 ? '−' : '±') + f1(Math.abs(t.d)) + '&nbsp;п.п. за ' + t.days + '&nbsp;дн.</span>' : '';
        var pt = changed[id] && patch.version ? '<a class="mh-patch" href="/patch/' + encodeURIComponent(patch.version) + '/#h-' + encodeURIComponent(changed[id]) + '">Изменён в патче ' + esc(patch.version) + '</a>' : '';
        return '<li class="mh-card"><a class="mh-link" href="/hero/' + encodeURIComponent(slug) + '/"><img src="/assets/heroes/' + encodeURIComponent(slug) + '.webp" alt="" width="64" height="36" loading="lazy" decoding="async"><span>' + esc(h.localized_name) + '</span></a>' +
          '<span class="mh-wr">' + wr + (tr ? ' ' + tr : '') + '</span>' + pt +
          '<button type="button" class="mh-del" data-mh-del="' + id + '" aria-label="Убрать ' + esc(h.localized_name) + ' из моих героев">×</button></li>';
      }).join('');
      body.innerHTML = '<ul class="mh-list">' + cards + '</ul><p class="mh-src">Винрейт — своя база рейтинговых матчей всех рангов (как на «Статистике»); изменение — разница с винрейтом недельной давности (каждый снимок считается по всей базе на тот день). Отметки хранятся только в этом браузере.</p>';
    }).catch(function () {
      body.innerHTML = '<p class="mh-hint">Не удалось загрузить данные. Обнови страницу.</p>';
    });
  }
  box.addEventListener('click', function (e) {
    var del = e.target.closest && e.target.closest('[data-mh-del]');
    if (!del) return;
    var id = Number(del.getAttribute('data-mh-del'));
    save(load().filter(function (x) { return x !== id; }));
    render();
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) render(); });
  render();
})();
