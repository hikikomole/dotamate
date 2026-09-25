#!/usr/bin/env node
// Generates deploy/privacy/index.html (policy, 152-FZ) and deploy/privacy/consent/index.html (separate consent text, art. 9 152-FZ).
// Hand-written content (no external API data needed), reusing the same
// page shell markup/CSS as the other generated guide pages.

const fs = require('fs');
const path = require('path');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

const analyticsSnippet=`<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "379dbb7942a7403688647b232a7e84b6"}'></script><!-- End Cloudflare Web Analytics -->\n<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->`;

const UPDATED = '2026-09-25';
const OPERATOR = 'Белов Алексей Александрович';
const P = 'style="line-height:1.7;color:#c7cbd4;margin:0 0 12px;"';
const UL = 'style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;padding-left:20px;"';
const TD = 'style="padding:8px 10px;border-top:1px solid rgba(255,255,255,.08);vertical-align:top;"';
const TH = 'style="padding:8px 10px;text-align:left;opacity:.75;font-weight:600;"';
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const form = `<a href="/contact/">форму обратной связи</a>`;
const sec = (id, h, body) => `<section class="detail-section" id="${id}">\n<h2>${h}</h2>\n${body}\n</section>`;
const table = (head, rows) => `<div style="overflow-x:auto;margin:0 0 14px;"><table style="width:100%;border-collapse:collapse;font-size:14px;color:#c7cbd4;"><thead><tr>${head.map(h=>`<th ${TH}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td ${TD}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const policyBody = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / Политика конфиденциальности</nav>
<div class="eyebrow">LEGAL</div>
<h1 style="margin:6px 0 8px;">Политика конфиденциальности</h1>
<p style="font-size:13px;opacity:.6;margin:0 0 26px;">Редакция от ${UPDATED}. Политика обработки персональных данных сайта dotamate.ru</p>

${sec('general','1. Общие положения',`
<p ${P}>1.1. Настоящая политика определяет, какие данные обрабатываются при использовании сайта <b>dotamate.ru</b> (далее — «Сайт»), зачем, на каком основании, кому они передаются и как посетитель может управлять ими. Политика составлена в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» и Федеральным законом от 27.07.2006 № 149-ФЗ «Об информации, информационных технологиях и о защите информации».</p>
<p ${P}>1.2. Автор и владелец проекта — <b>Hikikomole</b>. Оператор персональных данных — ${OPERATOR} (далее — «Оператор», «мы»). Обращения по любым вопросам, в том числе по персональным данным, принимаются через ${form}.</p>
<p ${P}>1.3. Сайт — неофициальный информационный фанатский проект о компьютерной игре Dota 2. На Сайте нет регистрации, личных кабинетов, форм сбора контактов и приёма платежей. Мы не просим вас сообщать имя, телефон, адрес электронной почты или иные сведения о себе.</p>
<p ${P}>1.4. Открывая любую страницу Сайта и продолжая им пользоваться, вы подтверждаете, что вам исполнилось 18 лет, что вы ознакомились с настоящей политикой и принимаете её, в том числе обработку сведений о посещениях сервисом Яндекс.Метрика (раздел 5). Рекламные cookies включаются только после кнопки «Принять» в уведомлении о cookies. Если вы не согласны с политикой, прекратите использование Сайта или отключите статистику по ссылке «Отключить cookies» внизу любой страницы — все материалы Сайта останутся доступны.</p>
<p ${P}>1.5. Политика опубликована в открытом доступе по адресу <a href="/privacy/">dotamate.ru/privacy/</a> в соответствии с ч. 2 ст. 18.1 Закона № 152-ФЗ.</p>`)}

