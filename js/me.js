// «Мой профиль» (/me/): последние матчи игрока по Steam Web API.
// Бэкенд — deploy/api/index.php, контракт в claude/plan-me-profil.md:
//   GET /api/dota/player/<id>/matches?offset=0|20|40|60|80
// Сначала offset=0 (20 матчей), затем в фоне 20…480 — до 500 матчей. Сводка (summary) запрашивается
// только на каждой сотой странице и на последней (summary=0 на остальных), tz — пояс браузера.
// Сводку (герои, средние K/D/A, GPM, XPM, интервал Уилсона, тенденция) считает сервер: поле summary
// ответа покрывает все загруженные страницы 0..offset. Карточка для публикации — POST …/card (по кнопке).
// Steam ID хранится только в браузере (localStorage dmSteamId).
// Средний винрейт героя — data/stats.json (своя база рейтинговых матчей), имена — data/heroes.json.
(function () {
  'use strict';
  const form = document.getElementById('meForm');
  if (!form) return;
  const input = document.getElementById('meId');
  const msg = document.getElementById('meMsg');
  const out = document.getElementById('meOut');
  const forgetBtn = document.getElementById('meForget');

  const STORE_KEY = 'dmSteamId';
  const PAGE = 20, MAX = 500;      // Steam отдаёт до 500 последних матчей
  const STEAM64_BASE = 76561197960265728n;
  const MAX32 = 4294967294;
  const CLIENT_TIMEOUT_MS = 30000;   // сервер отвечает не дольше 25 с
  const BUSY_RETRIES = 3;

  const nf = new Intl.NumberFormat('ru-RU');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct1 = v => v.toFixed(1).replace('.', ',') + '&nbsp;%';
  const ci = c => Array.isArray(c) ? `<span class="me-ci">${c[0].toFixed(1).replace('.', ',')}–${c[1].toFixed(1).replace('.', ',')}</span>` : '';
  const n1 = v => typeof v === 'number' ? v.toFixed(1).replace('.', ',') : '—';
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
  const TZ = new Date().getTimezoneOffset();
  async function api(id, offset, signal, withSummary = true, extra = '') {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctl.abort(); }, CLIENT_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(`/api/dota/player/${encodeURIComponent(id)}/matches?offset=${offset}&tz=${TZ}${withSummary ? '' : '&summary=0'}${extra}`, { signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
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
    const rows = Array.from({ length: PAGE }, () => '<tr class="me-sk"><td colspan="8"><span></span></td></tr>').join('');
    out.innerHTML = `<div class="me-summary me-summary--load">Загружаем матчи…</div>` +
      `<h2 class="me-h2">Последние матчи</h2><div class="me-table-wrap">${tableHead()}<tbody>${rows}</tbody></table></div>`;
  }
  function tableHead() {
    return '<table class="me-table"><thead><tr><th>Итог</th><th>Герой</th><th title="Позиция — оценка по итоговой статистике">Поз.</th><th>K/D/A</th><th>Длит.</th><th>GPM</th><th>Когда</th><th class="me-c-id">Матч</th></tr></thead>';
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
    const open = run && run.open && run.open.has(String(m.matchId));
    return `<tr class="me-mrow${det ? ' is-click' : ''}${open ? ' is-open' : ''}"${det ? ` data-mid="${esc(m.matchId)}" tabindex="0" aria-expanded="${open ? 'true' : 'false'}" title="Нажмите — разбор матча"` : ''}><td>${res}</td><td>${heroCell(m.heroId)}</td><td>${det ? posBadge(m) : '<span class="me-na">—</span>'}</td><td class="me-num">${kda}</td><td class="me-num">${det ? dur(m.duration) : '—'}</td>` +
      `<td class="me-num">${det && m.gpm != null ? nf.format(m.gpm) : '—'}</td><td title="${esc(fullDate(m.start))}">${ago(m.start)}</td>` +
      `<td class="me-c-id"><span class="me-mid">${esc(m.matchId)}</span></td></tr>`;
  }

  // ---------- герои, тенденция, выводы (по summary с сервера) ----------
  // Оценка героя: средний винрейт героя вне 95% интервала Уилсона ваших игр.
  // Режим сводки: all — все игры, ranked — рейтинговые (lobby 7), normal — нерейтинговые не Turbo, turbo — Turbo (game_mode 23).
  const MODE_KEY = 'dmMeMode';
  const MODES = [['all', 'Все'], ['ranked', 'Рейтинговые'], ['normal', 'Обычные'], ['turbo', 'Turbo']];
  function loadMode() { try { const m = localStorage.getItem(MODE_KEY); return MODES.some(x => x[0] === m) ? m : 'all'; } catch (_) { return 'all'; } }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (_) {} }
  // Сводка выбранного режима; если сервер прислал старый формат без scopes — всё как «Все».
  function scopeOf(R) {
    const S = R.summary;
    if (!S || !S.scopes || R.mode === 'all' || !S.scopes[R.mode]) return S;
    return { ...S.scopes[R.mode], minGames: S.minGames, z: S.z };
  }
  function heroRows(S, mode) {
    return (S.heroes || []).map(x => {
      const avg = refs ? refs.wr.get(Number(x.heroId)) : undefined;
      const r = { ...x, avg: avg == null ? null : avg };
      // Средний винрейт героя на сайте — по рейтинговым играм: сравниваем только рейтинговые.
      r.nc = mode === 'turbo' ? 'turbo' : mode === 'normal' ? 'normal' : (x.unranked > 0 ? 'mixed' : '');
      if (r.nc) r.avg = null;
      if (r.avg != null) {
        r.diff = x.wr - r.avg;
        r.sig = x.games >= S.minGames && Array.isArray(x.ci) && (r.avg < x.ci[0] || r.avg > x.ci[1]);
      }
      return r;
    });
  }
  function verdict(r, minGames) {
    if (r.nc === 'turbo') return '<span class="me-na">Turbo — не сравнивается</span>';
    if (r.nc === 'normal') return '<span class="me-na">не рейтинг — не сравнивается</span>';
    if (r.nc === 'mixed') return '<span class="me-na" title="Средний винрейт героя — по рейтинговым играм. Выберите «Рейтинговые», чтобы сравнить.">смешаны режимы</span>';
    if (r.avg == null) return '<span class="me-na">нет среднего</span>';
    if (r.games < minGames) return `<span class="me-na">мало игр (&lt;${minGames})</span>`;
    if (!r.sig) return '<span class="me-na">в пределах случайности</span>';
    return r.diff > 0 ? '<b class="me-win">выше среднего</b>' : '<b class="me-loss">ниже среднего</b>';
  }
  function guideLink(id) {
    const h = refs && refs.heroes.get(Number(id));
    return h ? `<a class="me-guide" href="/hero/${esc(h.slug)}/guide/">Гайд</a>` : '<span class="me-na">—</span>';
  }
  function topBlock(S, rows) {
    const top = rows.slice(0, 15);
    const body = top.length ? top.map(r => `<tr><td>${heroCell(r.heroId)}</td><td class="me-num">${r.games}</td>` +
      `<td class="me-num">${pct1(r.wr)} ${ci(r.ci)}</td><td class="me-num">${r.avg == null ? '—' : pct1(r.avg)}</td><td>${verdict(r, S.minGames)}</td>` +
      `<td class="me-num">${n1(r.k)}/${n1(r.d)}/${n1(r.a)}</td><td class="me-num">${nf.format(r.gpm)}</td><td class="me-num">${nf.format(r.xpm)}</td><td>${guideLink(r.heroId)}</td></tr>`).join('')
      : '<tr><td colspan="9" class="me-na">Нет матчей с подробностями.</td></tr>';
    const g = S.all.games;
    return `<h2 class="me-h2">Мои герои</h2><p class="me-sub">По ${g} ${plural(g, 'матчу', 'матчам', 'матчам')} с подробностями${MODE_NOTE[R_MODE()] || ''}. В скобках — 95&nbsp;% интервал Уилсона для вашего винрейта. K/D/A, GPM, XPM — средние за матч. Средний винрейт героя (сравнивается только с рейтинговыми играми) — по нашей базе рейтинговых матчей всех рангов (Steam не сообщает ранг игрока).</p>` +
      `<div class="me-table-wrap me-top"><table class="me-table"><thead><tr><th>Герой</th><th>Игр</th><th>Ваш винрейт</th><th>Средний</th><th>Оценка</th><th>K/D/A</th><th>GPM</th><th>XPM</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const MODE_NOTE = { ranked: ' в рейтинговых играх', normal: ' в обычных (нерейтинговых) играх', turbo: ' в режиме Turbo' };
  const R_MODE = () => (run && run.mode) || 'all';
  function modeSwitch(R) {
    const S = R.summary;
    if (!S || !S.modes) return '';
    const cnt = { all: (S.modes.ranked || 0) + (S.modes.normal || 0) + (S.modes.turbo || 0), ranked: S.modes.ranked || 0, normal: S.modes.normal || 0, turbo: S.modes.turbo || 0 };
    const btn = ([k, label]) => `<button type="button" class="me-seg-b${R.mode === k ? ' is-on' : ''}" data-mode="${k}" role="radio" aria-checked="${R.mode === k}"${cnt[k] ? '' : ' disabled'}>${label}<span class="me-seg-n">${cnt[k]}</span></button>`;
    const hint = R.mode === 'turbo' ? 'В Turbo больше золота и опыта, поэтому GPM и XPM выше, чем в обычных играх.'
      : R.mode === 'ranked' ? 'Рейтинговые игры — только их сравниваем со средним винрейтом героя.'
      : R.mode === 'normal' ? 'Нерейтинговые игры без Turbo. Средний винрейт героя на сайте — по рейтинговым, поэтому оценки нет.'
      : ((cnt.ranked ? 1 : 0) + (cnt.normal ? 1 : 0) + (cnt.turbo ? 1 : 0) > 1 ? 'Режимы вместе: средние смешаны. Для точного сравнения выберите режим.' : '');
    return `<div class="me-mode"><div class="me-seg" role="radiogroup" aria-label="Режим игр">${MODES.map(btn).join('')}</div>${hint ? `<p class="me-mode-hint">${hint}</p>` : ''}</div>`;
  }
  function trendBlock(S) {
    const T = S.trend;
    if (!T) {
      const need = S.minGames * 2;
      return `<h2 class="me-h2">Тенденция</h2><p class="me-na me-empty">Нужно не меньше ${need} матчей с подробностями (сейчас ${S.all.games}), чтобы сравнить последние игры с предыдущими.</p>`;
    }
    const r = T.recent, q = T.previous;
    const cell = (a, b, f, better) => { const d = a - b; const cls = !d ? '' : (d > 0) === better ? 'me-up' : 'me-down'; return `<td class="me-num">${f(a)}</td><td class="me-num">${f(b)}</td><td class="me-num ${cls}">${d > 0 ? '+' : d < 0 ? '−' : ''}${f(Math.abs(d)).replace(/&nbsp;%$/, '')}</td>`; };
    const rowsHtml =
      `<tr><td>Винрейт</td><td class="me-num">${pct1(r.wr)} ${ci(r.ci)}</td><td class="me-num">${pct1(q.wr)} ${ci(q.ci)}</td><td class="me-num ${T.sig ? (r.wr > q.wr ? 'me-up' : 'me-down') : ''}">${pp(r.wr - q.wr)}</td></tr>` +
      `<tr><td>KDA</td>${cell(r.kda, q.kda, v => v.toFixed(2).replace('.', ','), true)}</tr>` +
      `<tr><td>Смерти за матч</td>${cell(r.d, q.d, n1, false)}</tr>` +
      `<tr><td>GPM</td>${cell(r.gpm, q.gpm, v => nf.format(Math.round(v)), true)}</tr>` +
      `<tr><td>XPM</td>${cell(r.xpm, q.xpm, v => nf.format(Math.round(v)), true)}</tr>`;
    const note = T.sig
      ? (r.wr > q.wr ? '<b class="me-win">Винрейт вырос</b> — разница больше случайного разброса' : '<b class="me-loss">Винрейт упал</b> — разница больше случайного разброса')
      : '<span class="me-na">Разница винрейта в пределах случайного разброса</span>';
    return `<h2 class="me-h2">Тенденция</h2><p class="me-sub">Последние ${T.n} ${plural(T.n, 'матч', 'матча', 'матчей')} против ${T.n} предыдущих. ${note} (z-тест двух долей, 95&nbsp;%, z&nbsp;=&nbsp;${String(T.z).replace('.', ',')}).</p>` +
      `<div class="me-table-wrap"><table class="me-table"><thead><tr><th></th><th>Последние ${T.n}</th><th>Предыдущие ${T.n}</th><th>Разница</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  }
  function adviceBlock(S, rows) {
    const eligible = rows.filter(r => r.games >= S.minGames && r.avg != null);
    const sig = eligible.filter(r => r.sig);
    let items;
    if (R_MODE() === 'turbo' || R_MODE() === 'normal') items = '<li class="me-na">Выводы только для рейтинговых игр: средний винрейт героя на сайте посчитан по рейтинговым матчам.</li>';
    else if (!eligible.length) items = `<li class="me-na">Нет героев с ${S.minGames} и более рейтинговыми играми среди загруженных матчей — выводов нет.</li>`;
    else if (!sig.length) items = `<li class="me-na">У всех героев с ${S.minGames}+ играми (${eligible.length}) средний винрейт героя попадает в интервал ваших игр — разница в пределах случайности.</li>`;
    else items = sig.map(r => {
      const h = refs.heroes.get(Number(r.heroId));
      const name = h ? esc(h.name) : 'Герой #' + esc(r.heroId);
      const link = h ? ` <a href="/hero/${esc(h.slug)}/guide/">Гайд по герою →</a>` : '';
      const head = r.diff > 0 ? 'играете лучше среднего' : 'играете хуже среднего';
      return `<li><b>${name}</b> — ${head}: ${pct1(r.wr)} за ${r.games} ${plural(r.games, 'игру', 'игры', 'игр')} (интервал ${ci(r.ci)}) против ${pct1(r.avg)} в среднем (${pp(r.diff)}).${link}</li>`;
    }).join('');
    return `<h2 class="me-h2">Выводы</h2><ul class="me-advice">${items}</ul>` +
      `<p class="me-sub">Вывод делается только для героев с ${S.minGames}+ играми, если средний винрейт героя лежит вне 95&nbsp;% интервала Уилсона для ваших игр.</p>`;
  }
  // ---------- карточка для публикации (только по нажатию) ----------
  function shareBlock(R) {
    const S = scopeOf(R);
    if (!R.done || !S || S.all.games < S.minGames) return '';
    const c = R.card;
    // Превью рисует сервер из кеша сразу, без сохранения; публичная ссылка — только по кнопке.
    const img = `<img class="me-card-img" src="/api/dota/player/${encodeURIComponent(R.id)}/card.png?mode=${R.mode}&t=${encodeURIComponent(R.cachedAt || '')}-${S.all.games}" alt="Карточка результата: винрейт, K/D/A и частые герои" width="1200" height="630">`;
    let ctl;
    if (c && c.url) {
      const abs = location.origin + c.url;
      ctl = `<p class="me-sub">Ссылка на карточку (без Steam ID и номеров матчей):</p><div class="me-row"><input class="me-share-url" readonly value="${esc(abs)}"><button type="button" class="me-btn" data-copy>Копировать</button><a class="me-btn me-btn--link" href="${esc(c.url)}" target="_blank" rel="noopener">Открыть</a></div>`;
    } else {
      const err = c && c.error ? `<p class="me-warn">${esc(c.error)}</p>` : '';
      ctl = `<p class="me-sub">Steam ID и номера матчей на картинку не попадают. Ссылка для соцсетей создаётся только по нажатию.</p>` +
        `<button type="button" class="me-btn me-btn--go" data-card${c && c.busy ? ' disabled' : ''}>${c && c.busy ? 'Создаём…' : 'Получить ссылку'}</button>${err}`;
    }
    return `<h2 class="me-h2">Поделиться результатом</h2><div class="me-share">${img}${ctl}</div>`;
  }
  const CARD_ERR = { not_enough: 'Мало матчей с подробностями для карточки.', no_data: 'Матчи ещё не загружены — обновите страницу.', rate_limited: 'Лимит карточек на сегодня исчерпан, попробуйте завтра.', forbidden: 'Запрос отклонён сервером.' };
  async function makeCard(R) {
    R.card = { busy: true }; render();
    let res = null, data = null;
    try {
      res = await fetch(`/api/dota/player/${encodeURIComponent(R.id)}/card?mode=${R.mode}`, { method: 'POST', cache: 'no-store', headers: { Accept: 'application/json' } });
      data = await res.json().catch(() => null);
    } catch (e) { console.error('[me] карточка:', e); }
    if (R !== run) return;
    if (res && res.ok && data && typeof data.url === 'string' && /^\/me\/card\/[a-f0-9]{20}\/$/.test(data.url) && /^\/api\/dota\/card\/[a-f0-9]{20}\.png$/.test(data.image)) R.card = { url: data.url, image: data.image };
    else R.card = { error: (data && CARD_ERR[data.error]) || (res ? `Не удалось создать карточку (HTTP ${res.status}).` : 'Нет связи с сервером.') };
    render();
  }
  // ---------- L2: позиции, динамика, серии, соперники, длительность, время, предметы ----------
  const POS_NAME = { '1': 'Керри', '2': 'Мид', '3': 'Хард', sup: 'Саппорт' };
  const POS_NUM = { '1': '1', '2': '2', '3': '3', sup: '4–5' };
  const f1 = v => v.toFixed(1).replace('.', ',');
  // Полоса винрейта 0–100 %: интервал Уилсона, отметка 50 %, ваша точка; ref — вторая отметка (средний/ожидаемый).
  function wrBar(x, ref, refLabel) {
    if (!x || x.wr == null) return '<span class="me-na">—</span>';
    const refTick = ref != null ? `<i class="me-bar-ref" style="left:${ref}%" title="${esc(refLabel || '')}: ${f1(ref)} %"></i>` : '';
    return `<span class="me-bar" role="img" aria-label="Винрейт ${f1(x.wr)} %, интервал ${f1(x.ci[0])}–${f1(x.ci[1])} %">` +
      `<span class="me-bar-t"><i class="me-bar-ci" style="left:${x.ci[0]}%;width:${Math.max(0.8, x.ci[1] - x.ci[0])}%"></i><i class="me-bar-50"></i>${refTick}<i class="me-bar-pt" style="left:${x.wr}%"></i></span></span>`;
  }
  function wrCell(x) {
    if (!x || x.wr == null) return '<span class="me-na">—</span>';
    return `<b class="me-wr">${f1(x.wr)}&nbsp;%</b>${ci(x.ci)}`;
  }
  function posBadge(m) {
    if (m.pos == null) return '<span class="me-na">—</span>';
    const k = String(m.pos);
    return `<span class="me-pos me-pos--${k}" title="${POS_NAME[k]} (поз. ${POS_NUM[k]}) — оценка модели, уверенность ${Math.round((m.posP || 0) * 100)}&nbsp;%">${POS_NUM[k]}</span>`;
  }
  function section(title, sub, body, cls) {
    return `<section class="me-sec${cls ? ' ' + cls : ''}"><h2 class="me-h2">${title}</h2>${sub ? `<p class="me-sub">${sub}</p>` : ''}${body}</section>`;
  }

  // Динамика: скользящий винрейт (окно 20) и GPM по матчам, старые слева.
  const ROLL = 20;
  function chartBlock(S) {
    const s = S.series || [];
    if (s.length < ROLL + 5) return '';
    const W = 1000, H = 180, P = 8, n = s.length;
    const X = i => P + (W - 2 * P) * i / (n - 1);
    const roll = []; let w = 0;
    // С первой игры: пока игр меньше 20 — среднее по всем сыгранным, дальше — по последним 20.
    for (let i = 0; i < n; i++) { w += s[i][1]; if (i >= ROLL) w -= s[i - ROLL][1]; roll.push([i, w / Math.min(i + 1, ROLL) * 100]); }
    const yW = v => P + (H - 2 * P) * (1 - v / 100);
    // Шкала GPM без выбросов: от минимума до 95-го процентиля (+10 %); точки выше рисуются у верхнего края.
    const g = s.map(x => x[2]); const gs0 = g.slice().sort((a, b) => a - b);
    const gmin = gs0[0], gmax = Math.max(gmin + 1, Math.round(gs0[Math.floor((gs0.length - 1) * 0.95)] * 1.1)), span = gmax - gmin;
    const yG = v => P + (H - 2 * P) * (1 - (Math.min(v, gmax) - gmin) / span);
    const gRoll = []; let gs = 0;
    for (let i = 0; i < n; i++) { gs += g[i]; if (i >= ROLL) gs -= g[i - ROLL]; gRoll.push([i, gs / Math.min(i + 1, ROLL)]); }
    const path = (pts, y) => pts.map((p, k) => (k ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
    const area = (pts, y) => path(pts, y) + `L${X(pts[pts.length - 1][0]).toFixed(1)} ${H - P}L${X(pts[0][0]).toFixed(1)} ${H - P}Z`;
    const dots = s.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${yG(x[2]).toFixed(1)}" r="2.2" class="${x[1] ? 'me-dot-w' : 'me-dot-l'}"/>`).join('');
    const last = roll[roll.length - 1][1], first = roll[Math.min(ROLL, n) - 1][1];   // «с начала» — от первого полного окна в 20 игр
    const d0 = new Date(s[0][0] * 1000), d1 = new Date(s[n - 1][0] * 1000);
    const dd = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    return section('Динамика', `Последние ${n} ${plural(n, 'матч', 'матча', 'матчей')}, старые слева. Линия — винрейт за последние ${ROLL} игр в каждой точке (в начале, пока игр меньше ${ROLL}, — за все сыгранные).`,
      `<div class="me-charts"><figure class="me-chart"><figcaption><span>Винрейт, скользящий за ${ROLL}</span><b>${f1(last)}&nbsp;%</b><em class="${last >= first ? 'me-up' : 'me-down'}">${last >= first ? '+' : '−'}${f1(Math.abs(last - first))} п.п. с первых ${ROLL} игр</em></figcaption>` +
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="me-svg" aria-hidden="true"><defs><linearGradient id="meGw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#72edac" stop-opacity=".32"/><stop offset="1" stop-color="#72edac" stop-opacity="0"/></linearGradient></defs>` +
      `<line x1="${P}" x2="${W - P}" y1="${yW(50)}" y2="${yW(50)}" class="me-svg-50"/><path d="${area(roll, yW)}" fill="url(#meGw)"/><path d="${path(roll, yW)}" class="me-svg-line"/></svg>` +
      `<div class="me-chart-ax"><span>${dd(d0)}</span><span>50&nbsp;%</span><span>${dd(d1)}</span></div></figure>` +
      `<figure class="me-chart"><figcaption><span>GPM по матчам</span><b>${nf.format(Math.round(gRoll[gRoll.length - 1][1]))}</b><em>среднее за ${ROLL} · точки: <i class="me-k-w"></i>победа <i class="me-k-l"></i>поражение</em></figcaption>` +
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="me-svg" aria-hidden="true">${dots}<path d="${path(gRoll, yG)}" class="me-svg-line me-svg-line--g"/></svg>` +
      `<div class="me-chart-ax"><span>${dd(d0)}</span><span>${nf.format(gmin)}–${nf.format(gmax)}</span><span>${dd(d1)}</span></div></figure></div>`);
  }

  function posBlock(S, root) {
    const P = S.positions || [];
    if (!P.length) return '';
    const tot = P.reduce((a, x) => a + x.games, 0);
    const pm = root.posModel;
    const acc = pm ? `Точность модели на проверочных матчах: позиция 1 — ${f1(pm.perPos[0])}&nbsp;%, 2 — ${f1(pm.perPos[1])}&nbsp;%, 3 — ${f1(pm.perPos[2])}&nbsp;%, кор/саппорт — ${f1(pm.coreSup)}&nbsp;%. 4 и 5 по итоговой статистике не различаются.` : '';
    const cards = ['1', '2', '3', 'sup'].map(k => {
      const x = P.find(p => p.pos === k);
      if (!x) return `<div class="me-pcard is-empty"><span class="me-pcard-n">${POS_NUM[k]}</span><span class="me-pcard-t">${POS_NAME[k]}</span><span class="me-na">нет игр</span></div>`;
      return `<div class="me-pcard"><span class="me-pcard-n me-pos--${k}">${POS_NUM[k]}</span><span class="me-pcard-t">${POS_NAME[k]}</span>` +
        `<span class="me-pcard-share">${Math.round(x.games / tot * 100)}<small>%</small></span><span class="me-pcard-g">${x.games} ${plural(x.games, 'игра', 'игры', 'игр')} · KDA ${String(x.kda).replace('.', ',')}</span>` +
        `<span class="me-pcard-wr">${wrCell(x)}</span>${wrBar(x)}</div>`;
    }).join('');
    return section('Мои позиции', `Позиция угадывается по итоговой статистике матча (золото, опыт, добивания, предметы, герой) — Steam её не сообщает. ${acc}${S.posUnknown ? ` Без оценки: ${S.posUnknown} ${plural(S.posUnknown, 'матч', 'матча', 'матчей')} (старые данные кеша).` : ''}`,
      `<div class="me-pcards">${cards}</div>`);
  }

  function streakBlock(S) {
    const st = S.streak, A = S.after;
    if (!st || !A) return '';
    const big = `<div class="me-streak ${st.win ? 'is-w' : 'is-l'}"><span class="me-streak-n">${st.n}</span><span>${st.win ? plural(st.n, 'победа', 'победы', 'побед') : plural(st.n, 'поражение', 'поражения', 'поражений')} подряд</span><small>текущая серия</small></div>`;
    const enough = A.afterWin.games >= S.minGames && A.afterLoss.games >= S.minGames;
    const verdictTxt = !enough ? `<span class="me-na">Мало пар игр подряд (нужно по ${S.minGames}+), вывода нет.</span>`
      : A.sig ? (A.afterLoss.wr < A.afterWin.wr ? '<b class="me-loss">После поражения вы играете заметно хуже</b> — разница больше случайного разброса. Возможно, стоит делать паузу.' : '<b class="me-win">После поражения вы играете даже лучше</b> — разница больше случайного разброса.')
      : '<span class="me-na">Разница в пределах случайного разброса — после поражений вы не «тильтуете».</span>';
    const row = (t, x) => `<div class="me-row2"><span class="me-row2-t">${t}</span><span class="me-row2-g">${x.games} ${plural(x.games, 'игра', 'игры', 'игр')}</span><span class="me-row2-wr">${wrCell(x)}</span>${wrBar(x)}</div>`;
    return section('Серии', `Игры подряд — следующая начата не позже ${Math.round(A.gap / 3600)}&nbsp;ч после конца предыдущей.`,
      `<div class="me-split">${big}<div class="me-panel">${row('После победы', A.afterWin)}${row('После поражения', A.afterLoss)}<p class="me-note2">${verdictTxt} <span class="me-na">z&nbsp;=&nbsp;${String(A.z).replace('.', ',')}</span></p></div></div>`);
  }

  function heroMini(id) {
    const h = refs && refs.heroes.get(Number(id));
    return h ? `<a class="me-hero me-hero--sm" href="/hero/${esc(h.slug)}/"><img src="/assets/heroes/${esc(h.slug)}.webp" alt="" width="40" height="23" loading="lazy" decoding="async"><span class="me-hero-n">${esc(h.name)}</span></a>`
      : `<span class="me-hero me-hero--sm"><span class="me-hero-ph"></span><span class="me-hero-n">Герой #${esc(id)}</span></span>`;
  }
  const draftVs = id => `/#draft=----_${Number(id)}----_`;
  const draftWith = id => `/#draft=${Number(id)}----_----_`;
  function pairList(title, list, all, kind) {
    if (!list.length) return `<div class="me-panel"><h3 class="me-h3">${title}</h3><p class="me-na">Нет героев с 5+ общими играми.</p></div>`;
    const act = id => { const h = refs && refs.heroes.get(Number(id)); if (!h) return '<span></span>';
      return kind === 'vs'
        ? `<span class="me-pa"><a href="${draftVs(id)}" title="DraftMate: ${esc(h.name)} в команде соперников">Драфт</a><a href="/hero/${esc(h.slug)}/#matchups" title="Кто контрит ${esc(h.name)}">Контрпики</a></span>`
        : `<span class="me-pa"><a href="${draftWith(id)}" title="DraftMate: ${esc(h.name)} в вашей команде">Драфт</a><a href="/hero/${esc(h.slug)}/guide/" title="Гайд по ${esc(h.name)}">Гайд</a></span>`; };
    return `<div class="me-panel"><h3 class="me-h3">${title}</h3>${list.map(x => `<div class="me-row2 me-row2--pa${x.sig ? ' is-sig' : ''}"><span class="me-row2-t">${heroMini(x.heroId)}</span><span class="me-row2-g">${x.games}</span><span class="me-row2-wr">${wrCell(x)}</span>${wrBar(x, all, 'Ваш общий винрейт')}${act(x.heroId)}</div>`).join('')}</div>`;
  }
  function pairsBlock(S) {
    const vs = S.vs || [], wi = S.with || [];
    if (!vs.length && !wi.length) return '';
    const all = S.all.wr;
    const by = (a, k) => a.slice().sort((x, y) => k * (x.wr - y.wr) || y.games - x.games).slice(0, 5);
    return section('Соперники и союзники', `Герои, с которыми или против которых у вас 5+ игр. Золотая отметка — винрейт игрока, белая — ваш общий (${f1(all)}&nbsp;%). Выделены те, где разница больше случайного разброса; при малой выборке интервалы широкие. «Драфт» открывает DraftMate с героем в команде соперников или в вашей.`,
      `<div class="me-grid2">${pairList('Тяжелее всего против', by(vs, 1), all, 'vs')}${pairList('Легче всего против', by(vs, -1), all, 'vs')}${pairList('Лучше всего вместе с', by(wi, -1), all, 'with')}${pairList('Хуже всего вместе с', by(wi, 1), all, 'with')}</div>`);
  }

  const DUR_NAME = { lt25: 'до 25 мин', '25_35': '25–35 мин', '35_45': '35–45 мин', gt45: 'больше 45 мин' };
  function durBlock(S, mode) {
    const D = S.dur || [];
    if (!D.some(x => x.games)) return '';
    const cmp = mode === 'ranked';
    const rows = D.map(x => {
      const sig = cmp && x.exp != null && x.games >= S.minGames && (x.exp < x.ci[0] || x.exp > x.ci[1]);
      const note = !cmp || x.exp == null ? '' : x.games < S.minGames ? '<span class="me-na">мало игр</span>' : sig ? (x.wr > x.exp ? '<b class="me-win">лучше ожидаемого</b>' : '<b class="me-loss">хуже ожидаемого</b>') : '<span class="me-na">как ожидается</span>';
      return `<div class="me-row2${sig ? ' is-sig' : ''}"><span class="me-row2-t">${DUR_NAME[x.key]}</span><span class="me-row2-g">${x.games}</span><span class="me-row2-wr">${wrCell(x)}</span>${wrBar(x, cmp ? x.exp : null, 'Ожидаемый')}${cmp ? `<span class="me-row2-n">${x.exp != null ? 'ожид. ' + f1(x.exp) + '&nbsp;%' : ''} ${note}</span>` : ''}</div>`;
    }).join('');
    return section('Длинные и короткие игры', cmp ? 'Белая отметка — ожидаемый винрейт: средний винрейт ваших героев в рейтинговых играх той же длины по базе сайта.' : 'Сравнение с ожидаемым — только в режиме «Рейтинговые».', `<div class="me-panel me-panel--dur">${rows}</div>`);
  }

  const PER_NAME = ['Ночь, 0–6', 'Утро, 6–12', 'День, 12–18', 'Вечер, 18–24'];
  const WD_NAME = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  function timeBlock(S) {
    const T = S.time;
    if (!T) return '';
    const all = S.all.wr;
    const col = (x, t) => {
      const h = x.games ? Math.max(4, x.wr) : 0;
      return `<div class="me-col${x.sig ? (x.wr > all ? ' is-up' : ' is-down') : ''}" title="${t}: ${x.games} ${plural(x.games, 'игра', 'игры', 'игр')}${x.games ? ', ' + f1(x.wr) + ' %, интервал ' + f1(x.ci[0]) + '–' + f1(x.ci[1]) + ' %' : ''}">` +
        `<span class="me-col-v">${x.games ? Math.round(x.wr) + '%' : '—'}</span><span class="me-col-bar"><i style="height:${h}%"></i><b style="bottom:${all}%"></b></span><span class="me-col-t">${t}</span><span class="me-col-g">${x.games}</span></div>`;
    };
    const sig = [...T.periods.map((x, i) => [x, PER_NAME[i]]), ...T.weekdays.map((x, i) => [x, WD_NAME[i]])].filter(([x]) => x.sig);
    const note = sig.length ? sig.map(([x, t]) => `<b class="${x.wr > all ? 'me-win' : 'me-loss'}">${t}</b> — ${f1(x.wr)}&nbsp;% (${x.wr > all ? 'лучше' : 'хуже'} вашего среднего)`).join('; ')
      : 'Разница по времени и дням в пределах случайного разброса.';
    return section('Когда вы играете лучше', `По вашему часовому поясу. Столбик — винрейт (интервал — в подсказке при наведении), линия — ваш общий винрейт (${f1(all)}&nbsp;%). ${note}`,
      `<div class="me-grid2 me-grid2--time"><div class="me-panel"><h3 class="me-h3">Время суток</h3><div class="me-cols">${T.periods.map((x, i) => col(x, PER_NAME[i])).join('')}</div></div>` +
      `<div class="me-panel"><h3 class="me-h3">День недели</h3><div class="me-cols">${T.weekdays.map((x, i) => col(x, WD_NAME[i])).join('')}</div></div></div>`);
  }

  function itemIcon(meta, id, label) {
    const m = meta[id];
    if (!m) return '';
    return `<a class="me-item" href="/item/${esc(m[2])}/" title="${esc(m[0])}"><img src="${esc(m[1])}" alt="${esc(m[0])}" width="58" height="42" loading="lazy" decoding="async">${label}</a>`;
  }
  function itemsBlock(S, root, R) {
    const I = S.items || [];
    if (!I.length) return '';
    const meta = root.itemMeta || {};
    if (!I.some(x => x.heroId === R.itemHero)) R.itemHero = I[0].heroId;
    const cur = I.find(x => x.heroId === R.itemHero);
    const tabs = I.map(x => { const h = refs && refs.heroes.get(Number(x.heroId)); return `<button type="button" class="me-tab${x.heroId === cur.heroId ? ' is-on' : ''}" data-ihero="${x.heroId}">${h ? `<img src="/assets/heroes/${esc(h.slug)}.webp" alt="" width="32" height="18">` : ''}${h ? esc(h.name) : '#' + x.heroId}<small>${x.games}</small></button>`; }).join('');
    // Постоянное число мест (8 и 6) и две строки подписи у каждого — блок не меняет высоту при смене героя.
    const pad = (html, n, k) => html + '<span class="me-item is-empty" aria-hidden="true"><i></i><span>&nbsp;</span><span>&nbsp;</span></span>'.repeat(Math.max(0, n - k));
    const mineHtml = cur.mine.map(it => itemIcon(meta, it.id, `<span>${it.share}%</span><span>${it.games >= 5 ? `<b class="${it.wins / it.games >= S.all.wr / 100 ? 'me-win' : 'me-loss'}">${Math.round(it.wins / it.games * 100)}% побед</b>` : '&nbsp;'}</span>`)).join('');
    const siteHtml = cur.site.map(it => itemIcon(meta, it.id, `<span>${it.share}%</span><span>&nbsp;</span>`)).join('');
    const mine = pad(mineHtml, 8, cur.mine.length), site = pad(siteHtml, 6, cur.site.length);
    const noMine = cur.mine.length ? '' : ' · <span class="me-na">нет законченных предметов</span>', noSite = cur.site.length ? '' : ' · <span class="me-na">нет данных сайта</span>';
    const h = refs && refs.heroes.get(Number(cur.heroId));
    return section('Предметы на ваших героях', 'Законченные предметы в итоговых шести слотах. Под иконкой — доля ваших игр с предметом, при 5+ играх — винрейт с ним (зелёный — выше вашего среднего). Справа — что чаще всего собирают на этого героя по базе сайта.',
      `<div class="me-tabs" role="tablist">${tabs}</div><div class="me-grid2"><div class="me-panel"><h3 class="me-h3">Вы собираете · ${cur.games} ${plural(cur.games, 'игра', 'игры', 'игр')}${noMine}</h3><div class="me-items">${mine}</div></div>` +
      `<div class="me-panel"><h3 class="me-h3">Обычно собирают${noSite}${h ? ` · <a href="/hero/${esc(h.slug)}/guide/">гайд по герою →</a>` : ''}</h3><div class="me-items">${site}</div></div></div>`);
  }
  // ---------- L3: разбор матча, рекорды, неделя, против среднего, похожие, друг ----------
  const dDate = ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  function itemImgs(items, meta) {
    return (items || []).map(id => { const m = id > 0 && meta[id]; return m ? `<a href="/item/${esc(m[2])}/" title="${esc(m[0])}"><img src="${esc(m[1])}" alt="${esc(m[0])}" width="33" height="24" loading="lazy" decoding="async"></a>` : '<i></i>'; }).join('');
  }
  function matchDetail(R, mid) {
    const D = R.details[mid];
    if (!D || D === 'loading') return '<div class="me-md-load">Загружаем матч…</div>';
    if (D === 'error') return '<div class="me-md-load me-na">Подробности матча недоступны: матч ещё не загружен на сервер. Обновите профиль.</div>';
    const team = rad => {
      const ps = D.players.filter(p => p.radiant === rad);
      const won = D.radiantWin === rad;
      const rows = ps.map(p => `<tr class="${p.me ? 'is-me' : ''}"><td>${heroMini(p.hero)}</td><td>${posBadge({ pos: p.pos, posP: p.posP })}</td>` +
        `<td class="me-num">${p.k}/${p.d}/${p.a}</td><td class="me-num">${nf.format(p.gpm)}</td><td class="me-num">${nf.format(p.xpm)}</td>` +
        `<td class="me-num">${p.lh}${p.dn != null ? '/' + p.dn : ''}</td><td class="me-num">${nf.format(p.nw)}</td><td class="me-num">${nf.format(p.hd)}</td>` +
        `<td><span class="me-md-items">${itemImgs(p.items, D.itemMeta || {})}</span></td></tr>`).join('');
      return `<div class="me-md-team"><div class="me-md-h"><b class="${rad ? 'me-md-rad' : 'me-md-dire'}">${rad ? 'Свет' : 'Тьма'}</b>${won ? '<span class="me-md-win">Победа</span>' : ''}</div>` +
        `<div class="me-md-scroll"><table class="me-md-t"><thead><tr><th>Герой</th><th>Поз.</th><th>K/D/A</th><th>GPM</th><th>XPM</th><th>Добив.</th><th>Ценность</th><th>Урон</th><th>Предметы</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    };
    return `<div class="me-md">${team(true)}${team(false)}<p class="me-md-note">Длительность ${dur(D.duration)} · позиции — оценка модели · <a href="/academy/match/?m=${esc(D.matchId)}">разбор с рекомендациями →</a> · <a href="https://www.dotabuff.com/matches/${esc(D.matchId)}" target="_blank" rel="noopener nofollow">матч на Dotabuff ↗</a></p></div>`;
  }
  async function loadDetail(R, mid) {
    R.details[mid] = 'loading'; render();
    try {
      const r = await fetch(`/api/dota/match/${encodeURIComponent(mid)}?me=${encodeURIComponent(R.id)}`, { headers: { Accept: 'application/json' } });
      const j = r.ok ? await r.json() : null;
      R.details[mid] = j && Array.isArray(j.players) ? j : 'error';
    } catch (e) { console.error('[me] матч', mid, e); R.details[mid] = 'error'; }
    if (R === run) render();
  }

  function weekBlock(S) {
    const W = S.week;
    if (!W || (!W.now.games && !W.prev.games)) return '';
    const d = W.now.games && W.prev.games ? W.now.wr - W.prev.wr : null;
    const sig = d != null && W.now.games >= S.minGames && W.prev.games >= S.minGames && Math.abs(W.z) > S.z;
    const bh = W.bestHero;
    const tile = (t, v, sub) => `<div class="me-wk-t"><span class="me-wk-l">${t}</span><b class="me-wk-v">${v}</b><span class="me-wk-s">${sub}</span></div>`;
    return section('Неделя в цифрах', 'Последние 7 дней против 7 дней до них.',
      `<div class="me-wk">${tile('Игр за неделю', W.now.games, `до этого ${W.prev.games}`)}` +
      tile('Винрейт', W.now.games ? f1(W.now.wr) + '<small>%</small>' : '—', d == null ? 'не с чем сравнить' : `<span class="${sig ? (d > 0 ? 'me-up' : 'me-down') : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${f1(Math.abs(d))} п.п.</span> к прошлой${sig ? '' : ' · в пределах случайности'}`) +
      tile('KDA', W.now.games ? String(W.now.kda).replace('.', ',') : '—', W.prev.games ? `до этого ${String(W.prev.kda).replace('.', ',')}` : '') +
      `<div class="me-wk-t me-wk-hero"><span class="me-wk-l">Герой недели</span>${bh ? `${heroMini(bh.heroId)}<span class="me-wk-s">${bh.wins} из ${bh.games} · ${f1(bh.wr)}&nbsp;%</span>` : '<span class="me-na">нужно 3+ игры на герое</span>'}</div></div>`);
  }

  const REC = [['kda', 'Лучший KDA', r => String(r.value).replace('.', ','), r => `${r.k}/${r.d}/${r.a}`], ['kills', 'Больше всего убийств', r => r.value, r => `${r.k}/${r.d}/${r.a}`],
    ['gpm', 'Максимальный GPM', r => nf.format(r.value), r => `${r.k}/${r.d}/${r.a}`], ['damage', 'Больше всего урона', r => nf.format(r.value), r => 'по героям'],
    ['longest', 'Самая долгая игра', r => dur(r.value), r => `${r.k}/${r.d}/${r.a}`]];
  function recordsBlock(S) {
    const R0 = S.records;
    if (!R0 || !R0.kda) return '';
    const tiles = REC.filter(([k]) => R0[k]).map(([k, t, v, sub]) => { const r = R0[k];
      return `<div class="me-rec"><span class="me-wk-l">${t}</span><b class="me-rec-v">${v(r)}</b>${heroMini(r.heroId)}<span class="me-wk-s">${dDate(r.start)} · ${r.win ? '<span class="me-up">победа</span>' : '<span class="me-down">поражение</span>'} · ${sub(r)}</span></div>`; }).join('');
    const ws = R0.winStreak ? `<div class="me-rec me-rec--streak"><span class="me-wk-l">Серия побед</span><b class="me-rec-v">${R0.winStreak.value}</b><span class="me-wk-s">${dDate(R0.winStreak.from)} — ${dDate(R0.winStreak.to)}</span></div>` : '';
    return section('Рекорды', 'Лучшие матчи среди загруженных.', `<div class="me-recs">${tiles}${ws}</div>`);
  }

  // Ячейка сравнения: ваше значение, среднее по базе, разница в % (better: 1 — больше лучше, -1 — меньше лучше).
  function cmpBox(v, b, fmt, better = 1) {
    if (v == null) return '<td class="me-na">—</td>';
    if (b == null || !b) return `<td class="me-cmp"><b>${fmt(v)}</b></td>`;
    const d = (v - b) / b * 100, good = d * better >= 0;
    return `<td class="me-cmp"><b>${fmt(v)}</b><span>${fmt(b)} <em class="${Math.abs(d) < 3 ? '' : good ? 'me-up' : 'me-down'}">${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}%</em></span></td>`;
  }
  function heroCmpBlock(S, mode) {
    const C = (S.heroCmp || []).filter(x => x.baseGpm != null);
    if (mode !== 'ranked') return section('Вы против среднего', '', '<p class="me-na me-empty">Сравнение со средним по герою и позиции — только в режиме «Рейтинговые»: база сайта собрана по рейтинговым играм.</p>');
    if (!C.length) return '';
    const n0 = v => nf.format(Math.round(v)), n1 = v => f1(v);
    const rows = C.map(x => `<tr><td>${heroMini(x.heroId)}</td><td>${posBadge({ pos: x.pos, posP: 1 })}</td><td class="me-num">${x.games}</td>` +
      cmpBox(x.gpm, x.baseGpm, n0) + cmpBox(x.xpm, x.baseXpm, n0) + cmpBox(x.k, x.baseK, n1) + cmpBox(x.d, x.baseD, n1, -1) + cmpBox(x.a, x.baseA, n1) +
      cmpBox(x.hd, x.baseHd, n0) + cmpBox(x.lh, x.baseLh, n0) + `<td class="me-num me-na">${nf.format(x.baseN)}</td></tr>`).join('');
    return section('Вы против среднего', 'Ваши средние за матч на герое и (угаданной) позиции против среднего по базе сайта для той же пары — рейтинговые игры 0–4500 MMR, позиции по Stratz. Под вашим числом — среднее и разница; для смертей меньше — лучше. Нужно 3+ ваших игры; при малой выборке разница может быть случайной.',
      `<div class="me-table-wrap"><table class="me-table me-cmp-t"><thead><tr><th>Герой</th><th>Поз.</th><th>Игр</th><th>GPM</th><th>XPM</th><th>Убийства</th><th>Смерти</th><th>Помощь</th><th>Урон</th><th>Добивания</th><th>Игр в базе</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  function similarBlock(S) {
    const M = S.similar;
    if (!M || !M.heroes || !M.heroes.length) return '';
    const cards = M.heroes.map(x => { const h = refs && refs.heroes.get(Number(x.heroId)); if (!h) return '';
      return `<a class="me-sim" href="/hero/${esc(h.slug)}/guide/"><img src="/assets/heroes/${esc(h.slug)}.webp" alt="" width="128" height="72" loading="lazy" decoding="async"><span class="me-sim-n">${esc(h.name)}</span><span class="me-sim-s">${f1(x.wr)}&nbsp;% · ${nf.format(x.n)} игр</span><span class="me-sim-g">Гайд →</span></a>`; }).join('');
    return section('Попробуйте на своей позиции', `Ваша основная позиция — <span class="me-pos me-pos--${M.pos}">${POS_NUM[M.pos]}</span> ${POS_NAME[M.pos]}. Здесь — герои с лучшим винрейтом на ней по базе сайта (по нижней границе интервала), которых вы почти не играете (меньше 3 игр).`, `<div class="me-sims">${cards}</div>`);
  }

  // ---------- сравнение с другом ----------
  const FRIEND_KEY = 'dmFriendId';
  function friendBlock(R) {
    const F = R.friend || {};
    const val = esc(F.draft != null ? F.draft : (F.id || ''));
    const form = `<form class="me-fr-form" data-friend><input id="meFriend" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Steam ID друга или ссылка на профиль" value="${val}"><button type="submit" class="me-btn me-btn--go">Сравнить</button>${F.id ? '<button type="button" class="me-btn" data-friend-clear>Убрать</button>' : ''}</form>`;
    let body = '';
    if (F.error) body = `<p class="me-warn">${esc(F.error)}</p>`;
    else if (F.loading) body = `<p class="me-na">Загружаем матчи друга… ${F.matches ? F.matches.length : 0} из 100</p>`;
    else if (F.summary && R.summary) body = friendCompare(R, F);
    return section('Сравнение с другом', 'По 100 последним матчам друга и вашим загруженным, все режимы. Steam ID друга хранится только в этом браузере.', `<div class="me-panel">${form}${body}</div>`);
  }
  function friendCompare(R, F) {
    const A = R.summary, B = F.summary;
    const mainPos = S => { const p = S.positions || []; if (!p.length) return '—'; const m = p.reduce((a, x) => x.games > a.games ? x : a); const t = p.reduce((a, x) => a + x.games, 0); return `<span class="me-pos me-pos--${m.pos}">${POS_NUM[m.pos]}</span> ${POS_NAME[m.pos]} · ${Math.round(m.games / t * 100)}%`; };
    const top = S => (S.heroes || []).slice(0, 3).map(h => heroMini(h.heroId)).join('');
    const row = (t, a, b, better) => `<tr><td>${t}</td><td class="${better === 1 ? 'is-best' : ''}">${a}</td><td class="${better === 2 ? 'is-best' : ''}">${b}</td></tr>`;
    const cmpN = (a, b) => a == null || b == null || a === b ? 0 : a > b ? 1 : 2;
    const a = A.all, b = B.all;
    const mine = new Set((A.heroes || []).map(h => h.heroId));
    const common = (B.heroes || []).filter(h => mine.has(h.heroId)).slice(0, 5);
    const commonHtml = common.length ? common.map(h => { const x = A.heroes.find(y => y.heroId === h.heroId); return `<div class="me-cmn"><span>${heroMini(h.heroId)}</span><span><small>вы</small> <b>${f1(x.wr)}&nbsp;%</b> · ${x.games} ${plural(x.games, 'игра', 'игры', 'игр')}</span><span><small>друг</small> <b>${f1(h.wr)}&nbsp;%</b> · ${h.games} ${plural(h.games, 'игра', 'игры', 'игр')}</span></div>`; }).join('') : '<p class="me-na">Общих героев нет.</p>';
    const T = A.friend;
    const tog = T && T.together.games ? `<div class="me-fr-tog"><b>${T.together.games}</b> ${plural(T.together.games, 'игра', 'игры', 'игр')} вместе · винрейт <b>${f1(T.together.wr)}&nbsp;%</b>${ci(T.together.ci)} против вашего общего ${f1(a.wr)}&nbsp;%${T.against.games ? ` · друг против друга: ${T.against.games} (ваши победы ${T.against.wins})` : ''}</div>`
      : '<div class="me-fr-tog me-na">Среди загруженных матчей вы не играли вместе.</div>';
    return tog + `<div class="me-table-wrap"><table class="me-table me-fr-t"><thead><tr><th></th><th>Вы</th><th>Друг</th></tr></thead><tbody>` +
      row('Матчей', a.games, b.games, 0) +
      row('Винрейт', wrCell(a), wrCell(b), cmpN(a.wr, b.wr)) +
      row('KDA', String(a.kda).replace('.', ','), String(b.kda).replace('.', ','), cmpN(a.kda, b.kda)) +
      row('GPM', nf.format(a.gpm), nf.format(b.gpm), cmpN(a.gpm, b.gpm)) +
      row('XPM', nf.format(a.xpm), nf.format(b.xpm), cmpN(a.xpm, b.xpm)) +
      row('Основная позиция', mainPos(A), mainPos(B), 0) +
      row('Частые герои', `<span class="me-fr-h">${top(A)}</span>`, `<span class="me-fr-h">${top(B)}</span>`, 0) +
      `</tbody></table></div><h3 class="me-h3 me-fr-h3">Общие герои</h3>${commonHtml}`;
  }
  async function loadFriend(R, fid) {
    R.friend = { id: fid, loading: true, matches: [] }; render();
    try { localStorage.setItem(FRIEND_KEY, fid); } catch (_) {}
    let summary = null;
    for (let off = 0; off < 100; off += PAGE) {
      const last = off + PAGE >= 100;
      const res = await fetchPage({ id: fid, ctl: R.ctl }, off, null, last);
      if (R !== run || R.ctl.signal.aborted || !R.friend || R.friend.id !== fid) return;
      if (!res.ok) { R.friend = { id: fid, error: errorInfo(res).title + (res.code === 'history_unavailable' ? ': у друга закрыта история матчей.' : '.') }; render(); return; }
      R.friend.matches = R.friend.matches.concat(res.data.matches);
      if (res.data.summary) summary = res.data.summary;
      if (res.data.matches.length < PAGE) { if (!summary) { const again = await fetchPage({ id: fid, ctl: R.ctl }, off, null, true); if (again.ok) summary = again.data.summary; } break; }
      render();
    }
    // Ваша сводка с отметкой игр вместе: тот же последний загруженный offset, параметр friend.
    const myOff = Math.max(0, Math.floor((R.matches.length - 1) / PAGE) * PAGE);
    const mine = await api(R.id, myOff, R.ctl.signal, true, '&friend=' + encodeURIComponent(fid));
    if (R !== run || !R.friend || R.friend.id !== fid) return;
    if (mine.ok && mine.data.summary) R.summary = mine.data.summary;
    R.friend = { id: fid, summary: summary || null, error: summary ? null : 'Не удалось получить сводку друга.' };
    render();
  }
  // Прокачка: ваш самый частый выбор на каждом из 10 уровней против популярного порядка сайта.
  function abIcon(meta, id, share, diff) {
    const m = meta[id];
    const title = m ? m[0] : 'Способность ' + id;
    const img = m && !m[2] ? `<img src="/assets/abilities/${esc(m[1])}.png" alt="" width="34" height="34" loading="lazy" decoding="async">` : `<i class="me-ab-ph${m && m[2] ? ' me-ab-tal' : ''}">${m && m[2] ? 'Т' : '?'}</i>`;
    return `<span class="me-ab${diff ? ' is-diff' : ''}" title="${esc(title)}${share != null ? ' — ' + share + '% ваших игр' : ''}">${img}</span>`;
  }
  function skillsBlock(S, root) {
    const K = S.skills || [];
    if (!K.length) return '';
    const meta = root.abilityMeta || {};
    const lv = Array.from({ length: 10 }, (_, i) => `<span class="me-ab-lv">${i + 1}</span>`).join('');
    const rows = K.map(x => {
      const mine = x.mine.map((s, i) => abIcon(meta, s.id, s.share, x.site && x.site[i] !== s.id)).join('');
      const site = x.site ? x.site.map((id, i) => abIcon(meta, id, null, x.mine[i].id !== id)).join('') : '';
      const score = x.site ? `${x.sitePos ? `<span class="me-na">сборка поз. ${x.sitePos}</span>` : ''}<span class="me-ab-score ${x.same >= 8 ? 'me-up' : x.same <= 5 ? 'me-down' : ''}">${x.same}/10 совпадает</span>` : '<span class="me-na">нет сборки сайта</span>';
      return `<div class="me-skill"><div class="me-skill-h">${heroMini(x.heroId)}<span class="me-na">${x.games} ${plural(x.games, 'игра', 'игры', 'игр')}${x.pos ? ' · ' + posBadge({ pos: x.pos, posP: 1 }) : ''}</span>${score}</div>` +
        `<div class="me-ab-grid"><span class="me-ab-l"></span><span class="me-ab-row me-ab-row--lv">${lv}</span><span class="me-ab-l">Вы</span><span class="me-ab-row">${mine}</span>` +
        (x.site ? `<span class="me-ab-l" title="Популярный порядок по сборкам сайта${x.sitePos ? ', позиция ' + x.sitePos : ''}">Обычно</span><span class="me-ab-row">${site}</span>` : '') + '</div></div>';
    }).join('');
    return section('Прокачка способностей', 'Первые 10 повышений: ваш самый частый выбор на каждом уровне против популярного порядка по сборкам сайта (Stratz, Divine–Immortal). Отличия подсвечены. «Т» — талант.', `<div class="me-skills">${rows}</div>`);
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
      ? `<div class="me-table-wrap me-matches">${tableHead()}<tbody>${shown.map(x => matchRow(x) + (R.open.has(String(x.matchId)) ? `<tr class="me-md-row"><td colspan="8">${matchDetail(R, String(x.matchId))}</td></tr>` : '')).join('')}</tbody></table></div><p class="me-sub me-md-hint">Нажмите на матч, чтобы увидеть всех 10 игроков.</p>${more}`
      : '<p class="me-na me-empty">В истории Steam нет матчей этого аккаунта.</p>';
    let bg = '';
    if (R.bgError) {
      const e = errorInfo(R.bgError);
      bg = `<p class="me-warn">Загружено ${m.length} из ${target} матчей: ${esc(e.title.toLowerCase())}. ${e.retry ? '<button type="button" class="me-btn me-btn--sm" data-resume>Догрузить</button>' : ''}</p>`;
    }
    const S = scopeOf(R);
    const hr = S ? heroRows(S, R.mode) : [];
    const ae = document.activeElement, keep = ae && ae.id === 'meFriend' ? [ae.selectionStart, ae.selectionEnd] : null;
    out.innerHTML = summary + refsNote + `<h2 class="me-h2">Последние матчи</h2>` + table +
      (m.length ? bg + (S ? modeSwitch(R) + weekBlock(S) + chartBlock(S) + recordsBlock(S) + topBlock(S, hr) + heroCmpBlock(S, R.mode) + skillsBlock(S, R.summary) + posBlock(S, R.summary) + similarBlock(S) +
        trendBlock(S) + streakBlock(S) + pairsBlock(S) + durBlock(S, R.mode) + timeBlock(S) + itemsBlock(S, R.summary, R) + (R.done ? friendBlock(R) : '') + adviceBlock(S, hr) + shareBlock(R) : '') : '');
    if (keep) { const fi = document.getElementById('meFriend'); if (fi) { fi.focus({ preventScroll: true }); try { fi.setSelectionRange(keep[0], keep[1]); } catch (_) {} } }
    out.querySelectorAll('tr[data-mid]').forEach(tr => {
      const toggle = () => { const id = tr.dataset.mid; if (R.open.has(id)) R.open.delete(id); else { R.open.add(id); if (!R.details[id]) { loadDetail(R, id); return; } } render(); };
      tr.addEventListener('click', e => { if (!e.target.closest('a')) toggle(); });
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    const ff = out.querySelector('[data-friend]');
    if (ff) {
      const fi = ff.querySelector('input');
      fi.addEventListener('input', () => { R.friend = { ...(R.friend || {}), draft: fi.value }; });
      ff.addEventListener('submit', e => {
        e.preventDefault();
        const p = parseInput(fi.value);
        if (!p.id) { R.friend = { draft: fi.value, error: p.err === 'vanity' ? 'Нужен числовой Steam ID друга (ссылка вида /id/<имя> не подходит).' : 'Не похоже на Steam ID.' }; render(); return; }
        if (p.id === R.id) { R.friend = { draft: fi.value, error: 'Это ваш собственный Steam ID.' }; render(); return; }
        loadFriend(R, p.id);
      });
      const fc = out.querySelector('[data-friend-clear]');
      if (fc) fc.addEventListener('click', () => { R.friend = null; try { localStorage.removeItem(FRIEND_KEY); } catch (_) {} render(); });
    }
    out.querySelectorAll('[data-ihero]').forEach(b => b.addEventListener('click', () => { R.itemHero = Number(b.dataset.ihero); const y = b.getBoundingClientRect().top; render(); const nb = out.querySelector(`[data-ihero="${R.itemHero}"]`); if (nb) window.scrollBy(0, nb.getBoundingClientRect().top - y); }));
    out.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.mode === R.mode) return;
      const y = b.getBoundingClientRect().top;
      R.mode = b.dataset.mode; saveMode(R.mode); R.card = null; render();
      const nb = out.querySelector(`[data-mode="${R.mode}"]`);
      if (nb) { window.scrollBy(0, nb.getBoundingClientRect().top - y); nb.focus({ preventScroll: true }); }
    }));
    const cb = out.querySelector('[data-card]');
    if (cb) cb.addEventListener('click', () => makeCard(R));
    const cp = out.querySelector('[data-copy]');
    if (cp) cp.addEventListener('click', () => {
      const inp = out.querySelector('.me-share-url');
      const done = () => { cp.textContent = 'Скопировано'; };
      if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); });
      else { inp.select(); }
    });
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
  async function fetchPage(R, offset, onWait, withSummary = true) {
    for (let i = 0; ; i++) {
      const res = await api(R.id, offset, R.ctl.signal, withSummary, R.friend && R.friend.id && R.friend.summary ? '&friend=' + encodeURIComponent(R.friend.id) : '');
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
      const target = Math.min(MAX, R.total || 0);
      const want = offset + PAGE >= target || (offset + PAGE) % 100 === 0;   // сводка — раз в 100 матчей и в конце
      let res = await fetchPage(R, offset, null, want);
      if (R !== run || R.ctl.signal.aborted) return;
      if (!res.ok) { R.bgError = res; R.done = true; render(); return; }
      const add = res.data.matches;
      if (!want && add.length < PAGE) {                    // история кончилась раньше ожидаемого — нужна итоговая сводка
        const again = await fetchPage(R, offset, null, true);
        if (R !== run || R.ctl.signal.aborted) return;
        if (again.ok) res = again;
      }
      R.matches = R.matches.concat(res.data.matches);
      if (res.data.summary) R.summary = res.data.summary;
      if (typeof res.data.total === 'number') R.total = res.data.total;
      if (add.length < PAGE) { render(); break; }
      render();
    }
    if (R === run) { R.done = true; render(); autoFriend(R); }
  }
  function autoFriend(R) {
    let f = ''; try { f = localStorage.getItem(FRIEND_KEY) || ''; } catch (_) {}
    const p = f ? parseInput(f) : {};
    if (p.id && p.id !== R.id && !R.friend) loadFriend(R, p.id);
  }
  async function start(id) {
    if (run) run.ctl.abort();
    const R = run = { id, ctl: new AbortController(), matches: [], total: 0, cachedAt: null, shown: PAGE, bgError: null, done: false, summary: null, card: null, mode: loadMode(), itemHero: null, open: new Set(), details: {}, friend: null };
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
    R.summary = res.data.summary || null;
    R.total = typeof res.data.total === 'number' ? res.data.total : R.matches.length;
    R.cachedAt = typeof res.data.cachedAt === 'number' ? res.data.cachedAt : null;
    if (R.matches.length < PAGE) R.done = true;
    render();
    if (R.done) autoFriend(R);
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
