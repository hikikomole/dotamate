## Назначение файла
Файл `app.js` содержит клиентскую логику интерактивного веб-приложения Companion по Dota 2. Он отвечает за загрузку, нормализацию, кэширование и отображение данных о героях, предметах, способностях, гайдах и аналитике покупок из внешних источников (Valve Datafeed API, OpenDota API и статических зеркалах GitHub). Также скрипт управляет модальными окнами, фильтрацией, поиском, мобильной навигацией и инструментом быстрой подготовки к пику.

## Глобальное состояние
| Переменная | Что хранит |
| :--- | :--- |
| `OFFICIAL_HERO_LIST` | URL эндпоинта Valve datafeed для получения списка героев |
| `OFFICIAL_ITEM_LIST` | URL эндпоинта Valve datafeed для получения списка предметов |
| `OPENDOTA_HEROES` | URL API OpenDota для получения статистики героев |
| `OPENDOTA_ITEMS` | URL API OpenDota для получения констант предметов |
| `STATIC_HEROES` | URL зеркала списка героев на GitHub |
| `STATIC_ITEMS` | URL зеркала списка предметов на GitHub |
| `CDN` | Базовый URL CDN Steam для ресурсов |
| `OPENDOTA_ITEM_POPULARITY` | Базовый URL API OpenDota для данных о популярности предметов героя |
| `LOCAL_MODE` | Булевый флаг запуска страницы по протоколу `file:` |
| `FALLBACK_IMG` | Data URI со встроенным SVG-изображением заглушки |
| `heroes` | Массив загруженных и нормализованных объектов героев |
| `items` | Массив загруженных и нормализованных объектов предметов |
| `filter` | Строковый идентификатор фильтра героев по атрибуту (`all`, `str`, `agi`, `int`, `universal`) |
| `itemFilter` | Строковый идентификатор фильтра предметов по цене (`all`, `cheap`, `mid`, `expensive`) |
| `guideFilter` | Строковый идентификатор фильтра категорий гайдов |
| `lastFocusedEl` | Ссылка на DOM-элемент, имевший фокус ввода до открытия модального окна |
| `spotlightHeroId` | Числовой ID героя, отображаемого в текущий момент в баннере Spotlight |
| `spotlightTimer` | Идентификатор интервала/таймера автоматической смены героя в баннере Spotlight |
| `heroItemPopularityCache` | Экземпляр `Map`, кэширующий данные популярности предметов по ID героев |
| `ruRoles` | Объект соответствия англоязычных названий ролей их русскому переводу |
| `attrs` | Объект сопоставления ключей атрибутов с их иконками и русскими названиями |
| `guideData` | Массив объектов с метаданными и текстами гайдов |
| `heroSlug` | Объект сопоставления локализованных имён героев с их системными слагами |
| `EXCLUDED_ITEM_INTERNAL_IDS` | Множество `Set` с внутренними ID служебных и некаталожных предметов Valve |
| `roleSuggestions` | Объект с рекомендациями ключевых предметов по ролям |
| `OFFICIAL_ITEM_CACHE_TTL` | Время жизни кэша официальных данных предмета в миллисекундах (30 дней) |
| `ITEM_COUNTERS` | Объект с описанием контрпредметов и механик противодействия |
| `window.itemCategoryFilter` | Строковый идентификатор фильтра предметов по категориям |

