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
  const pluralRu = (n, one, few, many) => { const x = Math.abs(n) % 100, y = x % 10; return x > 10 && x < 20 ? many : y > 1 && y < 5 ? few : y === 1 ? one : many; };
  const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + String(Math.abs(x)).replace('.', ',');
  const mmss = t => (t == null ? '—' : (t < 0 ? '−' : '') + Math.floor(Math.abs(t) / 60) + ':' + String(Math.abs(t) % 60).padStart(2, '0'));
  const POS = { 1: 'Керри', 2: 'Мид', 3: 'Оффлейн', 4: 'Поддержка', 5: 'Полная поддержка' };
  const TABS = ['tier', 'ranks', 'positions', 'pairs', 'items', 'matches', 'lanes', 'trend', 'pro'];

  let S = null, H = new Map(), I = new Map(), SH = new Map();
  let roleMeta = null, roleError = null, roleLoading = false;
  // Название основного среза: Steam (с 04.10.2026) — все рейтинговые матчи; OpenDota — ранги до Властелина.
  const baseName = () => (S && S.base.src === 'steam' ? 'Все рейтинговые' : 'Рекрут–Властелин');
  const state = { tier: { q: '', rank: 'all', pos: 'all', sort: 'lo', slice: 'base' }, ranks: { sort: '6' } };

  function heroSlug(h) {
    return typeof window.slugForHero === 'function' ? window.slugForHero(h) : String(h.name || '').replace(/^npc_dota_hero_/, '');
  }
  // Значок роли (js/hero-roles.js) и подписи к нему.
  const ROLE_KEY = { 1: 'carry', 2: 'mid', 3: 'offlane', 4: 'support', 5: 'hardsupport' };
  function roleIco(pos, title) {
    const R = window.D2HRoles;
    const img = R ? R.icon(ROLE_KEY[pos]) : '';
    return `<i class="st-role" title="${esc(title)}">${img || pos}</i>`;
  }
  // Основные роли героя (≥10% его матчей), первая — с лучшим винрейтом.
  function heroRoles(id) {
    const ro = SH.get(Number(id))?.ro || [];
    return ro.map((r, i) => roleIco(r[0], `${POS[r[0]]}${i === 0 && ro.length > 1 ? ' — лучший винрейт' : ''}: ${pct(r[2])} побед · ${pct(r[1])} матчей героя`)).join('');
  }
  // Самая частая роль героя на ранге g ('all' — по всем рангам).
  function topRole(id, g) {
    const h = SH.get(Number(id));
    if (!h) return null;
    if (g && g !== 'all') return h.rt?.[g] || null;
    const ro = (h.ro || []).slice().sort((a, b) => b[1] - a[1])[0];
    return ro ? [ro[0], ro[1]] : null;
  }
  function roleCell(id, g) {
    const r = topRole(id, g);
    return r ? `<span class="st-rolecell">${roleIco(r[0], `Чаще берут: ${POS[r[0]]} — ${pct(r[1])} матчей героя`)}<span>${POS[r[0]]}<small>${pct(r[1])}</small></span></span>` : '<span class="st-muted">—</span>';
  }
  function hero(id, sub) {
    const h = H.get(Number(id));
    if (!h) return '—';
    const slug = heroSlug(h);
    return `<span class="st-herocell"><a class="st-hero" href="/hero/${esc(slug)}/"><img loading="lazy" src="/assets/heroes/${esc(slug)}.webp" alt=""><span><b>${esc(h.localized_name)}</b>${sub ? `<small>${sub}</small>` : ''}</span></a><span class="st-roles">${heroRoles(id)}</span></span>`;
  }
  function item(id) {
    const x = I.get(Number(id));
    if (!x) return '—';
    return `<a class="st-hero st-item" href="/item/${esc(x.key)}/"><img loading="lazy" src="${esc(x.img || '/assets/items/' + x.key + '.png')}" alt=""><span><b>${esc(x.dname)}</b></span></a>`;
  }
  const bar = (v, max, cls) => `<i class="st-bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, v / max * 100)).toFixed(1)}%"></i></i>`;
  const note = t => `<p class="st-note">${t}</p>`;
  const table = (head, rows) => `<div class="st-table-wrap"><table class="st-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}" class="st-muted">Ничего не найдено — измените поиск или фильтры.</td></tr>`}</tbody></table></div>`;

  const ddm = s => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const RANK_NAMES = ['', 'Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'];
  // Срез детальных матчей Stratz (позиции 1–5, линии, покупки): период и ранги отличаются от основной выборки Steam.
  function stratzSrc() {
    const z = S.base.stratz;
    if (!z || !z.matches) return `Детальные матчи Stratz текущего патча (${num(S.base.stratzMatches)} матчей)`;
    const rk = z.rankLo ? `, ранги ${RANK_NAMES[Math.floor(z.rankLo / 10)] || '?'}–${RANK_NAMES[Math.floor(z.rankHi / 10)] || '?'}` : '';
    return `Детальные матчи Stratz текущего патча: ${num(z.matches)} матчей с ${ddm(z.from)} по ${ddm(z.to)}${rk} — это отдельная, меньшая выборка, не основная база Steam`;
  }
  // Роли — снимок Stratz; если он старше недели, честно пишем дату (источник отвечает с перебоями).
  function rolesSrc() {
    const at = S.roles && S.roles.fetchedAt;
    if (!at) return '';
    const old = Date.now() - new Date(at).getTime() > 7 * 864e5;
    return ` Роли — по данным Stratz на ${new Date(at).toLocaleDateString('ru-RU')}${old ? ' (последний успешный снимок: источник временно недоступен)' : ''}.`;
  }
  const emptyBlock = (t, p) => `<div class="st-empty"><b>${t}</b><p>${p}</p></div>`;

  // ---------- сводка ----------
  function renderSummary() {
    const b = S.base;
    const d = ddm;
    const days = Math.max(1, Math.round((new Date(b.to) - new Date(b.from)) / 864e5));
    const maxR = Math.max(...Object.values(b.ranks).map(r => r.n));
    const since = b.src === 'steam'
      ? `Выборка рейтинговых матчей Steam (не все матчи): с ${new Date(b.from).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} по ${new Date(b.to).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} (≈${days} сут., UTC), матчей ${num(b.matches)}${b.patchFrom ? `; только патч ${esc(b.patch)} (вышел ${new Date(b.patchFrom).toLocaleDateString('ru-RU', { timeZone: 'UTC' })})` : ''}`
      : `Данные с ${new Date(b.from).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}, матчей ${num(b.matches)}`;
    // Пересчёт идёт каждую ночь (daily-update, 04:17 МСК). Старше 36 ч — обновление не дошло до сайта: говорим прямо.
    const built = new Date(S.builtAt), ageH = (Date.now() - built.getTime()) / 36e5;
    const stale = Number.isFinite(ageH) && ageH > 36;
    const staleNote = stale ? `<p class="st-stale" role="status">Данные от ${built.toLocaleDateString('ru-RU')} — ежедневное обновление задерживается. Цифры ниже верны на эту дату.</p>` : '';
    summary.innerHTML = `${staleNote}<p class="st-since">${since}</p><div class="st-cards">
      <article><span>Матчей в базе</span><strong>${num(b.matches)}</strong><small>${d(b.from)} — ${d(b.to)} · патч ${esc(b.patch)}</small></article>
      <article><span>Победы Radiant</span><strong>${pct(b.radiantWr)}</strong><small>Dire — ${pct(Math.round((100 - b.radiantWr) * 10) / 10)}</small></article>
      <article><span>Детальных матчей</span><strong>${num(b.stratzMatches)}</strong><small>${S.posSteam ? 'линии, покупки (Stratz)' : 'позиции, линии, покупки (Stratz)'}${b.stratz && b.stratz.from ? ` · ${ddm(b.stratz.from)} — ${ddm(b.stratz.to)}` : ''}</small></article>
      <article><span>Обновлено</span><strong>${new Date(S.builtAt).toLocaleDateString('ru-RU')}</strong><small>${stale ? 'обновление задерживается' : 'пересчёт каждый день'}</small></article>
    </div>
    <div class="st-ranks">${Object.values(b.ranks).map(r => `<div><span>${esc(r.name)}</span>${bar(r.n, maxR)}<b>${num(r.n)}</b></div>`).join('')}</div>`;
  }

  // ---------- тир-лист ----------
  function tier() {
    const t = state.tier;
    const inPos = t.pos === 'all' ? null : new Set(S.heroes.filter(h => (h.ro || []).some(r => String(r[0]) === t.pos)).map(h => h.id));
    // Срез: base — основная своя база (ранги, тиры); top и pro — S.slices (tools/build-stats.js, раздел 5).
    const sl = t.slice !== 'base' && S.slices && S.slices[t.slice] ? S.slices[t.slice] : null;
    if (t.slice !== 'base' && !sl) t.slice = 'base';
    const isPro = t.slice === 'pro';
    let rows = (sl ? sl.heroes.map(h => ({ id: h[0], tier: null, n: h[1], wr: h[2], lo: h[3], pr: h[4], kda: isPro ? [h[5], h[6], h[7]] : null })) : S.heroes.map(h => {
      const r = t.rank === 'all' ? [h.n, h.wr, h.lo] : h.rank[t.rank];
      // Пикрейт в ранге — та же формула, что общий: матчей героя в группе / матчей группы.
      const rn = t.rank === 'all' ? 0 : S.base.ranks[t.rank].n;
      return r ? { id: h.id, tier: t.rank === 'all' ? h.tier : null, n: r[0], wr: r[1], lo: r[2], pr: t.rank === 'all' ? h.pr : (rn ? Math.round(r[0] / rn * 1000) / 10 : null) } : null;
    })).filter(Boolean)
      .filter(r => !inPos || inPos.has(r.id))
      .filter(r => !t.q || (H.get(r.id)?.localized_name || '').toLowerCase().includes(t.q));
    const k = t.sort;
    // Про-матчи из архива: 1–4 выбора не показываются; 5–9 — «мало данных», без винрейта и вне рейтинга (в конце списка).
    const proShow = (S.method && S.method.minProShow) || 5, proRank = (S.method && S.method.minProRank) || 12;
    let proHidden = 0;
    if (isPro) { const all = rows.length; rows = rows.filter(r => r.n >= proShow); proHidden = all - rows.length; rows.forEach(r => { r.low = r.n < proRank; }); }
    rows.sort((a, b) => (a.low ? 1 : 0) - (b.low ? 1 : 0) || (k === 'name' ? H.get(a.id).localized_name.localeCompare(H.get(b.id).localized_name) : (b[k] ?? -1) - (a[k] ?? -1)));
    let place = 0;
    rows.forEach(r => { r.place = r.low ? null : ++place; });
    const rankOpts = `<option value="all">Все ранги</option>` + Object.entries(S.base.ranks).map(([g, r]) => `<option value="${g}"${t.rank === g ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
    const posOpts = `<option value="all">Все позиции</option>` + Object.entries(POS).map(([p, n]) => `<option value="${p}"${t.pos === p ? ' selected' : ''}>${p} · ${n}</option>`).join('');
    const sortOpts = [['lo', 'Надёжный винрейт'], ['wr', 'Винрейт'], ['pr', 'Пикрейт'], ['n', 'Матчей'], ['name', 'Имя']].map(([v, l]) => `<option value="${v}"${t.sort === v ? ' selected' : ''}>${l}</option>`).join('');
    const maxPr = Math.max(...rows.map(r => r.pr || 0), 1);
    const sliceOpts = [['base', baseName()], ['top', 'Divine 5 и Immortal'], ['pro', 'Про-матчи (архив эфира)']].filter(([v]) => v === 'base' || (S.slices && S.slices[v]))
      .map(([v, l]) => `<option value="${v}"${t.slice === v ? ' selected' : ''}>${l}${v === 'base' ? '' : ' · ' + num(S.slices[v].matches) + ' матчей'}</option>`).join('');
    const dd = x => new Date(x).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `<div class="st-toolbar">
      <select id="stSlice" aria-label="Срез матчей">${sliceOpts}</select>
      <label class="search">⌕ <input id="stQ" placeholder="Герой…" value="${esc(t.q)}"></label>
      ${sl ? '' : `<select id="stRank" aria-label="Ранг">${rankOpts}</select>`}
      <select id="stPos" aria-label="Позиция">${posOpts}</select>
      <select id="stSort" aria-label="Сортировка">${sortOpts}</select>
    </div>` + (sl ? table(['#', 'Герой', 'Винрейт', 'Надёжный', 'Пикрейт', 'Матчей'].concat(isPro ? ['У/С/П в среднем'] : []), rows.map((r, i) =>
      `<tr><td class="st-muted">${r.place ?? '—'}</td><td>${hero(r.id)}</td>${r.low ? `<td colspan="2" class="st-muted">мало данных</td>` : `<td><b class="${r.wr >= 50 ? 'st-up' : 'st-down'}">${pct(r.wr)}</b></td><td>${pct(r.lo)}</td>`}<td>${pct(r.pr)} ${bar(r.pr, maxPr)}</td><td class="st-muted">${num(r.n)}</td>${isPro ? `<td>${r.kda.map(x => String(x).replace('.', ',')).join(' / ')}</td>` : ''}</tr>`)) +
      note(isPro
        ? `По ${num(sl.matches)} про-матчам (${dd(sl.from)} — ${dd(sl.to)}), разобранным из реплеев Valve в архиве эфира: ${sl.leagues.slice(0, 3).map(l => esc(l[0]) + ' — ' + num(l[1])).join(', ')}${sl.leagues.length > 3 ? ' и др.' : ''}. Выборка пока маленькая: винрейт отдельного героя по нескольким матчам — не оценка силы, поэтому смотрите на «Надёжный» (нижняя граница интервала Уилсона, 95%). Пикрейт — доля про-матчей, где героя взяли. Тиров нет: для них мало матчей. Винрейт и место — у героев с ${proRank}+ матчами; ${proShow}–${proRank - 1} — «мало данных»${proHidden ? `; ещё ${proHidden} героев с 1–${proShow - 1} матчами не показаны` : ''}.`
        : `По ${num(sl.matches)} рейтинговым матчам (${dd(sl.from)} — ${dd(sl.to)}) со средним рангом Divine 5 и Immortal по ленте OpenDota. Выше Divine 5 лента средний ранг не уточняет, поэтому отдельного среза «7000+ MMR» нет. «Надёжный» — нижняя граница интервала Уилсона (95%). Тиры и разрез по рангам — только в срезе «${baseName()}».`)
      : table(['#', 'Тир', 'Герой', 'Роль на ранге', 'Винрейт', 'Надёжный', 'Пикрейт', 'Матчей'], rows.map((r, i) =>
      `<tr><td class="st-muted">${i + 1}</td><td>${r.tier ? `<span class="st-tier st-tier-${r.tier}">${r.tier}</span>` : '<span class="st-muted">—</span>'}</td><td>${hero(r.id)}</td><td>${roleCell(r.id, t.rank)}</td><td><b class="${r.wr >= 50 ? 'st-up' : 'st-down'}">${pct(r.wr)}</b></td><td>${pct(r.lo)}</td><td>${pct(r.pr)} ${bar(r.pr, maxPr)}</td><td class="st-muted">${num(r.n)}</td></tr>`)) +
      note(`«Надёжный» — нижняя граница 95-процентного интервала Уилсона: у героя с малым числом матчей она ниже, поэтому случайная серия побед не выводит его в топ. Тиры S–D — пятые доли героев по этой границе (из героев с ${num(S.method.minTier)}+ матчей, по всем рангам). В разрезе ранга учитываются герои с ${num(S.method.minRank)}+ матчами. Роли — статистика Stratz по позициям: значки рядом с героем — роли, где у него ${S.roles ? S.roles.mainShare : 10}%+ матчей, первой идёт роль с лучшим винрейтом; «Роль на ранге» — самая частая роль героя на выбранном ранге. Stratz считает роли по парам рангов (Рекрут+Страж, Рыцарь+Герой, Легенда+Властелин), поэтому у соседних рангов роль общая. Фильтр позиции — по тем же основным ролям.${rolesSrc()}${t.rank !== 'all' ? ' Пикрейт в ранге — доля матчей этой группы рангов, где взяли героя.' : ''}`));
  }

  // ---------- ранги ----------
  function ranks() {
    // Группы 1–6 обязательны; группа 7 (Steam: средний ранг матча Божество 5 и Титан) — столбец, если есть хоть у одного героя.
    const req = Object.keys(S.base.ranks).filter(x => x <= 6);
    const g = req.concat(Object.keys(S.base.ranks).filter(x => x > 6 && S.heroes.some(h => h.rank[x])));
    const k = state.ranks.sort;
    const rows = S.heroes.filter(h => req.every(x => h.rank[x]))
      .map(h => ({ id: h.id, r: g.map(x => (h.rank[x] ? h.rank[x][1] : null)), d: Math.round((h.rank['6'][1] - h.rank['1'][1]) * 10) / 10 }))
      .sort((a, b) => k === 'd' ? b.d - a.d : k === '-d' ? a.d - b.d : (b.r[g.indexOf(k)] ?? -1) - (a.r[g.indexOf(k)] ?? -1));
    const cell = v => v == null ? '<td class="st-muted">—</td>' : `<td class="st-heat" style="--h:${Math.max(-1, Math.min(1, (v - 50) / 6)).toFixed(2)}">${pct(v)}</td>`;
    const opts = g.map(x => `<option value="${x}"${k === x ? ' selected' : ''}>Лучшие: ${esc(S.base.ranks[x].name)}</option>`).join('') +
      `<option value="d"${k === 'd' ? ' selected' : ''}>Сильнее на высоком ранге</option><option value="-d"${k === '-d' ? ' selected' : ''}>Сильнее на низком ранге</option>`;
    if (!rows.length) return `<div class="st-empty"><b>Разрез по рангам копится</b><p>Ранг матча известен у части базы (средний ранг из ленты OpenDota). Таблица появится, когда у героев наберётся по ${num(S.method.minRank)}+ матчей в каждой группе от Рекрута до Властелина. Сейчас матчей с известным рангом: ${Object.values(S.base.ranks).map(r => esc(r.name) + ' — ' + num(r.n)).join(', ')}.</p></div>`;
    return `<div class="st-toolbar"><select id="stRankSort" aria-label="Сортировка">${opts}</select></div>` +
      table(['Герой', 'Роль', ...g.map(x => esc(S.base.ranks[x].name)), 'Властелин − Рекрут'], rows.map(r =>
        `<tr><td>${hero(r.id)}</td><td>${roleCell(r.id, 'all')}</td>${r.r.map(cell).join('')}<td><b class="${r.d >= 0 ? 'st-up' : 'st-down'}">${sgn(r.d)} п.п.</b></td></tr>`)) +
      note(`Винрейт героя в каждой группе рангов своей базы. Показаны герои, у которых в каждой группе от Рекрута до Властелина ${num(S.method.minRank)}+ матчей${g.length > req.length ? '; «Божество 5 и Титан» — где матчей хватает, иначе «—»' : ''}. Ранг матча известен не у всех матчей базы (средний ранг из ленты OpenDota). Последний столбец — насколько лучше (или хуже) герой играется у Властелинов, чем у Рекрутов.${rolesSrc()}`);
  }

  // ---------- позиции ----------
  // Steam (S.posSteam): позиции 1/2/3 и «Поддержка 4–5» по разметке матчей моделью; без него — Stratz 1–5.
  const POS_STEAM = { 1: 'Керри', 2: 'Мид', 3: 'Оффлейн', sup: 'Поддержка 4–5' };
  function positions() {
    const audit = roleMeta?.meta?.coverage?.audit;
    const checked = Object.values(audit?.roles || {}).reduce((n, r) => n + r.total, 0);
    const validation = audit?.method === 'auto-crosscheck' && audit.reference === 'stratz' && checked
      ? ` Разметка автоматически сверена с позициями Stratz на ${num(checked)} игроках. Точность по позициям: ${[1, 2, 3, 4, 5].map(p => `${p} — ${audit.roles[p]?.total ? (100 * audit.roles[p].correct / audit.roles[p].total).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%' : '—'}`).join('; ')}. Stratz используется только для проверки.`
      : ' Для публикации разметка должна пройти проверку точности.';
    const method = note('Выборка рейтинговых реплеев Valve. Позиции определены по координатам и добиваниям к 10:00; оценка — нижняя граница 95% интервала Уилсона, не вероятность победы. Рейтинг доступен от 100 игр героя на позиции, 30–99 — малая выборка. Доля выборов считается среди размеченных игроков данной позиции.' + validation);
    if (roleError) return method + `<div class="st-empty" role="alert">Данные позиций не загрузились. <button type="button" id="stRoleRetry">Повторить</button></div>`;
    if (!roleMeta) return method + '<p class="st-loading" aria-live="polite">Загружаем позиции…</p>';
    const m = roleMeta.meta || {};
    const date = m.to ? new Date(m.to).toLocaleDateString('ru-RU') : '—';
    const provenance = note(`Рейтинговые реплеи, патч ${esc(m.patch || '—')}, ${num(m.matches)} ${pluralRu(m.matches, 'матч', 'матча', 'матчей')}, данные по ${esc(date)}. Разметка игроков: ${num(m.coverage?.labeledSlots)} из ${num(m.coverage?.possibleSlots)}.`);
    if (roleMeta.status !== 'ok' || !m.coverage?.gatePassed) return method + provenance + `<div class="st-empty">${m.coverage?.gatePassed ? 'Пока нет героев с 30 играми на позиции в этой выборке.' : 'Недостаточно проверенных реплеев для рейтинга позиций 1–5.'}</div>`;
    const blocks = Object.entries(POS).map(([p, name]) => {
      const q = roleMeta.positions?.[p];
      if (!q || !q.labeledSlots) return `<article class="st-card"><h3>${esc(name)}</h3><p>Нет размеченных игроков на этой позиции.</p></article>`;
      const rows = (q.heroes || []).filter(h => h.n >= 30).slice().sort((a, b) => (a.rating == null) - (b.rating == null)).map(h => `<tr><td>${hero(h.id)}</td><td>${num(h.n)}</td><td>${pct(h.wr)}</td><td>${h.rating == null ? '—' : h.rating}</td><td>${h.tier || (h.n < 100 ? 'Малая выборка' : 'Тир недоступен')}</td><td>${pct(h.pickShare)}</td></tr>`);
      return `<article class="st-card"><h3>${roleIco(p, name)} ${esc(name)}</h3><p>${num(q.matches)} ${pluralRu(q.matches, 'матч', 'матча', 'матчей')}, ${num(q.labeledSlots)} ${pluralRu(q.labeledSlots, 'игрок', 'игрока', 'игроков')}; рейтинг у ${num(q.eligibleHeroes)} героев. Скрыто ${num(q.hiddenHeroes)} ${pluralRu(q.hiddenHeroes, 'герой', 'героя', 'героев')} с менее чем 30 играми (${num(q.hiddenAppearances)} выборов).</p>${rows.length ? table(['Герой', 'Игр', 'Винрейт', 'Рейтинг', 'Тир', 'Доля выборов'], rows) : '<p>Пока нет героев с 30 играми на этой позиции.</p>'}</article>`;
    });
    const stale = m.to && Date.now() - new Date(m.to).getTime() > 36 * 3600e3 ? '<p class="st-stale">Данные старше 36 часов.</p>' : '';
    return method + provenance + stale + `<div class="st-role-grid">${blocks.join('')}</div>`;
  }

  // ---------- связки и контрпики ----------
  function pairs() {
    const syn = p => `<tr><td>${hero(p.a)}</td><td>${roleCell(p.a, 'all')}</td><td>${hero(p.b)}</td><td>${roleCell(p.b, 'all')}</td><td><b>${pct(p.w)}</b></td><td class="st-muted">${pct(p.e)}</td><td><b class="${p.d >= 0 ? 'st-up' : 'st-down'}">${sgn(p.d)}</b></td><td class="st-muted">${num(p.g)}</td></tr>`;
    const cnt = p => `<tr><td>${hero(p.hero)}</td><td>${roleCell(p.hero, 'all')}</td><td>${hero(p.by)}</td><td>${roleCell(p.by, 'all')}</td><td><b>${pct(p.w)}</b></td><td class="st-muted">${pct(p.e)}</td><td><b class="st-down">${sgn(p.d)}</b></td><td class="st-muted">${num(p.g)}</td></tr>`;
    const head = ['Герой', 'Роль', 'С кем', 'Роль', 'Побед', 'Ожидалось', 'Разница, п.п.', 'Матчей'];
    return `<section id="stMatchupSearch" class="st-card" aria-label="Поиск пары героев"></section><h3 class="st-h">Лучшие связки союзников</h3>` + table(head, S.synergy.slice(0, 20).map(syn)) +
      `<h3 class="st-h">Худшие связки</h3>` + table(head, S.antiSynergy.slice(0, 10).map(syn)) +
      `<h3 class="st-h">Самые жёсткие контрпики</h3>` + table(['Герой', 'Роль', 'Кто контрит', 'Роль', 'Побед героя', 'Ожидалось', 'Разница, п.п.', 'Матчей'], S.counters.slice(0, 20).map(cnt)) +
      (S.countersAt && new Date(S.builtAt) - new Date(S.countersAt) > 20 * 36e5 ? `<p class="st-stale" role="status">Контрпики — расчёт от ${new Date(S.countersAt).toLocaleDateString('ru-RU')}: сегодня они не пересчитались, связки и остальные цифры — свежие.</p>` : '') +
      note(`Ожидаемая доля побед считается по общим винрейтам обоих героев (сложение логитов — тот же метод, что у контрпиков на страницах героев), разница — насколько пара выигрывает чаще или реже ожидаемого. Учитываются пары, сыгранные ${num(S.method.minPair)}+ раз.`);
  }

  // ---------- предметы ----------
  function items() {
    if (!S.items || !S.items.length) return emptyBlock('Нет данных о покупках', 'Детальные матчи Stratz текущего патча ещё не собраны или источник недоступен.');
    const max = S.items[0]?.share || 1;
    return table(['#', 'Предмет', 'Покупают', 'Медиана первой покупки'], S.items.map((x, i) =>
      `<tr><td class="st-muted">${i + 1}</td><td>${item(x.id)}</td><td>${pct(x.share)} ${bar(x.share, max)}</td><td>${mmss(x.t)}</td></tr>`)) +
      note(`Доля матчей игроков, в которых предмет купили хотя бы раз, и медианное время первой покупки (минус — до начала матча). ${stratzSrc()}. Винрейт предмета не показываем: дорогие предметы покупают в уже выигранных играх, и такая цифра путает причину и следствие.`);
  }

  // ---------- матчи ----------
  function matches() {
    const d = S.base.duration, max = Math.max(...d.map(x => x[1]));
    const hist = `<div class="st-hist">${d.map(([m, n]) => `<div title="${m}${m >= 80 ? '+' : '–' + (m + 5)} мин: ${num(n)} матчей"><i style="height:${(n / max * 100).toFixed(1)}%"></i><span>${m}${m >= 80 ? '+' : ''}</span></div>`).join('')}</div>`;
    const late = S.durSwing.slice(0, 10), early = S.durSwing.slice(-10).reverse();
    const row = x => `<tr><td>${hero(x.id)}</td><td>${pct(x.early)}</td><td>${pct(x.late)}</td><td><b class="${x.d >= 0 ? 'st-up' : 'st-down'}">${sgn(x.d)}</b></td></tr>`;
    const head = ['Герой', 'До 25 мин', '45+ мин', 'Разница, п.п.'];
    return `<section id="stSideStats" class="st-card" aria-label="Статистика сторон" aria-live="polite"></section><h3 class="st-h">Длительность матчей</h3>${hist}<p class="st-note">Число матчей по длительности, шаг 5 минут. Матчи короче 15 минут не учитываются (брошенные игры). Radiant выигрывает ${pct(S.base.radiantWr)} матчей.</p>` +
      `<div class="st-grid st-grid-2"><div><h3 class="st-h">Сильнее в поздней игре</h3>${table(head, late.map(row))}</div><div><h3 class="st-h">Сильнее в ранней игре</h3>${table(head, early.map(row))}</div></div>` +
      note(`Винрейт героя в матчах до 25 минут и дольше 45 минут. Учитываются корзины с ${num(S.method.minDur)}+ матчами героя.`);
  }

  // ---------- линии ----------
  function lanes() {
    if (!S.lanes || !S.lanes.length) return emptyBlock('Нет данных о линиях', 'Детальные матчи Stratz текущего патча ещё не собраны или источник недоступен.');
    const row = x => `<tr><td>${hero(x.id)}</td><td>${roleCell(x.id, 'all')}</td><td><span class="st-stack"><i class="w" style="width:${x.win}%"></i><i class="d" style="width:${x.draw}%"></i><i class="l" style="width:${x.loss}%"></i></span></td><td class="st-up">${pct(x.win)}</td><td class="st-muted">${pct(x.draw)}</td><td class="st-down">${pct(x.loss)}</td><td class="st-muted">${num(x.n)}</td></tr>`;
    const head = ['Герой', 'Роль', 'Исход линии', 'Выиграл', 'Ничья', 'Проиграл', 'Матчей'];
    return `<div class="st-grid st-grid-2"><div><h3 class="st-h">Чаще всех выигрывают линию</h3>${table(head, S.lanes.slice(0, 15).map(row))}</div><div><h3 class="st-h">Чаще всех проигрывают линию</h3>${table(head, S.lanes.slice(-15).reverse().map(row))}</div></div>` +
      note(`Исход линии по оценке Stratz для линии, на которой стоял герой (сторона учтена). Порядок — по разнице «выиграл − проиграл». Герои с ${num(S.method.minLane)}+ матчами. ${stratzSrc()}.`);
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
      note(`Снимки раз в день, ${n} дн.: каждый — винрейт героя по всей выборке, которая была в базе в тот день (окно сдвигается), а не по матчам одного дня. Изменение — разница между первым и последним снимком.`);
  }

  // ---------- переключение ----------
  const R = { tier, ranks, positions, pairs, items, matches, lanes, trend };
  function loadRoles() {
    if (roleLoading || roleMeta || roleError) return;
    roleLoading = true; roleError = null;
    fetch('/data/role-meta.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(data => {
        if (data.schemaVersion !== 1 || !['ok', 'insufficient', 'unavailable'].includes(data.status) || !data.meta || !data.positions) throw new Error('Invalid role metadata');
        roleMeta = data;
      }).catch(e => { roleError = e; }).finally(() => {
        roleLoading = false;
        if (location.hash === '#positions') show('positions');
      });
  }
  function show(tab) {
    if (!TABS.includes(tab)) tab = 'tier';
    tabs.querySelectorAll('button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    if (pro) pro.hidden = tab !== 'pro';
    pane.hidden = tab === 'pro';
    if (tab !== 'pro') {
      if (!S) { pane.innerHTML = '<div class="st-loading">Загружаем статистику…</div>'; return; }
      if (tab === 'positions') loadRoles();
      pane.innerHTML = R[tab]();
      bind(tab);
    }
  }
  function bind(tab) {
    if (tab === 'pairs' && window.D2MatchupSearch) window.D2MatchupSearch.mount($('stMatchupSearch'), H);
    if (tab === 'matches' && window.D2SideStats) window.D2SideStats.mount($('stSideStats'), H);
    if (tab === 'positions' && $('stRoleRetry')) $('stRoleRetry').onclick = () => { roleError = null; loadRoles(); show('positions'); };
    if (tab === 'tier') {
      const t = state.tier;
      const q = $('stQ');
      q.oninput = () => { t.q = q.value.trim().toLowerCase(); const pos = q.selectionStart; show('tier'); const n = $('stQ'); n.focus(); n.setSelectionRange(pos, pos); };
      $('stSlice').onchange = e => { t.slice = e.target.value; show('tier'); };
      if ($('stRank')) $('stRank').onchange = e => { t.rank = e.target.value; show('tier'); };
      $('stPos').onchange = e => { t.pos = e.target.value; show('tier'); };
      $('stSort').onchange = e => { t.sort = e.target.value; show('tier'); };
    }
    if (tab === 'ranks' && $('stRankSort')) $('stRankSort').onchange = e => { state.ranks.sort = e.target.value; show('ranks'); };
  }
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    history.replaceState(null, '', '#' + b.dataset.tab);
    show(b.dataset.tab);
  });
  // Стрелки влево/вправо, Home/End — переход между вкладками (шаблон WAI-ARIA tabs).
  tabs.addEventListener('keydown', e => {
    const list = [...tabs.querySelectorAll('button[data-tab]')], i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    const b = list[(j + list.length) % list.length];
    b.focus(); b.click();
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // Шапки таблиц прилипают под верхнее меню — высоту меню берём живьём.
  function stickyTop() {
    const bar = document.querySelector('.topbar');
    const pos = bar ? getComputedStyle(bar).position : '';
    const h = bar && (pos === 'fixed' || pos === 'sticky') ? Math.round(bar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--st-sticky', h + 'px');
  }
  stickyTop();
  window.addEventListener('resize', stickyTop);

  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ': HTTP ' + r.status); return r.json(); });
  show(location.hash.slice(1));
  Promise.all([get('/data/stats.json'), get('/data/heroes.json'), get('/data/items-ru.json')]).then(([s, h, it]) => {
    S = s;
    SH = new Map(s.heroes.map(x => [Number(x.id), x]));
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
