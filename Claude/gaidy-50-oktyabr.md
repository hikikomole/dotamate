# 50 гайдов по предметам (02.10.2026)

Добавлены в конец `guide-content.js` (было 71 → 121), страницы собраны `build-guide-pages.js` в deploy/guide/<slug>/. Каталог /guides/ строится из guide-content.js в build-pages.js (тег ПРЕДМЕТЫ → группа «Предметы»), правка js/app.js не нужна (guideData оттуда убран другой сессией 02.10). **Не выложено, git commit не делался.** Резервные копии: `Claude outputs/u-guides-oct/` (guide-content.bak.js, new-guides.json).

## Темы (slug)
battle-fury, radiance, desolator, daedalus, butterfly, euls-wind-waker, force-staff-hurricane-pike, glimmer-cape, manta-style, linkens-sphere, lotus-orb, blade-mail, shadow-blade-silver-edge, scythe-of-vyse, orchid-bloodthorn, refresher-orb, satanic, heart-of-tarrasque, assault-cuirass, pipe-of-insight, mekansm-guardian-greaves, diffusal-blade-disperser, maelstrom-mjollnir, rod-of-atos-gleipnir, echo-sabre, skull-basher-abyssal-blade, nullifier, ghost-scepter-ethereal-blade, dagon, shivas-guard, aeon-disk, octarine-core, vanguard-crimson-guard, bottle, armlet, mask-of-madness, sange-yasha-kaya, monkey-king-bar, solar-crest, divine-rapier, gem-of-true-sight, soul-ring, bracer-wraith-band-null-talisman, heavens-halberd, bloodstone, which-boots-to-buy, boots-of-travel, phylactery-khanda, parasma, starting-items.
Не пересекаются с 71 общим гайдом (проверено скриптом по slug и темам; БКБ, даггер, мидас, палка, аганим, срез хила, ТП, смок уже были).

## Источники и проверка
- Цены, характеристики, перезарядки, описания: `data/items-ru.json` (Valve datafeed, 21.09.2026; актуальный патч 7.41f — проверено по dota2.com/datafeed/patchnoteslist).
- «Чаще всего покупают»: `data/item-heroes.json` (OpenDota itemPopularity), первые 6 героев.
- Скрипт: каждое число в статьях найдено в данных предметов; кроме расчётных (средний урон Daedalus 137,5%, уклонение 51,25%, Heart 47,5/60/77,5, октарина ×1,33, блок 17,5%, MKB 56, Parasma 112,5, Tango 112) — пересчитаны вручную. Названия компонентов сверены с dname.
- Убраны непроверяемые утверждения (рефрешер и предметы, MKB против слепоты, «раз в секунду» у Maelstrom).
- Стенд (Playwright): страницы рендерятся, на 390 px нет горизонтальной прокрутки. check-links: битых ссылок из гайдов нет (3 битых — /js/search.js, /css/guides.css, /js/guides.js — файлы другой сессии, ещё не в deploy/).

## Делегирование
Не делегировалось: по опыту 25.09 (Groq) внешние модели ошибаются в механиках; тексты написаны Claude по фактам из данных.

## Замечено, не правилось
- В гайде magic-wand: «максимум 20 зарядов, перезарядка 15 с» — сверить с items-ru.json (у Magic Stick 10 зарядов, 17 с).
- Полей faq/answer у 50 сентябрьских гайдов по-прежнему нет.

## Выкладка
По команде «выкладывай»: push-server.js → на сервере build-guide-pages.js, build-pages.js, build-sitemap.js → sync → deploy (+1 версия) → indexnow.js по 50 адресам /guide/<slug>/.