${sec('data','2. Какие данные обрабатываются',`
<p ${P}><b>2.1. Технические данные запроса.</b> При открытии любой страницы браузер, как на любом сайте, передаёт серверу IP-адрес, сведения о браузере и устройстве (User-Agent), адрес запрошенной страницы, адрес страницы-источника (referrer), дату и время запроса. Эти данные обрабатывает хостинг-провайдер Сайта для доставки страниц, защиты от атак и технических журналов.</p>
<p ${P}><b>2.2. Данные Яндекс.Метрики (только с согласия).</b> Идентификаторы cookies, IP-адрес, сведения о браузере, устройстве, разрешении экрана, языке, регионе, источнике перехода, просмотренных страницах, времени на сайте; при включённом Вебвизоре — запись действий на странице: перемещения и клики мыши, прокрутка, переходы по ссылкам. На Сайте нет полей ввода личных данных, поэтому их содержимое Вебвизор не получает.</p>
<p ${P}><b>2.3. Данные Рекламной сети Яндекса (только с согласия).</b> Cookies и иные идентификаторы устройства, IP-адрес, сведения о браузере и о показах и кликах по рекламным блокам — для подбора и показа объявлений и учёта показов.</p>
<p ${P}><b>2.4. Данные в хранилище вашего браузера (localStorage).</b> Сайт хранит на вашем устройстве служебные записи, которые <b>не передаются</b> ни нам, ни третьим лицам:</p>
${table(['Ключ','Назначение','Срок'],[
 ['<code>dmConsent</code>','Ваш выбор в настройках cookies и дата выбора','До изменения выбора или очистки браузера'],
 ['<code>d2h_cache_*</code>','Кэш игровых справочников и статистики, чтобы страницы грузились быстрее','До обновления данных или очистки браузера'],
 ['<code>dgBest.v1</code>','Ваш лучший результат в мини-игре','До очистки браузера'],
 ['<code>d2hHomeBg</code>','Выбранный фон главной страницы','До очистки браузера']])}
<p ${P}><b>2.5. Форма обратной связи.</b> Если вы отправите обращение через ${form}, мы получим выбранную тему, текст сообщения, а также имя и контакт для ответа — если вы их укажете (оба поля необязательны). Для защиты от спама сохраняется необратимый хеш IP-адреса (SHA-256), который удаляется через 30 дней.</p>
<p ${P}><b>2.6. Чего мы не обрабатываем.</b> Мы не собираем специальные категории персональных данных (о здоровье, убеждениях и т. п.), биометрические данные, паспортные и платёжные данные. Мы не пытаемся установить личность посетителя и не сопоставляем данные аналитики с какими-либо иными сведениями о нём.</p>`)}

${sec('purposes','3. Цели, правовые основания и сроки',table(['Цель','Данные','Основание','Срок'],[
 ['Доставка страниц Сайта, его работоспособность и защита от атак','Технические данные запроса (п. 2.1)','Законный интерес Оператора в работе Сайта — п. 7 ч. 1 ст. 6 Закона № 152-ФЗ','В пределах сроков хранения журналов хостинг-провайдера'],
 ['Статистика посещаемости и улучшение удобства Сайта','Данные Яндекс.Метрики (п. 2.2)','Согласие — п. 1 ч. 1 ст. 6, ст. 9 Закона № 152-ФЗ','До отзыва согласия; хранение на стороне Яндекса — по правилам Яндекса'],
 ['Показ рекламы, за счёт которой существует Сайт','Данные РСЯ (п. 2.3)','Согласие — п. 1 ч. 1 ст. 6, ст. 9 Закона № 152-ФЗ','До отзыва согласия; хранение на стороне Яндекса — по правилам Яндекса'],
 ['Ответ на ваши обращения и защита формы от спама','Данные формы (п. 2.5)','Согласие — п. 1 ч. 1 ст. 6, ст. 9 Закона № 152-ФЗ (<a href="/privacy/consent-feedback/">текст согласия</a>); для запросов субъекта — также ст. 14, 20','Обращение — не более 1 года после ответа; хеш IP — 30 дней']])+
`<p ${P}>Общедоступная обезличенная статистика: Cloudflare Web Analytics (без cookies, без идентификации посетителей) даёт нам только суммарные показатели — число просмотров страниц, страны, типы устройств.</p>
<p ${P}>По достижении целей или при отзыве согласия данные уничтожаются или обезличиваются в сроки, установленные ст. 21 Закона № 152-ФЗ.</p>`)}

