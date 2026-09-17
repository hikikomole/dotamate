// Regenerates sitemap.xml (and deploy/sitemap.xml) by merging every *-urls.json
// manifest produced by the static-page generators, plus the homepage.
const fs = require('fs');

const today = new Date().toISOString().slice(0, 10);

function readUrls(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const guideUrls = readUrls('guide-urls.json');       // 10 long-form articles
const roleGuideUrls = readUrls('role-guide-urls.json'); // 7 role/comparison guides
const heroUrls = readUrls('hero-urls.json');         // 127 heroes
const itemUrls = readUrls('item-urls.json');         // 400 items
const privacyUrls = readUrls('privacy-urls.json');   // privacy policy
const glossaryUrls = readUrls('glossary-urls.json'); // terms glossary

const entries = [];
entries.push({ loc: 'https://dotamate.ru/', changefreq: 'daily', priority: '1.0' });

for (const g of [...guideUrls, ...roleGuideUrls, ...privacyUrls, ...glossaryUrls]) {
  entries.push({ loc: g.loc, lastmod: today, changefreq: 'monthly', priority: '0.8' });
}
for (const h of heroUrls) {
  entries.push({ loc: h.loc, lastmod: today, changefreq: 'weekly', priority: '0.7' });
}
for (const it of itemUrls) {
  entries.push({ loc: it.loc, lastmod: today, changefreq: 'weekly', priority: '0.6' });
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries.map(e => {
    const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : '';
    return `  <url><loc>${e.loc}</loc>${lastmod}<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`;
  }).join('\n') +
  `\n</urlset>\n`;

fs.writeFileSync('sitemap.xml', xml);
fs.writeFileSync('deploy/sitemap.xml', xml);
console.log('sitemap.xml written with', entries.length, 'URLs');
