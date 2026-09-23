/**
 * Блоки «Способности и таланты» и «Прогресс по предметам» на странице героя.
 *
 * Данные: Stratz, брекет Divine/Immortal, по каждой из популярных позиций
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

  /** Иконка способности: локальный ассет, внешних запросов нет */
  function abilityIcon(name) { return '/assets/abilities/' + name + '.png'; }
  function itemIcon(slug) { return '/assets/items/' + slug + '.png'; }

  /** Одна ветка прокачки 1–10 */
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
        return `<div class="hb-step hb-step-talent" title="${tip}"><u>Т</u><span>${i + 1}</span></div>`;
      }
      if (!a.name) {
        return `<div class="hb-step hb-step-empty" title="${tip}"><span>${i + 1}</span></div>`;
      }
      return `<div class="hb-step" title="${tip}">
        <img loading="lazy" src="${esc(abilityIcon(a.name))}" alt="${esc(title)}" onerror="this.closest('.hb-step').classList.add('hb-step-empty');this.remove()">
        <span>${i + 1}</span>
      </div>`;
    }).join('');
    return `<div class="hb-branch">
      <div class="hb-branch-head"><h3>${esc(label)}</h3><em>${esc(hint)}</em><b>${wr(branch.winrate)}</b></div>
      <div class="hb-steps">${cells}</div>
    </div>`;
  }

  /** Таланты: уровни 25→10 сверху вниз, как в игре */
  function talentsHtml(talents, ctx) {
    if (!talents || !talents.length) return '';
    const esc = ctx.escapeHtml;
    const rows = talents.slice().sort((a, b) => b.level - a.level).map(t => {
      const side = (o) => {
        if (!o) return '<div class="hb-tal-cell hb-tal-empty"></div>';
        const a = ctx.abilities[o.abilityId] || {};
        const tags = [];
        if (o.abilityId === t.mostPicked) tags.push('<i class="hb-tag hb-tag-pick">чаще берут</i>');
        if (o.abilityId === t.highestWin) tags.push('<i class="hb-tag hb-tag-win">выше винрейт</i>');
        return `<div class="hb-tal-cell${o.abilityId === t.mostPicked ? ' is-picked' : ''}">
          <b>${esc(a.title || ('Талант ' + o.abilityId))}</b>
          <span>Берут ${wr(o.pick)} · Побед ${wr(o.winrate)}</span>
          ${tags.join('')}
        </div>`;
      };
      const opts = t.options.slice(0, 2);
      return `<div class="hb-tal-row">${side(opts[0])}<div class="hb-tal-lvl">${t.level}</div>${side(opts[1])}</div>`;
    }).join('');
    return `<div class="hb-talents">${rows}</div>`;
  }

  /** Полоса предметов с таймингами */
  function itemsHtml(items, ctx) {
    if (!items) return '';
    const esc = ctx.escapeHtml;
    const card = (x, withShare) => {
      const it = ctx.items[x.itemId];
      if (!it) return '';
      return `<a class="hb-item" href="/item/${esc(it.slug)}/" title="${esc(it.dname)} · побед ${wr(x.winrate)}">
        <span class="hb-item-when">${withShare ? wr(x.share) + ' · ' + minute(x.avgMinute) : minute(x.avgMinute)}</span>
        <img loading="lazy" src="${esc(itemIcon(it.slug))}" alt="${esc(it.dname)}" onerror="this.style.visibility='hidden'">
        <b>${esc(it.dname)}</b>
      </a>`;
    };
    const core = items.core.map(x => card(x, false)).filter(Boolean).join('');
    const sit = items.situational.map(x => card(x, true)).filter(Boolean).join('');
    if (!core && !sit) return '';
    return `${core ? `<div class="hb-sub"><h3>Прогресс по основным предметам</h3><em>Что покупают почти всегда, в порядке среднего времени покупки</em><div class="hb-items hb-items-core">${core}</div></div>` : ''}
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
      return `<div class="hb-pane${i === 0 ? ' on' : ''}" data-pos="${p}">
        <div class="hb-progressions">
          ${progressionHtml(v.progression.popular, 'Частый выбор', 'самая популярная способность на каждом уровне', ctx)}
          ${progressionHtml(v.progression.highestWin, 'Выбор по винрейту', 'лучший процент побед на каждом уровне', ctx)}
        </div>
        ${talentsHtml(v.talents, ctx)}
      </div>`;
    }).join('');

    const itemPanes = build.positionOrder.map((p, i) =>
      `<div class="hb-pane${i === 0 ? ' on' : ''}" data-pos="${p}">${itemsHtml(build.positions[p].items, ctx)}</div>`
    ).join('');

    return `<section class="hp-builds container" id="heroBuilds" data-hero-id="${build.heroId}">
  <h2>Способности и таланты</h2>
  <p class="hb-lead">Популярные варианты развития и выбора талантов${multi ? ' для каждой роли героя' : ''}</p>
  ${tabs}
  <div class="hb-panes hb-panes-skills">${panes}</div>

  <h2 class="hb-h2-second">Прогресс</h2>
  <p class="hb-lead">Обычные покупки, в среднем по минутам матча</p>
  <div class="hb-panes hb-panes-items">${itemPanes}</div>
</section>`;
  }

  return { sectionsHtml, RU_POS, POS_KEY };
});

/** Переключение позиций: одна кнопка — обе панели (способности и предметы) */
(function () {
  if (typeof document === 'undefined') return;
  function bind() {
    const host = document.getElementById('heroBuilds');
    if (!host) return;
    host.querySelectorAll('.hb-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const pos = btn.dataset.pos;
        host.querySelectorAll('.hb-tab').forEach(b => {
          const on = b === btn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-selected', String(on));
        });
        host.querySelectorAll('.hb-pane').forEach(p => p.classList.toggle('on', p.dataset.pos === pos));
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
