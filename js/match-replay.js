(() => {
  'use strict';
  const S = 'http://www.w3.org/2000/svg';
  const el = (tag, value, cls) => { const n = document.createElement(tag); if (value != null) n.textContent = String(value); if (cls) n.className = cls; return n; };
  const svg = (tag, attrs = {}) => { const n = document.createElementNS(S, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  const fmt = t => { const n = Math.floor(Math.abs(Number(t) || 0)); return `${Number(t) < 0 ? '-' : ''}${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const number = n => n == null ? '—' : Number(n).toLocaleString('ru-RU');
  const rows = value => Array.isArray(value) ? value : [];
  const empty = panel => panel.append(el('div', 'Данных реплея пока нет.', 'mr-placeholder mr-empty'));
  const sample = (m, p, key, t) => { const i = (t - m.econFrom) / m.econStep; return Number.isInteger(i) && i >= 0 ? rows(p?.econ?.[key])[i] ?? null : null; };
  const state = new Map();
  let currentId;
  function hero(p) { const wrap = el('span', p?.hero || `Герой ${p?.heroId || '?'}`, 'mr-hero'); if (p?.slug && /^[a-z0-9_]+$/.test(p.slug)) { const img = el('img'); img.src = `/assets/heroes/${p.slug}.webp`; img.alt = ''; img.loading = 'lazy'; wrap.prepend(img); } return wrap; }
  function button(label, fn) { const n = el('button', label); n.type = 'button'; n.addEventListener('click', fn); return n; }
  function draw(id, tab, panel) {
    if (!panel.isConnected) return;
    const st = state.get(id); panel.replaceChildren(); panel.className = 'match-replay';
    if (!st?.data) {
      const s = st?.status || { status: 'none' };
      const messages = { none: 'Запускаем разбор…', queued: s.working ? 'Разбираем реплей…' : `В очереди, впереди ${number(s.ahead ?? 0)}`, too_fresh: `Реплей будет доступен примерно через ${Math.ceil((s.retryAfter || 0) / 60)} мин.`, expired: 'Реплей удалён Valve (старше 7 дней)', failed: `Не удалось разобрать реплей: ${s.reason || 'неизвестная ошибка'}`, rate_limited: 'Слишком много запросов. Повторите позже.', match_unknown: 'Матч не найден.', loading: 'Загружаем реплей…' };
      panel.append(el('div', messages[s.status] || 'Данные реплея недоступны.', `mr-placeholder ${tab === 2 ? 'mr-placeholder-chart' : ''}`));
      if (['failed', 'rate_limited'].includes(s.status)) panel.append(button('Повторить', () => request(id)));
      window.matchTabLayout?.(panel, panel.matchTabAnchor);
      return;
    }
    const m = st.data;
    if (tab === 2) graphs(m, panel);
    if (tab === 3) purchases(m, panel, st);
    if (tab === 4) skills(m, panel, st);
    if (tab === 5) events(m, panel, st);
    if (tab === 6) lanes(m, panel);
    if (tab === 7) damage(m, panel);
    if (tab === 8) wards(m, panel, st);
    window.matchTabLayout?.(panel, panel.matchTabAnchor);
  }
  function updateUi(id) {
    if (id !== currentId) return;
    const st = state.get(id), s = st?.status || { status: 'none' };
    const messages = { none: 'Запускаем разбор…', queued: s.working ? 'Разбираем реплей…' : `В очереди, впереди ${number(s.ahead ?? 0)}`, too_fresh: `Реплей будет доступен примерно через ${Math.ceil((s.retryAfter || 0) / 60)} мин.`, expired: 'Реплей удалён Valve (старше 7 дней)', failed: `Не удалось разобрать реплей: ${s.reason || 'неизвестная ошибка'}`, rate_limited: 'Слишком много запросов. Повторите позже.', match_unknown: 'Матч не найден.' };
    const indicator = document.querySelector('.match-replay-status');
    if (indicator) {
      indicator.replaceChildren();
      if (s.status === 'ready') { indicator.textContent = 'Разбор готов'; setTimeout(() => { if (indicator.isConnected && st.status?.status === 'ready') indicator.replaceChildren(); }, 3000); }
      else { if (['none', 'queued'].includes(s.status)) indicator.append(el('span', null, 'match-replay-spinner')); indicator.append(el('span', messages[s.status] || 'Проверяем реплей…')); }
    }
    document.querySelectorAll('.match-replay-badge').forEach(b => { b.textContent = s.status === 'ready' ? '●' : '…'; b.classList.toggle('is-ready', s.status === 'ready'); });
    if (st.panel?.isConnected) draw(id, st.tab, st.panel);
  }
  function schedule(id) {
    const st = state.get(id); clearTimeout(st.timer);
    if (st.status?.status !== 'queued' || document.visibilityState !== 'visible') return;
    st.timer = setTimeout(() => check(id), Date.now() - st.queuedAt < 20 * 60 * 1000 ? 4000 : 15000);
  }
  async function loadReady(id) {
    const st = state.get(id), s = st.status;
    if (st.loading || st.data || !st.panel?.isConnected) return;
    st.loading = true;
    try {
      const u = new URL(s.url, location.origin); if (u.origin !== location.origin || !u.pathname.startsWith(`/api/live/match/${id}`)) throw new Error('Invalid replay URL');
      const response = await fetch(u.href); if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json(); if (data.schema !== 3 || !Array.isArray(data.players)) throw new Error('Invalid replay');
      st.data = data; draw(id, st.tab, st.panel);
    } catch (_) { st.status = { status: 'failed', reason: 'ошибка загрузки' }; updateUi(id); }
    finally { st.loading = false; }
  }
  async function check(id, enqueue = false) {
    const st = state.get(id); if (!st || st.busy || (document.visibilityState !== 'visible' && st.checked)) return;
    st.busy = true; try {
      const r = await fetch(`/api/dota/match/${encodeURIComponent(id)}/parse${enqueue ? '?request=1' : ''}`, { headers: { Accept: 'application/json' } });
      const s = await r.json(); if (state.get(id) !== st) return; st.checked = true;
      st.status = r.status === 429 ? { status: 'rate_limited' } : r.status === 409 ? { status: 'match_unknown' } : s;
      if (s.status === 'none' && !enqueue && !st.requested && !navigator.webdriver && document.visibilityState === 'visible') { st.requested = true; st.status = { status: 'none' }; updateUi(id); st.busy = false; return check(id, true); }
      if (st.status.status === 'queued' && !st.queuedAt) st.queuedAt = Date.now();
      if (st.status.status === 'failed' && Number(s.retryAfter) > 0 && !st.autoRetried) { st.autoRetried = true; st.retryAt = Date.now() + Number(s.retryAfter) * 1000; }
      updateUi(id);
      if (st.status.status === 'ready') loadReady(id);
      if (st.retryAt) { clearTimeout(st.retryTimer); st.retryTimer = setTimeout(() => { st.retryAt = 0; request(id); }, Math.max(0, st.retryAt - Date.now())); }
    } catch (_) { st.status = { status: 'failed', reason: 'ошибка загрузки' }; updateUi(id); }
    finally { st.busy = false; schedule(id); }
  }
  function request(id) { const st = state.get(id); if (!st || navigator.webdriver || document.visibilityState !== 'visible') return; clearTimeout(st.retryTimer); st.retryAt = 0; check(id, true); }
  function chart(m, panel, key, title) {
    const t = rows(m.adv?.t), v = rows(m.adv?.[key]);
    const data = t.map((time, i) => [Number(time), Number(v[i])]).filter(([time, value], i) => i < v.length && Number.isFinite(time) && Number.isFinite(value));
    if (!data.length) { empty(panel); return; }
    panel.append(el('h3', title));
    const box = el('div', null, 'mr-chart');
    const g = svg('svg', { viewBox: '0 0 700 300', role: 'img', 'aria-label': `${title}: преимущество Света выше нуля, Тьмы ниже` });
    const left = 54, right = 686, top = 14, bottom = 262, zero = (top + bottom) / 2;
    const minT = Math.min(0, data[0][0]), maxT = Math.max(minT + 1, data.at(-1)[0]);
    const peak = Math.max(1, ...data.map(([, value]) => Math.abs(value)));
    const scale = Math.pow(10, Math.floor(Math.log10(peak)));
    const step = Math.ceil(peak / scale / 2) * scale;
    const range = Math.max(step * 2, peak);
    const x = time => left + (time - minT) / (maxT - minT) * (right - left);
    const y = value => zero - value / range * (zero - top);
    const tick = value => `${value < 0 ? '-' : ''}${Math.abs(value) >= 1000 ? `${Number((Math.abs(value) / 1000).toFixed(1))}k` : Math.abs(value)}`;
    for (const value of [-range, -step, 0, step, range]) {
      const yy = y(value); g.append(svg('line', { x1: left, y1: yy, x2: right, y2: yy, class: value === 0 ? 'mr-zero' : 'mr-grid' }));
      const label = svg('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end', class: 'mr-axis-label' }); label.textContent = tick(value); g.append(label);
    }
    const interval = maxT - minT > 2400 ? 600 : 300;
    for (let time = Math.ceil(minT / interval) * interval; time <= maxT; time += interval) {
      const xx = x(time); g.append(svg('line', { x1: xx, y1: top, x2: xx, y2: bottom, class: 'mr-grid' }));
      const label = svg('text', { x: xx, y: bottom + 19, 'text-anchor': 'middle', class: 'mr-axis-label' }); label.textContent = fmt(time); g.append(label);
    }
    const points = data.map(([time, value]) => [x(time), y(value)]);
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i], [x2, y2] = points[i + 1], v1 = data[i][1], v2 = data[i + 1][1];
      const cross = x1 + (x2 - x1) * -v1 / (v2 - v1);
      const segments = v1 * v2 < 0 ? [[[x1, y1], [cross, zero]], [[cross, zero], [x2, y2]]] : [[[x1, y1], [x2, y2]]];
      for (const [[ax, ay], [bx, by]] of segments) g.append(svg('path', { d: `M ${ax} ${zero} L ${ax} ${ay} L ${bx} ${by} L ${bx} ${zero} Z`, class: (ay + by) / 2 <= zero ? 'mr-radiant-area' : 'mr-dire-area' }));
    }
    g.append(svg('polyline', { points: points.map(p => p.join(',')).join(' '), fill: 'none', class: 'mr-line' }));
    points.forEach((p, i) => { const dot = svg('circle', { cx: p[0], cy: p[1], r: 5, class: 'mr-point', tabindex: 0 }); const value = data[i][1]; const label = `${fmt(data[i][0])} · ${value >= 0 ? 'Свет' : 'Тьма'} +${number(Math.abs(value))}`; const titleNode = svg('title'); titleNode.textContent = label; dot.append(titleNode); dot.setAttribute('aria-label', label); g.append(dot); });
    box.append(g); panel.append(box);
    const legend = el('div', null, 'mr-legend'); legend.append(el('span', 'Свет впереди', 'mr-legend-radiant'), el('span', 'Тьма впереди', 'mr-legend-dire')); panel.append(legend);
  }
  function graphs(m, panel) { chart(m, panel, 'gold', 'Преимущество по ценности'); chart(m, panel, 'xp', 'Преимущество по опыту'); panel.append(button('Ценность игроков', () => { const box = el('div', null, 'mr-chart'); const g = svg('svg', { viewBox: '0 0 600 220', role: 'img', 'aria-label': 'График ценности игроков' }); const max = Math.max(1, ...rows(m.players).flatMap(p => rows(p?.econ?.nw)).filter(Number.isFinite)); const len = Math.max(2, ...rows(m.players).map(p => rows(p?.econ?.nw).length)); rows(m.players).forEach((p, i) => { const a = rows(p?.econ?.nw); const points = a.map((n, j) => n == null ? null : `${30 + j / (len - 1) * 560},${200 - n / max * 180}`).filter(Boolean); const line = svg('polyline', { points: points.join(' '), fill: 'none', stroke: `hsl(${i * 36} 65% 52%)`, 'stroke-width': 2 }); const titleNode = svg('title'); titleNode.textContent = p.hero; line.append(titleNode); g.append(line); }); box.append(g); panel.append(box); })); }
  let catalog;
  async function itemsCatalog() { if (!catalog) catalog = fetch('/data/items-ru.json').then(r => r.json()).then(d => d.items || {}).catch(() => ({})); return catalog; }
  function itemInfo(items, raw) {
    const key = String(raw || '').replace(/^item_/, '');
    const aliases = { ward_observer: 'ward_dispenser', ward_sentry: 'ward_dispenser', tp_scroll: 'tpscroll' };
    const item = items[key] || items[aliases[key]];
    const names = { ward_observer: 'Обзорный вард', ward_sentry: 'Сторожевой вард' };
    return { item, name: names[key] || item?.dname || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), recipe: key.startsWith('recipe_') || item?.cat === 'recipe' };
  }
  async function purchases(m, panel, st) {
    const items = await itemsCatalog(); if (!panel.isConnected || st.data !== m) return;
    panel.replaceChildren();
    panel.append(button(st.noConsumables ? 'Показать расходники' : 'Без расходников', () => { st.noConsumables = !st.noConsumables; purchases(m, panel, st); }));
    panel.append(button(st.showRecipes ? 'Скрыть рецепты' : 'Показать рецепты', () => { st.showRecipes = !st.showRecipes; purchases(m, panel, st); }));
    for (const p of rows(m.players)) {
      const row = el('div', null, 'mr-purchase-row'); row.append(hero(p));
      if (!p.purchaseLogComplete) row.append(el('small', 'Журнал покупок неполный'));
      const list = el('div', null, 'mr-items');
      for (const [t, key] of rows(p?.items).filter(Array.isArray)) {
        const { item, name, recipe } = itemInfo(items, key);
        if ((!st.showRecipes && recipe) || (st.noConsumables && item?.cat === 'consumable')) continue;
        const cell = el('span', null, 'mr-item'); cell.title = `${name} · ${fmt(t)}`;
        if (item?.img?.startsWith('/assets/items/')) { const img = el('img'); img.src = item.img; img.alt = name; img.loading = 'lazy'; cell.append(img); }
        else cell.append(el('span', name));
        cell.append(el('small', fmt(t))); list.append(cell);
      }
      row.append(list); panel.append(row);
    }
    if (!rows(m.players).length) empty(panel);
  }
  let abilityNames;
  function skills(m, panel, st) {
    if (!rows(m.players).some(p => Array.isArray(p.skills))) { panel.append(el('p', 'Нет данных в этом разборе')); return; }
    if (!abilityNames) abilityNames = Promise.all(['/data/hero-abilities.json', '/data/talents-text.json'].map(u => fetch(u).then(r => r.json()).catch(() => ({})))).then(([abilities, talents]) => {
      const names = new Map();
      for (const group of Object.values(abilities.heroes || {})) for (const a of rows(group)) if (a.key) names.set(a.key, a.dname || a.key);
      for (const [key, label] of Object.entries(talents.byKey || {})) names.set(key, label);
      return names;
    });
    abilityNames.then(names => {
      if (!panel.isConnected || st.data !== m) return;
      panel.replaceChildren();
      for (const p of rows(m.players)) {
        const row = el('div', null, 'mr-skill-row'); row.append(hero(p));
        const list = el('div', null, 'mr-skill-list');
        rows(p.skills).forEach(([t, key, level], i) => {
          const chip = el('span', null, 'mr-skill');
          const name = names.get(key) || String(key).replace(/_/g, ' ');
          chip.title = `${name} · уровень способности ${level} · ${fmt(t)}`;
          chip.append(el('small', i + 1));
          if (key === 'special_bonus_attributes') chip.append(el('span', '+атр'));
          else if (String(key).startsWith('special_bonus')) { chip.classList.add('mr-talent'); chip.append(el('span', name)); }
          else if (/^[a-z0-9_]+$/.test(key)) { const img = el('img'); img.src = `/assets/abilities/${key}.png`; img.alt = name; img.loading = 'lazy'; img.onerror = () => img.replaceWith(el('span', name)); chip.append(img); }
          else chip.append(el('span', name));
          chip.append(el('small', level)); list.append(chip);
        });
        if (!list.childNodes.length) list.append(el('span', 'Нет данных в этом разборе'));
        row.append(list); panel.append(row);
      }
      window.matchTabLayout?.(panel, panel.matchTabAnchor);
    });
  }
  function damage(m, panel) {
    if (!rows(m.players).some(p => Array.isArray(p.dmgTo))) { panel.append(el('p', 'Нет данных в этом разборе')); return; }
    const players = rows(m.players), max = Math.max(1, ...players.flatMap(p => rows(p.dmgTo).map(Number).filter(Number.isFinite)));
    const short = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
    for (const [start, title] of [[0, 'Свет → Тьма'], [5, 'Тьма → Свет']]) {
      panel.append(el('h3', title)); const wrap = el('div', null, 'mr-table-scroll'), table = el('table', null, 'mr-damage-table');
      const head = el('tr'); head.append(el('th', 'Герой')); for (let j = 0; j < 5; j++) { const cell = el('th'); cell.append(hero(players[(start + 5 + j) % 10])); head.append(cell); } head.append(el('th', 'Всего')); table.append(head);
      const totals = Array(5).fill(0);
      for (let i = 0; i < 5; i++) { const p = players[start + i], tr = el('tr'), label = el('th'); label.append(hero(p)); tr.append(label); let sum = 0;
        for (let j = 0; j < 5; j++) { const slot = (start + 5 + j) % 10, n = Math.max(0, Number(p?.dmgTo?.[slot]) || 0), td = el('td', short(n)); td.style.setProperty('--mr-shade', String(n / max)); td.title = `${p?.hero || 'Герой'} → ${players[slot]?.hero || 'герой'}: ${number(n)}`; tr.append(td); sum += n; totals[j] += n; }
        tr.append(el('th', short(sum))); table.append(tr);
      }
      const foot = el('tr'); foot.append(el('th', 'Всего')); for (const n of totals) foot.append(el('th', short(n))); foot.append(el('th', short(totals.reduce((a, b) => a + b, 0)))); table.append(foot); wrap.append(table); panel.append(wrap);
    }
    panel.append(el('p', 'Урон по героям из combat log, без иллюзий.', 'mr-note'));
  }
  function eventRows(m) { return [...rows(m.deaths).map(x => ({ ...x, type: 'kill' })), ...rows(m.roshan).map(x => ({ ...x, type: 'roshan' })), ...rows(m.buildings).map(x => ({ ...x, type: 'building' })), ...rows(m.aegis).map(x => ({ ...x, type: 'aegis' })), ...rows(m.acts).filter(Array.isArray).map(([t, type, slot, side]) => ({ t, type, slot, side }))].sort((a, b) => a.t - b.t); }
  function events(m, panel, st) {
    panel.replaceChildren(); const types = [['all', 'Все'], ['kill', 'Убийства'], ['roshan', 'Рошан'], ['building', 'Постройки'], ['smoke', 'Смоки'], ['buyback', 'Байбэки'], ['utility', 'Глифы/сканы']];
    const chips = el('div', null, 'mr-chips'); for (const [key, label] of types) { const b = button(label, () => { st.filter = key; events(m, panel, st); }); b.setAttribute('aria-pressed', String((st.filter || 'all') === key)); chips.append(b); } panel.append(chips);
    const players = rows(m.players), list = el('ol', null, 'mr-events');
    for (const e of eventRows(m)) {
      if (st.filter && st.filter !== 'all' && st.filter !== e.type && !(st.filter === 'utility' && ['glyph', 'scan'].includes(e.type)) && !(st.filter === 'roshan' && e.type === 'aegis')) continue;
      const li = el('li'); li.append(el('time', fmt(e.t)));
      if (e.type === 'kill') { li.append(hero(players[e.killer]), el('span', '→'), hero(players[e.victim])); for (const slot of rows(e.assist)) { const assist = hero(players[slot]); assist.classList.add('mr-assist'); assist.title = 'ассист (оценка)'; li.append(assist); } if (e.gold) li.append(el('span', `+${number(e.gold)} золота`)); }
      else if (e.type === 'roshan') li.append(el('span', 'Рошан убит'));
      else if (e.type === 'aegis') { li.append(el('span', ({ pick: 'Аегис подобран', stolen: 'Аегис украден', denied: 'Аегис уничтожен' })[e.kind] || 'Аегис'), hero(players[e.slot])); }
      else if (e.type === 'building') li.append(el('span', `Постройка уничтожена: ${e.kind || ''}`));
      else { li.append(el('span', ({ smoke: 'Смок', buyback: 'Байбэк', glyph: 'Глиф', scan: 'Скан' })[e.type])); if (e.slot >= 0) li.append(hero(players[e.slot])); else if (e.side === 2 || e.side === 3) li.append(el('span', e.side === 2 ? 'Свет' : 'Тьма')); }
      list.append(li);
    }
    panel.append(list); if (!list.childNodes.length) panel.append(el('p', 'Нет данных в этом разборе'));
    panel.append(el('p', 'Ассисты — оценка по счётчику ассистов.', 'mr-note'));
  }
  function lanes(m, panel) { const wrap = el('div', null, 'mr-table-scroll'), table = el('table'); const head = el('tr'); for (const label of ['Герой', 'LH/DN 5', 'LH/DN 10', 'Ценность 10', 'Уровень 10']) head.append(el('th', label)); table.append(head); for (const p of rows(m.players)) { const tr = el('tr'), td = el('td'); td.append(hero(p)); tr.append(td); for (const t of [300, 600]) tr.append(el('td', `${number(sample(m, p, 'lh', t))}/${number(sample(m, p, 'dn', t))}`)); tr.append(el('td', number(sample(m, p, 'nw', 600))), el('td', number(sample(m, p, 'lvl', 600)))); table.append(tr); } wrap.append(table); panel.append(wrap); if (!rows(m.players).length) empty(panel); }
  const heatCache = new WeakMap();
  function wards(m, panel, st = {}) {
    const players = rows(m.players), hasMap = m.coords === 'cell';
    panel.replaceChildren();
    if (!Array.isArray(m.wards) && !Array.isArray(m.runes) && !players.some(p => Array.isArray(p.x))) { panel.append(el('p', 'Нет данных в этом разборе')); return; }
    const controls = el('div', null, 'mr-chips');
    for (const [key, name] of [['wards', 'Варды'], ['runes', 'Руны'], ['heat', 'Перемещения']]) {
      const b = button(name, () => { st.mapLayer = key; wards(m, panel, st); }); b.setAttribute('aria-pressed', String((st.mapLayer || 'wards') === key)); controls.append(b);
    }
    panel.append(controls);
    const layer = st.mapLayer || 'wards';
    if (layer === 'heat') {
      const chooser = el('div', null, 'mr-map-heroes');
      players.forEach((p, i) => { const b = button('', () => { st.mapHero = i; wards(m, panel, st); }); b.setAttribute('aria-label', p.hero || `Герой ${i + 1}`); b.append(hero(p)); b.setAttribute('aria-pressed', String((st.mapHero || 0) === i)); chooser.append(b); }); panel.append(chooser);
    }
    const map = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': 'Места установки вардов', class: 'mr-map' });
    map.append(svg('image', { href: '/assets/live/minimap.jpg', x: 0, y: 0, width: 200, height: 200, preserveAspectRatio: 'none' }));
    const label = w => `${w.kind === 'obs' ? 'Обзорный' : 'Сторожевой'} вард, ${fmt(w.t)}${Number.isFinite(w.end) && w.end >= w.t ? ` · ${fmt(w.end - w.t)}` : ''}`;
    for (const w of layer === 'wards' ? rows(m.wards) : []) {
      if (m.coords !== 'cell') break;
      const x = (w.x - 54) / 148 * 200, y = (202 - w.y) / 148 * 200;
      if (![x, y].every(Number.isFinite) || x < 0 || x > 200 || y < 0 || y > 200) continue;
      const dot = svg('circle', { cx: x, cy: y, r: 3, class: w.kind === 'obs' ? 'mr-obs' : 'mr-sen' });
      const titleNode = svg('title'); titleNode.textContent = label(w); dot.append(titleNode); map.append(dot);
    }
    if (layer === 'heat' && hasMap) {
      const p = players[st.mapHero || 0]; let bins = heatCache.get(p);
      if (!bins) { bins = new Uint32Array(64 * 64); const xs = rows(p?.x), ys = rows(p?.y); for (let i = 0; i < Math.min(xs.length, ys.length); i++) { const x = Math.floor((xs[i] - 54) / 148 * 64), y = Math.floor((202 - ys[i]) / 148 * 64); if (x >= 0 && x < 64 && y >= 0 && y < 64) bins[y * 64 + x]++; } if (p) heatCache.set(p, bins); }
      const peak = Math.max(1, ...bins); bins.forEach((n, i) => { if (n) map.append(svg('rect', { x: (i % 64) * 200 / 64, y: Math.floor(i / 64) * 200 / 64, width: 200 / 64, height: 200 / 64, fill: '#e85c35', opacity: (0.15 + 0.7 * Math.sqrt(n / peak)).toFixed(2) })); });
    }
    if (hasMap && (layer === 'heat' || layer === 'wards')) panel.append(map);
    if (layer === 'heat' && !rows(players[st.mapHero || 0]?.x).length) panel.append(el('p', 'Нет данных в этом разборе'));
    if (layer === 'runes') { for (const r of rows(m.runes)) { const row = el('div', null, 'mr-rune-row'); row.append(el('time', fmt(r.t)), hero(players[r.slot]), el('span', 'Руна')); row.title = `Руна ${r.rune}`; panel.append(row); } if (!rows(m.runes).length) panel.append(el('p', 'Нет данных в этом разборе')); return; }
    if (layer !== 'wards') return;
    for (const p of rows(m.players)) {
      const ws = rows(m.wards).filter(w => w.slot === p.slot);
      const obs = ws.filter(w => w.kind === 'obs'), sen = ws.filter(w => w.kind !== 'obs');
      const lifetimes = ws.filter(w => Number.isFinite(w.end) && w.end >= w.t).map(w => w.end - w.t);
      const average = lifetimes.length ? fmt(lifetimes.reduce((sum, n) => sum + n, 0) / lifetimes.length) : '—';
      const row = el('div', null, 'mr-ward-row'); row.append(hero(p), el('span', `Обзорные: ${obs.length} · Сторожевые: ${sen.length} · Среднее время: ${average}`));
      const details = el('details', null, 'mr-ward-details'); details.append(el('summary', 'Показать все'));
      const list = el('div', null, 'mr-ward-list');
      for (const w of ws) { const entry = el('span', null, 'mr-ward-entry'); entry.append(hero(p), el('span', label(w))); list.append(entry); }
      details.append(list); row.append(details); panel.append(row);
    }
    if (!rows(m.wards).length) empty(panel);
  }
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState !== 'visible') { for (const st of state.values()) clearTimeout(st.timer); return; } for (const [id, st] of state) { if (st.status?.status === 'none' && !st.requested && !navigator.webdriver) { st.requested = true; request(id); } else if (st.status?.status === 'queued') check(id); } });
  window.matchReplay = { start(id) { if (currentId && currentId !== id) clearTimeout(state.get(currentId)?.timer); currentId = id; let st = state.get(id); if (!st) { st = {}; state.set(id, st); } updateUi(id); if (!st.checked) check(id); }, open(id, tab, panel) { let st = state.get(id); if (!st) { st = {}; state.set(id, st); } st.tab = tab; st.panel = panel; if (st.data) draw(id, tab, panel); else if (st.status?.status === 'ready') loadReady(id); else { draw(id, tab, panel); if (!st.checked && currentId === id) check(id); } }, sample, eventRows };
})();




