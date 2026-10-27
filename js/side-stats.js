(function () {
  'use strict';
  let data = null, pending = null, failed = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = value => value == null ? 'Мало данных' : `${String(value).replace('.', ',')}%`;
  function load() {
    if (!pending) pending = fetch('/data/side-stats.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(d => {
      if (d.schemaVersion !== 1 || d.meta?.source !== 'steam' || d.meta.cohort !== 'ranked-all-ranks' || !Array.isArray(d.duration) || !Array.isArray(d.heroes)) throw new Error('Invalid side data');
      data = d; failed = false;
    }).catch(() => { failed = true; }).finally(() => { pending = null; });
    return pending;
  }
  function mount(root, heroes) {
    if (!root) return;
    if (failed) { root.innerHTML = '<h3>Стороны и длительность</h3><p>Данные недоступны.</p><button type="button">Повторить</button>';
      root.querySelector('button').onclick = () => { failed = false; root.textContent = 'Загружаем стороны…'; load().then(() => mount(root, heroes)); }; return; }
    if (!data) { root.textContent = 'Загружаем стороны…'; load().then(() => mount(root, heroes)); return; }
    if (data.status !== 'ok') { root.innerHTML = '<h3>Стороны и длительность</h3><p>Пока нет подходящих ранговых матчей.</p>'; return; }
    const stale = data.meta.to && Date.now() - Date.parse(data.meta.to) > 36 * 3600000 ? ' Данные старше 36 часов.' : '';
    const drows = data.duration.map(d => `<tr><td>${esc(d.key)} мин</td><td>${d.n.toLocaleString('ru-RU')}</td><td>${pct(d.radiantWr)}</td></tr>`).join('');
    const hrows = data.heroes.filter(h => h.radiant.n || h.dire.n).sort((a, b) => (b.radiant.n + b.dire.n) - (a.radiant.n + a.dire.n)).slice(0, 30)
      .map(h => `<tr><td>${esc(heroes.get(h.id)?.localized_name || heroes.get(h.id)?.name || h.id)}</td><td>${h.radiant.n}</td><td>${pct(h.radiant.wr)}</td><td>${h.dire.n}</td><td>${pct(h.dire.wr)}</td><td>${h.delta == null ? 'Мало данных' : (h.delta > 0 ? '+' : '') + h.delta + ' п.п.'}</td></tr>`).join('');
    root.innerHTML = `<h3>Radiant и Dire в ранговых матчах Steam</h3><p>Патч ${esc(data.meta.patch)} · до ${esc(data.meta.to || 'неизвестно')}.${stale} Разница по герою: его доля побед на Radiant минус на Dire. Это описание выборки, не преимущество стороны.</p>
      <div class="st-table-wrap"><table class="st-table"><thead><tr><th>Длительность</th><th>Матчей</th><th>Победы Radiant</th></tr></thead><tbody>${drows}</tbody></table></div>
      <h4>Герои по сторонам</h4><div class="st-table-wrap"><table class="st-table"><thead><tr><th>Герой</th><th>Radiant игр</th><th>Radiant WR</th><th>Dire игр</th><th>Dire WR</th><th>Разница</th></tr></thead><tbody>${hrows}</tbody></table></div>
      <p>Порог: 300 матчей для длительности, 100 появлений героя на каждой стороне для разницы. Данные по линиям недоступны.</p>`;
  }
  window.D2SideStats = { mount };
})();