## Функции
| Функция | Что делает | Какие API/эндпоинты дёргает | Какие DOM-элементы трогает |
| :--- | :--- | :--- | :--- |
| `escapeHtml` | Экранирует спецсимволы в строке для безопасной вставки в HTML | - | - |
| `slugForHero` | Возвращает текстовый слаг героя на основе его названия | - | - |
| `imageUrl` | Формирует URL изображения героя на CDN | - | - |
| `imageCandidates` | Возвращает список альтернативных URL изображений героя через `d2hImageCandidates` | - | - |
| `itemSlug` | Формирует нормализованный слаг для имени предмета | - | - |
| `itemImage` | Формирует URL изображения предмета на CDN | - | - |
| `itemImageCandidates` | Возвращает варианты URL изображений предмета через `d2hImageCandidates` | - | - |
| `roleText` | Преобразует массив ролей героя в строку с русским переводом | - | - |
| `attrInfo` | Возвращает иконку и текстовое название атрибута героя | - | - |
| `officialHeroUrl` | Генерирует ссылку на официальную страницу героя на dota2.com | - | - |
| `winrate` | Вычисляет процент побед героя в профессиональных матчах | - | - |
| `go` | Выполняет плавный скролл к указанному элементу | - | Ищет элемент по ID через `document.getElementById` и вызывает `scrollIntoView` |
| `normalizeHeroes` | Приводит структуру объектов героев к единому формату и сортирует их по имени | - | - |
| `unwrapHeroes` | Извлекает массив героев из ответов различных API | - | - |
| `unwrapItems` | Извлекает массив предметов из ответов различных API | - | - |
| `isRealCatalogItem` | Проверяет, является ли предмет настоящим покупным предметом каталога | - | - |
| `normalizeItems` | Очищает, нормализует и сортирует список предметов | - | - |
| `enrichProStats` | Загружает актуальную pro-статистику героев с OpenDota и обновляет кэш | `OPENDOTA_HEROES` (через `d2hFetchJSON`) | Перерисовывает интерфейс через вызовы `renderStats`, `renderFeaturedHeroes`, `quickPrepOptions` |
| `loadHeroes` | Загружает список героев из нескольких источников с падением на кэш или локальные данные | `OFFICIAL_HERO_LIST`, `OPENDOTA_HEROES`, `STATIC_HEROES` (через `d2hFirstSuccessful`, `d2hFetchJSON`) | `#status` |
| `updateItemCounters` | Обновляет счетчики количества предметов в UI | - | `#quickItemCount`, `#itemCountHero`, `#itemCountHero2` |
| `loadItems` | Загружает базу предметов из онлайн-источников, кэша или локальной базы | `OFFICIAL_ITEM_LIST`, `OPENDOTA_ITEMS`, `STATIC_ITEMS` (через `d2hFirstSuccessful`, `d2hFetchJSON`) | `#itemStatus` |
| `itemCategory` | Определяет категорию предмета (рецепт, нейтральный, расходник, компонент, предмет) | - | - |
| `itemCategoryLabel` | Возвращает локализованную текстовую метку категории предмета | - | - |
| `itemDescriptionPreview` | Формирует краткое текстовое превью описания предмета из кэша | - | - |
| `renderItems` | Отрисовывает сетку предметов с учетом поиска и фильтров | - | `#itemSearch`, `#itemsGrid`, `#itemVisibleCount` |
| `statValue` | Форматирует числовое значение в строку с разделением разрядов | - | - |
| `updateHeroUI` | Обновляет счетчики героев в UI и вызывает функции рендеринга связанных блоков | - | `#heroCount`, `#quickHeroCount`, `#heroRoleCount`, `#status`, `#freshBadge` |
| `renderHeroSpotlight` | Генерирует разметку для случайного героя в баннере Spotlight и ставит таймер обновления | - | `#featured` |
| `heroCard` | Возвращает HTML-разметку карточки героя | - | - |
| `renderHeroes` | Фильтрует героев по запросу и атрибуту и отрисовывает их сетку | - | `#search`, `#heroesGrid` |
| `renderFeaturedHeroes` | Отрисовывает топ популярных героев в специальном блоке | - | `#featuredHeroesGrid` |
| `buildItemAnalytics` | Формирует агрегированную аналитику покупок предметов по популярным героям | Вызывает `fetchHeroItemPopularity` | - |
| `renderItemAnalytics` | Генерирует и отрисовывает блок аналитики наиболее покупаемых предметов | - | `#itemAnalytics`, кнопки с атрибутом `[data-item-analytics]` |
| `loadItemAnalytics` | Инициализирует сбор и рендеринг аналитики предметов | - | `#itemAnalytics` |
| `wr` | Вложенная в `renderStats`: возвращает винрейт для героев с >= 5 пиками | - | - |
| `renderStats` | Фильтрует, сортирует и отрисовывает таблицу статистики героев и инсайты | - | `#statsSearch`, `#statsSort`, `#statsAttr`, `#statsAttack`, `#statsRole`, `#statsBody`, `#bestWinrate`, `#proPicks`, `#statsExtra`, `#itemAnalytics` |
| `renderGuides` | Фильтрует и отрисовывает сетку гайдов | - | `#guidesGrid` |
| `randomHero` | Выбирает случайного героя и открывает его модальный профиль | - | `#randomToolText` |
| `heroStats` | Формирует массив ключевых числовых характеристик героя | - | - |
| `heroBuild` | Возвращает массив рекомендуемых предметов для роли героя | - | - |
| `score` | Вложенная в `counterCandidates`: рассчитывает рейтинг контрпика | - | - |
| `counterCandidates` | Подбирает топ-3 контрпика для героя | - | - |
| `quickPrepOptions` | Заполняет списки автодополнения и чипы для быстрой подготовки к пику | - | `#quickPrepHeroes`, `#quickPrepChips` |
| `renderQuickPrep` | Отрисовывает резюме быстрой подготовки (контрпики, билд, винрейт) для героя | - | `#quickPrepResult` |
| `quickPrepSelectByName` | Ищет героя по введенному имени и передает его в `renderQuickPrep` | - | - |
| `popularityStorageKey` | Генерирует ключ `localStorage` для хранения данных популярности предметов героя | - | - |
| `normalizePopularityPayload` | Приводит структуру ответа API популярности предметов к единому формату по фазам | - | - |
| `popularityTotal` | Объединяет массивы предметов всех фаз игры в один список | - | - |
| `findItemById` | Ищет объект предмета в глобальном массиве по его ID | - | - |
| `phaseTitle` | Возвращает локализованное название фазы игры | - | - |
| `phaseItems` | Группирует и сортирует популярные предметы по фазам | - | - |
| `popularityCard` | Генерирует HTML-разметку предметов для конкретной фазы игры | - | - |
| `renderHeroItemPopularity` | Отрисовывает статистику покупок предметов в профиле героя | - | `#heroItemPopularity`, кнопки с атрибутом `[data-item-pop]` |
| `fetchHeroItemPopularity` | Выполняет сетевой запрос популярных предметов героя с кэшированием в `localStorage` | `/api/dota/hero/${heroId}/items`, `${OPENDOTA_ITEM_POPULARITY}${heroId}/itemPopularity` (через `d2hFetchJSON`) | - |
| `loadHeroItemPopularity` | Инициализирует загрузку и отображение сборки предметов для героя | - | `#heroItemPopularity` |
| `abilityIcon` | Формирует URL иконки способности на CDN Steam | - | - |
| `abilityParts` | Очищает HTML-теги в описании способности и извлекает информацию о развеивании | - | - |
| `loadHeroAbilities` | Загружает и отрисовывает список способностей героя | `/api/dota/hero/${h.name}/abilities` (через `fetch`) | `#heroAbilities` |
| `cachedItemUsers` | Собирает из кэша список героев, использующих данный предмет | - | - |
| `loadReverseItemPopularity` | Выполняет обратный поиск героев, покупающих указанный предмет | - | - |
| `renderItemHeroLinks` | Отрисовывает блок героев, использующих предмет, и распределение по фазам | - | `#itemPurchaseUse`, кнопки с атрибутом `[data-hero-open]` |
| `openHero` | Генерирует разметку и открывает модальное окно с детальным профилем героя | - | `#modalContent`, `#modal`, `#close`, кнопки `[data-hero-open]`, `[data-item-by-name]` |
| `closeModal` | Закрывает модальное окно и возвращает фокус | - | `#modal`, элемент `lastFocusedEl` |
| `officialItemCacheKey` | Генерирует ключ `localStorage` для кэша данных предмета Valve | - | - |
| `readOfficialItemCache` | Читает данные предмета из `localStorage` с проверкой существования | - | - |
| `writeOfficialItemCache` | Записывает данные предмета Valve в `localStorage` | - | - |
| `extractOfficialItemData` | Извлекает объект предмета из различных структур ответа Valve Datafeed | - | - |
| `refreshOfficialItemData` | Запрашивает свежие данные предмета из API или Datafeed Valve | `/api/dota/item/${itemId}`, `https://www.dota2.com/datafeed/itemdata?...` (через `fetch`) | - |
| `fetchOfficialItemData` | Возвращает данные предмета из кэша и при необходимости обновляет их в фоновом режиме | - | - |
| `cleanOfficialHtml` | Очищает строку от HTML-тегов, спецсимволов и дублирующихся пробелов | - | - |
| `humanizeStatName` | Преобразует системный ключ характеристики в читаемую строку | - | - |
| `push` | Вложенная в `officialItemFacts`: формирует и добавляет HTML-блок характеристики в массив | - | - |
| `officialItemFacts` | Формирует список официальных числовых показателей предмета | - | - |
| `itemOfficialUseFlags` | Возвращает массив текстовых флагов рекомендации применения предмета | - | - |
| `itemKey` | Нормализует имя предмета для поиска в таблице контрпредметов | - | - |
| `itemCounterEntries` | Сопоставляет предмет с записями его контрпредметов из таблицы `ITEM_COUNTERS` | - | - |
| `renderItemCounters` | Генерирует HTML-разметку списка контрпредметов с объяснениями | - | - |
| `openItem` | Создаёт разметку и открывает модальное окно с подробным профилем предмета | `https://www.dota2.com/datafeed/itemdata?...` | `#modalContent`, `#modal`, `#close`, `#itemRefreshBtn`, `#officialItemDesc`, `#officialItemDetails`, `#itemPurchaseUse`, элементы с атрибутом `[data-item-open]` |
| `compareHeroes` | Запрашивает имена двух героев и выводит таблицу их сравнения в модальном окне | - | `#modalContent`, `#modal`, `#close` |
| `$` | Вспомогательная функция-сокращение для `document.getElementById` | - | Ищет элемент по ID в DOM |
| `on` | Подключает обработчик события к DOM-элементу по его ID | - | Навешивает `addEventListener` на элемент по ID |
| `click` | Назначает обработчик `onclick` DOM-элементу по его ID | - | Устанавливает свойство `onclick` на элемент по ID |
| `setMenuOpen` | Управляет открытием/закрытием мобильного навигационного меню | - | `#navMenu`, `#menu` |

