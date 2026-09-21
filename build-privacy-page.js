#!/usr/bin/env node
// Generates the site's privacy policy at deploy/privacy/index.html.
// Hand-written content (no external API data needed), reusing the same
// page shell markup/CSS as the other generated guide pages.

const fs = require('fs');
const path = require('path');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->\n<!-- Yandex.Metrika counter --><script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><noscript><div><img src="https://mc.yandex.ru/watch/112755250" style="position:absolute; left:-9999px;" alt="" /></div></noscript><!-- /Yandex.Metrika counter -->`;

const title = 'Политика конфиденциальности | Dota Mate';
const desc = 'Какие данные собирает Dota Mate, как используется локальное хранилище браузера, веб-аналитика и что изменится, если на сайте появится реклама.';
const canonical = 'https://dotamate.ru/privacy/';
const updated = new Date().toISOString().slice(0,10);

const ldjson = JSON.stringify({
  "@context":"https://schema.org","@type":"WebPage","name":title,
  "description":desc,"url":canonical
});
const breadcrumb = JSON.stringify({
  "@context":"https://schema.org","@type":"BreadcrumbList",
  "itemListElement":[
    {"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},
    {"@type":"ListItem","position":2,"name":"Политика конфиденциальности","item":canonical}
  ]
});

const bodyHtml = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / Политика конфиденциальности</nav>
<div class="eyebrow">LEGAL</div>
<h1 style="margin:6px 0 8px;">Политика конфиденциальности</h1>
<p style="font-size:13px;opacity:.6;margin:0 0 26px;">Обновлено: ${updated}</p>

<section class="detail-section">
<h2>О проекте</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">Dota Mate (dotamate.ru) — неофициальный фанатский проект, посвящённый Dota 2. Мы не связаны с Valve Corporation. Названия, изображения героев и предметов принадлежат их правообладателям и используются в справочных целях.</p>
</section>

<section class="detail-section">
<h2>Какие данные мы собираем</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 10px;"><b>Локальное хранилище браузера.</b> Избранные герои, сохранённые билды и настройки интерфейса хранятся прямо в вашем браузере (localStorage) и никуда не отправляются. Вы можете очистить эти данные в любой момент через настройки браузера или кнопку «Сбросить локальные данные» в профиле.</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;"><b>Веб-аналитика.</b> Для понимания посещаемости страниц мы используем Cloudflare Web Analytics — она не использует cookies, не отслеживает пользователей между сайтами и не собирает данные, по которым можно установить личность посетителя. Это агрегированная статистика: сколько человек открыли страницу, откуда пришли, с какого устройства.</p>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;"><b>Яндекс.Метрика.</b> Мы также используем Яндекс.Метрику для анализа посещаемости и поведения на сайте, включая Вебвизор — запись действий посетителей (движения мыши, клики, скролл) для улучшения удобства сайта. Эти данные обрабатывает Яндекс в соответствии со своей политикой конфиденциальности. Вы можете ограничить сбор данных Яндекс.Метрикой через настройки cookies в браузере.</p>
</section>

<section class="detail-section">
<h2>Cookies</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">Сайт показывает рекламу через Рекламную сеть Яндекса (РСЯ). Для показа релевантных объявлений Яндекс может использовать cookies и похожие технологии на вашем устройстве — это стандартная практика контекстной рекламы, и мы не видим и не храним эти данные сами. Вы можете управлять учётом интересов при показе рекламы Яндекса на странице <a href="https://yandex.ru/tune/adv" target="_blank" rel="noopener">yandex.ru/tune/adv</a>, а также отключить cookies в настройках браузера.</p>
</section>

<section class="detail-section">
<h2>Реклама и партнёрские ссылки</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">На отдельных страницах сайта показывается реклама через Рекламную сеть Яндекса (РСЯ) — блоки явно помечены подписью «Реклама». Яндекс может использовать обезличенные данные об устройстве и cookies, чтобы показывать более релевантные объявления; подробнее — в <a href="https://yandex.ru/legal/confidential/" target="_blank" rel="noopener">политике конфиденциальности Яндекса</a>. Партнёрских (affiliate) ссылок на сайте пока нет. Если они появятся, мы заранее обновим этот раздел и явно пометим такие ссылки.</p>
</section>

<section class="detail-section">
<h2>Передача данных третьим лицам</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">Мы не продаём и не передаём личные данные пользователей третьим лицам, за исключением сервисов, необходимых для работы сайта (например, хостинг), и случаев, предусмотренных законом.</p>
</section>

<section class="detail-section">
<h2>Ваши права</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">Вы можете в любой момент очистить локальные данные браузера. Если у вас есть аккаунт и вы хотите удалить его или узнать, какие данные о вас хранятся, свяжитесь с администрацией проекта.</p>
</section>

<section class="detail-section">
<h2>Изменения политики</h2>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">Мы можем время от времени обновлять эту страницу — например, при добавлении рекламы или новых функций. Дата последнего обновления указана в начале страницы.</p>
</section>
`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" href="/assets/dotamate-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="https://dotamate.ru/assets/dotamate-og.jpg">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<script type="application/ld+json">${ldjson}</script>
<script type="application/ld+json">${breadcrumb}</script>
${analyticsSnippet}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><img class="brand-logo" src="/assets/dotamate-logo.png" alt="Dota Mate" width="621" height="120"></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/game/">Игра</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:820px;">
${bodyHtml}
</main>
<footer><div class="container">Dota Mate · неофициальный проект · <a href="/privacy/" style="color:inherit;">Конфиденциальность</a></div></footer>
</body>
</html>
`;

const dir = path.join('deploy','privacy');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'index.html'), html, 'utf8');
fs.writeFileSync('privacy-urls.json', JSON.stringify([{loc:canonical,name:'Политика конфиденциальности'}],null,1));
console.log('Generated privacy policy page.');