${sec('third','4. Кому передаются данные',`
<p ${P}>Мы не продаём и не сдаём в аренду данные посетителей. Данные передаются только следующим сервисам, без которых Сайт не работает или которые включаются с вашего согласия:</p>
${table(['Получатель','Страна','Зачем','Что получает'],[
 ['ООО «ЯНДЕКС» — Яндекс.Метрика','Россия','Статистика посещений (только с согласия)','Данные п. 2.2 · '+ext('https://yandex.ru/legal/confidential/','политика Яндекса')],
 ['ООО «ЯНДЕКС» — Рекламная сеть Яндекса','Россия','Показ рекламы (только с согласия)','Данные п. 2.3 · '+ext('https://yandex.ru/legal/confidential/','политика Яндекса')],
 ['Cloudflare, Inc.','США','Хостинг, доставка страниц (CDN), защита от атак, обезличенная статистика Web Analytics, хранение обращений из формы (база данных D1)','Технические данные п. 2.1, данные формы п. 2.5 · '+ext('https://www.cloudflare.com/privacypolicy/','политика Cloudflare')],
 ['Google LLC — Google Fonts','США','Загрузка шрифтов оформления','IP-адрес и сведения о браузере при загрузке шрифта · '+ext('https://policies.google.com/privacy','политика Google')],
 ['Valve Corporation — сервер изображений Steam (cdn.steamstatic.com)','США','Загрузка официальных изображений и видео героев и предметов','IP-адрес и сведения о браузере при загрузке файла · '+ext('https://store.steampowered.com/privacy_agreement/','политика Valve')]])}
<p ${P}>4.2. <b>Трансграничная передача.</b> Сервисы Cloudflare, Google и Valve расположены в США. Передача им технических данных запроса происходит автоматически, когда ваш браузер загружает страницу, шрифт или изображение, и ограничена объёмом, необходимым для этой загрузки. Трансграничная передача осуществляется с соблюдением требований ст. 12 Закона № 152-ФЗ.</p>
<p ${P}>4.3. Данные могут быть предоставлены государственным органам только в случаях и в порядке, прямо предусмотренных законодательством Российской Федерации.</p>
<p ${P}>4.4. Внешние ссылки. Сайт содержит ссылки на сторонние ресурсы (например, OpenDota, Stratz, dota2.com, Steam). Переходя по ним, вы попадаете под правила этих ресурсов; мы не отвечаем за их содержание и обработку данных на них.</p>`)}

${sec('cookies','5. Cookies и как ими управлять',`
<p ${P}>5.1. Сам Сайт не устанавливает собственных cookies. Cookies устанавливают сервисы Яндекса. Счётчик Яндекс.Метрики загружается при открытии Сайта и перестаёт загружаться, если вы нажмёте «Отключить cookies» внизу любой страницы. Реклама загружается только после того, как вы нажмёте «Принять». Перечень cookies Метрики и сроки их действия опубликованы Яндексом: ${ext('https://yandex.ru/support/metrica/general/cookie-usage.html','cookies Яндекс.Метрики')}.</p>
<p ${P}>5.2. Отказаться от cookies или отозвать согласие можно в любой момент по ссылке <a href="#" data-consent-revoke>«Отключить cookies»</a> внизу любой страницы. При отзыве Сайт удаляет доступные ему cookies Яндекса на домене dotamate.ru и перестаёт загружать счётчик и рекламу.</p>
<p ${P}>5.3. Дополнительно: ${ext('https://yandex.ru/tune/adv','отключить учёт интересов в рекламе Яндекса')}, ${ext('https://yandex.ru/support/metrica/general/opt-out.html','блокировщик Яндекс.Метрики для браузера')}, а также запрет cookies и очистка данных сайта в настройках браузера.</p>
<p ${P}>5.4. Отказ от cookies статистики и рекламы не ограничивает доступ к материалам Сайта.</p>`)}

${sec('rights','6. Ваши права',`
<p ${P}>В соответствии со ст. 14–17 Закона № 152-ФЗ вы вправе:</p>
<ul ${UL}>
<li>получить сведения о том, обрабатываются ли ваши данные, какие, с какой целью и кому передаются;</li>
<li>потребовать уточнения, блокирования или уничтожения данных, если они неполные, устаревшие, неточные, незаконно полученные или не нужны для заявленной цели;</li>
<li>отозвать согласие на обработку — по ссылке «Отключить cookies» внизу страницы или через ${form};</li>
<li>обжаловать действия Оператора в Роскомнадзоре (${ext('https://rkn.gov.ru/','rkn.gov.ru')}) или в суде.</li>
</ul>
<p ${P}>Запрос направляется через ${form} с темой «Персональные данные»; укажите контакт для ответа. Мы отвечаем в течение 10 рабочих дней с даты получения запроса; срок может быть продлён не более чем на 5 рабочих дней с уведомлением о причинах (ч. 3 ст. 14, ч. 1 ст. 20 Закона № 152-ФЗ). Поскольку мы не знаем ваших имени и контактов, для поиска данных аналитики укажите в запросе, если возможно, идентификатор Метрики (значение cookie <code>_ym_uid</code>), дату и время посещения.</p>`)}

