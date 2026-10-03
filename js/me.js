// «Мой профиль» (/me/): последние матчи игрока по Steam Web API.
// Бэкенд — deploy/api/index.php, контракт в claude/plan-me-profil.md:
//   GET /api/dota/player/<id>/matches?offset=0|20|40|60|80
// Сначала offset=0 (20 матчей), затем в фоне 20…80 — до 100 матчей для топа героев.
// Steam ID хранится только в браузере (localStorage dmSteamId).
// Средний винрейт героя — data/stats.json (своя база 0–4500 MMR), имена — data/heroes.json.
(function () {
  'use strict';
  const form = document.getElementById('meForm');
  if (!form) return;
  const input = document.getElementById('meId');
  const msg = document.getElementById('meMsg');
  const out = document.getElementById('meOut');
  const forgetBtn = document.getElementById('meForget');

  const STORE_KEY = 'dmSteamId';
  const PAGE = 20, MAX = 100;
  const STEAM64_BASE = 76561197960265728n;
  const MAX32 = 4294967294;
  const CLIENT_TIMEOUT_MS = 30000;   // сервер отвечает не дольше 25 с
  const BUSY_RETRIES = 3;
  const MIN_GAMES = 10;              // минимум игр для вывода по герою
  const Z95 = 1.96;

  const nf = new Intl.NumberFormat('ru-RU');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct1 = v => v.toFixed(1).replace('.', ',') + '&nbsp;%';
  const pp = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '&nbsp;п.п.';

  // ---------- хранение ID ----------
  function loadId() { try { return localStorage.getItem(STORE_KEY) || ''; } catch (_) { return ''; } }
  function saveId(id) { try { localStorage.setItem(STORE_KEY, id); } catch (_) {} }
  function dropId() { try { localStorage.removeItem(STORE_KEY); } catch (_) {} }

  // ---------- разбор ввода ----------
  // Возвращает { id: '<32-бит>' } или { err: 'vanity' | 'bad' }.
  function from64(s) {
    const n = BigInt(s) - STEAM64_BASE;
    return n >= 1n && n <= BigInt(MAX32) ? String(n) : null;
  }
  function parseInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return { err: 'empty' };
    if (/steamcommunity\.com\/id\//i.test(s)) return { err: 'vanity' };
    let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})(?:[\/?#]|$)/i);
    if (m) { const id = m[1].startsWith('7656119') ? from64(m[1]) : null; return id ? { id } : { err: 'bad' }; }
    m = s.match(/(?:dotabuff\.com|opendota\.com|stratz\.com)\/players\/(\d{1,10})(?:[\/?#]|$)/i);
    const d = m ? m[1] : s;
    if (!/^\d+$/.test(d)) return { err: 'bad' };
    if (d.length <= 10) { const n = Number(d); return n >= 1 && n <= MAX32 ? { id: String(n) } : { err: 'bad' }; }
    if (d.length === 17 && d.startsWith('7656119')) { const id = from64(d); return id ? { id } : { err: 'bad' }; }
    return { err: 'bad' };
  }

  // ---------- справочники ----------
  let refs = null; // { heroes: Map(id → {name, slug}), wr: Map(id → wr) }
  function getJson(url) {
    return fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  const refsPromise = Promise.all([getJson('/data/heroes.json'), getJson('/data/stats.json')])
    .then(([h, s]) => {
      const heroes = new Map(), wr = new Map();
      (h.heroes || []).forEach(x => {
        const slug = typeof window.slugForHero === 'function' ? window.slugForHero(x) : String(x.name || '').replace(/^npc_dota_hero_/, '');
        heroes.set(Number(x.id), { name: x.localized_name, slug });
      });
      (s.heroes || []).forEach(x => { if (typeof x.wr === 'number') wr.set(Number(x.id), x.wr); });
      refs = { heroes, wr };
      return refs;
    })
    .catch(e => { console.error('[me] справочники героев не загрузились:', e); refs = { heroes: new Map(), wr: new Map(), failed: true }; return refs; });

  // ---------- запрос к API ----------
  // Всегда возвращает { ok:true, data } или { ok:false, code, retryAfter }.
  async function api(id, offset, signal) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctl.abort(); }, CLIENT_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(`/api/dota/player/${encodeURIComponent(id)}/matches?offset=${offset}`, { signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    } catch (e) {
      clearTimeout(t); signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return { ok: false, code: 'aborted' };
      return { ok: false, code: timedOut ? 'timeout' : 'network' };
    }
    let text = '';
    try { text = await r.text(); } catch (e) {
      clearTimeout(t); signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return { ok: false, code: 'aborted' };
      return { ok: false, code: timedOut ? 'timeout' : 'network' };
    }
    clearTimeout(t); signal.removeEventListener('abort', onAbort);
    const ra = parseInt(r.headers.get('Retry-After') || '', 10);
    const retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = undefined; }
    if (!r.ok) {
      const code = data && typeof data.error === 'string' ? data.error : (r.status === 429 ? 'busy' : r.status === 504 ? 'timeout' : r.status >= 500 ? 'upstream_error' : 'http');
      return { ok: false, code, retryAfter, status: r.status };
    }
    if (data === undefined || data === null) return { ok: false, code: 'bad_json' };
    if (!Array.isArray(data.matches)) return { ok: false, code: 'bad_json' };
    return { ok: true, data };
  }

  // ---------- тексты ошибок ----------
  function waitText(sec) {
    if (sec == null) return '';
    if (sec < 60) return `${sec} с`;
    const m = Math.ceil(sec / 60);
    if (m < 60) return `${m} мин`;
    return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  }
  const HISTORY_HINT = 'В Dota 2 откройте <b>Настройки</b> → раздел <b>«Сообщество»</b> → включите <b>«Общедоступная история матчей»</b>. Steam начнёт отдавать матчи после следующей сыгранной игры. Проверьте и сам ID: это «код для друзей» Steam (Друзья → «Добавить друга»).';
  function errorInfo(res) {
    switch (res.code) {
      case 'bad_id': return { title: 'Неверный Steam ID', text: 'Сервер не принял этот ID. Введите код для друзей Steam (32-битный ID), 64-битный ID из 17 цифр или ссылку steamcommunity.com/profiles/…', retry: false };
      case 'bad_offset': return { title: 'Ошибка запроса', text: 'Сервер не принял номер страницы матчей. Обновите страницу.', retry: true };
      case 'history_unavailable': return { title: 'История матчей закрыта', text: HISTORY_HINT, retry: true, retryLabel: 'Проверить снова' };
      case 'busy': return { title: 'Сервер занят', text: `Сейчас обрабатываются другие запросы к Steam. Попробуйте через ${waitText(res.retryAfter == null ? 5 : res.retryAfter)}.`, retry: true };
      case 'rate_limited': return { title: 'Лимит запросов к Steam', text: `Steam временно ограничил запросы. Попробуйте через ${waitText(res.retryAfter == null ? 60 : res.retryAfter)}.`, retry: true };
      case 'timeout': return { title: 'Steam не ответил вовремя', text: 'Запрос к Steam занял слишком много времени. Попробуйте ещё раз через минуту.', retry: true };
      case 'upstream_error': return { title: 'Ошибка Steam', text: 'Steam вернул ошибку. Обычно это ненадолго — попробуйте позже.', retry: true };
      case 'not_configured': return { title: 'Раздел временно недоступен', text: 'Сервер ещё не настроен для запросов к Steam. Загляните позже.', retry: false };
      case 'network': return { title: 'Нет связи с сервером', text: 'Проверьте подключение к интернету и попробуйте ещё раз.', retry: true };
      case 'bad_json': return { title: 'Неожиданный ответ сервера', text: 'Сервер прислал данные, которые не удалось прочитать. Попробуйте ещё раз позже.', retry: true };
      default: return { title: 'Не удалось загрузить матчи', text: `Ошибка сервера${res.status ? ' (HTTP ' + res.status + ')' : ''}. Попробуйте позже.`, retry: true };
    }
  }

  const EMPTY = '<div class="me-empty-state">Введите Steam ID — здесь появятся 20 последних матчей, а после догрузки до 100 матчей — ваши герои и выводы.</div>';

  // ---------- состояние ----------
  let run = null; // { id, ctl, matches, total, cachedAt, shown, bgError, done }

  function setMsg(html, kind) {
    msg.innerHTML = html || '';
    msg.className = 'me-msg' + (kind ? ' me-msg--' + kind : '');
  }

  function skeleton() {
    const rows = Array.from({ length: PAGE }, () => '<tr class="me-sk"><td colspan="7"><span></span></td></tr>').join('');
    out.innerHTML = `<div class="me-summary me-summary--load">Загружаем матчи…</div>` +
      `<h2 class="me-h2">Последние матчи</h2><div class="me-table-wrap">${tableHead()}<tbody>${rows}</tbody></table></div>`;
  }
  function tableHead() {
    return '<table class="me-table"><thead><tr><th>Итог</th><th>Герой</th><th>K/D/A</th><th>Длит.</th><th>GPM</th><th>Когда</th><th class="me-c-id">Матч</th></tr></thead>';
  }
  function showError(res, id) {
    const e = errorInfo(res);
    out.innerHTML = `<div class="me-error" role="alert"><strong>${esc(e.title)}</strong><p>${e.text}</p>` +
      (e.retry ? `<button type="button" class="me-btn me-btn--go" data-retry>${esc(e.retryLabel || 'Повторить')}</button>` : '') + '</div>';
    const b = out.querySelector('[data-retry]');
    if (b) b.addEventListener('click', () => start(id));
  }

  // ---------- форматирование ----------
  function dur(s) {
    if (typeof s !== 'number') return '—';
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
  }
  function ago(ts) {
    if (typeof ts !== 'number') return '—';
    const d = Date.now() / 1000 - ts;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + '&nbsp;мин назад';
    if (d < 86400) return Math.round(d / 3600) + '&nbsp;ч назад';
    const days = Math.floor(d / 86400);
    if (days === 1) return 'вчера';
    if (days < 31) return days + '&nbsp;дн. назад';
    return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fullDate(ts) {
    return typeof ts === 'number' ? new Date(ts * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function heroCell(heroId) {
    if (!(Number(heroId) > 0)) return '<span class="me-na">—</span>';
    const h = refs && refs.heroes.get(Number(heroId));
    if (!h) return `<span class="me-hero"><span class="me-hero-ph"></span><span class="me-hero-n">Герой #${esc(heroId)}</span></span>`;
    return `<a class="me-hero" href="/hero/${esc(h.slug)}/" title="${esc(h.name)}"><img src="/assets/heroes/${esc(h.slug)}.webp" alt="" width="48" height="27" loading="lazy" decoding="async"><span class="me-hero-n">${esc(h.name)}</span></a>`;
  }
  // Матч засчитывается, только если есть подробности, герой и длительность (лобби без игры Steam отдаёт с hero 0 и duration 0).
  function played(m) { return m.details === true && typeof m.win === 'boolean' && m.heroId > 0 && m.duration > 0; }
  function matchRow(m) {
    const det = played(m);
    const res = det ? (m.win ? '<b class="me-win">Победа</b>' : '<b class="me-loss">Поражение</b>') : `<span class="me-na">${m.details === true ? 'не сыгран' : 'нет данных'}</span>`;
    const kda = det && m.k != null ? `${m.k}/${m.d}/${m.a}` : '—';
    return `<tr><td>${res}</td><td>${heroCell(m.heroId)}</td><td class="me-num">${kda}</td><td class="me-num">${det ? dur(m.duration) : '—'}</td>` +
      `<td class="me-num">${det && m.gpm != null ? nf.format(m.gpm) : '—'}</td><td title="${esc(fullDate(m.start))}">${ago(m.start)}</td>` +
      `<td class="me-c-id"><span class="me-mid">${esc(m.matchId)}</span></td></tr>`;
  }

  // ---------- топ героев и выводы ----------
  function heroStats(matches) {
    const by = new Map();
    for (const m of matches) {
      if (!played(m)) continue;
      const x = by.get(m.heroId) || { id: m.heroId, n: 0, w: 0 };
      x.n++; if (m.win) x.w++;
      by.set(m.heroId, x);
    }
    return [...by.values()].map(x => {
      const avg = refs ? refs.wr.get(Number(x.id)) : undefined;
      const wr = x.w / x.n * 100;
      const r = { ...x, wr, avg: avg == null ? null : avg };
      if (r.avg != null) {
        const p = r.avg / 100;
        r.diff = wr - r.avg;
        r.thr = Z95 * Math.sqrt(p * (1 - p) / x.n) * 100;
        r.sig = x.n >= MIN_GAMES && Math.abs(r.diff) > r.thr;
      }
      return r;
    }).sort((a, b) => b.n - a.n || b.wr - a.wr);
  }
  function verdict(r) {
    if (r.avg == null) return '<span class="me-na">нет среднего</span>';
    if (r.n < MIN_GAMES) return `<span class="me-na">мало игр (&lt;${MIN_GAMES})</span>`;
    if (!r.sig) return '<span class="me-na">в пределах случайности</span>';
    return r.diff > 0 ? '<b class="me-win">выше среднего</b>' : '<b class="me-loss">ниже среднего</b>';
  }
  function topBlock(stats, withDetails) {
    const top = stats.slice(0, 10);
    const rows = top.map(r => `<tr><td>${heroCell(r.id)}</td><td class="me-num">${r.n}</td><td class="me-num">${pct1(r.wr)}</td>` +
      `<td class="me-num">${r.avg == null ? '—' : pct1(r.avg)}</td><td class="me-num">${r.avg == null ? '—' : pp(r.diff)}</td><td>${verdict(r)}</td></tr>`).join('');
    const body = top.length ? rows : '<tr><td colspan="6" class="me-na">Нет матчей с подробностями.</td></tr>';
    return `<h2 class="me-h2">Мои герои</h2><p class="me-sub">По ${withDetails} ${plural(withDetails, 'матчу', 'матчам', 'матчам')} с подробностями. Средний винрейт героя — по нашей базе 0–4500 MMR (Steam не сообщает ранг игрока).</p>` +
      `<div class="me-table-wrap me-top"><table class="me-table"><thead><tr><th>Герой</th><th>Игр</th><th>Ваш винрейт</th><th>Средний</th><th>Разница</th><th>Оценка</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function adviceBlock(stats) {
    const eligible = stats.filter(r => r.n >= MIN_GAMES && r.avg != null);
    const sig = eligible.filter(r => r.sig);
    let items;
    if (!eligible.length) items = `<li class="me-na">Нет героев с ${MIN_GAMES} и более играми среди загруженных матчей — выводов нет.</li>`;
    else if (!sig.length) items = `<li class="me-na">У всех героев с ${MIN_GAMES}+ играми (${eligible.length}) разница со средним винрейтом в пределах случайности.</li>`;
    else items = sig.map(r => {
      const h = refs.heroes.get(Number(r.id));
      const name = h ? esc(h.name) : 'Герой #' + esc(r.id);
      const link = h ? ` <a href="/hero/${esc(h.slug)}/">Страница героя →</a>` : '';
      const head = r.diff > 0 ? 'играете лучше среднего' : 'играете хуже среднего';
      return `<li><b>${name}</b> — ${head}: ${pct1(r.wr)} за ${r.n} ${plural(r.n, 'игру', 'игры', 'игр')} против ${pct1(r.avg)} в среднем (${pp(r.diff)}, порог случайности ±${r.thr.toFixed(1).replace('.', ',')}&nbsp;п.п.).${link}</li>`;
    }).join('');
    return `<h2 class="me-h2">Выводы</h2><ul class="me-advice">${items}</ul>` +
      `<p class="me-sub">Вывод делается только для героев с ${MIN_GAMES}+ играми, если |разница| &gt; 1,96·√(p(1−p)/n), где p — средний винрейт героя, n — ваши игры (уровень 95&nbsp;%).</p>`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  // ---------- отрисовка ----------
  function render() {
    const R = run;
    const m = R.matches;
    const withDet = m.filter(played);
    const wins = withDet.filter(x => x.win).length;
    const target = Math.min(MAX, R.total || 0);
    const loading = !R.done ? ` · загружаем ещё… <span class="me-progress">${m.length} из ${target}</span>` : '';
    const stamp = R.cachedAt ? ` · данные Steam от ${esc(fullDate(R.cachedAt))}` : '';
    const summary = `<div class="me-summary"><span>Аккаунт <b>${esc(R.id)}</b></span>` +
      `<span>Матчей: <b>${m.length}</b>${R.total ? ' из ' + nf.format(Math.min(R.total, 500)) + ' в истории Steam' : ''}</span>` +
      (withDet.length ? `<span>Победы: <b>${wins} из ${withDet.length}</b> (${pct1(wins / withDet.length * 100)})</span>` : '') +
      `<span class="me-summary-meta">${loading}${stamp}</span></div>`;
    const refsNote = refs && refs.failed ? '<p class="me-warn">Справочник героев не загрузился — показаны номера героев, средний винрейт недоступен.</p>' : '';
    const shown = m.slice(0, R.shown);
    const more = m.length > R.shown ? `<button type="button" class="me-btn me-more" data-more>Показать ещё ${Math.min(PAGE, m.length - R.shown)}</button>` : '';
    const table = shown.length
      ? `<div class="me-table-wrap">${tableHead()}<tbody>${shown.map(matchRow).join('')}</tbody></table></div>${more}`
      : '<p class="me-na me-empty">В истории Steam нет матчей этого аккаунта.</p>';
    let bg = '';
    if (R.bgError) {
      const e = errorInfo(R.bgError);
      bg = `<p class="me-warn">Загружено ${m.length} из ${target} матчей: ${esc(e.title.toLowerCase())}. ${e.retry ? '<button type="button" class="me-btn me-btn--sm" data-resume>Догрузить</button>' : ''}</p>`;
    }
    const stats = heroStats(m);
    out.innerHTML = summary + refsNote + `<h2 class="me-h2">Последние матчи</h2>` + table +
      (m.length ? bg + topBlock(stats, withDet.length) + adviceBlock(stats) : '');
    const mb = out.querySelector('[data-more]');
    if (mb) mb.addEventListener('click', () => { R.shown += PAGE; render(); });
    const rb = out.querySelector('[data-resume]');
    if (rb) rb.addEventListener('click', () => { R.bgError = null; R.done = false; render(); background(R); });
  }

  // ---------- загрузка ----------
  const sleep = (ms, signal) => new Promise(res => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
  });
  async function fetchPage(R, offset, onWait) {
    for (let i = 0; ; i++) {
      const res = await api(R.id, offset, R.ctl.signal);
      if (res.ok || res.code !== 'busy' || i >= BUSY_RETRIES || R.ctl.signal.aborted) return res;
      const sec = res.retryAfter == null ? 5 : Math.min(res.retryAfter, 30);
      if (onWait) onWait(sec);
      await sleep(sec * 1000, R.ctl.signal);
      if (R.ctl.signal.aborted) return { ok: false, code: 'aborted' };
    }
  }
  async function background(R) {
    while (!R.ctl.signal.aborted) {
      const offset = R.matches.length;
      if (offset >= MAX || offset >= (R.total || 0) || offset % PAGE !== 0) break;
      const res = await fetchPage(R, offset);
      if (R !== run || R.ctl.signal.aborted) return;
      if (!res.ok) { R.bgError = res; R.done = true; render(); return; }
      const add = res.data.matches;
      R.matches = R.matches.concat(add);
      if (typeof res.data.total === 'number') R.total = res.data.total;
      if (add.length < PAGE) { render(); break; }
      render();
    }
    if (R === run) { R.done = true; render(); }
  }
  async function start(id) {
    if (run) run.ctl.abort();
    const R = run = { id, ctl: new AbortController(), matches: [], total: 0, cachedAt: null, shown: PAGE, bgError: null, done: false };
    setMsg('');
    skeleton();
    const [res] = await Promise.all([
      fetchPage(R, 0, sec => { const el = out.querySelector('.me-summary--load'); if (R === run && el) el.textContent = `Сервер занят, повторим через ${sec} с…`; }),
      refsPromise,
    ]);
    if (R !== run) return;
    setMsg('');
    if (!res.ok) { if (res.code !== 'aborted') showError(res, id); return; }
    R.matches = res.data.matches.slice(0, PAGE);
    R.total = typeof res.data.total === 'number' ? res.data.total : R.matches.length;
    R.cachedAt = typeof res.data.cachedAt === 'number' ? res.data.cachedAt : null;
    if (R.matches.length < PAGE) R.done = true;
    render();
    if (!R.done) background(R);
  }

  // ---------- форма ----------
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = parseInput(input.value);
    if (p.err === 'empty') { setMsg('Введите Steam ID или ссылку на профиль.', 'err'); input.focus(); return; }
    if (p.err === 'vanity') {
      setMsg('Ссылка вида steamcommunity.com/id/<имя> не подходит — нужен числовой ID. Где взять: в Steam откройте «Друзья» → «Добавить друга» — «Ваш код для друзей» (это и есть 32-битный ID), или страницу «Об аккаунте» — строка «Steam ID» из 17 цифр.', 'err');
      input.focus(); return;
    }
    if (p.err) { setMsg('Не похоже на Steam ID. Нужен код для друзей Steam (до 10 цифр), 64-битный ID из 17 цифр (начинается с 7656119) или ссылка steamcommunity.com/profiles/…', 'err'); input.focus(); return; }
    input.value = p.id;
    saveId(p.id);
    start(p.id);
  });
  forgetBtn.addEventListener('click', () => {
    if (run) { run.ctl.abort(); run = null; }
    dropId();
    input.value = '';
    out.innerHTML = EMPTY;
    setMsg('Steam ID удалён из этого браузера.', 'info');
  });

  const saved = loadId();
  const sp = saved ? parseInput(saved) : {};
  if (sp.id) { input.value = sp.id; start(sp.id); }
  else { if (saved) dropId(); out.innerHTML = EMPTY; }
})();
