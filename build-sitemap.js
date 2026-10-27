// Regenerates sitemap.xml (and deploy/sitemap.xml) by merging every *-urls.json
// manifest produced by the static-page generators, plus the homepage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const today = new Date().toISOString().slice(0, 10);

// lastmod — дата, когда содержимое страницы в deploy/ последний раз изменилось (а не дата сборки у всех
// 750 адресов, как было до 15.10.2026: такой lastmod поисковики игнорируют). Отпечаток страницы хранится
// в data/sitemap-state/lastmod.json (data/ — серверная, push-server её не трогает; на сайт папка не идёт —
// SKIP_DIRS в tools/sync-deploy.js). Метка версии сайта (?v=, meta dotamate-version) в отпечаток не входит.
const STATE = path.join('data', 'sitemap-state', 'lastmod.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch { state = {}; }
const nextState = {};
function lastmodOf(loc) {
  const rel = loc.replace(/^https:\/\/dotamate\.ru\//, '');
  const file = path.join('deploy', rel, rel.endsWith('.html') ? '' : 'index.html');
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch { return today; }
  const norm = html.replace(/\?v=\d+/g, '').replace(/<meta name="dotamate-version"[^>]*>/g, '');
  const h = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
  const prev = state[loc];
  const d = prev && prev.h === h && /^\d{4}-\d{2}-\d{2}$/.test(prev.d) ? prev.d : today;
  nextState[loc] = { h, d };
  return d;
}

function readUrls(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const guideUrls = readUrls('guide-urls.json');       // 10 long-form articles
const roleGuideUrls = readUrls('role-guide-urls.json'); // 7 role/comparison guides
const heroUrls = readUrls('hero-urls.json');         // 127 heroes
const itemUrls = readUrls('item-urls.json');         // 400 items
const heroGuideUrls = readUrls('hero-guide-urls.json'); // 127 гайдов по героям
const privacyUrls = readUrls('privacy-urls.json');   // privacy policy
const glossaryUrls = readUrls('glossary-urls.json'); // terms glossary
const tierUrls = readUrls('tier-urls.json');
const pageUrls = readUrls('page-urls.json');         // разделы сайта: главная, герои, предметы…

const entries = [];
// Главная и страницы разделов идут первыми: это точки входа в каталоги.
for (const p of pageUrls) {
  const isHome = p.loc === 'https://dotamate.ru/';
  entries.push({ loc: p.loc, lastmod: lastmodOf(p.loc), changefreq: 'daily', priority: isHome ? '1.0' : '0.9' });
}
if (!pageUrls.length) entries.push({ loc: 'https://dotamate.ru/', changefreq: 'daily', priority: '1.0' });

for (const g of [...guideUrls, ...roleGuideUrls, ...privacyUrls, ...glossaryUrls, ...tierUrls]) {
  entries.push({ loc: g.loc, lastmod: lastmodOf(g.loc), changefreq: 'monthly', priority: '0.8' });
}
for (const h of heroUrls) {
  entries.push({ loc: h.loc, lastmod: lastmodOf(h.loc), changefreq: 'weekly', priority: '0.7' });
}
for (const hg of heroGuideUrls) {
  entries.push({ loc: hg.loc, lastmod: lastmodOf(hg.loc), changefreq: 'weekly', priority: '0.7' });
}
for (const it of itemUrls) {
  entries.push({ loc: it.loc, lastmod: lastmodOf(it.loc), changefreq: 'weekly', priority: '0.6' });
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries.map(e => {
    const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : '';
    return `  <url><loc>${e.loc}</loc>${lastmod}<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`;
  }).join('\n') +
  `\n</urlset>\n`;

fs.writeFileSync('sitemap.xml', xml);
fs.writeFileSync('deploy/sitemap.xml', xml);
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE + '.tmp', JSON.stringify(nextState));
fs.renameSync(STATE + '.tmp', STATE);
console.log('sitemap.xml written with', entries.length, 'URLs; изменились сегодня:', entries.filter(e => e.lastmod === today).length);