${sec('security','7. Защита данных',`
<p ${P}>Сайт работает только по защищённому протоколу HTTPS. Используются заголовки безопасности (Content-Security-Policy и др.), ограничивающие загрузку кода только перечисленными в этой политике сервисами. На серверах Сайта не ведётся база персональных данных посетителей. Доступ к аккаунтам хостинга и аналитики есть только у Оператора и защищён.</p>
<p ${P}>При обнаружении инцидента с персональными данными Оператор уведомляет Роскомнадзор в сроки, установленные ч. 3.1 ст. 21 Закона № 152-ФЗ.</p>`)}

${sec('children','8. Несовершеннолетние',`
<p ${P}>Сайт предназначен для пользователей, достигших 18 лет. Используя Сайт, вы подтверждаете, что достигли этого возраста. Сайт не запрашивает сведения о возрасте и не собирает намеренно данные о детях. Если вам нет 18 лет, решение об использовании Сайта и о cookies статистики и рекламы должны принимать ваши родители или законные представители.</p>`)}

${sec('legal','9. Правовая информация и ограничение ответственности',`
<p ${P}>9.1. Dota 2, Steam, названия, изображения и видео героев и предметов являются товарными знаками и объектами прав Valve Corporation. Сайт не связан с Valve Corporation, не одобрен и не спонсируется ею. Материалы Valve используются в информационных и справочных целях.</p>
<p ${P}>9.2. Статистика, винрейты, сборки и прогнозы рассчитываются по открытым данным (OpenDota, Stratz, Valve) и собственной выборке публичных матчей. Они носят справочный характер, предоставляются «как есть» и не гарантируют результата в игре. Методика и данные могут содержать неточности и меняться после обновлений игры.</p>
<p ${P}>9.3. Реклама на Сайте размещается через Рекламную сеть Яндекса и помечается словом «Реклама». Подбор объявлений, их содержание и маркировку обеспечивают Яндекс и рекламодатели; Оператор не является рекламодателем этих объявлений и не отвечает за товары и услуги, которые в них предлагаются.</p>
<p ${P}>9.4. Материалы Сайта не являются публичной офертой. Сайт не продаёт игровые предметы, аккаунты и услуги по повышению рейтинга.</p>`)}

${sec('changes','10. Изменения политики',`
<p ${P}>Оператор вправе изменять политику, в том числе при подключении новых сервисов. Новая редакция действует с момента публикации на этой странице; дата редакции указана вверху. Если изменение затрагивает цели обработки или состав данных, передаваемых с согласия, у посетителей будет повторно запрошено согласие.</p>
<p ${P}>Вопросы по политике — через ${form}.</p>`)}
`;

const consentBody = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/privacy/">Политика конфиденциальности</a> / Согласие</nav>
<div class="eyebrow">LEGAL</div>
<h1 style="margin:6px 0 8px;">Согласие на обработку персональных данных</h1>
<p style="font-size:13px;opacity:.6;margin:0 0 26px;">Редакция от ${UPDATED}.</p>
<section class="detail-section">
<p ${P}>Я, посетитель сайта dotamate.ru, свободно, своей волей и в своём интересе даю согласие <b>${OPERATOR}</b> (оператор; обращения — через <a href="/contact/">форму обратной связи</a>) на обработку моих персональных данных на следующих условиях (ст. 9 Федерального закона № 152-ФЗ «О персональных данных»).</p>
<p ${P}><b>1. Цели обработки:</b></p>
<ul ${UL}>
<li>анализ посещаемости и удобства сайта с помощью сервиса Яндекс.Метрика, включая Вебвизор;</li>
<li>показ рекламы на сайте через Рекламную сеть Яндекса и учёт её показов.</li>
</ul>
<p ${P}><b>2. Перечень данных:</b> идентификаторы cookies и иные идентификаторы устройства; IP-адрес; сведения о браузере, операционной системе, устройстве, разрешении экрана, языке и регионе; адреса просмотренных страниц и страницы-источника; дата, время и длительность посещения; действия на страницах (клики, перемещения мыши, прокрутка, переходы по ссылкам); сведения о показах рекламы и кликах по ней.</p>
<p ${P}><b>3. Действия с данными:</b> сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача (предоставление, доступ) лицу, указанному в п. 4, обезличивание, блокирование, удаление, уничтожение; с использованием средств автоматизации.</p>
<p ${P}><b>4. Лицо, которому поручена обработка / которому передаются данные:</b> ООО «ЯНДЕКС» (119021, г. Москва, ул. Льва Толстого, д. 16) — сервисы Яндекс.Метрика и Рекламная сеть Яндекса. Трансграничная передача по настоящему согласию не осуществляется.</p>
<p ${P}><b>5. Срок действия:</b> до отзыва согласия.</p>
<p ${P}><b>6. Отзыв:</b> в любой момент по ссылке «Отключить cookies» внизу любой страницы сайта или через <a href="/contact/">форму обратной связи</a>. После отзыва обработка прекращается, а данные уничтожаются в срок, установленный ч. 5 ст. 21 Закона № 152-ФЗ, если иное не предусмотрено законом.</p>
<p ${P}>Отказ от согласия не ограничивает доступ к материалам сайта. Подробные условия обработки — в <a href="/privacy/">Политике конфиденциальности</a>.</p>
<p ${P}><a href="#" data-consent-revoke>Отключить cookies</a></p>
</section>`;


