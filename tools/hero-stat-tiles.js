// Паспорт героя и плитки статистики для страниц /hero/<slug>/ (build-hero-pages.js).
// Данные — data/stats.json (своя база, tools/build-stats.js), hero-counters.json, hero-items.json.
// Пороги показа — из stats.method, как на /stats/: блок ниже порога не выводится.
'use strict';
const POS = {1:'Керри',2:'Мид',3:'Оффлейн',4:'Поддержка',5:'Полная поддержка'};
const PHASES = [['start','Старт','до 0:00'],['early','Ранняя','0–10 мин'],['mid','Середина','10–25 мин'],['late','Поздняя','25–40 мин'],['vlate','Финал','40+ мин']];
const f1 = x => x.toFixed(1).replace('.', ',');
const sg = x => (x > 0 ? '+' : x < 0 ? '−' : '±') + f1(Math.abs(x));
const nf = n => Number(n).toLocaleString('ru-RU');
const bar = (w, lo = 40, hi = 60) => Math.max(2, Math.min(100, (w - lo) / (hi - lo) * 100)).toFixed(1);

function render(h, ctx) {
  const { S, counters, heroItems, byId, itemById, itemVariants, escapeHtml: esc, slugForHero, imageUrl, minRole } = ctx;
  const id = Number(h.id);
  const st = S && Array.isArray(S.heroes) ? S.heroes.find(x => x.id === id) : null;
  const M = (S && S.method) || {};
  const RANK = S && S.base && S.base.ranks ? Object.fromEntries(Object.entries(S.base.ranks).map(([k, v]) => [k, v.name])) : {};
  const icon = hid => { const o = byId.get(Number(hid)); return o ? `<a class="hx-hico" href="/hero/${slugForHero(o)}/"><img src="${imageUrl(o)}" alt="" loading="lazy" width="44" height="25"><span>${esc(o.localized_name)}</span></a>` : ''; };
  const name = esc(h.localized_name);

  // --- место и основная позиция
  let place = 0, ranked = [], mainPos = null, roShare = 0;
  if (st) {
    ranked = S.heroes.filter(x => x.n >= (M.minTier || 0)).sort((a, b) => b.wr - a.wr);
    place = ranked.findIndex(x => x.id === id) + 1;
    const ro = [...(st.ro || [])].sort((a, b) => b[1] - a[1]);
    if (ro.length) { mainPos = ro[0][0]; roShare = ro[0][1]; }
  }
  // --- сравнение с ролью
  const P = mainPos && S.positions ? S.positions[mainPos] : null;
  const ph = P ? P.heroes.find(x => x.id === id && x.n >= (M.minPos || 0)) : null;
  let roleTile = '', rolePlace = '';
  if (ph) {
    const pool = P.heroes.filter(x => x.n >= (M.minPos || 0));
    const avgWr = pool.reduce((a, x) => a + x.wr * x.n, 0) / pool.reduce((a, x) => a + x.n, 0);
    rolePlace = `${[...pool].sort((a, b) => b.wr - a.wr).findIndex(x => x.id === id) + 1} из ${pool.length}`;
    const row = (k, v, a, isInt) => {
      const d = v - a, rel = Math.max(-1, Math.min(1, d / (Math.abs(a) * 0.12 || 1)));
      const up = d >= 0, shown = isInt ? (up ? '+' : '−') + nf(Math.abs(Math.round(d))) : sg(d) + ' пп';
      return `<tr><th>${k}</th><td>${isInt ? nf(v) : f1(v) + ' %'}</td><td class="hx-mut">${isInt ? nf(Math.round(a)) : f1(a) + ' %'}</td><td><span class="hx-dev"><i class="${up ? 'up' : 'dn'}" style="${up ? 'left' : 'right'}:50%;width:${(Math.abs(rel) * 50).toFixed(1)}%"></i></span><b class="${up ? 'up' : 'dn'}">${shown}</b></td></tr>`;
    };
    roleTile = `<article class="hx-tile hx-wide"><h2>${name} против других: ${POS[mainPos]}</h2>
<p class="hx-lead">Место по винрейту на этой позиции: <b>${rolePlace}</b> героев (от ${M.minPos} игр на позиции).</p>
<table class="hx-cmp"><thead><tr><th></th><th>Герой</th><th>Среднее</th><th>Разница</th></tr></thead><tbody>
${row('Винрейт', ph.wr, avgWr)}${row('Золото в минуту', ph.gpm, P.gpm, 1)}${row('Опыт в минуту', ph.xpm, P.xpm, 1)}</tbody></table>
<p class="hx-note">${nf(ph.n)} игр героя на позиции; среднее — по ${nf(P.n)} играм всех героев этой позиции.</p></article>`;
  }
  // --- выводы по правилам с порогом
  const notes = [];
  if (st) {
    const rk = k => st.rank && st.rank[k] && st.rank[k][0] >= (M.minRank || 0) ? st.rank[k] : null;
    const lowR = [rk(1), rk(2)].filter(Boolean), highR = [rk(5), rk(6)].filter(Boolean);
    const w = a => a.reduce((s, x) => s + x[1] * x[0], 0) / a.reduce((s, x) => s + x[0], 0);
    if (lowR.length && highR.length) {
      const d = w(lowR) - w(highR);
      if (Math.abs(d) >= 2) notes.push(d > 0 ? `Сильнее на низких рангах: ${f1(w(lowR))} % у Рекрута–Стража против ${f1(w(highR))} % у Легенды–Властелина` : `Сильнее на высоких рангах: ${f1(w(highR))} % у Легенды–Властелина против ${f1(w(lowR))} % у Рекрута–Стража`);
    }
    const e = (st.dur || {}).lt25 || [0, 0], l = (st.dur || {}).gt45 || [0, 0];
    const durOk = e[0] >= (M.minDur || 0) && l[0] >= (M.minDur || 0) && e[0] > 0 && l[0] > 0;
    if (durOk && Math.abs(l[1] - e[1]) >= 3) notes.push(l[1] > e[1] ? `Лучше в долгих играх: ${f1(l[1])} % после 45 мин против ${f1(e[1])} % до 25 мин` : `Лучше в коротких играх: ${f1(e[1])} % до 25 мин против ${f1(l[1])} % после 45 мин`);
    const ln = (S.lanes || []).find(x => x.id === id && x.n >= (M.minLane || 0));
    if (ln && Math.abs(ln.win - ln.loss) >= 8) notes.push(ln.win > ln.loss ? `Обычно выигрывает линию: ${f1(ln.win)} % побед против ${f1(ln.loss)} % поражений` : `Часто проигрывает линию: ${f1(ln.loss)} % поражений против ${f1(ln.win)} % побед`);
    if (ph && Math.abs(ph.gpm - P.gpm) / P.gpm >= 0.05) notes.push(ph.gpm > P.gpm ? `Фармит быстрее своей роли: ${ph.gpm} золота/мин при среднем ${P.gpm}` : `Фармит медленнее своей роли: ${ph.gpm} золота/мин при среднем ${P.gpm}`);
    if (!notes.length && lowR.length && highR.length && durOk) notes.push('Без явных перекосов: Рекрут–Страж и Легенда–Властелин различаются меньше чем на 2 пп, игры до 25 и после 45 мин — меньше чем на 3 пп');
  }
  // --- паспорт
  const A = { str: ['Сила', 'str'], agi: ['Ловкость', 'agi'], int: ['Интеллект', 'int'], all: ['Универсальный', 'uni'], universal: ['Универсальный', 'uni'] }[h.primary_attr] || ['Универсальный', 'uni'];
  const cx = Math.max(1, Math.min(3, Number(h.complexity) || 1));
  const kpi = (k, v, s) => `<div class="hx-kpi"><small>${k}</small><b>${v}</b>${s ? `<em>${s}</em>` : ''}</div>`;
  const tierCls = { S: 's', A: 'a', B: 'b', C: 'c', D: 'd' }[st && st.tier] || 'c';
  const passport = `<section class="hx-pass container">
  <img class="hx-portrait" src="${imageUrl(h)}" alt="${name}" width="256" height="144" fetchpriority="high">
  <div class="hx-id">
    <nav aria-label="breadcrumb" class="hp-crumbs"><a href="/heroes/">Герои</a> <span>›</span> <span aria-current="page">${name}</span></nav>
    <h1>${name} <span>— билд, контрпики, винрейт</span></h1>
    <p class="hx-sub"><i class="hx-attr ${A[1]}"></i>${A[0]} · ${h.attack_type === 'Melee' ? 'Ближний бой' : h.attack_type === 'Ranged' ? 'Дальний бой' : '—'}${mainPos ? ` · ${POS[mainPos]} в ${f1(roShare)} % игр` : ''}</p>
  </div>
  <div class="hx-kpis">
    ${st && st.tier ? kpi('Тир', `<span class="hx-tier ${tierCls}">${esc(st.tier)}</span>`) : ''}
    ${st ? kpi('Винрейт', f1(st.wr) + ' %', place ? `место ${place} из ${ranked.length}` : '') : ''}
    ${st ? kpi('Пикрейт', f1(st.pr) + ' %') : ''}
    ${st ? kpi('Матчей', nf(st.n)) : ''}
    ${rolePlace ? kpi('Место в роли', rolePlace, POS[mainPos]) : ''}
    ${kpi('Сложность', `<span aria-label="Сложность ${cx} из 3">${'●'.repeat(cx)}<span class="hx-mut">${'●'.repeat(3 - cx)}</span></span>`)}
  </div>
  ${notes.length ? `<ul class="hx-notes">${notes.slice(0, 3).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  ${st ? `<p class="hx-src">Своя база: ${nf(S.base.matches)} рейтинговых матчей${S.base.src === 'steam' ? ' всех рангов' : ''}. <a href="/stats/">Вся статистика героев</a></p>` : ''}
</section>`;

  // --- плитки
  const lead = [], small = [];
  if (st) {
    const ranks = Object.keys(st.rank || {}).filter(k => st.rank[k][0] >= (M.minRank || 0));
    if (ranks.length) (roleTile ? lead : small).push(`<article class="hx-tile"><h2>Винрейт по рангам</h2><div class="hx-cols">${ranks.map(k => `<div title="${nf(st.rank[k][0])} игр"><b>${f1(st.rank[k][1])}</b><span style="height:${bar(st.rank[k][1])}%"></span><small>${esc(RANK[k] || k)}</small></div>`).join('')}</div><p class="hx-note">Шкала 40–60 %, линия — 50 %. От ${M.minRank} игр на ранге.</p></article>`);
    const durs = (M.durBuckets || []).filter(([k]) => st.dur && st.dur[k] && st.dur[k][0] >= (M.minDur || 0));
    if (durs.length) small.push(`<article class="hx-tile"><h2>Винрейт по длительности</h2><div class="hx-cols">${durs.map(([k, lab]) => `<div title="${nf(st.dur[k][0])} игр"><b>${f1(st.dur[k][1])}</b><span style="height:${bar(st.dur[k][1])}%"></span><small>${esc(lab)}</small></div>`).join('')}</div><p class="hx-note">Шкала 40–60 %, линия — 50 %.</p></article>`);
    const ln = (S.lanes || []).find(x => x.id === id && x.n >= (M.minLane || 0));
    if (ln) small.push(`<article class="hx-tile"><h2>Линия к 10-й минуте</h2><div class="hx-lane"><i class="w" style="width:${ln.win}%">${f1(ln.win)}</i><i class="d" style="width:${ln.draw}%">${f1(ln.draw)}</i><i class="l" style="width:${ln.loss}%">${f1(ln.loss)}</i></div><p class="hx-legend"><span class="w">победа</span><span class="d">ничья</span><span class="l">поражение</span><span>— доля игр, %</span></p><p class="hx-note">${nf(ln.n)} игр с разбором линии.</p></article>`);
    const other = x => x.a === id ? x.b : x.a;
    const sy = (S.synergy || []).filter(x => x.a === id || x.b === id), an = (S.antiSynergy || []).filter(x => x.a === id || x.b === id);
    if (sy.length || an.length) small.push(`<article class="hx-tile"><h2>В одной команде</h2>${sy.length ? `<h3>Хорошие связки</h3><ul class="hx-mu">${sy.slice(0, 4).map(x => `<li>${icon(other(x))}<b class="up">${sg(x.d)} пп</b></li>`).join('')}</ul>` : ''}${an.length ? `<h3>Плохие связки</h3><ul class="hx-mu">${an.slice(0, 4).map(x => `<li>${icon(other(x))}<b class="dn">${sg(x.d)} пп</b></li>`).join('')}</ul>` : ''}<p class="hx-note">Винрейт пары против ожидаемого, от ${M.minPair} игр вместе.</p></article>`);
  }
  const hc = counters && counters.heroes ? counters.heroes[String(id)] : null;
  const mu = (arr, cls) => (arr || []).slice(0, 5).map(x => { const ic = icon(x.id); return ic ? `<li>${ic}<b class="${cls}">${sg(x.d)} пп</b></li>` : ''; }).join('');
  const muAgainst = mu(hc && hc.against, 'dn'), muGood = mu(hc && hc.good, 'up');
  const matchups = (muAgainst || muGood) ? `<article class="hx-tile" id="matchups"><h2>Матчапы</h2><div class="hx-two">
<div><h3>Кто контрит ${name}</h3>${muAgainst ? `<ul class="hx-mu">${muAgainst}</ul>` : '<p class="hx-note">Пар от ' + (counters.minGames || 300) + ' игр пока нет.</p>'}</div>
<div><h3>Кого контрит ${name}</h3>${muGood ? `<ul class="hx-mu">${muGood}</ul>` : '<p class="hx-note">Пар от ' + (counters.minGames || 300) + ' игр пока нет.</p>'}</div></div>
<p class="hx-note">Разница винрейта против ожидаемого по силе героев, пары от ${counters.minGames || 300} игр. <a href="/guide/counter-picks/">Как работают контрпики</a></p></article>` : '';

  // --- покупки: один блок; роли переключает строка ролей (js/hero-builds.js, #heroBuys)
  const rec = heroItems && heroItems.heroes ? heroItems.heroes[String(id)] : null;
  // Пять фаз колонками на всю ширину: иконка, название, доля матчей и полоса той же доли.
  const phaseCol = (r, k, lab, time) => {
    const n = Number(r && r.n) || 0;
    const rows = ((r && r[k]) || []).map(x => ({ id: itemVariants[Number(x.i)] ?? Number(x.i), g: Number(x.g) || 0 })).filter(x => itemById.has(x.id)).slice(0, 6);
    if (!n || !rows.length) return '';
    return `<div class="hx-bcol"><h3>${lab}<small>${time}</small></h3><ul>${rows.map(x => { const it = itemById.get(x.id); const p = Math.round(x.g / n * 100); return `<li><a href="/item/${it.slug}/" title="${esc(it.dname)} — ${p}% матчей (${x.g} из ${n})"><i style="width:${p}%"></i><img src="/assets/items/${it.slug}.png" alt="" loading="lazy" width="36" height="26"><span>${esc(it.dname)}</span><b>${p}%</b></a></li>`; }).join('')}</ul></div>`;
  };
  const pane = r => { const cols = PHASES.map(([k, lab, time]) => phaseCol(r, k, lab, time)).join(''); return cols ? `<div class="hx-bcols">${cols}</div>` : ''; };
  let buys = '';
  if (rec && Number(rec.n) >= minRole) {
    const all = pane(rec);
    if (all) {
      const roles = Object.entries(rec.pos || {}).map(([p, r]) => { const b = pane(r); return b ? `<div class="hp-buys-pane" data-pos="POSITION_${p}" hidden><p class="hp-buys-role">Роль: ${POS[p]} · ${nf(r.n)} матчей героя на этой роли</p>${b}</div>` : ''; }).join('');
      const buyRoles = {}; for (const p of [1, 2, 3, 4, 5]) buyRoles['POSITION_' + p] = rec.pos && rec.pos[p] ? 1 : ((rec.posN && rec.posN[p]) || 0);
      buys = `<article class="hx-tile" id="heroBuys" data-roles='${JSON.stringify(buyRoles)}' data-min-role="${minRole}"><h2>Что покупают по ходу игры</h2>
<p class="hp-buys-note">Своя база матчей текущего патча (${nf(heroItems.matchesUsed)} матчей с временем покупок). % — доля матчей героя, где предмет купили в этой фазе (всего ${nf(rec.n)}).</p>
<div class="hp-buys-pane on" data-pos="all">${all}</div>${roles}</article>`;
    }
  }
  const rows = `${lead.length || roleTile ? `<div class="hx-row r1">${roleTile}${lead.join('')}</div>` : ''}${small.length ? `<div class="hx-row">${small.join('')}</div>` : ''}${matchups}${buys}`;
  return { passport, rows, notesCount: notes.length };
}
module.exports = { render };
