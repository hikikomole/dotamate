/**
 * Что показывать в каталоге предметов, а что прятать.
 *
 * Две причины задвоений:
 *  1) Рецепты. Это отдельные покупаемые предметы, но для читателя они дубли:
 *     «Crystalys — рецепт» рядом с «Crystalys». Своей страницы у них нет и
 *     никогда не было, в билдах и покупках на них нет НИ ОДНОЙ ссылки
 *     (проверено: 0 из 3494 и 0 из 2528). Поэтому их можно смело прятать из
 *     каталога, оставив данные в data/items-ru.json для будущих разделов.
 *  2) Уровни одного предмета: Dagon 1–5 и Necronomicon 1–3 лежат как
 *     отдельные записи с ОДИНАКОВЫМ названием и описанием — в сетке это пять
 *     и три карточки подряд. Показываем базовую, а уровни расписываем внутри.
 *
 * Вариант определяется правилом, а не списком: ключ вида <база>_<цифра> И
 * совпадающее с базой название. Правило само отсеивает Stygian Desolator
 * (desolator_2), Boots of Travel 2 и Aghanim's Blessing — там названия разные.
 *
 * Работает и в браузере (window.D2HItems), и в сборочных скриптах.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.D2HItems = api;
})(typeof window !== 'undefined' ? window : null, function () {

  const bareKey = x => String((x && (x.name || x.key)) || x || '').replace(/^item_/, '');

  function isRecipe(item) {
    if (!item) return false;
    if (item.recipeFor) return true;
    return /^recipe_/.test(bareKey(item));
  }

  /** Ключ базового предмета, если это уровень одного и того же предмета */
  function variantBase(key, catalog) {
    const m = String(key).match(/^(.+)_([2-9])$/);
    if (!m) return null;
    const base = catalog[m[1]];
    const self = catalog[key];
    if (!base || !self) return null;
    return base.dname && base.dname === self.dname ? m[1] : null;
  }

  /** Карты «вариант -> база» по ключам и по числовым id */
  function buildVariantMaps(catalog) {
    const byKey = {}, byId = {};
    for (const key of Object.keys(catalog)) {
      const base = variantBase(key, catalog);
      if (!base) continue;
      byKey[key] = base;
      const from = catalog[key] && catalog[key].id;
      const to = catalog[base] && catalog[base].id;
      if (from != null && to != null) byId[from] = to;
    }
    return { byKey, byId };
  }

  /** Прятать ли запись из каталога: рецепт или не первый уровень предмета */
  function isHidden(item, catalog, variantByKey) {
    if (isRecipe(item)) return true;
    const key = bareKey(item);
    if (variantByKey) return Boolean(variantByKey[key]);
    return Boolean(variantBase(key, catalog || {}));
  }

  /**
   * Уровни предмета для описания: базовый плюс все его варианты, по цене.
   * Числа берутся из каталога, ничего не вписано руками.
   */
  function levelsOf(baseKey, catalog) {
    const base = catalog[baseKey];
    if (!base) return [];
    const list = [{ key: baseKey, cost: Number(base.cost || 0) }];
    for (const key of Object.keys(catalog)) {
      if (variantBase(key, catalog) === baseKey) list.push({ key, cost: Number(catalog[key].cost || 0) });
    }
    if (list.length < 2) return [];
    list.sort((a, b) => a.cost - b.cost);
    return list.map((x, i) => ({
      level: i + 1,
      key: x.key,
      cost: x.cost,
      step: i ? x.cost - list[i - 1].cost : 0
    }));
  }

  return { isRecipe, variantBase, buildVariantMaps, isHidden, levelsOf, bareKey };
});