const feedbackConsentBody = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / <a href="/privacy/">Политика конфиденциальности</a> / Согласие для формы</nav>
<div class="eyebrow">LEGAL</div>
<h1 style="margin:6px 0 8px;">Согласие на обработку персональных данных при обращении через форму</h1>
<p style="font-size:13px;opacity:.6;margin:0 0 26px;">Редакция от ${UPDATED}. Даётся отметкой в форме обратной связи перед отправкой</p>
<section class="detail-section">
<p ${P}>Я, отправляя обращение через форму обратной связи сайта dotamate.ru, свободно, своей волей и в своём интересе даю согласие <b>${OPERATOR}</b> (оператор) на обработку моих персональных данных на следующих условиях (ст. 9 Федерального закона № 152-ФЗ «О персональных данных»).</p>
<p ${P}><b>1. Цель:</b> рассмотрение обращения и ответ на него, в том числе на запросы о моих персональных данных; защита формы от спама.</p>
<p ${P}><b>2. Перечень данных:</b> тема и текст обращения; имя и контакт для ответа (адрес электронной почты, Telegram или иной) — если я их указал; хеш IP-адреса (SHA-256); дата и время отправки.</p>
<p ${P}><b>3. Действия с данными:</b> сбор, запись, хранение, использование, удаление, уничтожение; с использованием средств автоматизации.</p>
<p ${P}><b>4. Лицо, осуществляющее хранение по поручению оператора:</b> Cloudflare, Inc. (США) — хостинг сайта и база данных, в которой хранятся обращения. Хранение у Cloudflare является трансграничной передачей данных.</p>
<p ${P}><b>5. Срок действия:</b> до ответа на обращение и 1 год после него; хеш IP-адреса удаляется через 30 дней. Согласие может быть отозвано раньше.</p>
<p ${P}><b>6. Отзыв:</b> новым обращением через <a href="/contact/">форму обратной связи</a> с темой «Персональные данные». После отзыва обращение удаляется в срок, установленный ч. 5 ст. 21 Закона № 152-ФЗ.</p>
<p ${P}>Подробные условия — в <a href="/privacy/">Политике конфиденциальности</a>.</p>
</section>`;

const contactBody = `<nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;"><a href="/">Главная</a> / Обратная связь</nav>
<div class="eyebrow">CONTACT</div>
<h1 style="margin:6px 0 8px;">Обратная связь</h1>
<p style="line-height:1.7;color:#c7cbd4;margin:0 0 22px;">Ошибка в данных, идея, вопрос или запрос о персональных данных — напишите здесь. Если нужен ответ, оставьте контакт.</p>
<form class="fb-form" id="fbForm" novalidate>
<label class="fb-field"><span>Тема</span>
<select name="topic" required>
<option value="question">Вопрос или предложение</option>
<option value="bug">Ошибка на сайте или в данных</option>
<option value="personal_data">Персональные данные</option>
<option value="other">Другое</option>
</select></label>
<label class="fb-field"><span>Имя <small>— необязательно</small></span><input name="name" maxlength="100" autocomplete="name"></label>
<label class="fb-field"><span>Контакт для ответа <small>— email или Telegram, необязательно</small></span><input name="contact" maxlength="200" autocomplete="email"></label>
<label class="fb-field"><span>Сообщение</span><textarea name="message" rows="6" minlength="10" maxlength="4000" required></textarea></label>
<label class="fb-hp" aria-hidden="true">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>
<label class="fb-check"><input type="checkbox" name="consent" required> <span>Даю <a href="/privacy/consent-feedback/" target="_blank">согласие на обработку персональных данных</a></span></label>
<div class="fb-actions"><button type="submit" class="fb-submit">Отправить</button><span class="fb-status" id="fbStatus" role="status" aria-live="polite"></span></div>
</form>
<script src="/js/contact.js" defer></script>`;

function page({title, desc, canonical, body, crumbs, index}) {
  const ldjson = JSON.stringify({"@context":"https://schema.org","@type":"WebPage","name":title,"description":desc,"url":canonical,"dateModified":UPDATED});
  const breadcrumb = JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList",
    "itemListElement":crumbs.map((c,i)=>({"@type":"ListItem","position":i+1,"name":c[0],"item":c[1]}))});
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">${index?'':'\n<meta name="robots" content="noindex, follow">'}
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=optional"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap">
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
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    <nav id="navMenu"><a href="/">Главная</a><a href="/heroes/">Герои</a><a href="/items/">Предметы</a><a href="/stats/">Статистика</a><a href="/guides/">Гайды</a><a href="/meta/">META</a></nav>
    <div class="nav-spacer"></div>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:820px;">
${body}
</main>
<footer><div class="container footer-row"><span class="footer-brand">Dotamate by Hikikomole — фан-проект о Dota 2</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
</body>
</html>
`;
}

