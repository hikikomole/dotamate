(function () {
  'use strict';
  let data = null, pending = null, failed = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const valid = d => d && d.schemaVersion === 1 && d.meta?.source === 'steam' &&
    d.meta.cohort === 'ranked-all-ranks' && Array.isArray(d.heroIds) && Array.isArray(d.with) && Array.isArray(d.vs) &&
    [d.with, d.vs].every(rows => rows.every(p => Number.isInteger(p.a) && Number.isInteger(p.b) &&
      Number.isInteger(p.n) && Number.isInteger(p.w) && p.n >= p.w && p.w >= 0 &&
      (p.n < 300 || [p.observed, p.expected, p.delta].every(Number.isFinite))));
  function load() {
    if (!pending) pending = fetch('/data/matchup-search.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(d => { if (!valid(d)) throw new Error('Invalid pair data'); data = d; failed = false; })
      .catch(() => { failed = true; }).finally(() => { pending = null; });
    return pending;
  }
  function mount(root, heroes) {
    if (!root) return;
    const options = [...heroes].sort((a, b) => String(a[1].localized_name || a[1].name).localeCompare(String(b[1].localized_name || b[1].name), 'ru'))
      .map(([id, h]) => `<option value="${id}">${esc(h.localized_name || h.name)}</option>`).join('');
    root.innerHTML = `<h3>Поиск связки или противостояния</h3><p>Ранговые матчи Steam: совместная победа или исход A против B, не дуэль на линии.</p>
      <div class="st-matchup-controls"><label>Герой A <select id="stPairA">${options}</select></label><label>Герой B <select id="stPairB">${options}</select></label>
      <label>Тип <select id="stPairKind"><option value="with">В одной команде</option><option value="vs">Против друг друга</option></select></label></div>
      <div id="stPairResult" aria-live="polite">Загружаем пары…</div>`;
    const a = root.querySelector('#stPairA'), b = root.querySelector('#stPairB'), kind = root.querySelector('#stPairKind');
    if (b.options.length > 1) b.selectedIndex = 1;
    const result = root.querySelector('#stPairResult');
    function render() {
      if (a.value === b.value) { result.textContent = 'Выберите двух разных героев.'; return; }
      if (failed) { result.innerHTML = '<p>Данные пар недоступны.</p><button type="button" id="stPairRetry">Повторить</button>';
        result.querySelector('button').onclick = () => { failed = false; result.textContent = 'Загружаем пары…'; load().then(render); }; return; }
      if (!data) { result.textContent = 'Загружаем пары…'; return; }
      if (data.status !== 'ok') { result.textContent = 'Пока нет подходящих ранговых матчей.'; return; }
      const x = Number(a.value), y = Number(b.value), p = data[kind.value].find(v => v.a === Math.min(x, y) && v.b === Math.max(x, y));
      if (!p) { result.textContent = 'Эта пара не встречалась в выборке.'; return; }
      if (p.n < 300) { result.textContent = `${p.n.toLocaleString('ru-RU')} матчей. Для оценки нужно 300.`; return; }
      const observed = kind.value === 'vs' && x > y ? Math.round((100 - p.observed) * 10) / 10 : p.observed;
      const expected = kind.value === 'vs' && x > y ? Math.round((100 - p.expected) * 10) / 10 : p.expected;
      const delta = Math.round((observed - expected) * 10) / 10;
      const stale = data.meta.to && Date.now() - Date.parse(data.meta.to) > 36 * 3600000 ? ' · данные старше 36 часов' : '';
      result.textContent = `${p.n.toLocaleString('ru-RU')} матчей · победы ${observed}% · ожидалось ${expected}% · разница ${delta > 0 ? '+' : ''}${delta} п.п. · данные до ${data.meta.to || 'неизвестно'}${stale}. Ожидание по общей доле побед героев (log5); связь не доказывает причину.`;
    }
    [a, b, kind].forEach(el => el.addEventListener('change', render));
    render(); if (!data && !failed) load().then(render);
  }
  window.D2MatchupSearch = { mount };
})();
