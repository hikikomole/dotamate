# Переезд dotamate.ru с Cloudflare на Hostiman (25–26.09.2026)

## Итог
Сайт работает из РФ без VPN (проверено владельцем с телефона 26.09.2026).
- Хостинг: Hostiman RuGold, 330 ₽/мес, ЦОД Selectel Москва, услуга 278486, панель ispmanager.
- Веб-IP 81.90.180.146; SSH ruvip72.hostiman.ru:8228, логин s278486, вход по ключу `%USERPROFILE%\.ssh\dotamate_hostiman` (пароль не используется).
- Корень сайта: `~/www/dotamate.ru` (= содержимое `deploy/` без worker.js, wrangler.jsonc, .wrangler, _headers).
- `_headers` перенесён в `.htaccess` (CSP и прочие заголовки, deflate, expires, запрет служебных файлов).
- DNS: у регистратора Timeweb NS → ns1–4.hostiman.ru. Зона в панели Hostiman (A, www, MX, SPF/DKIM/DMARC).
- SSL: Let's Encrypt для dotamate.ru и www, выпущен 25.09.2026.

## Почему не бесплатные CDN (замер с iPhone без VPN, loc=RU)
Cloudflare и Netlify — обрыв на 25 с; GitHub Pages, Google Cloud, Firebase, Google Fonts — < 1 с.
Firebase отвергнут (360 МБ/сутки), GitHub Pages — запрет коммерческого использования в правилах.

## Открытые хвосты
1. **Деплой изменился.** `wrangler deploy` больше не обновляет сайт. Выкладка: tar `deploy/` → одно SSH-подключение `ssh ... "cd ~/www/dotamate.ru && tar -xf -" < site.tar`. `tools/daily-update.js` и `tools/update-site.js` нужно перевести на этот способ.
2. SSH блокирует IP после нескольких подключений подряд — делать одно подключение на задачу; просить поддержку разблокировать.
3. Нет редиректов http→https и www→dotamate.ru (панель: Сайты → dotamate.ru).
4. Защита DDoS Hostiman показывает ботам «Checking your browser» — уточнить у поддержки, пропускает ли Googlebot/YandexBot.
5. Без воркера не работают: `/api/dota/hero-stats`, `/api/dota/hero-positions` (есть запасной файл), `/api/dota/hero/<name>/abilities`, `/api/feedback`. План: PHP (или Node через CloudLinux selector) на хостинге.
6. Скрипт Cloudflare Web Analytics в страницах больше не нужен.
7. Netlify-проект `dotamate-ru` можно удалить; папка `netlify-site/` в проекте — временная.