const privacyUrl = 'https://dotamate.ru/privacy/';
const consentUrl = 'https://dotamate.ru/privacy/consent/';
const title = 'Политика конфиденциальности | Dota Mate';
const pages = [
  {dir:['deploy','privacy'], title, canonical:privacyUrl, index:false, body:policyBody,
   desc:'Политика обработки персональных данных dotamate.ru по 152-ФЗ: оператор, какие данные собирают Яндекс.Метрика, РСЯ и хостинг, cookies, сроки, права посетителя.',
   crumbs:[['Главная','https://dotamate.ru/'],['Политика конфиденциальности',privacyUrl]]},
  {dir:['deploy','privacy','consent'], title:'Согласие на обработку персональных данных | Dota Mate', canonical:consentUrl, index:false, body:consentBody,
   desc:'Текст согласия на обработку персональных данных для Яндекс.Метрики и Рекламной сети Яндекса на dotamate.ru.',
   crumbs:[['Главная','https://dotamate.ru/'],['Политика конфиденциальности',privacyUrl],['Согласие',consentUrl]]},
  {dir:['deploy','privacy','consent-feedback'], title:'Согласие для формы обратной связи | Dota Mate', canonical:'https://dotamate.ru/privacy/consent-feedback/', index:false, body:feedbackConsentBody,
   desc:'Текст согласия на обработку персональных данных при отправке обращения через форму обратной связи dotamate.ru.',
   crumbs:[['Главная','https://dotamate.ru/'],['Политика конфиденциальности',privacyUrl],['Согласие для формы','https://dotamate.ru/privacy/consent-feedback/']]},
  {dir:['deploy','contact'], title:'Обратная связь | Dota Mate', canonical:'https://dotamate.ru/contact/', index:true, body:contactBody,
   desc:'Напишите команде Dotamate: ошибка в данных, идея, вопрос или запрос о персональных данных.',
   crumbs:[['Главная','https://dotamate.ru/'],['Обратная связь','https://dotamate.ru/contact/']]}
];
for (const p of pages) {
  const dir = path.join(...p.dir);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'), page(p), 'utf8');
}
fs.writeFileSync('privacy-urls.json', JSON.stringify([{loc:'https://dotamate.ru/contact/',name:'Обратная связь'}],null,1));
console.log('Generated privacy policy and consent pages.');
