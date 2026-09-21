// Русские подписи характеристик предметов.
//
// OpenDota отдаёт у каждой характеристики поле display вида
// "+ {value} Damage" — по-английски. Набор этих строк маленький и меняется
// редко: на 263 предметах каталога их ровно 51, поэтому словарь ведётся
// руками, а не машинным переводом. Термины взяты в том виде, в каком они
// звучат в русском клиенте Dota 2.
//
// Если Valve добавит новую строку, её здесь не окажется — тогда на странице
// останется английский оригинал. Это заметно и чинится одной строкой; молча
// прятать характеристику хуже.
//
// Характеристики без display (сырые ключи вроде bash_chance_melee) на
// страницу не выводятся вовсе: это внутренние имена движка, для читателя они
// выглядят как дамп базы, а сами числа почти всегда уже названы в описании
// способности предмета.

module.exports = {
  '+ {value} Damage': '+ {value} к урону',
  '+ {value} Mana Regeneration': '+ {value} к восстановлению маны',
  '+ {value} Health Regeneration': '+ {value} к восстановлению здоровья',
  '+ {value} Health': '+ {value} к здоровью',
  '+ {value} Intelligence': '+ {value} к интеллекту',
  '+ {value} Strength': '+ {value} к силе',
  '+ {value} Armor': '+ {value} к броне',
  '+ {value} All Attributes': '+ {value} ко всем атрибутам',
  '+ {value} Attack Speed': '+ {value} к скорости атаки',
  '+ {value} Mana': '+ {value} к мане',
  '+ {value} Agility': '+ {value} к ловкости',
  '+ {value} Movement Speed': '+ {value} к скорости передвижения',
  '+ {value}% Magic Resistance': '+ {value}% к сопротивлению магии',
  '+ {value} Cast Range': '+ {value} к дальности применения',
  '+ {value}% Spell Lifesteal': '+ {value}% вампиризма от заклинаний',
  '+ {value}% Evasion': '+ {value}% к уклонению',
  '+ {value}% Spell Amplification': '+ {value}% к усилению заклинаний',
  '+ {value}% Mana Regen Amplification': '+ {value}% к усилению восстановления маны',
  '+ {value}% Movement Speed': '+ {value}% к скорости передвижения',
  '+ {value}% Health Restoration': '+ {value}% к получаемому лечению',
  '+ {value}% Slow Resistance': '+ {value}% к сопротивлению замедлению',
  '+ {value}% Lifesteal': '+ {value}% вампиризма',
  '+ {value} Attack Range (Ranged Only)': '+ {value} к дальности атаки (только дальний бой)',
  '+ {value} Area of Effect': '+ {value} к радиусу действия',
  '+ {value} Projectile Speed': '+ {value} к скорости снаряда',
  '+ {value} Bonus Night Vision': '+ {value} к ночному обзору',
  '+ {value} Damage (MELEE)': '+ {value} к урону (ближний бой)',
  '+ {value} Damage (RANGED)': '+ {value} к урону (дальний бой)',
  '+ {value} Move Speed (Ranged Heroes)': '+ {value} к скорости передвижения (герои дальнего боя)',
  '+ {value} Move Speed (Melee Heroes)': '+ {value} к скорости передвижения (герои ближнего боя)',
  '+ {value} Selected Attribute': '+ {value} к выбранному атрибуту',
  '+ {value} Primary Attribute': '+ {value} к основному атрибуту',
  '+ {value}% Max Mana': '+ {value}% к максимальному запасу маны',
  '+ {value}% Max Health Regen': '+ {value}% к максимальному восстановлению здоровья',
  '+ {value} Attack Range (Melee Only)': '+ {value} к дальности атаки (только ближний бой)',
  '+ {value}% Base Attack Speed Percentage': '+ {value}% к базовой скорости атаки',
  '+ {value}% Status Resistance': '+ {value}% к сопротивлению эффектам',
  '+ {value}% Mana Cost/Mana Loss Reduction': '+ {value}% к снижению затрат и потерь маны',
  '+ {value}% Cast Speed Bonus': '+ {value}% к скорости применения способностей',
  '+ {value}% Cooldown Reduction': '+ {value}% к снижению перезарядки',
  'COOLDOWN: {value}': 'Перезарядка: {value}',
  'TOWN PORTAL SCROLL COOLDOWN: {value}': 'Перезарядка Town Portal Scroll: {value}',
  'TOWN PORTAL SCROLL CHANNEL TIME: {value}': 'Время поддержания Town Portal Scroll: {value}',
  'OBSERVER VISION RANGE: {value}': 'Радиус обзора Observer Ward: {value}',
  'OBSERVER DURATION (MINUTES): {value}': 'Время действия Observer Ward, мин: {value}',
  'SENTRY DURATION (MINUTES): {value}': 'Время действия Sentry Ward, мин: {value}',
  'SENTRY TRUE SIGHT RANGE: {value}': 'Радиус истинного зрения Sentry Ward: {value}',
  'MOVEMENT SLOW: {value}%': 'Замедление: {value}%',
  'EFFECT RADIUS: {value}': 'Радиус действия: {value}',
  'HITS TO KILL: {value}': 'Ударов до уничтожения: {value}',
  'CURRENT BONUS: {value}%': 'Текущий бонус: {value}%',
};
