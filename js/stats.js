/**
 * Раздел «Статистика и аналитика» (/stats/).
 * Данные — /data/stats.json (tools/build-stats.js), справочники — heroes.json и
 * items-ru.json. Вкладка в адресе (#tier, #ranks …), чтобы ссылкой можно было
 * поделиться. Клик по герою открывает карточку героя (делегирование в app.js).
 * Вкладка «Про-сцена» — прежняя таблица, её рисует js/app.js (renderStats).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const pane = $('stPane'), tabs = $('stTabs'), pro = $('stPro'), summary = $('stSummary');
  if (!pane || !tabs) return;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru-RU');
  const pct = x => (x == null ? '—' : String(x).replace('.', ',') + '%');
  const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + String(Math.abs(x)).replace('.', ',');
  const mmss = t => (t == null ? '—' : (t < 0 ? '−' : '') + Math.floor(Math.abs(t) / 60) + ':' + String(Math.abs(t) % 60).padStart(2, '0'));
  const POS = { 1: 'Керри', 2: 'Мид', 3: 'Оффлейн', 4: 'Поддержка', 5: 'Полная поддержка' };
  const TABS = ['tier', 'ranks', 'positions', 'pairs', 'items', 'matches', 'lanes', 'trend', 'pro'];

  let S = null, H = new Map(), I = new Map();
  const state = { tier: { q: '', rank: 'all', pos: 'all', sort: 'lo' }, ranks: { sort: '6' } };

  function heroSlug(h) {
    return typeof window.slugForHero === 'function' ? window.slugForHero(h) : String(h.name || '').replace(/^npc_dota_hero_/, '');
  }
  function hero(id, sub) {
    const h = H.get(Number(id));
    if (!h) return '—';
    const slug = heroSlug(h);
    return `<a class="st-hero" href="/hero/${esc(slug)}/"><img loading="lazy" src="/assets/heroes/${esc(slug)}.png" alt=""><span><b>${esc(h.localized_name)}</b>${sub ? `<small>${sub}</small>` : ''}</span></a>`;
  }
  function item(id) {
    const x = I.get(Number(id));
    if (!x) return '—';
    return `<a class="st-hero st-item" href="/item/${esc(x.key)}/"><img loading="lazy" src="${esc(x.img || '/assets/items/' + x.key + '.png')}" alt=""><span><b>${esc(x.dname)}</b></span></a>`;
  }
  const bar = (v, max, cls) => `<i class="st-bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, v / max * 100)).toFixed(1)}%"></i></i>`;
  const note = t => `<p class="st-note">${t}</p>`;
  const table = (head, rows) => `<div class="st-table-wrap"><table class="st-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  // ---------- сводка ----------
  function renderSummary() {
    const b = S.base;
    const d = s => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const maxR = Math.max(...Object.values(b.ranks).map(r => r.n));
    summary.innerHTML = `<div class="st-cards">
      <article><span>Матчей в базе</span><strong>${num(b.matches)}</strong><small>${d(b.from)} — ${d(b.to)} · патч ${esc(b.patch)}</small></article>
      <article><span>Победы Radiant</span><strong>${pct(b.radiantWr)}</strong><small>Dire — ${pct(Math.round((100 - b.radiantWr) * 10) / 10)}</small></article>
      <article><span>Детальных матчей</span><strong>${num(b.stratzMatches)}</strong><small>позиции, линии, покупки (Stratz)</small></article>
      <article><span>Обновлено</span><strong>${new Date(S.builtAt).toLocaleDateString('ru-RU')}</strong><small>пересчёт каждый день</small></article>
    </div>
    <div class="st-ranks">${Object.values(b.ranks).map(r => `<div><span>${esc(r.name)}</span>${bar(r.n, maxR)}<b>${num(r.n)}</b></div>`).join('')}</div>`;
  }

  // ---------- тир-лист ----------
  function tier() {
    const t = state.tier;
    const inPos = t.pos === 'all' ? null : new Set((S.positions[t.pos]?.heroes || []).map(h => h.id));
    let rows = S.heroes.map(h => {
      const r = t.rank === 'all' ? [h.n, h.wr, h.lo] : h.rank[t.rank];
      return r ? { id: h.id, tier: t.rank === 'all' ? h.tier : null, n: r[0], wr: r[1], lo: r[2], pr: h.pr } : null;
    }).filter(Boolean)
      .filter(r => !inPos || inPos.has(r.id))
      .filter(r => !t.q || (H.get(r.id)?.localized_name || '').toLowerCase().includes(t.q));
    const k = t.sort;
    rows.sort((a, b) => k === 'name' ? H.get(a.id).localized_name.localeCompare(H.get(b.id).localized_name) : (b[k] ?? -1) - (a[k] ?? -1));
    const rankOpts = `<option value="all">Все ранги</option>` + Object.entries(S.base.ranks).map(([g, r]) => `<option value="${g}"${t.rank === g ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
    const posOpts = `<option value="all">Все позиции</option>` + Object.entries(POS).map(([p, n]) => `<option value="${p}"${t.pos === p ? ' selected' : ''}>${p} · ${n}</option>`).join('');
    const sortOpts = [['lo', 'Надёжный винрейт'], ['wr', 'Винрейт'], ['pr', 'Пикрейт'], ['n', 'Матчей'], ['name', 'Имя']].map(([v, l]) => `<option value="${v}"${t.sort === v ? ' selected' : ''}>${l}</option>`).join('');
    const maxPr = Math.max(...rows.map(r => r.pr || 0), 1);
    return `<div class="st-toolbar">
      <label class="search">⌕ <input id="stQ" placeholder="Герой…" value="${esc(t.q)}"></label>
      <select id="stRank" aria-label="Ранг">${rankOpts}</select>
      <select id="stPos" aria-label="Позиция">${posOpts}</select>
      <select id="stSort" aria-label="Сортировка">${sortOpts}</select>
    </div>` + table(['#', 'Тир', 'Герой', 'Винрейт', 'Надёжный', 'Пикрейт', 'Матчей'], rows.map((r, i) =>
      `<tr><td class="st-muted">${i + 1}</td><td>${r.tier ? `<span class="st-tier st-tier-${r.tier}">${r.tier}</span>` : '<span class="st-muted">—</span>'}</td><td>${hero(r.id)}</td><td><b class="${r.wr >= 50 ? 'st-up' : 'st-down'}">${pct(r.wr)}</b></td><td>${pct(r.lo)}</td><td>${pct(r.pr)} ${bar(r.pr, maxPr)}</td><td class="st-muted">${num(r.n)}</td></tr>`)) +
      note(`«Надёжный» — нижняя граница 95-процентного интервала Уилсона: у героя с малым числом матчей она ниже, поэтому случайная серия побед не выводит его в топ. Тиры S–D — пятые доли героев по этой границе (из героев с ${num(S.method.minTier)}+ матчей, по всем рангам). В разрезе ранга учитываются герои с ${num(S.method.minRank)}+ матчами. Позиции — по детальным матчам Stratz (${num(S.method.minPos)}+ матчей героя на позиции).`);
  }

  // ---------- ранги ----------
  function ranks() {
    const g = Object.keys(S.base.ranks);
    const k = state.ranks.sort;
    const rows = S.heroes.filter(h => g.every(x => h.rank[x]))
      .map(h => ({ id: h.id, r: g.map(x => h.rank[x][1]), d: Math.round((h.rank['6'][1] - h.rank['1'][1]) * 10) / 10 }))
      .sort((a, b) => k === 'd' ? b.d - a.d : k === '-d' ? a.d - b.d : b.r[g.indexOf(k)] - a.r[g.indexOf(k)]);
    const cell = v => `<td class="st-heat" style="--h:${Math.max(-1, Math.min(1, (v - 50) / 6)).toFixed(2)}">${pct(v)}</td>`;
    const opts = g.map(x => `<option value="${x}"${k === x ? ' selected' : ''}>Лучшие: ${esc(S.base.ranks[x].name)}</option>`).join('') +
      `<option value="d"${k === 'd' ? ' selected' : ''}>Сильнее на высоком ранге</option><option value="-d"${k === '-d' ? ' selected' : ''}>Сильнее на низком ранге</option>`;
    return `<div class="st-toolbar"><select id="stRankSort" aria-label="Сортировка">${opts}</select></div>` +
      table(['Герой', ...g.map(x => esc(S.base.ranks[x].name)), 'Властелин − Рекрут'], rows.map(r =>
        `<tr><td>${hero(r.id)}</td>${r.r.map(cell).join('')}<td><b class="${r.d >= 0 ? 'st-up' : 'st-down'}">${sgn(r.d)} п.п.</b></td></tr>`)) +
      note(`Винрейт героя в каждой группе рангов своей базы. Показаны герои, у которых в каждой группе ${num(S.method.minRank)}+ матчей. Последний столбец — насколько лучше (или хуже) герой играется у Властелинов, чем у Рекрутов.`);
  }

  // ---------- позиции ----------
  function positions() {
    return `<div class="st-grid st-grid-5">${Object.entries(POS).map(([p, name]) => {
      const q = S.positions[p];
      if (!q) return '';
      const best = q.heroes.slice(0, 8), worst = q.heroes.slice(-5).reverse();
      const row = h => `<li>${hero(h.id, `${pct(h.wr)} · ${num(h.n)} матчей · GPM ${h.gpm}`)}</li>`;
      return `<article class="st-card"><h3><span class="st-pos">${p}</span>${name}</h3>
        <div class="st-kpi"><div><span>GPM</span><b>${q.gpm}</b></div><div><span>XPM</span><b>${q.xpm}</b></div><div><span>Игроков</span><b>${num(q.n)}</b></div></div>
        <h4>Лучшие</h4><ol class="st-list">${best.map(row).join('')}</ol>
        <h4>Худшие</h4><ol class="st-list">${worst.map(row).join('')}</ol></article>`;
    }).join('')}</div>` +
      note(`Детальные матчи Stratz текущего патча (${num(S.base.stratzMatches)} матчей). GPM и XPM — среднее за матч на позиции. Порядок — по надёжному винрейту (интервал Уилсона), герои с ${num(S.method.minPos)}+ матчами на позиции. Выборка растёт каждый день.`);
  }

  // ---------- связки и контрпики ----------
  function pairs() {
    const syn = p => `<tr><td>${hero(p.a)}</td><td>${hero(p.b)}</td><td><b>${pct(p.w)}</b></td><td class="st-muted">${pct(p.e)}</td><td><b class="${p.d >= 0 ? 'st-up' : 'st-down'}">${sgn(p.d)}</b></td><td class="st-muted">${num(p.g)}</td></tr>`;
    const cnt = p => `<tr><td>${hero(p.hero)}</td><td>${hero(p.by)}</td><td><b>${pct(p.w)}</b></td><td class="st-muted">${pct(p.e)}</td><td><b class="st-down">${sgn(p.d)}</b></td><td class="st-muted">${num(p.g)}</td></tr>`;
    const head = ['Герой', 'С кем', 'Побед', 'Ожидалось', 'Разница, п.п.', 'Матчей'];
    return `<h3 class="st-h">Лучшие связки союзников</h3>` + table(head, S.synergy.slice(0, 20).map(syn)) +
      `<h3 class="st-h">Худшие связки</h3>` + table(head, S.antiSynergy.slice(0, 10).map(syn)) +
      `<h3 class="st-h">Самые жёсткие контрпики</h3>` + table(['Герой', 'Кто контрит', 'Побед героя', 'Ожидалось', 'Разница, п.п.', 'Матчей'], S.counters.slice(0, 20).map(cnt)) +
      note(`Ожидаемая доля побед считается по общим винрейтам обоих героев (сложение логитов — тот же метод, что у контрпиков на страницах героев), разница — насколько пара выигрывает чаще или реже ожидаемого. Учитываются пары, сыгранные ${num(S.method.minPair)}+ раз.`);
  }

  // ---------- предметы ----------
  function items() {
    const max = S.items[0]?.share || 1;
    return table(['#', 'Предмет', 'Покупают', 'Медиана первой покупки'], S.items.map((x, i) =>
      `<tr><td class="st-muted">${i + 1}</td><td>${item(x.id)}</td><td>${pct(x.share)} ${bar(x.share, max)}</td><td>${mmss(x.t)}</td></tr>`)) +
      note(`Доля матчей игроков, в которых предмет купили хотя бы раз, и медианное время первой покупки (минус — до начала матча). Детальные матчи Stratz текущего патча. Винрейт предмета не показываем: дорогие предметы покупают в уже выигранных играх, и такая цифра путает причину и следствие.`);
  }

  // ---------- матчи ----------
  function matches() {
    const d = S.base.duration, max = Math.max(...d.map(x => x[1]));
    const hist = `<div class="st-hist">${d.map(([m, n]) => `<div title="${m}${m >= 80 ? '+' : '–' + (m + 5)} мин: ${num(n)} матчей"><i style="height:${(n / max * 100).toFixed(1)}%"></i><span>${m}${m >= 80 ? '+' : ''}</span></div>`).join('')}</div>`;
    const late = S.durSwing.slice(0, 10), early = S.durSwing.slice(-10).reverse();
    const row = x => `<tr><td>${hero(x.id)}</td><td>${pct(x.early)}</td><td>${pct(x.late)}</td><td><b class="${x.d >= 0 ? 'st-up' : 'st-down'}">${sgn(x.d)}</b></td></tr>`;
    const head = ['Герой', 'До 25 мин', '45+ мин', 'Разница, п.п.'];
    return `<h3 class="st-h">Длительность матчей</h3>${hist}<p class="st-note">Число матчей по длительности, шаг 5 минут. Матчи короче 15 минут не учитываются (брошенные игры). Radiant выигрывает ${pct(S.base.radiantWr)} матчей.</p>` +
      `<div class="st-grid st-grid-2"><div><h3 class="st-h">Сильнее в поздней игре</h3>${table(head, late.map(row))}</div><div><h3 class="st-h">Сильнее в ранней игре</h3>${table(head, early.map(row))}</div></div>` +
      note(`Винрейт героя в матчах до 25 минут и дольше 45 минут. Учитываются корзины с ${num(S.method.minDur)}+ матчами героя.`);
  }

  // ---------- линии ----------
  function lanes() {
    const row = x => `<tr><td>${hero(x.id)}</td><td><span class="st-stack"><i class="w" style="width:${x.win}%"></i><i class="d" style="width:${x.draw}%"></i><i class="l" style="width:${x.loss}%"></i></span></td><td class="st-up">${pct(x.win)}</td><td class="st-muted">${pct(x.draw)}</td><td class="st-down">${pct(x.loss)}</td><td class="st-muted">${num(x.n)}</td></tr>`;
    const head = ['Герой', 'Исход линии', 'Выиграл', 'Ничья', 'Проиграл', 'Матчей'];
    return `<div class="st-grid st-grid-2"><div><h3 class="st-h">Чаще всех выигрывают линию</h3>${table(head, S.lanes.slice(0, 15).map(row))}</div><div><h3 class="st-h">Чаще всех проигрывают линию</h3>${table(head, S.lanes.slice(-15).reverse().map(row))}</div></div>` +
      note(`Исход линии по оценке Stratz для линии, на которой стоял герой (сторона учтена). Порядок — по разнице «выиграл − проиграл». Герои с ${num(S.method.minLane)}+ матчами, детальные матчи текущего патча.`);
  }

  // ---------- динамика ----------
  function spark(series, i) {
    const v = series.map(x => (x ? x[i] : null));
    const ok = v.filter(x => x != null);
    if (ok.length < 2) return '';
    const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
    const pts = v.map((x, k) => x == null ? null : `${(k / (v.length - 1) * 100).toFixed(1)},${(28 - (x - lo) / span * 26).toFixed(1)}`).filter(Boolean).join(' ');
    return `<svg class="st-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }
  function trend() {
    const h = S.history, n = h.days.length;
    if (n < 2) return `<div class="st-empty"><b>История копится</b><p>Снимков пока: ${n} (${h.days.map(d => new Date(d).toLocaleDateString('ru-RU')).join(', ')}). Каждый день после обновления базы добавляется новый. Графики винрейта по дням, растущие и падающие герои появятся со второго снимка, осмысленные тренды — примерно через неделю.</p></div>`;
    const rows = Object.entries(h.heroes).map(([id, s]) => {
      const f = s.find(Boolean), l = [...s].reverse().find(Boolean);
      return f && l ? { id: Number(id), s, a: f[0], b: l[0], d: Math.round((l[0] - f[0]) * 10) / 10 } : null;
    }).filter(Boolean).sort((x, y) => y.d - x.d);
    const row = x => `<tr><td>${hero(x.id)}</td><td>${spark(x.s, 0)}</td><td>${pct(x.a)}</td><td>${pct(x.b)}</td><td><b class="${x.d >= 0 ? 'st-up' : 'st-down'}">${sgn(x.d)}</b></td></tr>`;
    const d = s => new Date(s).toLocaleDateString('ru-RU');
    const head = ['Герой', 'Винрейт по дням', d(h.days[0]), d(h.days[n - 1]), 'Изменение, п.п.'];
    return `<div class="st-grid st-grid-2"><div><h3 class="st-h">Растут</h3>${table(head, rows.slice(0, 15).map(row))}</div><div><h3 class="st-h">Падают</h3>${table(head, rows.slice(-15).reverse().map(row))}</div></div>` +
      note(`Ежедневные снимки винрейта по всей базе, ${n} дн. Изменение — разница между первым и последним снимком.`);
  }

  // ---------- переключение ----------
  const R = { tier, ranks, positions, pairs, items, matches, lanes, trend };
  function show(tab) {
    if (!TABS.includes(tab)) tab = 'tier';
    tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    if (pro) pro.hidden = tab !== 'pro';
    pane.hidden = tab === 'pro';
    if (tab !== 'pro') {
      if (!S) { pane.innerHTML = '<div class="st-loading">Загружаем статистику…</div>'; return; }
      pane.innerHTML = R[tab]();
      bind(tab);
    }
  }
  function bind(tab) {
    if (tab === 'tier') {
      const t = state.tier;
      const q = $('stQ');
      q.oninput = () => { t.q = q.value.trim().toLowerCase(); const pos = q.selectionStart; show('tier'); const n = $('stQ'); n.focus(); n.setSelectionRange(pos, pos); };
      $('stRank').onchange = e => { t.rank = e.target.value; show('tier'); };
      $('stPos').onchange = e => { t.pos = e.target.value; show('tier'); };
      $('stSort').onchange = e => { t.sort = e.target.value; show('tier'); };
    }
    if (tab === 'ranks') $('stRankSort').onchange = e => { state.ranks.sort = e.target.value; show('ranks'); };
  }
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    history.replaceState(null, '', '#' + b.dataset.tab);
    show(b.dataset.tab);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ': HTTP ' + r.status); return r.json(); });
  show(location.hash.slice(1));
  Promise.all([get('/data/stats.json'), get('/data/heroes.json'), get('/data/items-ru.json')]).then(([s, h, it]) => {
    S = s;
    H = new Map((h.heroes || h).map(x => [Number(x.id), x]));
    for (const [key, v] of Object.entries(it.items || {})) I.set(Number(v.id), Object.assign({ key }, v));
    renderSummary();
    show(location.hash.slice(1));
  }).catch(e => {
    console.error('Статистика:', e);
    summary.innerHTML = '';
    pane.innerHTML = '<div class="st-empty"><b>Статистика не загрузилась</b><p>Обновите страницу. Вкладка «Про-сцена» работает отдельно.</p></div>';
  });
})();
