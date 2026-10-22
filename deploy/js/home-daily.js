// Главная: «Герой дня» и «Вопрос дня».
// Герой и вопрос выбираются по дате МСК одинаково для всех посетителей:
// перестановка по списку героев/предметов, отсортированному по id/коду,
// не зависит от ежедневного обновления статистики. Все цифры — из
// data/stats.json, data/hero-counters.json, data/items-ru.json.
// Серия дней хранится в localStorage; без него блок работает, серия не копится.
(function () {
  const root = document.getElementById('homeDaily');
  if (!root) return;

  const STORE_KEY = 'dmDaily.v1';
  const GOAL_CLICK = 'home_daily_click';
  const GOAL_ANSWER = 'home_daily_answer';
  const MSK_MS = 3 * 3600 * 1000;

  const $ = sel => root.querySelector(sel);
  const nf = new Intl.NumberFormat('ru-RU');
  const pct = v => String(v).replace('.', ',') + ' %';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mskDay(offsetDays) {
    return new Date(Date.now() + MSK_MS + (offsetDays || 0) * 864e5).toISOString().slice(0, 10);
  }
  // FNV-1a → детерминированный генератор (mulberry32) от строки.
  function seedRng(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Слаг адреса героя: карта js/app.js (slugForHero) — у Vengeful Spirit адрес не совпадает с name.
  const heroSlug = h => (typeof window.slugForHero === 'function' ? window.slugForHero(h) : '') || String(h.name || '').replace('npc_dota_hero_', '');
  function goal(name) {
    try { if (typeof window.ym === 'function') window.ym(112755250, 'reachGoal', name); } catch (_) {}
  }
  function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); return true; } catch (_) { return false; }
  }
  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
    return r.json();
  }

  const today = mskDay(0);
  const POS = { 1: 'Керри', 2: 'Мид', 3: 'Оффлейн', 4: 'Поддержка', 5: 'Полная поддержка' };

  function renderHero(heroes, stats, counters) {
    const byId = new Map(heroes.map(h => [Number(h.id), h]));
    const st = new Map(stats.heroes.map(h => [Number(h.id), h]));
    const ids = heroes.map(h => Number(h.id)).filter(id => st.has(id)).sort((a, b) => a - b);
    if (!ids.length) throw new Error('нет героев со статистикой');
    const rng = seedRng('hero:' + today);
    const id = ids[Math.floor(rng() * ids.length)];
    const h = byId.get(id), s = st.get(id);
    const slug = heroSlug(h);
    const href = '/hero/' + slug + '/';

    $('.hd-img').innerHTML = `<img src="/assets/heroes/${esc(slug)}.webp" alt="${esc(h.localized_name)}" width="128" height="72" decoding="async">`;
    $('.hd-name').textContent = h.localized_name;
    $('.hd-name').href = href;
    const pos = (Array.isArray(s.ro) ? s.ro.slice().sort((x, y) => y[1] - x[1]) : [])[0] || null;
    $('.hd-stats').innerHTML = [
      ['Винрейт', pct(s.wr)],
      ['Матчей', nf.format(s.n)],
      ['Пикрейт', pct(s.pr)],
      ['Позиция', pos ? `${POS[pos[0]] || pos[0]} · ${pct(pos[1])}` : '—'],
    ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');

    const c = counters.heroes && counters.heroes[id];
    const mu = (arr, sign) => (arr || []).slice(0, 3).map(x => {
      const o = byId.get(Number(x.id)); if (!o) return '';
      const os = heroSlug(o);
      return `<a href="/hero/${esc(os)}/" title="${esc(o.localized_name)}: ${sign}${Math.abs(x.d).toString().replace('.', ',')} п.п. по ${nf.format(x.g)} матчам"><img src="/assets/heroes/${esc(os)}.webp" alt="${esc(o.localized_name)}" width="40" height="23" loading="lazy" decoding="async"></a>`;
    }).join('');
    $('.hd-good').innerHTML = mu(c && c.good, '+') || '<span>—</span>';
    $('.hd-bad').innerHTML = mu(c && c.against, '−') || '<span>—</span>';

    $('.hd-go-hero').href = href;
    $('.hd-go-guide').href = href + 'guide/';
    $('.hd-go-counters').href = href + '#matchups';
    const b = stats.base || {};
    $('.hd-src').textContent = `${nf.format(b.matches || 0)} рейтинговых матчей${b.src === 'steam' ? ' всех рангов' : ''}${b.patch ? ', патч ' + b.patch : ''}`;
  }

  function buildQuestion(itemsDoc) {
    const items = itemsDoc.items || {};
    const pool = Object.keys(items).sort().filter(k => items[k].cat === 'item' && items[k].cost > 0);
    const rng = seedRng('quiz:' + today);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const withComp = pool.filter(k => (items[k].comp || []).length >= 2 && items[k].comp.every(c => items[c]));
    const type = rng() < 0.5 && withComp.length >= 4 ? 'comp' : 'cost';
    if (type === 'comp') {
      const key = pick(withComp), it = items[key];
      const compCost = it.comp.reduce((sum, c) => sum + (items[c].cost || 0), 0);
      const parts = it.comp.map(c => items[c].dname).join(' + ') + (compCost < it.cost ? ' + рецепт' : '');
      const opts = new Set([key]);
      while (opts.size < 4) opts.add(pick(withComp));
      return { key, text: `Какой предмет собирается из: ${parts}?`, options: shuffle([...opts], rng).map(k => ({ v: k, label: items[k].dname, img: items[k].img })), answer: key, explain: `${it.dname} — ${nf.format(it.cost)} золота.` };
    }
    const key = pick(pool), it = items[key];
    const costs = new Set([it.cost]);
    const others = [...new Set(pool.map(k => items[k].cost))].filter(v => v !== it.cost).sort((a, b) => Math.abs(a - it.cost) - Math.abs(b - it.cost)).slice(0, 8);
    while (costs.size < 4 && others.length) costs.add(others.splice(Math.floor(rng() * others.length), 1)[0]);
    return { key, text: `Сколько золота стоит ${it.dname}?`, img: it.img, options: shuffle([...costs], rng).map(v => ({ v: String(v), label: nf.format(v) })), answer: String(it.cost), explain: `${it.dname} стоит ${nf.format(it.cost)} золота.` };
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function renderQuiz(q) {
    const state = load() || {};
    $('.hq-text').textContent = q.text;
    const box = $('.hq-opts');
    box.innerHTML = q.options.map(o => `<button type="button" class="hq-opt" data-v="${esc(o.v)}">${o.img ? `<img src="${esc(o.img)}" alt="" width="33" height="24" loading="lazy" decoding="async">` : ''}<span>${esc(o.label)}</span></button>`).join('');
    const finish = (chosen, fresh) => {
      $('.hq-card').classList.add('is-answered');
      box.querySelectorAll('.hq-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.v === q.answer) b.classList.add('is-right');
        else if (b.dataset.v === chosen) b.classList.add('is-wrong');
      });
      const ok = chosen === q.answer;
      $('.hq-result').textContent = (ok ? 'Верно! ' : 'Не угадал. ') + q.explain + (fresh ? '' : ' Новый вопрос — завтра.');
      $('.hq-item').href = '/item/' + q.key + '/';
      $('.hq-item').classList.add('is-on');
    };
    showStreak(state);
    if (state.d === today && state.q === q.key && state.a != null) finish(state.a, false);
    box.addEventListener('click', e => {
      const b = e.target.closest('.hq-opt');
      if (!b || b.disabled) return;
      const s = load() || {};
      if (s.d !== today) {
        s.streak = s.last === mskDay(-1) ? (Number(s.streak) || 0) + 1 : 1;
        s.last = today;
      }
      s.d = today; s.q = q.key; s.a = b.dataset.v;
      const kept = save(s);
      finish(b.dataset.v, true);
      showStreak(kept ? s : null);
      goal(GOAL_ANSWER);
    });
  }
  function showStreak(s) {
    const el = $('.hq-streak');
    const alive = s && (s.last === today || s.last === mskDay(-1)) ? Number(s.streak) || 0 : 0;
    el.textContent = alive ? `Серия: ${alive} ${plural(alive, 'день', 'дня', 'дней')} подряд` : 'Серия: отвечай каждый день';
  }
  function plural(n, a, b, c) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
  }

  root.addEventListener('click', e => { if (e.target.closest('a')) goal(GOAL_CLICK); });

  Promise.all([getJson('/data/heroes.json'), getJson('/data/stats.json'), getJson('/data/hero-counters.json')])
    .then(([h, s, c]) => renderHero(h.heroes || h, s, c))
    .then(() => root.classList.add('hd-ready'))
    .catch(err => { console.warn('Герой дня:', err.message); $('.hd-card').classList.add('hd-failed'); $('.hd-name').textContent = 'Данные не загрузились'; });
  getJson('/data/items-ru.json')
    .then(d => renderQuiz(buildQuestion(d)))
    .catch(err => { console.warn('Вопрос дня:', err.message); $('.hq-card').classList.add('hd-failed'); $('.hq-text').textContent = 'Данные не загрузились'; });
})();
