'use strict';
const fs = require('fs');
const path = require('path');
const { navHtml } = require('./site-nav');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = ['Керри', 'Мид', 'Оффлейн', 'Саппорт 4', 'Саппорт 5'];
const origin = 'https://dotamate.ru/tier-list/';

function renderTierPages(data, heroes, shell = fs.readFileSync(path.join(__dirname, '..', 'page-shell.html'), 'utf8')) {
  if (data.schemaVersion !== 1 || !data.positions || !data.meta || !['ok', 'insufficient', 'unavailable'].includes(data.status)) throw new Error('Invalid role metadata');
  const byId = new Map(heroes.map(h => [Number(h.id), h]));
  const page = (title, desc, url, content) => shell.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => ({
    TITLE: esc(title), DESC: esc(desc), CANONICAL: url, PAGE_STYLES: '<link rel="stylesheet" href="/css/stats.css">',
    BODY_CLASS: '', NAV: navHtml('stats'), PATCH_CHIP: '', BREADCRUMBS: '', CONTENT: `<main class="container">${content}</main>`, PAGE_SCRIPTS: ''
  })[key] ?? '');
  const out = { urls: [] };
  const links = [];
  const date = data.meta.to && !Number.isNaN(Date.parse(data.meta.to)) ? new Date(data.meta.to).toLocaleDateString('ru-RU') : 'неизвестно';
  for (let p = 1; p <= 5; p++) {
    const q = data.positions[p];
    const title = `Тир-лист: позиция ${p} — ${names[p - 1]} | Dota Mate`;
    const desc = `Рейтинг героев Dota 2 на позиции ${p} по проверенной выборке реплеев Valve.`;
    const url = `${origin}position-${p}/`;
    const eligible = data.status === 'ok' && data.meta.coverage?.gatePassed && q && Array.isArray(q.heroes) && q.heroes.some(h => h.n >= 100);
    const rows = eligible ? q.heroes.map(h => {
      const hero = byId.get(h.id);
      if (!hero || !Number.isInteger(h.n) || h.n < 30) return '';
      const slug = String(hero.name || '').replace(/^npc_dota_hero_/, '');
      if (!/^[a-z0-9_]+$/.test(slug)) return '';
      return `<tr><td><a href="/hero/${slug}/">${esc(hero.localized_name || slug)}</a></td><td>${h.n}</td><td>${esc(h.wr)}%</td><td>${h.rating == null ? '—' : esc(h.rating)}</td><td>${esc(h.tier || 'Малая выборка')}</td></tr>`;
    }).filter(Boolean) : [];
    out[`position-${p}`] = page(title, desc, url, `<h1>Тир-лист: позиция ${p} — ${names[p - 1]}</h1><p>Рейтинговые реплеи Valve, патч ${esc(data.meta.patch)}, ${esc(data.meta.matches)} матчей. Данные по ${esc(date)}. Рейтинг — нижняя граница интервала Уилсона; от 100 игр на героя.</p><p><a href="/tier-list/">Все позиции</a></p>${rows.length ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Герой</th><th>Игр</th><th>Побед</th><th>Рейтинг</th><th>Тир</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p>Недостаточно проверенных данных для рейтинга этой позиции.</p>'}`);
    if (rows.length) { out.urls.push({ loc: url }); links.push(`<li><a href="/tier-list/position-${p}/">Позиция ${p} — ${names[p - 1]}</a></li>`); }
  }
  const exportReady = data.meta.coverage?.gridClientVerified === true && [1, 2, 3, 4, 5].every(p => data.positions[p]?.heroes?.some(h => h.n >= 100));
  const exportControl = exportReady ? '<a href="/data/hero_grid_config.json" download="hero_grid_config.json">Скачать сетку героев для Dota 2</a>' : '<button type="button" disabled>Скачать сетку героев</button><p>Экспорт появится после проверки данных и импорта в клиент Dota 2.</p>';
  out.index = page('Тир-лист героев по позициям | Dota Mate', 'Рейтинг героев по позициям 1–5 на основе проверенных реплеев Valve.', origin,
    `<h1>Тир-лист героев по позициям</h1><p>Рейтинговые реплеи Valve. Данные по ${esc(date)}.</p>${links.length ? `<ul>${links.join('')}</ul>` : '<p>Недостаточно проверенных данных для рейтинга позиций.</p>'}<section><h2>Сетка героев для Dota 2</h2>${exportControl}<p>Перед установкой сохраните копию своего файла сеток, закройте Dota 2 и вручную объедините configs, если хотите сохранить прежние сетки. Путь: Steam/userdata/&lt;account&gt;/570/remote/cfg/. После запуска проверьте результат и синхронизацию Steam Cloud.</p></section>`);
  if (links.length) out.urls.unshift({ loc: origin });
  return out;
}
module.exports = { renderTierPages };
