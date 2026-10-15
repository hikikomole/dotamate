// Учебный центр: «Разбор матча» (/academy/match/) — интерфейс.
// Расчёт — js/academy-analysis.js, хранение разборов и целей — js/academy-records.js,
// разметка — tools/academy-render.js (renderMatchPage).
//
// Матч по Steam ID берётся у того же API, что «Мой профиль» (deploy/api/index.php):
//   GET /api/dota/player/<id>/matches?offset=0&summary=0 — 20 последних матчей;
//   GET /api/dota/match/<matchId>?me=<id> — все 10 игроков (из кеша сервера, после списка).
// Steam ID хранится в браузере под тем же ключом dmSteamId, что и в «Моём профиле».
// Справочники — /data/stats.json (эталон), /data/heroes.json, /data/hero-items.json, /data/items-ru.json.
(function () {
  'use strict';
  const root = document.querySelector('[data-academy-match]');
  const R = window.DMAcademyRecords, A = window.DMMatchAnalysis;
  if (!root || !R || !A) return;
  let REFS = { guides: {}, stages: {}, routes: [] };
  try { REFS = JSON.parse(document.getElementById('academyMatchRefs').textContent); } catch (e) { /* без подписей ссылок */ }
  document.documentElement.classList.add('ac-js');

  const $ = s => root.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
  const dur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const dateOf = ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const posLabel = p => p === 'sup' ? 'поддержка (4–5)' : `позиция ${p}`;
  const AREA_ICON = { lane: '🛣', farm: '💰', xp: '📈', deaths: '💀', fights: '⚔', damage: '🗡', objectives: '🏰', items: '🎒', vision: '👁', positioning: '🧭', macro: '🗺', draft: '🧩', tilt: '🧘' };

  // ---------- хранилище ----------
  function storageNote(ok) {
    const n = $('[data-academy-storage]');
    if (!n || ok) return;
    n.textContent = 'Браузер не разрешает сайту хранить данные: разборы и цели пропадут после перезагрузки страницы.';
    n.hidden = false;
  }

  // ---------- справочники ----------
  let dataPromise = null;
  function getJson(url) { return fetch(url, { headers: { Accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function loadData() {
    if (dataPromise) return dataPromise;
    dataPromise = Promise.all([getJson('/data/stats.json'), getJson('/data/heroes.json'), getJson('/data/hero-items.json').catch(() => null), getJson('/data/items-ru.json').catch(() => null)])
      .then(([stats, h, heroItems, items]) => {
        const heroes = new Map();
        (h.heroes || []).forEach(x => {
          const slug = (typeof window.slugForHero === 'function' ? window.slugForHero(x) : '') || String(x.name || '').replace(/^npc_dota_hero_/, '');
          heroes.set(Number(x.id), { name: x.localized_name, slug });
        });
        return { stats, heroes, heroItems, items: items && items.items };
      });
    dataPromise.catch(() => { dataPromise = null; });   // повторная попытка при следующем действии
    return dataPromise;
  }

  // ---------- Steam ID (те же правила, что в «Моём профиле», js/me.js) ----------
  const STORE_KEY = 'dmSteamId';
  const STEAM64_BASE = 76561197960265728n, MAX32 = 4294967294;
  function from64(s) { const n = BigInt(s) - STEAM64_BASE; return n >= 1n && n <= BigInt(MAX32) ? String(n) : null; }
  function parseId(raw) {
    const s = String(raw || '').trim();
    if (!s) return { err: 'Введи Steam ID или ссылку на профиль.' };
    if (/steamcommunity\.com\/id\//i.test(s)) return { err: 'Это ссылка с коротким именем профиля. Нужна ссылка вида steamcommunity.com/profiles/7656… или код для друзей Steam (Друзья → «Добавить друга»).' };
    let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})(?:[\/?#]|$)/i);
    if (m) { const id = m[1].startsWith('7656119') ? from64(m[1]) : null; return id ? { id } : { err: 'Не получилось прочитать ID из ссылки.' }; }
    m = s.match(/(?:dotabuff\.com|opendota\.com|stratz\.com)\/players\/(\d{1,10})(?:[\/?#]|$)/i);
    const d = m ? m[1] : s;
    if (!/^\d+$/.test(d)) return { err: 'ID — это число: код для друзей Steam (до 10 цифр) или 64-битный ID из 17 цифр.' };
    if (d.length <= 10) { const n = Number(d); return n >= 1 && n <= MAX32 ? { id: String(n) } : { err: 'Такого Steam ID не бывает.' }; }
    if (d.length === 17 && d.startsWith('7656119')) { const id = from64(d); return id ? { id } : { err: 'Такого Steam ID не бывает.' }; }
    return { err: 'ID — это число: код для друзей Steam (до 10 цифр) или 64-битный ID из 17 цифр.' };
  }
  const loadId = () => { try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; } };
  const saveId = id => { try { localStorage.setItem(STORE_KEY, id); } catch (e) { /* только в памяти */ } };
  const dropId = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* нечего удалять */ } };

  // ---------- API ----------
  async function api(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);   // сервер отвечает не дольше 25 с
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = undefined; }
      const ra = parseInt(r.headers.get('Retry-After') || '', 10);
      if (!r.ok) return { ok: false, code: data && typeof data.error === 'string' ? data.error : r.status === 429 ? 'busy' : r.status >= 500 ? 'upstream_error' : 'http', retryAfter: isFinite(ra) ? ra : null, status: r.status };
      if (!data) return { ok: false, code: 'bad_json' };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, code: ctl.signal.aborted ? 'timeout' : 'network' };
    } finally { clearTimeout(t); }
  }
  function waitText(sec) { if (sec == null) return 'минуту'; if (sec < 60) return `${sec} с`; const m = Math.ceil(sec / 60); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; }
  function errorText(res) {
    switch (res.code) {
      case 'bad_id': return 'Сервер не принял этот Steam ID. Проверь число или ссылку на профиль.';
      case 'history_unavailable': return 'История матчей закрыта. В Dota 2 открой Настройки → «Сообщество» → включи «Общедоступная история матчей»; Steam начнёт отдавать матчи после следующей сыгранной игры. Пока можно ввести цифры вручную.';
      case 'busy': return `Сервер сейчас обрабатывает другие запросы к Steam. Попробуй через ${waitText(res.retryAfter == null ? 5 : res.retryAfter)}.`;
      case 'rate_limited': return `Steam временно ограничил запросы. Попробуй через ${waitText(res.retryAfter)} или введи цифры вручную.`;
      case 'timeout': return 'Steam не ответил вовремя. Попробуй ещё раз через минуту.';
      case 'not_configured': return 'Запросы к Steam сейчас недоступны. Введи цифры матча вручную.';
      case 'network': return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
      default: return `Не удалось загрузить матчи${res.status ? ' (HTTP ' + res.status + ')' : ''}. Попробуй позже или введи цифры вручную.`;
    }
  }

  // ---------- состояние ----------
  let cur = null;        // { id, input }
  let steamId = '';
  let listRows = [];

  function setMsg(text, kind) {
    const m = $('[data-mt-msg]');
    m.textContent = text || '';
    m.className = 'ac-mt-msg' + (kind ? ' is-' + kind : '');
  }

  // ---------- вкладки выбора ----------
  function selectTab(name, focus) {
    root.querySelectorAll('[data-mt-tab]').forEach(t => {
      const on = t.getAttribute('data-mt-tab') === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    root.querySelectorAll('[data-mt-panel]').forEach(p => { p.hidden = p.getAttribute('data-mt-panel') !== name; });
    if (name === 'manual') fillHeroes();
  }

  // ---------- список матчей ----------
  function heroImg(h, w, hh, eager) { return h ? `<img src="/assets/heroes/${esc(h.slug)}.webp" alt="" width="${w}" height="${hh}"${eager ? '' : ' loading="lazy"'} decoding="async">` : ''; }
  function kindOf(m) { return m.gameMode === A.TURBO ? 'Turbo' : m.lobbyType === 7 ? 'Рейтинг' : 'Обычный'; }
  async function showList(id) {
    steamId = id;
    const list = $('[data-mt-list]');
    list.textContent = '';
    setMsg('Загружаем последние матчи… Первый запрос к Steam может занять до 20 секунд.', 'wait');
    const [res, data] = await Promise.all([api(`/api/dota/player/${encodeURIComponent(id)}/matches?offset=0&summary=0`), loadData().catch(() => null)]);
    if (steamId !== id) return;
    if (!res.ok) { setMsg(errorText(res), 'err'); return; }
    listRows = (res.data.matches || []).filter(m => m.details === true && typeof m.win === 'boolean' && m.heroId > 0 && m.duration > 0);
    if (!listRows.length) { setMsg('Steam не вернул сыгранных матчей с подробностями. Если матч только что закончился, подожди пару минут — или введи цифры вручную.', 'err'); return; }
    setMsg(`Последние ${listRows.length} ${plural(listRows.length, 'матч', 'матча', 'матчей')}. Выбери, какой разобрать.`);
    const H = data ? data.heroes : new Map();
    list.innerHTML = listRows.map(m => {
      const h = H.get(Number(m.heroId));
      const turbo = m.gameMode === A.TURBO, short = m.duration < A.MIN_DURATION;
      const note = turbo ? 'Turbo не разбирается' : short ? 'короче 10 минут' : '';
      return `<li><button type="button" class="ac-mt-row${m.win ? ' is-win' : ' is-loss'}" data-mt-pick="${esc(m.matchId)}"${note ? ' disabled' : ''}>` +
        `${heroImg(h, 64, 36)}<span class="ac-mt-hero"><b>${esc(h ? h.name : 'Герой #' + m.heroId)}</b><small>${esc(kindOf(m))} · ${m.start ? esc(dateOf(m.start)) : ''}</small></span>` +
        `<span class="ac-mt-res">${m.win ? 'Победа' : 'Поражение'}</span><span class="ac-mt-kda">${Number(m.k)}/${Number(m.d)}/${Number(m.a)}</span><span class="ac-mt-dur">${dur(Number(m.duration))}</span>` +
        `<span class="ac-mt-go">${note ? esc(note) : 'Разобрать →'}</span></button></li>`;
    }).join('');
  }

  // Вход разбора из подробностей матча (все 10 игроков) или, если их нет, из строки списка.
  function inputFromSteam(row, D) {
    const base = { source: 'steam', matchId: String(row ? row.matchId : D.matchId), start: row ? row.start : undefined, lobbyType: row ? row.lobbyType : undefined };
    if (D && Array.isArray(D.players)) {
      const me = D.players.find(p => p.me);
      if (me) {
        const team = D.players.filter(p => p.radiant === me.radiant).map(p => ({ hero: p.hero, me: p.me, k: p.k, d: p.d, a: p.a, nw: p.nw, hd: p.hd, td: p.td, gpm: p.gpm, xpm: p.xpm, lh: p.lh }));
        const pos = me.pos === 'sup' || [1, 2, 3].includes(me.pos) ? me.pos : null;
        return Object.assign(base, { heroId: me.hero, pos: pos || 'sup', posModel: pos || undefined, win: D.radiantWin === me.radiant, duration: D.duration, gameMode: D.gameMode,
          k: me.k, d: me.d, a: me.a, lh: me.lh, dn: me.dn, gpm: me.gpm, xpm: me.xpm, hd: me.hd, td: me.td, nw: me.nw, items: me.items, team: team.length === 5 ? team : undefined });
      }
    }
    if (!row) return null;
    const pos = row.pos === 'sup' || [1, 2, 3].includes(row.pos) ? row.pos : null;
    return Object.assign(base, { heroId: row.heroId, pos: pos || 'sup', posModel: pos || undefined, win: row.win, duration: row.duration, gameMode: row.gameMode,
      k: row.k, d: row.d, a: row.a, lh: row.lastHits, gpm: row.gpm, xpm: row.xpm, hd: row.heroDamage, nw: row.netWorth, items: row.items });
  }
  async function pickSteam(mid) {
    const row = listRows.find(m => String(m.matchId) === String(mid)) || null;
    setMsg('Загружаем подробности матча…', 'wait');
    const res = await api(`/api/dota/match/${encodeURIComponent(mid)}?me=${encodeURIComponent(steamId)}`);
    const input = inputFromSteam(row, res.ok ? res.data : null);
    if (!input) { setMsg('Подробности этого матча недоступны. Загрузи список матчей заново или введи цифры вручную.', 'err'); return; }
    setMsg(res.ok ? '' : 'Подробности всех игроков недоступны — разбор без контекста команды.', res.ok ? '' : 'err');
    open(input, true);
  }

  // ---------- ручной ввод ----------
  let heroesFilled = false;
  function fillHeroes() {
    if (heroesFilled) return;
    const sel = $('#mt-hero');
    loadData().then(d => {
      heroesFilled = true;
      const list = [...d.heroes].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru'));
      sel.innerHTML = '<option value="">Выбери героя</option>' + list.map(([id, h]) => `<option value="${id}">${esc(h.name)}</option>`).join('');
    }).catch(() => { sel.innerHTML = '<option value="">Не удалось загрузить героев — обнови страницу</option>'; });
  }
  function readManual(form) {
    const v = name => { const el = form.elements[name]; return el && el.value !== '' ? Number(el.value) : null; };
    const err = [];
    const heroId = v('hero'), pos = v('pos'), win = form.querySelector('input[name=win]:checked');
    if (!heroId) err.push('героя');
    if (!pos) err.push('позицию');
    if (!win) err.push('результат');
    const need = { min: 'длительность', k: 'убийства', d: 'смерти', a: 'помощь', lh: 'добивания', gpm: 'золото в минуту', xpm: 'опыт в минуту' };
    Object.keys(need).forEach(k => { const x = v(k); const el = form.elements[k]; if (x === null || !isFinite(x) || (el && !el.checkValidity())) err.push(need[k]); });
    if (err.length) return { err: 'Проверь поля: ' + err.join(', ') + '.' };
    const input = { source: 'manual', heroId, pos, win: win.value === '1', duration: v('min') * 60, k: v('k'), d: v('d'), a: v('a'), lh: v('lh'), gpm: v('gpm'), xpm: v('xpm') };
    if (v('dn') !== null) input.dn = v('dn');
    if (v('hd') !== null) input.hd = v('hd');
    return { input };
  }

  // ---------- разбор ----------
  function open(input, save, id) {
    const clean = R.cleanInput(input);
    if (!clean) { setMsg('Данные этого матча неполные — разобрать его не получится. Попробуй другой матч или введи цифры вручную.', 'err'); return; }
    let saved = { ok: true, id: id || null };
    if (save) { saved = R.saveAnalysis(clean); storageNote(saved.ok); }
    cur = { id: saved.id, input: clean };
    renderResult();
    renderHistory();
    const sec = $('[data-mt-result]');
    sec.hidden = false;
    sec.scrollIntoView({ block: 'start' });
    try { sec.focus({ preventScroll: true }); } catch (e) { sec.focus(); }
  }
  // Изменение уже открытого разбора (позиция, ответы): пересчёт и перезапись той же записи.
  function update(fn) {
    if (!cur) return;
    fn(cur.input);
    if (cur.id) {
      const r = R.matches.mutate(st => { const a = st.analyses.find(x => x.id === cur.id); if (a) a.input = R.cleanInput(cur.input) || a.input; });
      storageNote(r.ok);
    }
    renderResult();
    renderHistory();
  }

  function guideLinks(slugs) { return slugs.map(g => `<a href="/guide/${esc(g)}/">«${esc(REFS.guides[g] || g)}»</a>`).join(', '); }
  function stageLink(st) {
    const s = REFS.stages[st.course + '/' + st.module];
    return s ? `<a class="ac-mr-stage" href="${esc(s.href)}">${esc(s.course)} · этап ${s.n}: ${esc(s.title)} →</a>` : '';
  }
  function verdictChip(m) {
    if (m.verdict === 'na') return '<span class="ac-mr-chip">нет эталона</span>';
    const d = Math.round((m.ratio - 1) * 100);
    const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
    const word = m.verdict === 'good' ? (m.lowerBetter ? 'заметно меньше' : 'заметно выше') : m.verdict === 'low' ? (m.lowerBetter ? 'заметно больше' : 'заметно ниже') : 'около среднего';
    const ico = m.verdict === 'good' ? '▲ ' : m.verdict === 'low' ? '▼ ' : '';
    return `<span class="ac-mr-chip">${ico}${sign}${Math.abs(d)}&nbsp;% · ${word}</span>`;
  }
  function metricRow(m) {
    // Полоса: эталон — отметка посередине, значение — длина (до двух эталонов).
    const w = m.ratio == null ? 0 : Math.max(2, Math.min(100, m.ratio * 50));
    return `<div class="ac-mr-m is-${m.verdict}"><span class="ac-mr-ml">${esc(m.label)}</span>` +
      `<span class="ac-mr-mv"><b>${A.fmt(m.value, m.digits)}</b><small>эталон ${A.fmt(m.base, m.digits)}</small></span>` +
      `<span class="ac-mr-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i><em></em></span>${verdictChip(m)}</div>`;
  }
  function itemIcon(items, id, have) {
    const it = items && Object.values(items).find(x => x.id === id);
    if (!it) return '';
    const slug = Object.keys(items).find(k => items[k] === it);
    return `<a class="ac-mr-item${have ? ' is-have' : ''}" href="/item/${esc(slug)}/" title="${esc(it.dname)}"><img src="${esc(it.img)}" alt="${esc(it.dname)}" width="44" height="32" loading="lazy" decoding="async">${have ? '<span class="ac-sr"> (есть у тебя)</span>' : ''}</a>`;
  }
  const QUESTIONS = [
    ['lane', 'Как прошла линия?', [['won', 'Выиграл'], ['even', 'Ровно'], ['lost', 'Проиграл'], ['unknown', 'Не знаю']]],
    ['deaths', 'Почему чаще всего умирал?', [['ganked', 'Ловили без обзора'], ['fight', 'Погибал первым в драке'], ['greedy', 'Рисковал ради фарма'], ['few', 'Почти не умирал'], ['unknown', 'Не помню']]],
    ['hard', 'Что было труднее всего?', [['farm', 'Фармить'], ['fights', 'Драться'], ['map', 'Понять, куда идти'], ['draft', 'Играть против их пика'], ['none', 'Ничего особенного']]],
    ['mood', 'Как было с эмоциями?', [['calm', 'Спокойно'], ['annoyed', 'Раздражался'], ['tilt', 'Тильтовал']]],
  ];
  function questionsBlock(ans) {
    return `<form class="ac-mr-q" data-mt-questions><h3 class="ac-mr-h">Уточни разбор — 4 вопроса</h3><p class="ac-hint">Цифры не видят, где и почему ты умирал. Ответы добавят рекомендации — меняй их когда угодно.</p>` +
      QUESTIONS.map(([k, q, opts]) => `<fieldset><legend>${q}</legend><div class="ac-mr-opts">` + opts.map(([v, l]) =>
        `<label><input type="radio" name="${k}" value="${v}"${ans[k] === v ? ' checked' : ''}> <span>${l}</span></label>`).join('') + `</div></fieldset>`).join('') + `</form>`;
  }

  function renderResult() {
    const out = $('[data-mt-out]');
    const input = cur.input;
    out.innerHTML = '<p class="ac-hint">Считаем…</p>';
    loadData().then(data => {
      if (!cur || cur.input !== input) return;
      const res = A.analyze(input, data);
      const h = data.heroes.get(Number(input.heroId));
      const name = h ? h.name : 'Герой #' + input.heroId;
      const kind = input.gameMode === A.TURBO ? 'Turbo' : input.lobbyType === 7 ? 'рейтинговый' : input.source === 'steam' ? 'обычный' : '';
      const posOpts = [1, 2, 3, 4, 5].map(p => `<option value="${p}"${input.pos === p ? ' selected' : ''}>Позиция ${p}</option>`).join('') +
        (input.pos === 'sup' ? '<option value="sup" selected>Поддержка (4–5)</option>' : '');
      const modelHint = input.source === 'steam' && input.posModel ? `оценка модели: ${esc(posLabel(input.posModel))} — поправь, если играл иначе` : 'от неё зависит эталон';
      let html = `<div class="ac-mr-head${input.win ? ' is-win' : ' is-loss'}">${heroImg(h, 96, 54, true)}<div class="ac-mr-title"><b>${esc(name)}</b>` +
        `<span><em>${input.win ? 'Победа' : 'Поражение'}</em> · ${dur(input.duration)} · ${input.k}/${input.d}/${input.a}${kind ? ' · ' + kind : ''}${input.start ? ' · ' + esc(dateOf(input.start)) : ''}${input.matchId ? ` · <a href="https://www.dotabuff.com/matches/${esc(input.matchId)}" target="_blank" rel="noopener nofollow">матч на Dotabuff ↗</a>` : ''}</span></div>` +
        `<label class="ac-mr-pos" for="mt-pos-edit"><span>Твоя позиция</span><select id="mt-pos-edit" data-mt-posedit>${posOpts}</select><small>${modelHint}</small></label></div>`;

      if (!res.ok) {
        const why = { short: `Матч короче ${A.MIN_DURATION / 60} минут — по нему нельзя судить об игре.`, turbo: 'Turbo не разбирается: золото и опыт там начисляются иначе, сравнивать с обычными матчами нельзя.',
          no_base: 'Для этого героя и позиции в базе сайта пока нет эталона. Попробуй выбрать другую позицию.', pos: 'Выбери позицию.' }[res.error] || 'Этот матч не удалось разобрать.';
        out.innerHTML = html + `<p class="ac-note">${why}</p>`;
        return;
      }
      const notes = [];
      if (res.baseline.kind === 'position') notes.push(`Героя на этой позиции в базе мало — сравнение идёт со средним игроком позиции и только по золоту и опыту.`);
      if (input.source === 'steam' && input.lobbyType !== 7) notes.push('Это не рейтинговый матч, а эталон — по рейтинговым. Сравнение примерное.');
      if (!input.win) notes.push('Матч проигран: в поражениях почти все показатели ниже среднего. Смотри на самые большие отставания.');
      const low = res.metrics.filter(m => m.verdict === 'low').length, good = res.metrics.filter(m => m.verdict === 'good').length;
      const b = res.baseline;
      html += notes.map(n => `<p class="ac-note ac-note-soft">${esc(n)}</p>`).join('');
      const nm = res.metrics.filter(m => m.verdict !== 'na').length;
      html += `<p class="ac-mr-sum"><b>Итог:</b> из ${nm} ${plural(nm, 'показателя', 'показателей', 'показателей')} заметно лучше среднего — ${good}, заметно хуже — ${low}.` +
        `${res.recs.length ? ` Главное, над чем стоит поработать, — <b>${esc(res.recs[0].title.toLowerCase())}</b>.` : ' Хороший матч — закрепляй.'}</p>`;
      html += `<h3 class="ac-mr-h">Показатели против эталона</h3><div class="ac-mr-metrics">${res.metrics.map(metricRow).join('')}</div>`;
      html += `<p class="ac-src">Эталон: ${b.kind === 'hero' ? `${esc(name)} на позиции «${esc(posLabel(input.pos))}» — ${b.n.toLocaleString('ru-RU')} ${plural(b.n, 'матч', 'матча', 'матчей')}` : `все герои на позиции «${esc(posLabel(input.pos))}»`} в базе сайта` +
        `${data.stats.base && data.stats.base.patch ? `, патч ${esc(data.stats.base.patch)}` : ''}; средняя длительность матча эталона — ${A.fmt(b.minutes, 1)} мин${b.minutesFrom === 'hero' ? '' : ' (по всей базе)'}. <a href="#method">Как считается</a>.</p>`;

      const T = res.team;
      if (T) {
        const tile = (label, val, sub) => `<div class="ac-mr-tile"><span>${label}</span><b>${val}</b><small>${sub}</small></div>`;
        html += `<h3 class="ac-mr-h">Ты в своей команде</h3><div class="ac-mr-tiles">` +
          (T.kp != null ? tile('Участие в убийствах', A.pct(T.kp), `${T.kpRank}-е место из 5 · убийств команды ${T.kills}`) : '') +
          (T.nwShare != null ? tile('Доля ценности команды', A.pct(T.nwShare), `${T.nwRank}-е место по ценности`) : '') +
          (T.hdShare != null ? tile('Доля урона по героям', A.pct(T.hdShare), `${T.hdRank}-е место по урону`) : '') +
          (T.deathShare != null ? tile('Доля смертей команды', A.pct(T.deathShare), `${T.deathRank}-е место по смертям`) : '') + `</div>`;
      }

      const I = res.items;
      if (I && data.items && I.popular.length) {
        html += `<h3 class="ac-mr-h">Предметы</h3><div class="ac-mr-items"><div><p class="ac-h">У тебя в конце матча</p><div class="ac-mr-row">${I.mine.map(id => itemIcon(data.items, id, I.have.includes(id))).join('') || '<span class="ac-hint">пусто</span>'}</div></div>` +
          `<div><p class="ac-h">Чаще всего собирают${I.scope === 'pos' ? ' на этой позиции' : ''}</p><div class="ac-mr-row">${I.popular.map(x => itemIcon(data.items, x.id, I.have.includes(x.id))).join('')}</div></div></div>` +
          `<p class="ac-src">Совпадений: ${I.have.length} из ${I.popular.length}. Законченные предметы из покупок ${I.n.toLocaleString('ru-RU')} ${plural(I.n, 'матча', 'матчей', 'матчей')} ${esc(name)} в базе сайта.${h ? ` Сборки по патчу — в <a href="/hero/${esc(h.slug)}/guide/">гайде по герою</a>.` : ''}</p>`;
      }

      const recs = res.recs;
      html += `<h3 class="ac-mr-h">Что тренировать</h3>`;
      if (!recs.length) {
        html += `<p class="ac-mr-ok">Заметных отставаний от эталона нет. Ответь на вопросы ниже — они помогут найти то, чего не видно в цифрах, — или пройди следующий этап маршрута по своей роли.</p>`;
      } else {
        html += `<ol class="ac-mr-recs">` + recs.map((r, i) => `<li class="ac-mr-rec${i >= A.MAX_RECS ? ' is-more' : ''}"${i >= A.MAX_RECS ? ' hidden' : ''}>` +
          `<p class="ac-mr-rec-t"><span aria-hidden="true">${AREA_ICON[r.id] || '•'}</span> ${esc(r.title)}</p>` +
          `<ul class="ac-mr-why">${r.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` +
          `<p class="ac-mr-how">${esc(r.how)}</p>` +
          `<p class="ac-mr-links">Почитать: ${guideLinks(r.guides)}</p>${stageLink(r.stage)}</li>`).join('') + `</ol>` +
          (recs.length > A.MAX_RECS ? `<button type="button" class="ac-link-btn" data-mt-more>Показать ещё ${recs.length - A.MAX_RECS}</button>` : '');
      }
      if (res.strengths.length) html += `<h3 class="ac-mr-h">Получилось</h3><ul class="ac-mr-good">${res.strengths.map(s => `<li>${esc(s.text)}</li>`).join('')}</ul>`;
      if (res.task) html += `<div class="ac-mr-task"><p class="ac-h">Задание на следующий матч</p><p>${esc(res.task.text)}</p>` +
        `<button type="button" class="ac-cta ac-cta-sm" data-mt-goal="${esc(res.task.area)}" data-mt-goal-text="${esc(res.task.text)}">Сделать целью</button><span class="ac-mt-goalmsg" data-mt-goalmsg role="status"></span></div>`;
      html += questionsBlock(input.answers || {});
      html += `<div class="ac-mr-actions"><a class="ac-cta ac-cta-sm ac-cta-ghost" href="#pick" data-mt-again>Разобрать другой матч</a><a class="ac-cta ac-cta-sm ac-cta-ghost" href="#history">Мои разборы</a></div>`;
      out.innerHTML = html;
    }).catch(e => {
      console.error('[academy-match]', e);
      out.innerHTML = '<p class="ac-note">Не удалось загрузить справочники сайта для разбора. Проверь связь и обнови страницу.</p>';
    });
  }

  // ---------- история и цели ----------
  function renderHistory() {
    const box = $('[data-mt-history]');
    const st = R.matches.load().state;
    if (!st.analyses.length && !st.goals.length) return;
    loadData().catch(() => null).then(data => {
      const H = data ? data.heroes : new Map();
      let html = '';
      if (st.goals.length) {
        html += `<h3 class="ac-mr-h">Цели</h3><ul class="ac-goal-list">` + st.goals.map(g => `<li class="${g.done ? 'is-done' : ''}">` +
          `<label><input type="checkbox" class="ac-check" data-mt-goaldone="${esc(g.id)}"${g.done ? ' checked' : ''}><span>${esc(g.text)}</span></label>` +
          `<button type="button" class="ac-link-btn" data-mt-goaldel="${esc(g.id)}" aria-label="Удалить цель">Удалить</button></li>`).join('') + `</ul>`;
      }
      if (st.analyses.length && data) {
        // Что повторяется: области рекомендаций в последних 10 разборах.
        const last = st.analyses.slice(0, 10), count = {};
        last.forEach(a => { const r = A.analyze(a.input, data); if (r.ok) r.recs.forEach(x => { count[x.id] = (count[x.id] || 0) + 1; }); });
        const rep = Object.keys(count).filter(k => count[k] >= 2).sort((a, b) => count[b] - count[a]);
        if (last.length >= 2) {
          html += `<h3 class="ac-mr-h">Что повторяется</h3>` + (rep.length
            ? `<ul class="ac-mr-rep">${rep.map(k => `<li><span aria-hidden="true">${AREA_ICON[k] || '•'}</span> <b>${esc(A.REC[k].title)}</b> — в ${count[k]} из ${last.length} ${plural(last.length, 'разбора', 'разборов', 'разборов')}. ${guideLinks(A.REC[k].guides.slice(0, 1))}</li>`).join('')}</ul>`
            : `<p class="ac-hint">В последних ${last.length} ${plural(last.length, 'разборе', 'разборах', 'разборах')} нет зоны роста, которая повторялась бы дважды.</p>`);
        }
        html += `<h3 class="ac-mr-h">Разборы · ${st.analyses.length}</h3><ul class="ac-mr-hist">` + st.analyses.map(a => {
          const i = a.input, h = H.get(Number(i.heroId));
          const when = i.start ? dateOf(i.start) : new Date(a.saved).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
          return `<li${cur && cur.id === a.id ? ' class="is-cur"' : ''}>${heroImg(h, 48, 27)}<span><b>${esc(h ? h.name : 'Герой #' + i.heroId)}</b><small>${i.win ? 'Победа' : 'Поражение'} · ${esc(posLabel(i.pos))} · ${esc(when)}${i.source === 'manual' ? ' · вручную' : ''}</small></span>` +
            `<button type="button" class="ac-link-btn" data-mt-open="${esc(a.id)}">Открыть</button><button type="button" class="ac-link-btn" data-mt-del="${esc(a.id)}" aria-label="Удалить разбор">Удалить</button></li>`;
        }).join('') + `</ul>`;
      }
      box.innerHTML = html || '<p class="ac-hint">Разборов пока нет.</p>';
    });
  }

  // ---------- события ----------
  root.addEventListener('click', e => {
    const t = e.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    if (t.matches('[data-mt-tab]')) { selectTab(t.getAttribute('data-mt-tab'), false); return; }
    if (t.matches('[data-mt-pick]')) { pickSteam(t.getAttribute('data-mt-pick')); return; }
    if (t.matches('[data-mt-forget]')) {
      dropId(); $('#mt-id').value = ''; t.hidden = true; $('[data-mt-list]').textContent = ''; steamId = ''; setMsg('Steam ID удалён из этого браузера.');
      return;
    }
    if (t.matches('[data-mt-more]')) { root.querySelectorAll('.ac-mr-rec.is-more').forEach(li => { li.hidden = false; }); t.remove(); return; }
    if (t.matches('[data-mt-goal]')) {
      const r = R.addGoal(t.getAttribute('data-mt-goal-text'), t.getAttribute('data-mt-goal'));
      storageNote(r.ok);
      const m = $('[data-mt-goalmsg]');
      if (m) m.textContent = r.dup ? 'Такая цель уже есть.' : r.ok ? 'Цель добавлена — она видна здесь и на главной Учебного центра.' : 'Цель добавлена до перезагрузки страницы.';
      renderHistory();
      return;
    }
    if (t.matches('[data-mt-goaldel]')) {
      const id = t.getAttribute('data-mt-goaldel');
      storageNote(R.matches.mutate(st => { st.goals = st.goals.filter(g => g.id !== id); }).ok);
      renderHistory();
      return;
    }
    if (t.matches('[data-mt-open]')) {
      const a = R.matches.load().state.analyses.find(x => x.id === t.getAttribute('data-mt-open'));
      if (a) open(a.input, false, a.id);
      return;
    }
    if (t.matches('[data-mt-del]')) {
      const id = t.getAttribute('data-mt-del');
      storageNote(R.matches.mutate(st => { st.analyses = st.analyses.filter(a => a.id !== id); }).ok);
      if (cur && cur.id === id) cur.id = null;
      renderHistory();
      if (!R.matches.load().state.analyses.length && !R.matches.load().state.goals.length) $('[data-mt-history]').innerHTML = '<p class="ac-hint">Разборов пока нет.</p>';
    }
  });
  root.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.matches || !t.matches('[data-mt-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    selectTab(t.getAttribute('data-mt-tab') === 'steam' ? 'manual' : 'steam', true);
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-mt-posedit]')) { const v = t.value === 'sup' ? 'sup' : Number(t.value); update(i => { i.pos = v; }); return; }
    if (t.closest('[data-mt-questions]') && t.type === 'radio') { update(i => { i.answers = Object.assign({}, i.answers, { [t.name]: t.value }); }); return; }
    if (t.matches('[data-mt-goaldone]')) {
      const id = t.getAttribute('data-mt-goaldone');
      storageNote(R.matches.mutate(st => { const g = st.goals.find(x => x.id === id); if (g) g.done = t.checked; }).ok);
      const li = t.closest('li'); if (li) li.classList.toggle('is-done', t.checked);
    }
  });
  root.addEventListener('submit', e => {
    const f = e.target;
    if (f.matches('[data-mt-idform]')) {
      e.preventDefault();
      const p = parseId($('#mt-id').value);
      if (p.err) { setMsg(p.err, 'err'); $('#mt-id').focus(); return; }
      saveId(p.id);
      $('[data-mt-forget]').hidden = false;
      showList(p.id);
      return;
    }
    if (f.matches('[data-mt-manual]')) {
      e.preventDefault();
      const r = readManual(f);
      const err = $('[data-mt-err]');
      err.textContent = r.err || '';
      if (r.input) open(r.input, true);
    }
  });
  window.addEventListener('storage', e => { if (e.key === R.KEY_M || e.key === null) renderHistory(); });

  // ---------- старт ----------
  const saved = loadId();
  if (saved) { $('#mt-id').value = saved; $('[data-mt-forget]').hidden = false; }
  renderHistory();
  // ?m=<номер матча> — переход из «Моего профиля»: матч уже в кеше сервера.
  const qm = new URLSearchParams(location.search).get('m');
  if (qm && /^\d{1,19}$/.test(qm) && saved) {
    steamId = saved;
    pickSteam(qm);
  }
})();
