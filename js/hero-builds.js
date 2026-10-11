/**
 * Блоки «Способности и таланты» и «Что покупают на <герое>» на странице героя.
 *
 * Данные (с U5, 09.10.2026): прокачка и таланты — рейтинговые матчи всех рангов Steam по позициям
 * модели (поддержка 4 и 5 — общий билд, supMerged), предметы — Stratz Divine/Immortal, по каждой позиции
 * героя отдельно. Источник — data/builds/<heroId>.json, в проде поверх него
 * /api/dota/hero/<id>/build с суточным кешем.
 *
 * О методике, чтобы подписи не врали: Stratz не отдаёт готовую цепочку
 * прокачки 1–10 целиком. Он отдаёт, сколько матчей способность была впервые
 * взята на каждом уровне. Поэтому «частый выбор» — самый популярный вариант
 * НА КАЖДОМ уровне, а «выбор по винрейту» — лучший по проценту побед на
 * каждом уровне. Подписи в интерфейсе сформулированы именно так.
 *
 * Работает и в браузере (window.D2HBuilds), и в сборочных скриптах.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.D2HBuilds = api;
})(typeof window !== 'undefined' ? window : null, function () {

  const RU_POS = {
    POSITION_1: 'Керри', POSITION_2: 'Мид', POSITION_3: 'Оффлейн',
    POSITION_4: 'Поддержка', POSITION_5: 'Полная поддержка'
  };
  const POS_KEY = {
    POSITION_1: 'carry', POSITION_2: 'mid', POSITION_3: 'offlane',
    POSITION_4: 'support', POSITION_5: 'hardsupport'
  };

  const wr = v => v == null ? '—' : String(v.toFixed(1)).replace('.', ',') + '%';
  const num = n => String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const minute = m => m == null ? '—' : m + ' мин';
  /** «182 матча», «5 матчей», «1 матч» — иначе подпись читается как машинная */
  const matchWord = n => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'матчей';
    if (b === 1) return 'матч';
    if (b >= 2 && b <= 4) return 'матча';
    return 'матчей';
  };

  /** Цепочка из skill-chains.json -> шаги для отрисовки полосы прокачки */
  function chainToBranch(chain) {
    if (!chain || !Array.isArray(chain.seq)) return null;
    return {
      steps: chain.seq.map(id => ({ abilityId: id, matches: chain.matches, winrate: chain.winrate })),
      matches: chain.matches,
      winrate: chain.winrate
    };
  }

  /**
   * Название таланта. Сейчас английское — как в исходных данных Stratz.
   * Русские переводы уже собраны в data/talents-ru.json: чтобы включить их,
   * достаточно передать их в ctx.talentNames из сборщика страниц.
   */
  function talentLabel(abilityId, meta, ctx) {
    const ru = ctx.talentNames && ctx.talentNames[abilityId];
    const fromTree = ctx.talentTitles && ctx.talentTitles[abilityId];
    const raw = ru || fromTree || (meta && meta.title) || '';
    // Бонус к атрибутам в данных приходит служебным именем.
    if (/^special_bonus_attributes$/.test(raw) || (meta && meta.name === 'special_bonus_attributes')) return 'Бонус ко всем атрибутам';
    if (/^special_bonus_/.test(raw) || !raw) return 'Талант';
    return cleanTalent(raw);
  }

  /**
   * Последняя страховка от «+{s:bonus_damage} Jinada Damage» на странице.
   * Значения подставляются в справочнике (tools/build-talent-tree.js), но если
   * какой-то талант пришёл мимо него, лучше показать название без числа,
   * чем служебную заглушку.
   */
  function cleanTalent(text) {
    // «-{s:value}s Bushwhack Cooldown» без числа превращался в «-s Bushwhack…»: знак и единица без значения убираем.
    return String(text || '').replace(/\{s:[A-Za-z0-9_]+\}/g, '').replace(/\s+/g, ' ').replace(/^[+\-−]\s/, '').replace(/^[+\-−]?(?:s|%|x)(?=\s)/, '').trim();
  }

  /**
   * Короткая подпись таланта для плитки шириной в одну ячейку прокачки.
   * Числовые таланты («+30 к урону») сокращаем до значения — оно и есть суть;
   * текстовые обрезаем по слову, полный текст остаётся в подсказке.
   */
  function shortTalent(text) {
    const t = String(text || '').trim();
    const num = t.match(/^([+\-−]?\d+(?:[.,]\d+)?(?:\s*%|s\b|с\b)?)/);
    if (num) return num[1].replace(/\s+/g, '');
    return t.length > 12 ? t.slice(0, 11).replace(/\s+\S*$/, '') + '…' : t;
  }

  /** Иконка способности: локальный ассет, внешних запросов нет */
  function abilityIcon(name) { return '/assets/abilities/' + name + '.png'; }
  function itemIcon(slug) { return '/assets/items/' + slug + '.png'; }

  /**
   * Одна ветка прокачки 1–10.
   * branch.steps — список из 10 шагов вида {abilityId, matches, winrate}.
   * Для настоящей цепочки matches/winrate у всех шагов одинаковые: это
   * характеристика всей последовательности, а не отдельного уровня.
   */
  function progressionHtml(branch, label, hint, ctx) {
    if (!branch || !branch.steps) return '';
    const esc = ctx.escapeHtml;
    const cells = branch.steps.map((s, i) => {
      if (!s) return `<div class="hb-step hb-step-empty"><span>${i + 1}</span></div>`;
      const a = ctx.abilities[s.abilityId] || {};
      const title = a.title || ('Способность ' + s.abilityId);
      const tip = `${esc(title)} · ${wr(s.winrate)} побед, ${num(s.matches)} матчей`;
      // На 10-м уровне вместо способности часто берут талант. Картинки у
      // талантов в игре нет вообще — рисуем значок «Т», а не битое изображение.
      if (a.isTalent) {
        const label = talentLabel(s.abilityId, a, ctx);
        return `<div class="hb-step hb-step-talent" title="${esc(label)} · ${wr(s.winrate)} побед, ${num(s.matches)} ${matchWord(s.matches)}">
          <em>Талант</em><u>${esc(shortTalent(label))}</u><span>${i + 1}</span>
        </div>`;
      }
      // Иконки нет ни у способности без имени, ни у врождённых способностей,
      // которые Valve не публикует. В сборке мы знаем список файлов заранее
      // (ctx.hasAbilityIcon) и не ставим ссылку вовсе; в браузере такого
      // списка нет, поэтому там страхует onerror ниже.
      const noIcon = !a.name || (ctx.hasAbilityIcon && !ctx.hasAbilityIcon(a.name));
      if (noIcon) {
        return `<div class="hb-step hb-step-empty" title="${tip}"><span>${i + 1}</span></div>`;
      }
      return `<div class="hb-step" title="${tip}">
        <img loading="lazy" src="${esc(abilityIcon(a.name))}" alt="${esc(title)}" onerror="this.closest('.hb-step').classList.add('hb-step-empty');this.remove()">
        <span>${i + 1}</span>
      </div>`;
    }).join('');
    return `<div class="hb-branch">
      <div class="hb-branch-head">
        <h3>${esc(label)}</h3><em>${esc(hint)}</em>
        <span class="hb-branch-nums"><b>${wr(branch.winrate)}</b> побед${branch.matches ? `<u>${num(branch.matches)} ${matchWord(branch.matches)}</u>` : ''}</span>
      </div>
      <div class="hb-steps">${cells}</div>
    </div>`;
  }

  /** Обозначения иконок в полосах прокачки: иконка + название способности. */
  function legendHtml(branches, ctx) {
    const esc = ctx.escapeHtml, seen = new Set(), out = [];
    for (const b of branches) for (const s of (b && b.steps) || []) {
      if (!s || seen.has(s.abilityId)) continue; seen.add(s.abilityId);
      const a = ctx.abilities[s.abilityId] || {};
      if (a.isTalent) { out.push(`<li><i class="hb-legend-t">Т</i><span>Талант: ${esc(talentLabel(s.abilityId, a, ctx))}</span></li>`); continue; }
      if (!a.name || (ctx.hasAbilityIcon && !ctx.hasAbilityIcon(a.name))) continue;
      out.push(`<li><img loading="lazy" src="${esc(abilityIcon(a.name))}" alt=""><span>${esc(a.title || a.name)}</span></li>`);
    }
    return out.length ? `<ul class="hb-legend" aria-label="Обозначения способностей">${out.join('')}</ul>` : '';
  }

  /** Таланты: уровни 25→10 сверху вниз, как в игре */
  function talentsHtml(talents, ctx) {
    if (!talents || !talents.length) return '';
    const esc = ctx.escapeHtml;
    const rows = talents.slice().sort((a, b) => b.level - a.level).map(t => {
      // Когда обе метки достаются одному таланту, вторая ничего не сообщает —
      // показываем одну. Если победитель по винрейту другой, метки расходятся
      // по своим сторонам и подсказывают выбор.
      const sameWinner = t.mostPicked === t.highestWin;
      const side = (o) => {
        if (!o) return '<div class="hb-tal-cell hb-tal-empty"></div>';
        const a = ctx.abilities[o.abilityId] || {};
        const isPick = o.abilityId === t.mostPicked;
        const isWin = o.abilityId === t.highestWin;
        let tag = '';
        if (isPick && (sameWinner || !isWin)) tag = '<i class="hb-tag hb-tag-pick">чаще берут</i>';
        else if (isWin) tag = '<i class="hb-tag hb-tag-win">выше винрейт</i>';
        // Талант, который в выборке не брали ни разу, всё равно показываем:
        // «ноль раз взяли» — это факт о таланте, а пустая половина дерева нет.
        // Талант без единого матча в выборке: не «плохой», а просто не
        // сложившийся в привычку — выбор остаётся за игроком.
        const unused = !o.matches;
        const stats = unused
          ? 'Решает игрок'
          : `Берут ${wr(o.pick)} · Побед ${wr(o.winrate)}`;
        return `<div class="hb-tal-cell${isPick ? ' is-picked' : ''}${isWin && !isPick ? ' is-win' : ''}${unused ? ' is-unused' : ''}">
          <b>${esc(cleanTalent(o.title) || talentLabel(o.abilityId, a, ctx))}</b>
          <span>${esc(stats)}</span>
          ${unused ? '' : tag}
        </div>`;
      };
      const opts = t.options.slice(0, 2);
      return `<div class="hb-tal-row">${side(opts[0])}<div class="hb-tal-lvl">${t.level}</div>${side(opts[1])}</div>`;
    }).join('');
    return `<h3 class="hb-sub-h">Таланты</h3><p class="hb-hint">На 10, 15, 20 и 25 уровне выбирают один талант из двух. <b>Берут</b> — доля игроков, выбравших талант, <b>Побед</b> — винрейт с ним. Рамка «чаще берут» — выбор большинства, зелёная «выше винрейт» — вариант, который выигрывает чаще.</p><div class="hb-talents">${rows}</div>`;
  }

  /** Полоса предметов с таймингами */
  function itemsHtml(items, ctx) {
    if (!items) return '';
    const esc = ctx.escapeHtml;
    const card = (x, withShare) => {
      // Уровни предмета (Dagon 2–5) ведут на базовую карточку: отдельных
      // страниц у них больше нет.
      const id = (ctx.itemVariants && ctx.itemVariants[x.itemId]) || x.itemId;
      const it = ctx.items[id];
      if (!it) return '';
      return `<a class="hb-item" href="/item/${esc(it.slug)}/" title="${esc(it.dname)} · побед ${wr(x.winrate)}">
        <span class="hb-item-when">${withShare ? wr(x.share) + ' · ' + minute(x.avgMinute) : minute(x.avgMinute)}</span>
        <img loading="lazy" src="${esc(itemIcon(it.slug))}" alt="${esc(it.dname)}" onerror="this.style.visibility='hidden'">
        <b>${esc(it.dname)}</b>
      </a>`;
    };
    const core = items.core.map(x => card(x, false)).filter(Boolean).join('');
    const sit = ctx.coreOnly ? '' : items.situational.map(x => card(x, true)).filter(Boolean).join('');
    if (!core && !sit) return '';
    return `${core ? `<div class="hb-sub"><h3>Основные предметы</h3><em>Что покупают почти всегда, в порядке среднего времени покупки</em><div class="hb-items hb-items-core">${core}</div></div>` : ''}
${sit ? `<div class="hb-sub"><h3>Ситуативные предметы</h3><em>Частота покупки и среднее время</em><div class="hb-items">${sit}</div></div>` : ''}`;
  }

  /**
   * Собирает оба блока. build — содержимое data/builds/<id>.json.
   * ctx: { escapeHtml, abilities: {id->{name,title}}, items: {id->{slug,dname}} }
   */
  function sectionsHtml(build, ctx) {
    if (!build || !build.positionOrder || !build.positionOrder.length) return '';
    const esc = ctx.escapeHtml;
    const multi = build.positionOrder.length > 1;

    const tabs = multi ? `<div class="hb-tabs" role="tablist" aria-label="Позиция героя">${
      build.positionOrder.map((p, i) => `<button type="button" role="tab" class="hb-tab${i === 0 ? ' on' : ''}" data-pos="${p}" aria-selected="${i === 0}">
        <i class="hb-tab-ico hr-ico hr-ico-${POS_KEY[p]}">${ctx.roleIcon ? ctx.roleIcon(POS_KEY[p]) : ''}</i>${esc(RU_POS[p] || p)}
      </button>`).join('')
    }</div>` : '';

    const panes = build.positionOrder.map((p, i) => {
      const v = build.positions[p];
      const chain = ctx.chains && ctx.chains[p];
      // Настоящая последовательность лучше поуровневого среза: она показывает,
      // как герои качаются на самом деле, а не что чаще встречается на уровне.
      const legend = legendHtml(chain ? [chainToBranch(chain.popular), chainToBranch(chain.highestWin)] : [v.progression.popular, v.progression.highestWin], ctx);
      const progs = chain
        ? `<h3 class="hb-sub-h">Порядок прокачки, уровни 1–10</h3><p class="hb-hint">Каждая клетка — уровень героя (цифра в углу) и способность, которую на нём качают. Наведите на иконку — появится название.</p>
          ${legend}
          <div class="hb-progressions">
            ${progressionHtml(chainToBranch(chain.popular), 'Самая популярная', 'реальная последовательность прокачки', ctx)}
            ${progressionHtml(chainToBranch(chain.highestWin), 'Лучшая по винрейту', 'наибольший процент побед', ctx)}
          </div>
          <p class="hb-source">Прокачка — рейтинговые матчи всех рангов (Steam), ${num(chain.sampleMatches)} ${matchWord(chain.sampleMatches)}. Таланты по ролям — ${v.supMerged ? 'рейтинговые матчи всех рангов (Steam), поддержка 4 и 5 — общий билд' : build.bracket === 'ALL' ? 'рейтинговые матчи всех рангов (Steam)' : 'матчи Divine/Immortal (Stratz)'}.</p>`
        : `<h3 class="hb-sub-h">Порядок прокачки, уровни 1–10</h3><p class="hb-hint">Каждая клетка — уровень героя и способность, которую на нём качают.</p>${legend}<div class="hb-progressions">
            ${progressionHtml(v.progression.popular, 'Частый выбор', 'самая популярная способность на каждом уровне', ctx)}
            ${progressionHtml(v.progression.highestWin, 'Выбор по винрейту', 'лучший процент побед на каждом уровне', ctx)}
          </div>${build.bracket === 'ALL' ? `<p class="hb-source">Прокачка и таланты — рейтинговые матчи всех рангов (Steam), ${num(v.matches)} ${matchWord(v.matches)}${v.supMerged ? ', поддержка 4 и 5 — общий билд' : ''}.</p>` : ''}`;
      return `<div class="hb-pane${i === 0 ? ' on' : ''}" data-pos="${p}">
        ${progs}
        ${talentsHtml(v.talents, ctx)}
      </div>`;
    }).join('');

    const itemPanes = build.positionOrder.map((p, i) =>
      `<div class="hb-pane${i === 0 ? ' on' : ''}" data-pos="${p}">${itemsHtml(build.positions[p].items, ctx)}</div>`
    ).join('');

    return `<section class="hp-builds container" id="heroBuilds" data-hero-id="${build.heroId}">
  <h2>Прокачка и таланты</h2>
  <p class="hb-lead">Как качают героя и какие таланты берут${multi ? ' — выберите роль:' : '.'}</p>
  ${tabs}
  <div class="hb-panes hb-panes-skills">${panes}</div>

  <h2 class="hb-h2-second">${ctx.coreOnly ? 'Порядок сборки на высоком ранге' : `Что покупают на ${esc(build.heroName)}`}</h2>
  <p class="hb-lead">${ctx.coreOnly ? 'Основные предметы в порядке средней минуты покупки. Stratz, матчи Divine/Immortal, по выбранной роли.' : 'Stratz, матчи Divine/Immortal, по выбранной роли. Время — средняя минута покупки.'}</p>
  <div class="hb-panes hb-panes-items">${itemPanes}</div>
</section>`;
  }

  return { sectionsHtml, RU_POS, POS_KEY };
});

