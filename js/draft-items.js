/* DraftMate: предметы против состава соперника.
 *
 * Данные — /data/item-counters.json (tools/build-item-counters.js):
 *   threats — угрозы и предметы против них, механика подтверждена описанием Valve (proof);
 *   heroTags — какие угрозы несёт герой и чем это подтверждено;
 *   buy — сколько матчей герой на роли покупает предмет по фазам (своя база).
 * Состояние драфта и позиции — из js/draft-tool.js (window.D2HDraft), своих расчётов драфта тут нет.
 * Совет показывается, только если герой на своей роли реально покупает предмет; иначе — ничего.
 */
(function () {
  'use strict';
  var box = document.getElementById('dtItems');
  if (!box || !window.D2HDraft) return;

  var PHASE = ['до 0:00', '0–10 мин', '10–25 мин', '25–40 мин', 'после 40 мин'];
  var SIDES = ['radiant', 'dire'];
  var PER_HERO = 3;
  var MIN_SHOW = 0.05; // совет — от 5% матчей героя на роли: реже — это уже не типичная покупка
  var data = null, loading = false, failed = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    if (data || loading) return;
    loading = true;
    fetch('/data/item-counters.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.threats || !j.buy) throw new Error('пустой ответ');
        data = j; render();
      })
      .catch(function (e) { failed = 'Не удалось загрузить данные о предметах: ' + e.message; render(); })
      .then(function () { loading = false; });
  }

  // Угрозы стороны соперника: k -> [{ name, why }]
  function enemyThreats(ids, pos) {
    var out = {};
    Object.keys(data.threats).forEach(function (k) {
      var t = data.threats[k], hit = [];
      ids.forEach(function (id, i) {
        if (!id) return;
        var tags = data.heroTags[id] && data.heroTags[id][k];
        var byPos = t.enemyPos && pos && t.enemyPos.indexOf(pos[i]) >= 0;
        if (!tags && !byPos) return;
        var h = window.D2HDraft.hero(id);
        hit.push({ name: h ? h.localized_name : '#' + id, why: tags ? tags.join(', ') : 'керри (позиция 1)' });
      });
      if (hit.length >= t.min) out[k] = hit;
    });
    return out;
  }

  function adviceFor(heroId, pos, threats) {
    var B = data.buy[heroId] && data.buy[heroId][String(pos || '').replace('POSITION_', '')];
    if (!B) return null;
    var byItem = {};
    Object.keys(threats).forEach(function (k) {
      data.threats[k].items.forEach(function (it) {
        var v = B.it[it.id];
        if (!v) return;
        var g = Math.max.apply(null, v), ph = v.indexOf(g);
        if (g / B.n < MIN_SHOW) return;
        var r = byItem[it.id] || (byItem[it.id] = { it: it, share: g / B.n, phase: ph, threats: [], weight: 0 });
        r.threats.push(k);
        r.weight += threats[k].length;
      });
    });
    return Object.keys(byItem).map(function (id) { return byItem[id]; })
      .sort(function (a, b) { return b.share * b.weight - a.share * a.weight; })
      .slice(0, PER_HERO);
  }

  function closes(r, threats) {
    return r.threats.map(function (k) {
      return esc(data.threats[k].label) + ' (' + threats[k].map(function (x) { return esc(x.name); }).join(', ') + ')';
    }).join('; ');
  }

  function itemHtml(r, threats) {
    var it = r.it, name = esc(it.name);
    var title = esc(it.proof) + ' — описание Valve';
    var head = '<img src="' + esc(it.img) + '" alt="" width="36" height="26" loading="lazy" decoding="async">' +
      (it.page ? '<a href="' + esc(it.page) + '">' + name + '</a>' : '<b>' + name + '</b>');
    return '<li class="dti-item" title="' + title + '"><div class="dti-name">' + head + '</div>' +
      '<small>' + PHASE[r.phase] + ' · покупают в ' + Math.round(r.share * 100) + '% матчей на роли</small>' +
      '<small class="dti-closes" title="' + esc(r.threats.map(function (k) { return threats[k].map(function (x) { return x.name + ': ' + x.why; }).join('\n'); }).join('\n')) + '">закрывает: ' + closes(r, threats) + '</small></li>';
  }

  function render() {
    if (!window.D2HDraft.ready()) return;
    var picks = window.D2HDraft.picks();
    var any = picks.radiant.concat(picks.dire).some(Boolean);
    box.hidden = !any;
    if (!any) return;
    if (failed) { box.querySelector('.dti-grid').innerHTML = '<p class="dt-zero">' + esc(failed) + '</p>'; return; }
    if (!data) { load(); return; }
    var pos = window.D2HDraft.positions() || { radiant: [], dire: [] };
    box.querySelector('.dti-grid').innerHTML = SIDES.map(function (side) {
      var enemy = side === 'radiant' ? 'dire' : 'radiant';
      var threats = enemyThreats(picks[enemy], pos[enemy]);
      var rows = picks[side].map(function (id, i) {
        if (!id) return '';
        var h = window.D2HDraft.hero(id);
        var adv = adviceFor(id, pos[side][i], threats);
        var body = !Object.keys(threats).length ? '<p class="dt-zero">У соперника пока нет угроз из нашего списка.</p>'
          : adv === null ? '<p class="dt-zero">Мало матчей героя на этой роли — советов нет.</p>'
          : !adv.length ? '<p class="dt-zero">Против этих угроз герой на этой роли в нашей базе ничего не покупает.</p>'
          : '<ul>' + adv.map(function (r) { return itemHtml(r, threats); }).join('') + '</ul>';
        return '<div class="dti-hero"><div class="dti-hero-head"><img src="' + esc(window.D2HDraft.icon(h)) + '" alt="" width="40" height="22" loading="lazy">' +
          '<b>' + esc(h ? h.localized_name : '') + '</b></div>' + body + '</div>';
      }).join('');
      return '<div class="dt-rec-panel dti-panel" data-side="' + side + '"><div class="dt-rec-head"><b>' +
        (side === 'radiant' ? 'Свет' : 'Тьма') + '</b></div>' + (rows || '<p class="dt-zero">Героев ещё нет.</p>') + '</div>';
    }).join('');
  }

  window.D2HDraft.onChange(render);
})();
