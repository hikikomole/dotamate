(() => {
  'use strict';
  const root = document.getElementById('streams-results');
  if (!root) return;
  const status = document.getElementById('streams-status');
  const language = document.getElementById('streams-language');
  const buttons = [...document.querySelectorAll('.streams-chip[data-filter]')];
  let streams = [], filter = 'all', curated = false, selectedLanguage = null;
  try { selectedLanguage = localStorage.getItem('streams-language'); } catch (_) { /* Storage may be unavailable. */ }
  const langCode = stream => typeof stream.lang === 'string' && stream.lang.trim() ? stream.lang.trim().toLowerCase() : 'other';
  const displayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames('ru', { type: 'language' }) : null;
  const languageName = code => {
    if (code === 'other') return 'Другие';
    let name;
    try { name = displayNames?.of(code); } catch (_) { /* Invalid language code. */ }
    name = name && name.toLowerCase() !== code ? name : code.toUpperCase();
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const imageUrl = value => typeof value === 'string' && /^https:\/\/(images\.kick\.com|files\.kick\.com|static-cdn\.jtvnw\.net)\//.test(value) ? value : '';
  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const platform = stream => stream.platform === 'kick' ? 'kick' : 'twitch';
  function card(stream) {
    const kick = platform(stream) === 'kick';
    const handle = kick ? stream.slug : stream.login;
    if (!(kick ? /^[a-z0-9_-]{1,40}$/i : /^[a-z0-9_]{1,25}$/i).test(handle || '')) return null;
    const item = el('li', 'streams-item');
    const link = el('a', 'streams-card' + (!kick && curated && stream.live === false ? ' is-offline' : ''));
    link.href = kick ? `https://kick.com/${handle}` : `https://www.twitch.tv/${handle}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    const media = el('div', 'streams-media');
    const thumb = imageUrl(stream.thumb);
    if (thumb && (kick || !curated || stream.live === true)) {
      const img = el('img');
      img.src = thumb; img.alt = ''; img.loading = 'lazy'; img.width = 440; img.height = 248;
      media.append(img);
    }
    media.append(el('span', `streams-platform is-${platform(stream)}`, kick ? 'Kick' : 'Twitch'));
    if (kick || !curated || stream.live === true) media.append(el('span', 'streams-live', 'LIVE'));
    if (!kick && curated && stream.live === false) media.append(el('span', 'streams-offline', 'Не в сети'));
    if (Number(stream.viewers) > 0) media.append(el('span', 'streams-viewers', `${Number(stream.viewers).toLocaleString('ru-RU')} зрителей`));
    const details = el('div', 'streams-details');
    details.append(el('strong', 'streams-title', String(stream.title || (!kick && curated ? 'Канал Dota 2' : 'Dota 2'))));
    const byline = el('div', 'streams-byline');
    const avatar = imageUrl(stream.avatar);
    if (avatar) {
      const img = el('img', 'streams-avatar');
      img.src = avatar; img.alt = ''; img.loading = 'lazy'; img.width = 32; img.height = 32;
      byline.append(img);
    }
    byline.append(el('span', 'streams-name', String(stream.name || handle)), el('span', 'streams-lang', String(stream.lang || '').toUpperCase()));
    details.append(byline); link.append(media, details); item.append(link);
    return item;
  }
  function render() {
    root.replaceChildren();
    const shown = streams.filter(s => (language.value === 'all' || langCode(s) === language.value) && (filter === 'all' || platform(s) === filter));
    if (!shown.length) { status.textContent = 'Сейчас нет подходящих стримов Dota 2'; return; }
    status.textContent = '';
    for (const provider of ['kick', 'twitch']) {
      const group = shown.filter(s => platform(s) === provider).sort((a, b) =>
        (provider === 'twitch' && curated ? Number(b.live === true) - Number(a.live === true) : 0) ||
        Number(b.viewers || 0) - Number(a.viewers || 0));
      if (!group.length) continue;
      const section = el('section', 'streams-group');
      section.append(el('h2', '', provider === 'kick' ? 'Kick' : 'Twitch'));
      const list = el('ul', 'streams-grid');
      for (const stream of group) { const node = card(stream); if (node) list.append(node); }
      section.append(list); root.append(section);
    }
  }
  function updateLanguages() {
    const available = streams.filter(s => filter === 'all' || platform(s) === filter);
    const counts = new Map();
    for (const stream of available) counts.set(langCode(stream), (counts.get(langCode(stream)) || 0) + 1);
    const codes = [...counts.keys()].sort((a, b) => Number(b === 'ru') - Number(a === 'ru') || counts.get(b) - counts.get(a) || languageName(a).localeCompare(languageName(b), 'ru'));
    const preferred = selectedLanguage === null ? (counts.has('ru') ? 'ru' : 'all') : selectedLanguage;
    language.replaceChildren(new Option(`Все языки (${available.length})`, 'all'));
    for (const code of codes) language.add(new Option(`${languageName(code)} (${counts.get(code)})`, code));
    language.value = counts.has(preferred) ? preferred : preferred === 'all' ? 'all' : counts.has('ru') ? 'ru' : 'all';
  }
  async function load() {
    status.textContent = '';
    try {
      const response = await fetch('/api/streams', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP');
      const data = await response.json();
      if (!data.ok) throw new Error('API');
      curated = (data.providers?.twitch?.mode || data.mode) === 'curated';
      streams = (Array.isArray(data.streams) ? data.streams : []).filter(s => s && (platform(s) === 'kick'
        ? /^[a-z0-9_-]{1,40}$/i.test(s.slug || '') : /^[a-z0-9_]{1,25}$/i.test(s.login || '')));
      updateLanguages();
      render();
    } catch (_) {
      if (streams.length) return;
      root.replaceChildren();
      status.replaceChildren(document.createTextNode('Не удалось загрузить стримы. '));
      const retry = el('button', 'streams-chip', 'Повторить');
      retry.type = 'button'; retry.addEventListener('click', load); status.append(retry);
    }
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    buttons.forEach(chip => { const active = chip === button; chip.classList.toggle('is-active', active); chip.setAttribute('aria-pressed', String(active)); });
    updateLanguages();
    render();
  }));
  language.addEventListener('change', () => {
    selectedLanguage = language.value;
    try { localStorage.setItem('streams-language', selectedLanguage); } catch (_) { /* Storage may be unavailable. */ }
    render();
  });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 120000);
})();