/**
 * Переключение позиций на странице героя.
 * Вкладки билда (одна кнопка — обе панели Stratz) и строка ролей наверху:
 * клик по роли включает билд Stratz этой роли и покупки из нашей базы для неё.
 * Роль кликабельна, если хотя бы одно из двух для неё есть; чего нет —
 * честно подписано, показывается ближайшее доступное (билд первой роли,
 * покупки по всем ролям).
 */
(function () {
  if (typeof document === 'undefined') return;
  const RU = { POSITION_1: 'Керри', POSITION_2: 'Мид', POSITION_3: 'Оффлейн', POSITION_4: 'Поддержка', POSITION_5: 'Полная поддержка' };

  function showBuild(host, pos) {
    if (!host) return false;
    const has = !!host.querySelector(`.hb-panes-skills .hb-pane[data-pos="${pos}"]`);
    const target = has ? pos : (host.querySelector('.hb-panes-skills .hb-pane') || {}).dataset?.pos;
    if (!target) return false;
    host.querySelectorAll('.hb-tab').forEach(b => { const on = b.dataset.pos === target; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    host.querySelectorAll('.hb-pane').forEach(p => p.classList.toggle('on', p.dataset.pos === target));
    let note = host.querySelector('.hb-rolenote');
    if (!note) { note = document.createElement('p'); note.className = 'hb-rolenote'; host.querySelector('.hb-lead').after(note); }
    note.hidden = has || pos === 'all';
    if (!note.hidden) note.textContent = `Для роли «${RU[pos]}» мало матчей — показан билд роли «${RU[target]}».`;
    return has;
  }

  function showBuys(box, pos, roles, minRole) {
    if (!box) return false;
    const has = pos !== 'all' && !!box.querySelector(`.hp-buys-pane[data-pos="${pos}"]`);
    const target = has ? pos : 'all';
    box.querySelectorAll('.hp-buys-pane').forEach(p => { const on = p.dataset.pos === target; p.hidden = !on; p.classList.toggle('on', on); });
    let note = box.querySelector('.hp-buys-rolenote');
    if (!note) { note = document.createElement('p'); note.className = 'hp-buys-note hp-buys-rolenote'; box.querySelector('.hp-buys-note').after(note); }
    note.hidden = has || pos === 'all';
    if (!note.hidden) note.textContent = `На роли «${RU[pos]}» у героя ${roles[pos] || 0} матчей в нашей базе (свой список — от ${minRole}) — показаны покупки по всем ролям.`;
    return has;
  }

  function bind() {
    const host = document.getElementById('heroBuilds');
    if (host) host.querySelectorAll('.hb-tab').forEach(btn => btn.addEventListener('click', () => showBuild(host, btn.dataset.pos)));

    const rolesHost = document.getElementById('heroRoles');
    const row = rolesHost && rolesHost.querySelector('[data-hero-roles]');
    const R = window.D2HRoles;
    if (!row || !R || !R.bindSwitch) return;
    const box = document.getElementById('heroBuys');
    let roles = {};
    try { roles = box ? JSON.parse(box.dataset.roles || '{}') : {}; } catch (e) { roles = {}; }
    const minRole = box ? Number(box.dataset.minRole) || 80 : 80;
    const avail = {};
    for (const pos of Object.keys(RU)) {
      // Роль доступна, только когда для неё есть свой билд (прокачка, таланты, сборка).
      // Иначе она неактивна и не нажимается — без подмены чужим билдом. Страницы
      // пересобираются при каждом обновлении данных, поэтому роль включится сама,
      // как только матчей станет достаточно.
      const b = !!(host && host.querySelector(`.hb-panes-skills .hb-pane[data-pos="${pos}"]`));
      avail[pos] = b ? true : `Пока мало данных: на этой роли недостаточно матчей для своего билда (в нашей базе ${roles[pos] || 0} матчей героя на роли).`;
    }
    const select = R.bindSwitch(row, avail, pos => {
      showBuild(host, pos);
      showBuys(box, pos, roles, minRole);
    });
    // Вкладки ролей внутри «Прокачки» и строка ролей — один переключатель.
    if (host && select) host.querySelectorAll('.hb-tab').forEach(btn => btn.addEventListener('click', () => select(btn.dataset.pos)));
  }
  document.addEventListener('d2h:roles-row', bind);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
