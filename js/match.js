(() => {
  'use strict';
  const form = document.getElementById('matchForm');
  const input = document.getElementById('matchId');
  const status = document.getElementById('matchStatus');
  const out = document.getElementById('matchOut');
  let heroes = new Map();
  let items = new Map();
  let requestNumber = 0;
  const valid = id => /^[1-9]\d{0,14}$/.test(id);
  const shown = value => value === null || value === undefined || value === '' ? '—' : String(value);
  const el = (tag, cls, value) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = shown(value);
    return node;
  };
  const field = (p, key, source) => (p.missing || []).includes(source) ? null : p[key];
  const fmt = value => value == null || value === '' ? '—' : Number(value).toLocaleString('ru-RU');
  let activeTab = 0;
  let replayModule;
  let perfModule;
  const scriptVersion = () => {
    const version = document.querySelector('meta[name="dotamate-version"]')?.content;
    return version ? '?v=' + encodeURIComponent(version) : '';
  };
  function perfApi() {
    if (!perfModule) perfModule = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/js/perf-score.js' + scriptVersion();
      script.onload = () => resolve(window.perfScore); script.onerror = reject; document.head.append(script);
    });
    return perfModule;
  }
  async function fillScores(data, current) {
    const module = await perfApi().catch(() => null);
    if (current !== requestNumber) return;
    for (const p of data.players) {
      try { p.perf = module ? await module.evaluate(data, p) : { score: null, reason: 'jsonUnavailable' }; }
      catch (_) { p.perf = { score: null, reason: 'jsonUnavailable' }; }
    }
    if (current === requestNumber) render(data);
  }
  let replayStartedId;
  let tallestPanel = 0;
  let tabClickToken = 0;
  let tabAnchor;
  window.addEventListener('scroll', () => { tabAnchor = undefined; }, { passive: true });
  function clickAnchor(tabs) {
    tabAnchor = { token: ++tabClickToken, top: tabs.getBoundingClientRect().top };
    return tabAnchor;
  }
  function settlePanel(panel, anchor) {
    if (!panel?.isConnected) return;
    panel.style.minHeight = '';
    const height = panel.getBoundingClientRect().height;
    tallestPanel = Math.max(tallestPanel, Math.min(height, window.innerHeight * 2));
    panel.style.minHeight = `${Math.max(420, height)}px`;
    const tabs = out.querySelector('.match-tabs');
    if (tabs && anchor && tabAnchor === anchor) {
      const delta = tabs.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    }
  }
  window.matchTabLayout = settlePanel;
  function replayApi() {
    if (!replayModule) replayModule = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/js/match-replay.js' + scriptVersion();
      script.onload = () => resolve(window.matchReplay); script.onerror = reject; document.head.append(script);
    });
    return replayModule;
  }
  function openReplay(id, tab, panel) {
    replayApi().then(module => module.open(id, tab, panel)).catch(() => { panel.textContent = 'Не удалось загрузить анализ реплея.'; });
  }
  const time = value => value == null ? '—' : `${Math.floor(Number(value) / 60)}:${String(Math.floor(Number(value) % 60)).padStart(2, '0')}`;
  const side = (data, rad) => (rad ? data.radiantName || data.x?.teams?.[0]?.tag : data.direName || data.x?.teams?.[1]?.tag) || (rad ? 'Свет' : 'Тьма');
  const bits = (n, width) => { let count = 0, value = Number(n) || 0; for (let i = 0; i < width; i++) { count += value & 1; value >>>= 1; } return count; };
  const modes = { 1: 'All Pick', 2: 'Captain’s Mode', 3: 'Random Draft', 4: 'Single Draft', 5: 'All Random', 22: 'Ranked All Pick', 23: 'Turbo' };
  const lobbies = { 0: 'Обычный', 1: 'Тренировка', 2: 'Турнир', 7: 'Рейтинговый' };
  function icon(id, meta, kind = '') {
    const box = el('span', `match-slot ${kind}`);
    if (!(Number(id) > 0)) { box.classList.add('is-empty'); box.setAttribute('aria-hidden', 'true'); return box; }
    const known = items.get(Number(id));
    const info = meta && meta[id];
    const name = known?.name || info?.[0] || (Number(id) === 42 ? 'Observer Ward' : `Неизвестный предмет (ID ${id})`);
    const src = known?.img || info?.[1] || (Number(id) === 42 ? '/assets/items/ward_dispenser.png' : '');
    box.title = name;
    if (src.startsWith('/assets/items/')) {
      const img = el('img'); img.src = src; img.alt = name; img.title = name;
      img.width = 30; img.height = 22; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => { img.remove(); box.textContent = '?'; });
      box.append(img);
    } else box.textContent = '?';
    return box;
  }
  function render(data, anchor) {
    const oldHeight = out.querySelector('#match-tab-panel')?.getBoundingClientRect().height || 0;
    out.replaceChildren();
    const summary = el('section', 'match-summary');
    summary.append(el('span', 'match-winner', `Победа: ${side(data, !!data.radiantWin)}`));
    if (Array.isArray(data.x?.score)) summary.append(el('strong', 'match-score', `${data.x.score[0]} : ${data.x.score[1]}`));
    summary.append(el('div', 'match-sides', `${side(data, true)} · ${side(data, false)}`));
    const facts = [time(data.duration)];
    if (Number(data.start) > 0) facts.push(new Date(Number(data.start) * 1000).toLocaleString('ru-RU'));
    if (modes[data.gameMode]) facts.push(modes[data.gameMode]);
    if (data.x && lobbies[data.x.lobby] !== undefined) facts.push(lobbies[data.x.lobby]);
    if (data.x && data.x.fb != null) facts.push(`Первая кровь ${time(data.x.fb)}`);
    summary.append(el('div', 'match-summary-facts', facts.join(' · '))); out.append(summary);
    if (data.pending) out.append(el('p', 'match-pending', 'Загружаем полные данные…'));
    if (Array.isArray(data.x?.draft) && data.x.draft.length) {
      const draft = el('section', 'match-draft'); draft.append(el('h3', 'match-panel-title', 'Драфт'));
      const strip = el('div', 'match-draft-strip');
      for (const [pick, team, id] of data.x.draft) {
        const hero = heroes.get(Number(id)), name = hero?.name || `Герой ${id}`;
        const entry = el('span', `match-draft-entry ${Number(team) === 1 ? 'match-dire' : 'match-rad'} ${pick ? '' : 'match-ban'}`);
        entry.title = `${Number(team) === 1 ? side(data, false) : side(data, true)} · ${pick ? 'Выбор' : 'Бан'} · ${name}`;
        if (hero?.slug) { const img = el('img'); img.src = `/assets/heroes/${hero.slug}.webp`; img.alt = name; img.loading = 'lazy'; entry.append(img); } else entry.append(el('span', '', name));
        entry.append(el('small', '', pick ? 'Пик' : 'Бан')); strip.append(entry);
      }
      draft.append(strip); out.append(draft);
    }
    if (Array.isArray(data.x?.towers) && Array.isArray(data.x?.rax)) {
      const buildings = el('section', 'match-buildings'); buildings.append(el('h3', 'match-panel-title', 'Постройки'));
      for (const rad of [true, false]) { const i = rad ? 0 : 1; buildings.append(el('div', rad ? 'match-rad' : 'match-dire', `${side(data, rad)} · Башни ${bits(data.x.towers[i], 11)}/11 · Казармы ${bits(data.x.rax[i], 6)}/6`)); }
      out.append(buildings);
    }
    const detailedAvailable = data.players.some(p => p.x);
    if (data.players.length) {
      const tabs = el('div', 'match-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Статистика матча');
      ['Обзор', 'Подробно', 'Графики', 'Покупки', 'Способности', 'События', 'Линии', 'Урон', 'Карта'].forEach((label, i) => {
        if (i === 1 && !detailedAvailable) return;
        const button = el('button', '', label); button.type = 'button'; button.id = `match-tab-${i}`;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(activeTab === i)); button.setAttribute('aria-controls', 'match-tab-panel'); button.tabIndex = activeTab === i ? 0 : -1;
        button.addEventListener('click', () => { const anchor = clickAnchor(tabs); activeTab = i; render(data, anchor); document.getElementById(button.id)?.focus({ preventScroll: true }); });
        button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const anchor = clickAnchor(tabs); const ids = [...tabs.querySelectorAll('[role=tab]')].map(b => Number(b.id.split('-').pop())); const pos = ids.indexOf(i); activeTab = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : ids[(pos + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]; render(data, anchor); document.getElementById(`match-tab-${activeTab}`)?.focus({ preventScroll: true }); });
        if (i >= 2) button.append(el('span', 'match-replay-badge', '…'));
        tabs.append(button);
      }); out.append(tabs);
      const indicator = el('div', 'match-replay-status'); indicator.setAttribute('aria-live', 'polite'); out.append(indicator);
      if (replayStartedId === input.value.trim()) replayApi().then(module => module.start(replayStartedId)).catch(() => {});
    }
    const panel = el('div'); panel.id = 'match-tab-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `match-tab-${activeTab}`);
    panel.matchTabAnchor = anchor;
    panel.style.minHeight = `${Math.min(Math.max(oldHeight, tallestPanel, 420), window.innerHeight * 2)}px`;
    if (activeTab >= 2) { panel.append(el('div', 'mr-placeholder', 'Загружаем реплей…')); out.append(panel); settlePanel(panel, anchor); openReplay(input.value.trim(), activeTab, panel); return; }
    const damageVisible = key => (data.players || []).some(p => Array.isArray(p.x?.[key]) && p.x[key].some(v => Number(v) > 0));
    const damageKeys = [['di', 'Нанесённый урон'], ['dr', 'Полученный урон']].filter(([key]) => damageVisible(key));
    for (const rad of [true, false]) {
      const team = el('section', `me-md-team ${rad ? 'match-rad' : 'match-dire'}`);
      const players = (data.players || []).filter(p => p.radiant === rad);
      const heading = el('h2', 'me-md-h');
      heading.append(el('b', rad ? 'me-md-rad' : 'me-md-dire', side(data, rad)));
      if (data.radiantWin === rad) heading.append(el('span', 'me-md-win', 'Победа'));
      heading.append(el('span', 'match-team-totals', `${players.reduce((n, p) => n + (Number(field(p, 'k', 'kills')) || 0), 0)} убийств · ${fmt(players.reduce((n, p) => n + (Number(field(p, 'nw', 'net_worth')) || 0), 0))} ценность`));
      team.append(heading);
      const scroll = el('div', 'me-md-scroll');
      const table = el('table', `me-md-t ${activeTab ? 'match-detail-table' : 'match-overview-table'}`);
      const head = el('thead'); const header = el('tr');
      const healing = data.players.some(p => Number(field(p, 'hh', 'hero_healing')) > 0);
      const labels = activeTab ? ['Герой', 'Игрок', 'Урон башням', 'Золото потрачено', 'Золото', 'Мёртв', 'Потеря золота', 'Руны богатства', 'Аванпосты', 'Золото поддержки', ...damageKeys.map(([, label]) => label)] : ['Герой', 'Игрок', 'Ур.', 'K/D/A', 'Ценность', 'GPM', 'XPM', 'LH/DN', 'Урон', ...(healing ? ['Лечение'] : []), 'Предметы'];
      if (!activeTab) labels.splice(2, 0, 'Оценка');
      for (const label of labels) header.append(el('th', '', label));
      head.append(header); table.append(head);
      const body = el('tbody');
      for (const p of players) {
        const row = el('tr');
        if (Number(p.x?.lv) > 0) { row.classList.add('match-leaver'); row.title = 'Игрок покинул матч'; }
        const h = heroes.get(Number(p.hero));
        const hero = el('td', 'match-hero'); const heroBox = el('span', 'match-hero-box');
        const heroName = h?.name || (p.hero ? `Герой ${p.hero}` : 'Неизвестный герой');
        if (h?.slug) { const img = el('img'); img.src = `/assets/heroes/${h.slug}.webp`; img.alt = heroName; img.width = 42; img.height = 24; img.loading = 'lazy'; img.decoding = 'async'; heroBox.append(img); }
        heroBox.append(el('span', 'match-hero-name', heroName));
        if (Number(p.pos) >= 1 && Number(p.pos) <= 5) heroBox.append(el('span', 'match-role', `Поз. ${p.pos}`));
        hero.append(heroBox); row.append(hero);
        const player = el('td', 'match-player', p.name);
        if (Number(p.x?.pt) > 0) { const marker = el('span', 'match-party'); marker.style.setProperty('--party-color', ['#b789e8', '#71b5e8', '#e6ad59', '#77c48e', '#db858e'][(Number(p.x.pt) - 1) % 5]); marker.title = `Пати ${p.x.pt}`; marker.setAttribute('aria-label', marker.title); player.append(marker); }
        row.append(player);
        if (activeTab) {
          for (const key of ['td', 'gs', 'g', 'sd', 'gl', 'br', 'op', 'sg']) { const value = key === 'td' ? p.td : p.x?.[key]; row.append(el('td', 'me-num', key === 'sd' ? time(value) : fmt(value))); }
          for (const [key, label] of damageKeys) { const cell = el('td'); cell.append(damageBar(p.x?.[key], label)); row.append(cell); }
          body.append(row); continue;
        }
        const perfCell = el('td', 'match-perf'); const perf = p.perf;
        if (perf?.score != null) {
          const detail = el('details', 'match-perf-detail');
          const summary = el('summary', '', String(perf.score)); summary.setAttribute('aria-expanded', 'false'); detail.append(summary);
          const description = el('div', 'match-perf-pop');
          description.append(el('strong', '', 'Индекс игры'));
          if (data.leaverUnknown) description.append(el('small', '', window.perfScore.leaverNote));
          description.append(el('p', '', `Среднее 7 показателей против нашей выборки на этом герое. Игр: ${perf.n}. Патч ${perf.patch}. Период: ${new Date(perf.from * 1000).toLocaleDateString('ru-RU')} — ${new Date(perf.to * 1000).toLocaleDateString('ru-RU')}.${perf.stale ? ' Данные старше 48 часов.' : ''}`));
          for (const [key, label] of [['k','Убийства'],['d','Смерти'],['a','Помощь'],['lh','Добивания'],['gpm','GPM'],['xpm','XPM'],['hd','Урон героям']]) description.append(el('div', '', `${label} (${perf.weights[key]}%): лучше, чем ~${Math.round(perf.perMetric[key])}% игровых результатов на герое`));
          detail.append(description); perfCell.append(detail);
        } else { const reason = perf ? (window.perfScore?.reasons[perf.reason] || 'Нет оценки') : 'Загрузка оценки'; perfCell.append(el('span', '', '—')); perfCell.append(el('small', 'match-perf-reason', reason)); perfCell.title = reason; perfCell.setAttribute('aria-label', 'Оценка: —. ' + reason); }
        row.append(perfCell);
        row.append(el('td', 'me-num', p.lvl));
        const kda = el('td', 'me-num match-kda');
        [['k', 'kills', 'match-k'], ['d', 'deaths', 'match-d'], ['a', 'assists', '']].forEach(([key, source, cls], i) => { if (i) kda.append(document.createTextNode('/')); kda.append(el('span', cls, field(p, key, source))); });
        row.append(kda);
        const nw = field(p, 'nw', 'net_worth'); const nwCell = el('td', 'me-num', nw == null ? '—' : `${(Number(nw) / 1000).toFixed(1)}k`);
        if (nw != null) nwCell.title = fmt(nw); row.append(nwCell);
        for (const [key, source] of [['gpm', 'gold_per_min'], ['xpm', 'xp_per_min']]) {
          const value = field(p, key, source), cell = el('td', 'me-num');
          cell.append(el('span', '', fmt(value)));
          const average = Number(p.bm?.[key]), count = Number(p.bm?.n);
          if (value != null && Number.isFinite(average) && average > 0 && Number.isFinite(count) && count > 0) {
            const delta = Math.round((Number(value) / average - 1) * 100);
            const badge = el('small', `match-benchmark ${delta >= 0 ? 'match-benchmark-up' : 'match-benchmark-down'}`, `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`);
            badge.title = `Среднее на герое в этой роли: ${fmt(average)} ${key.toUpperCase()}, n=${fmt(count)} рейтинговых матчей DotaMate; роль определена моделью (точность ~80%)`;
            cell.append(badge);
          }
          row.append(cell);
        }
        row.append(el('td', 'me-num', `${shown(field(p, 'lh', 'last_hits'))}/${shown(field(p, 'dn', 'denies'))}`));
        row.append(el('td', 'me-num', fmt(field(p, 'hd', 'hero_damage'))));
        if (healing) row.append(el('td', 'me-num', fmt(field(p, 'hh', 'hero_healing'))));
        const itemCell = el('td', 'match-items-cell'); const inventory = el('span', 'match-inventory');
        const ids = Array.isArray(p.items) ? p.items : [];
        const mainItems = el('span', 'match-main-items'), extraItems = el('span', 'match-extra-items');
        for (let i = 0; i < 6; i++) mainItems.append(icon(ids[i], data.itemMeta));
        if (p.x) { for (let i = 0; i < 3; i++) extraItems.append(icon(p.x.bp?.[i], data.itemMeta, 'match-backpack')); mainItems.append(icon(p.x.nt, data.itemMeta, 'match-neutral')); }
        else { if (ids.slice(6, 9).some(id => Number(id) > 0)) for (let i = 6; i < 9; i++) extraItems.append(icon(ids[i], data.itemMeta, 'match-backpack')); const neutral = p.neutral ?? p.neutralItem ?? p.neutral_item ?? ids[9]; if (Number(neutral) > 0) mainItems.append(icon(neutral, data.itemMeta, 'match-neutral')); }
        inventory.append(mainItems); if (extraItems.childNodes.length) inventory.append(extraItems);
        itemCell.append(inventory); row.append(itemCell); body.append(row);
      }
      table.append(body); scroll.append(table); team.append(scroll); panel.append(team);
    }
    out.append(panel);
    if (!activeTab && (data.players || []).some(p => p.bm)) out.append(el('p', 'match-benchmark-note', 'Сравнение GPM и XPM со средним для героя на предполагаемой роли по рейтинговым матчам DotaMate. Роль определена моделью (точность ~80%); сравнение является оценкой.'));
    settlePanel(panel, anchor);
  }
  function damageBar(values, label) {
    if (!Array.isArray(values)) return el('span', '', '—');
    const wrap = el('div', 'match-damage'), bar = el('div', 'match-damage-bar');
    const nums = values.slice(0, 3).map(v => Math.max(0, Number(v) || 0));
    const total = nums.reduce((a, b) => a + b, 0), names = ['Физический', 'Магический', 'Чистый'];
    bar.title = `${label}: ${names.map((name, i) => `${name} ${fmt(nums[i])}`).join(' · ')}`;
    for (let i = 0; i < 3; i++) { const part = el('span', `match-damage-${i}`); part.style.width = `${total ? nums[i] / total * 100 : 0}%`; bar.append(part); }
    wrap.append(el('span', 'match-damage-total', fmt(total)), bar); const legend = el('span', 'match-damage-legend', 'Физ · Маг · Чист'); legend.title = bar.title; wrap.append(legend); return wrap;
  }
  async function load(id) {
    const current = ++requestNumber;
    activeTab = 0;
    out.replaceChildren();
    if (!valid(id)) { status.textContent = 'Введите корректный ID матча.'; return; }
    status.textContent = 'Загружаем матч…';
    try {
      let response;
      const deadline = Date.now() + 75000;
      const fullDeadline = Date.now() + 60000;
      do {
        response = await fetch(`/api/dota/match/${encodeURIComponent(id)}?full=1`, { headers: { Accept: 'application/json' } });
        if (current !== requestNumber) return;
        if (response.status !== 202) break;
        status.textContent = 'Запрашиваем матч у серверов Dota 2…';
        if (Date.now() >= deadline) {
          status.textContent = 'Матч ещё загружается. Попробуйте снова.';
          const retry = el('button', '', 'Повторить'); retry.type = 'button'; retry.addEventListener('click', () => load(id)); out.replaceChildren(retry);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 2500));
      } while (true);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === 'not_indexed') {
          status.textContent = 'Подробности доступны для матчей из разделов «Мой профиль» и «Про-матчи».';
          return;
        }
        status.textContent = response.status === 404 ? 'Матч не найден.' : response.status === 429 ? 'Слишком много запросов. Повторите позже.' : 'Не удалось загрузить матч. Повторите позже.';
        return;
      }
      let data = await response.json();
      if (!Array.isArray(data.players)) throw new Error('Invalid match response');
      try {
        const catalog = await fetch('/data/heroes.json').then(r => r.ok ? r.json() : null);
        heroes = new Map((catalog?.heroes || []).map(h => [Number(h.id), { name: h.localized_name, slug: String(h.name || '').replace(/^npc_dota_hero_/, '') }]));
      } catch (_) { /* Hero IDs remain visible when the local catalog is unavailable. */ }
      try {
        const catalog = await fetch('/data/items-ru.json').then(r => r.ok ? r.json() : null);
        items = new Map(Object.values(catalog?.items || {}).filter(it => Number(it.id) > 0).map(it => [Number(it.id), { name: it.dname, img: it.img }]));
      } catch (_) { /* API metadata remains available. */ }
      if (current !== requestNumber) return;
      status.textContent = ''; render(data); fillScores(data, current);
      if (!data.pending && replayStartedId !== id) { replayStartedId = id; replayApi().then(module => module.start(id)).catch(() => {}); }
      while (data.pending && !data.x && Date.now() < fullDeadline && current === requestNumber) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (current !== requestNumber) return;
        try {
          const next = await fetch(`/api/dota/match/${encodeURIComponent(id)}?full=1`, { headers: { Accept: 'application/json' } });
          if (!next.ok) continue;
          const updated = await next.json();
          if (!Array.isArray(updated.players)) continue;
          if (JSON.stringify(updated) !== JSON.stringify(data)) { data = updated; render(data); fillScores(data, current); if (!data.pending && replayStartedId !== id) { replayStartedId = id; replayApi().then(module => module.start(id)).catch(() => {}); } }
        } catch (_) { /* Keep the partial result visible. */ }
      }
      if (current === requestNumber && data.pending && !data.x) { const note = out.querySelector('.match-pending'); if (note) note.textContent = 'Полные данные пока недоступны. Обновите страницу позже.'; }
    } catch (_) { if (current === requestNumber) status.textContent = 'Не удалось загрузить матч. Повторите позже.'; }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = input.value.trim();
    if (valid(id)) history.replaceState(null, '', `/match/?id=${encodeURIComponent(id)}`);
    load(id);
  });
  const id = new URLSearchParams(location.search).get('id');
  if (id !== null) { input.value = id; load(id); }
})();
