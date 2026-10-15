# Замер скорости, телефон

Как мерить: Lighthouse 12.8.2 на компьютере владельца через мост (Edge headless, CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe, в .cmd обязательно `call npx -y lighthouse@12.8.2 <url> --quiet --output=json --output-path=<файл> --chrome-flags="--headless=new"`). Файлы: «Claude outputs/lh/before-*.json, after-*.json». Один прогон на страницу — разброс оценки ±3–5.

## 03.10.2026: v31 → v32 (задача 2, claude/plan-rost-trafika-oktyabr.md)

| Страница | Оценка | FCP | LCP | TBT | CLS | Вес |
|---|---|---|---|---|---|---|
| / | 80 → 83 | 2,6 → 2,6 с | 2,7 → 3,0 с | 468 → 311 мс | 0 → 0 | 2 260 → 1 831 КБ |
| /hero/axe/ | 81 → 87 | 2,6 → 2,6 с | 4,3 → 3,5 с | 30 → 44 мс | 0 → 0 | 1 616 → 817 КБ |
| /hero/axe/guide/ | 79 → 90 | 3,6 → 2,6 с | 4,0 → 3,1 с | 26 → 36 мс | 0 → 0 | 815 → 671 КБ |
| /live/ | 74 → 92 (повторы 81, 84) | 4,2 → 1,7 с | 4,2 → 1,7 с | 154 → 81 мс | 0,055 → 0,128 | 3 087 → 2 074 КБ |
| /items/ | 76 → 85 | 3,0 → 2,6 с | 3,4 → 3,1 с | 401 → 242 мс | 0 → 0 | 950 → 866 КБ |

Блокирующих ресурсов (render-blocking): / 15 → 6, /live 14 → 5, /items 13 → 4. Проверки браузера Hostiman в обоих замерах не было (0 запросов).

Что сделано в v32:
- Иконка сайта: favicon-32.png (1,2 КБ), icon-192.png (16,5 КБ), apple-touch-icon.png (15 КБ) вместо dotamate-icon.png 85 КБ (файл оставлен). На сервере 750/750 страниц с новой иконкой, 0 со старой.
- Портреты героев: assets/heroes/*.webp (128 шт, 1,1 МБ против 8,6 МБ png, качество 82); png оставлены (og:image, data/*.json). Ссылки: js/app.js, draft-tool.js, live.js, stats.js, home-draft.js (разбор пути png|webp), tools/hero-common.js, fetch-home-meta.js, fetch-patch-notes.js, build-item-pages.js, build-pages.js. tools/fetch-hero-icons.py сам делает webp (нужен Pillow).
- 7 общих скриптов (local-preview, reliable-data, item-variants, hero-roles, search, app, v43-features) — defer в page-shell.html и tools/hero-card.js. local-preview оставлен: app.js берёт из него резерв, если data/heroes.json или items-ru.json не загрузились.
- CSS Google Fonts — media="print" onload (page-shell.html, 7 сборщиков, patch/7.41f). На стенде CLS с этим и без этого одинаковый.
- Стенд: 779 html/js/css, 33 371 ссылка на /assets, /css, /js — битых 0; 5 страниц × 390/1366 px — битых картинок 0, ошибок JS 0.

Осталось (не в этой задаче):
- /live CLS 0,128: сдвиг 0,073 у .lv-lead/.lv-board/.lv-grid примерно через 15 с медленной загрузки (на стенде с замедлением воспроизводится и на старом коде, т.е. не от v32) + 0,055 .lv-mapwrap. Причина — строка над описанием заполняется после загрузки матча (~800 КБ). Лечится резервом высоты.
- TBT главной и /items в основном от Вебвизора Метрики (mc.webvisor.org, 730–1 040 мс скрипта) — отключается в настройках счётчика.
- style.css 100 КБ + theme-dark.css 150 КБ остаются блокирующими.
- На компьютере: CLS /items/ 0,16 и /live/ 0,09 на стенде (было и до v32).

## 02.10.2026, v17 (старый замер)
/ 54, /hero/axe/ 60 (вес 11,8 МБ из-за видео), /hero/axe/guide/ 94, /live/ 64, /items/ 54. Тогда в замер попадала проверка браузера Hostiman 1,2–3,7 с.