## Точки входа

### При загрузке страницы:
1. Выполняется рендеринг гайдов (`renderGuides()`).
2. Инициализируется асинхронная загрузка героев (`loadHeroes()`) и предметов (`loadItems()`).
3. Обрабатываются URL-параметры прямых ссылок (SEO deep links):
   - Если присутствует параметр `?openHero=<id>`, после загрузки героев открывается модальное окно данного героя (`openHero(id)`).
   - Если присутствует параметр `?openItem=<name>`, после загрузки предметов открывается модальное окно данного предмета (`openItem(openItemParam)`).

### По событиям:
- **Перехват ошибок загрузки изображений (`document.addEventListener('error', ..., true)`):** глобальный перехватчик события `error` проверяет домен CDN и автоматически пытается переключить изображение на резервный домен Steam CDN или подставляет SVG-заглушку `FALLBACK_IMG`.
- **Поиск героев (`#search`, событие `input`):** вызывает `renderHeroes`.
- **Фильтр атрибутов героев (`.chip[data-filter]`, событие `click`):** переключает фильтр `filter` и вызывает `renderHeroes`.
- **Сброс фильтра героев (`#resetChip`, событие `click`):** сбрасывает значения фильтра и поиска, вызывая `renderHeroes`.
- **Фильтрация и сортировка таблицы статистики (`#statsSearch`, `#statsSort`, `#statsAttr`, `#statsAttack`, `#statsRole`, события `input` / `change`):** вызывают `renderStats`.
- **Принудительное обновление данных (`#statsRefresh`, событие `click`):** очищает кэш `d2hClearCache()` и перезагружает героев и предметы с сервера (`loadHeroes(true)`, `loadItems(true)`).
- **Сравнение героев (`#compareBtn`, событие `click`):** вызывает функцию `compareHeroes()`.
- **Поиск предметов (`#itemSearch`, событие `input`):** вызывает `renderItems`.
- **Фильтры цен предметов (`.item-filter`, событие `click`):** изменяют `itemFilter` и вызывают `renderItems`.
- **Фильтры категорий предметов (`.item-category`, событие `click`):** изменяют `window.itemCategoryFilter` и вызывают `renderItems`.
- **Фильтры категорий гайдов (`.guide-filter`, событие `click`):** изменяют `guideFilter` и вызывают `renderGuides`.
- **Клик / нажатие клавиш по карточкам героев (`#heroesGrid`, события `click`, `keydown` [Enter/Space]):** открывают окно героя через `openHero`.
- **Клик по популярным героям (`#featuredHeroesGrid`, событие `click`):** открывает окно героя через `openHero`.
- **Клик по строке или кнопке героя в статистике (`#statsBody`, `#statsExtra`, событие `click`):** открывает окно героя через `openHero`.
- **Клик по предмету в сетке (`#itemsGrid`, событие `click`):** открывает окно предмета через `openItem`.
- **Ввод и выбор в блоке быстрой подготовки (`#quickPrepInput`, `#quickPrepChips`, `#quickPrepResult`, события `input`, `click`):** выбирают героя и отображают аналитику или открывают связанные модальные окна.
- **Переход к разделам из гайдов и модальных окон (`#guidesGrid`, `#modalContent`, событие `click` на элементах с `[data-go]`):** закрывают модальное окно и выполняют скролл к целевому блоку (`closeModal()`, `go()`).
- **Случайный выбор героя (`#randomBtn`, событие `click`):** вызывает `randomHero()`.
- **Закрытие модального окна (`#close`, `#modalBg`, событие `click`; `document`, событие `keydown` [Escape]):** вызывают `closeModal()`.
- **Переключение мобильного меню (`#menu`, событие `click`; клики по ссылкам `#navMenu a`):** управляют состоянием навигации через `setMenuOpen()`.
- **Изменение размера окна (`window`, событие `resize`):** при ширине экрана больше 760px автоматически закрывает мобильное меню (`setMenuOpen(false)`).
