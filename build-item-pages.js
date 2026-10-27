#!/usr/bin/env node
// Статические страницы предметов: deploy/item/<slug>/index.html.
//
// Источник данных — data/items-ru.json (собирает tools/build-items-ru.py из
// официального русского datafeed Valve). Сеть здесь больше не нужна: и текст,
// и числа, и картинки лежат в репозитории, поэтому страница предмета, карточка
// в каталоге и модалка показывают ровно одно и то же.
//
// Рецепты своей страницы не получают: их карточка ведёт на собираемый предмет.

const siteNav = require('./tools/site-nav');
const heroCardHtml = require('./tools/hero-card.js');
const fs = require('fs');
const path = require('path');

// Заранее сгенерированные русские meta description (tools/gen-item-meta.py):
// у них выверена длина под выдачу. Если для предмета такого нет — режем
// начало русского описания.
const seoDesc = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seo', 'item-descriptions.json'), 'utf8')); }
  catch { return {}; }
})();

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function itemSlug(name){return String(name||"").replace(/^item_/,'').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');}
function descText(x){return (x.desc||[]).map(b=>[b.h,b.t].filter(Boolean).join('. ')).join(' ').replace(/\s+/g,' ').trim();}
function trimTo(s,n){const t=String(s||'').trim();if(t.length<=n)return t;const cut=t.slice(0,n);const sp=cut.lastIndexOf(' ');return (sp>60?cut.slice(0,sp):cut).replace(/[\s,.;:—-]+$/,'')+'…';}

async function main(){
  const store=JSON.parse(fs.readFileSync(path.join(__dirname,'data','items-ru.json'),'utf8')).items;
  const statsAll=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-stats.json'),'utf8'));}catch{return null;}})();
  const timingAll=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-timings.json'),'utf8'));}catch{return null;}})();
  const followupsAll=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-followups.json'),'utf8'));}catch{return null;}})();
  const impact=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-impact.json'),'utf8'));}catch{return null;}})();
  // Статьи о предмете (/guide/) — tools/guide-items.js.
  const guideByItem=require('./tools/guide-items.js').linkGuideItems().byItem;
  const usage=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-heroes.json'),'utf8')).items;}catch{return {};}})();
  // Общее правило каталога: рецепты и повторные уровни одного предмета
  // (Dagon 2–5, Necronomicon 2–3) своей страницы не получают — иначе в
  // выдаче пять одинаковых «Dagon». Данные о них остаются в items-ru.json,
  // а старые адреса переадресуются на базовый предмет в deploy/.htaccess.
  const V=require('./js/item-variants.js');
  const variantMaps=V.buildVariantMaps(store);
  const entries=Object.entries(store).filter(([key,x])=>
    x.dname && !x.recipeFor && !variantMaps.byKey[key]);

  // Герои нужны, чтобы к именам в блоке покупок добавить иконку и ссылку.
  const {slugForHero}=require('./tools/hero-common.js');
  const heroById=new Map();
  try{
    for(const h of JSON.parse(fs.readFileSync(path.join(__dirname,'data','heroes.json'),'utf8')).heroes)
      heroById.set(Number(h.id),h);
  }catch{}

  const outRoot=process.env.ITEM_OUT||path.join(__dirname,'deploy','item');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  const only=process.env.ITEM_ONLY?process.env.ITEM_ONLY.split(','):null;
  for(const [key,x] of entries){
    if(only&&!only.includes(key)) continue;
    const slug=itemSlug(key);
    if(!slug) continue;
    const dir=path.join(outRoot,slug);
    fs.mkdirSync(dir,{recursive:true});

    const img=x.img||`/assets/items/${slug}.png`;
    const ogImage=`https://dotamate.ru${img}`;
    const title=[`${x.dname} — предмет Dota 2: характеристики и описание | Dota Mate`,`${x.dname} — предмет Dota 2: описание и сборка | Dota Mate`,`${x.dname} — предмет Dota 2 | Dota Mate`].find(t=>t.length<=70)||`${x.dname} | Dota Mate`;   // до 70 знаков: дальше поисковики обрезают
    const storedDesc=seoDesc[slug];
    const desc=(typeof storedDesc==='string'&&storedDesc.includes(x.dname))?storedDesc:trimTo(`${x.dname}. ${descText(x)}`,300);
    const lead=trimTo(descText(x),150);
    const canonical=`https://dotamate.ru/item/${slug}/`;
    const ldjson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Предметы","item":"https://dotamate.ru/items/"},{"@type":"ListItem","position":3,"name":x.dname,"item":canonical}]});

    const descHtml=(x.desc||[]).map(b=>`<div class="ip-block">${b.h?`<h3>${escapeHtml(b.h)}</h3>`:''}${String(b.t||'').split('\n').filter(Boolean).map(t=>`<p>${escapeHtml(t)}</p>`).join('')}</div>`).join('');
    const notesHtml=(x.notes||[]).map(n=>`<p>• ${escapeHtml(n)}</p>`).join('');
    const attribHtml=(x.attr||[]).map(t=>`<div><small>${escapeHtml(t)}</small></div>`).join('');
    // Ссылки «собирается из» и «входит в сборку». Рецепт ведёт на свой
    // предмет, уровень — на базовый (иначе Necronomicon ссылался бы на
    // собственный второй уровень, у которого страницы уже нет), ссылка на
    // самого себя отбрасывается.
    const link=k=>{
      const it=store[k];
      if(!it)return '';
      const target=variantMaps.byKey[it.recipeFor||k]||it.recipeFor||k;
      if(target===key)return '';
      const dest=store[target];
      return dest?`<a href="/item/${itemSlug(target)}/"><img src="${dest.img}" alt="${escapeHtml(dest.dname)}">${escapeHtml(dest.dname)}<span>→</span></a>`:'';
    };
    const componentsHtml=(x.comp||[]).map(link).filter(Boolean).join('');
    const intoHtml=(x.into||[]).map(link).filter(Boolean).join('');
    // Уровни улучшения — только у предметов, у которых они есть
    const levels=V.levelsOf(key,store);
    const levelsHtml=levels.length?`<div class="item-levels-grid">${levels.map(l=>
      `<div class="item-level"><b>${l.level}</b><span>${Number(l.cost).toLocaleString('ru-RU')} G</span><i>${l.step?'+'+Number(l.step).toLocaleString('ru-RU')+' G за улучшение':'базовый'}</i></div>`
    ).join('')}</div>`:'';
    const use=usage[String(x.id)];
    // Список героев с иконками и ссылкой на страницу героя: имя одно читается
    // тяжелее, а иконка узнаётся мгновенно. Слаг и картинка берутся из того же
    // справочника героев, что и остальной сайт; если героя в нём нет,
    // показываем строку без иконки, но не ломаем блок.
    const heroesHtml=(use&&use.heroes||[]).map(r=>{
      const h=heroById.get(Number(r.h));
      const slug=h?slugForHero(h):'';
      const icon=slug?`<img loading="lazy" src="/assets/heroes/${slug}.webp" alt="">`:'';
      const inner=`${icon}<span><b>${escapeHtml(r.n)}</b><i>${r.g} покупок · чаще: ${escapeHtml(r.p)}</i></span>`;
      return slug?`<li><a href="/hero/${slug}/">${inner}</a></li>`:`<li>${inner}</li>`;
    }).join('');
    // ---- Вариант A (02.10.2026): шапка, колонка цифр справа, дерево сборки, время покупки.
    const st=statsAll&&statsAll.items[key]||null;
    const verifiedMatches=Number(timingAll?.meta?.matches)||0;
    const timing=timingAll?.meta?.source==='Valve replay purchase events' && verifiedMatches>=30 &&
      timingAll.items?.[key]?.n>=30 && Array.isArray(timingAll.items[key].t) &&
      Array.isArray(timingAll.items[key].hist) && timingAll.items[key].hist.length===11 &&
      Array.isArray(timingAll.bins) && timingAll.bins.length===10 ? timingAll.items[key] : null;
    const nf=v=>Number(v).toLocaleString('ru-RU');
    const pct=(a,b)=>(Math.round(a/b*1000)/10).toLocaleString('ru-RU');
    const mins=s=>(Math.round(s/6)/10).toLocaleString('ru-RU');
    const kicker=[x.cat==='neutral'?`Нейтральный${x.tier?` · тир ${x.tier}`:''}`:(x.catRu||'Предмет'),x.cost?`${nf(x.cost)} золота`:''].filter(Boolean).join(' · ');
    // Атрибуты из datafeed двух видов: бонусы («+250 к здоровью») — чипы в
    // шапке; подписанные значения («105 / 125 ПЕРЕЗАРЯДКА:») приходят задом
    // наперёд и капсом — разворачиваем в строку «Перезарядка — 105 / 125».
    const labelled=[];
    const chips=(x.attr||[]).map(t=>{
      const m=String(t).match(/^(.*?\d.*?)\s+([A-Za-zА-Яа-яЁё][^:]*?):\s*$/);
      if(m){const l=m[2].toLowerCase().replace(/observer ward/g,'Observer Ward').replace(/sentry ward/g,'Sentry Ward');const lab=l.charAt(0).toUpperCase()+l.slice(1);labelled.push([lab,/^Перезарядка/.test(lab)&&!/\s(сек|мин)/.test(m[1])?m[1]+' сек':m[1]]);return '';}
      return `<span>${escapeHtml(t)}</span>`;}).filter(Boolean).join('');
    const node=(k,me)=>{const it=store[k];if(!it)return '';const t=variantMaps.byKey[it.recipeFor||k]||it.recipeFor||k;const d=store[t];if(!d)return '';
      return me?`<span class="it-node it-me"><img src="${d.img}" alt="">${escapeHtml(d.dname)}</span>`:(t===key?'':`<a class="it-node" href="/item/${itemSlug(t)}/"><img src="${d.img}" alt="" loading="lazy">${escapeHtml(d.dname)}</a>`);};
    const uniq=a=>[...new Set(a)];
    const compN=uniq((x.comp||[]).map(k=>node(k)).filter(Boolean)).join('');
    const intoN=uniq((x.into||[]).map(k=>node(k)).filter(Boolean)).join('');
    const treeHtml=(compN||intoN)?`<div class="it-tree">${compN?`<div class="it-col">${compN}</div><span class="it-arr" aria-hidden="true">→</span>`:''}<div class="it-col">${node(key,true)}</div>${intoN?`<span class="it-arr" aria-hidden="true">→</span><div class="it-col">${intoN}</div>`:''}</div>`:'';
    // ---- Вариант B (03.10.2026): свой шаблон под тип предмета.
    // Дешёвые компоненты (до 1000 золота) — короткий шаблон; Blink, Yasha и т.п.
    // в каталоге тоже «компоненты», но покупаются как самостоятельные предметы.
    const isFull=y=>y.cat==='item'||(y.cat==='component'&&y.cost>=1000);
    const type=x.cat==='neutral'?'neutral':x.cat==='consumable'?'cons':isFull(x)?'item':'comp';
    const playersPct=s=>pct(s.n,statsAll.players);
    const posNames=['Керри','Мид','Оффлейн','Саппорт 4','Саппорт 5'];
    const clampMin=s=>Math.max(0,s);
    // Время покупки — одна шкала 0–50 мин: полоса от q1 до q3, отметка медианы.
    const timeBar=s=>{const sc=v=>Math.min(100,clampMin(v)/3000*100);const a=sc(s.t[0]),b=sc(s.t[2]),m=sc(s.t[1]);
      const lab=v=>v<=0?'старт':mins(v)+'′';
      return `<div class="itb-time" role="img" aria-label="Обычно покупают с ${lab(s.t[0])} по ${lab(s.t[2])}, медиана ${lab(s.t[1])}"><div class="itb-track"><i style="left:${a}%;width:${Math.max(1.5,b-a)}%"></i><b style="left:${m}%"></b></div><div class="itb-scale"><span>0</span><span>10′</span><span>20′</span><span>30′</span><span>40′</span><span>50′</span></div></div>`;};
    let histHtml='',asideHtml='',summaryHtml='',compareHtml='',tierHtml='';
    const statRows=[];
    if(st&&type==='item'){
      const posSum=st.pos.reduce((a,b)=>a+b,0)||1;
      const topPos=st.pos.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]);
      const posHtml=topPos.map(([v,i])=>`<div class="it-bar"><span>${posNames[i]}<b>${pct(v,posSum)}%</b></span><i><u style="width:${Math.round(v/topPos[0][0]*100)}%"></u></i></div>`).join('');
      histHtml=timing?timeBar(timing)+`<p class="it-note">Медиана первой покупки: ${mins(timing.t[1])} мин. ${nf(timing.n)} покупателей в ${nf(verifiedMatches)} проверенных реплеях.</p><div class="itb-cmpw"><table class="itb-cmp"><thead><tr><th>Время</th><th>Первые покупки</th></tr></thead><tbody>${timing.hist.map((n,i)=>`<tr><td>${i===0?'До игры':i===timingAll.bins.length?'45+ мин':`${(i-1)*5}–${i*5} мин`}</td><td>${nf(n)}</td></tr>`).join('')}</tbody></table></div>`:'';
      summaryHtml=`<div class="itb-kpis">
        <div><b>${playersPct(st)}%</b><span>игроков покупают</span></div>
        ${timing?`<div><b>${timing.t[1]<=0?'старт':mins(timing.t[1])+'′'}</b><span>медиана покупки</span></div>`:''}
        <div><b>${posNames[topPos[0][1]]}</b><span>чаще всего · ${pct(topPos[0][0],posSum)}%</span></div></div>`;
      const heroRows=st.heroes.map(([hid,n,w])=>{const h=heroById.get(Number(hid));if(!h)return '';const sl=slugForHero(h);const r=Math.round(w/n*100);
        return `<a class="it-hrow" href="/hero/${sl}/" data-hero-open="${Number(hid)}"><img loading="lazy" src="/assets/heroes/${sl}.webp" alt=""><span>${escapeHtml(h.localized_name||h.name||'')}</span><small>${n}</small><b class="${r>=55?'it-up':r<=45?'it-down':''}">${r}%</b></a>`;}).join('');
      // Влияние на победу — из item-impact.json (купил до медианы vs не покупал, поправка на героя).
      const impRows=impact?Object.entries(impact.heroes).map(([hid,m])=>m[key]?[hid,m[key]]:null).filter(Boolean)
        .sort((a,b)=>b[1][0]-a[1][0]).slice(0,5).map(([hid,v])=>{const h=heroById.get(Number(hid));if(!h)return '';const sl=slugForHero(h);
          const e=v[0];return `<a class="it-hrow" href="/hero/${sl}/" data-hero-open="${Number(hid)}"><img loading="lazy" src="/assets/heroes/${sl}.webp" alt=""><span>${escapeHtml(h.localized_name||h.name||'')}</span><small>${nf(v[1])}</small><b class="${e>=2?'it-up':e<=-2?'it-down':''}">${e>0?'+':''}${e.toLocaleString('ru-RU')}</b></a>`;}).join(''):'';
      asideHtml=`<div class="it-card"><div class="it-kicker">Позиции</div>${posHtml}</div>
        ${heroRows?`<div class="it-card"><div class="it-kicker">Кто покупает чаще</div><div class="it-hhead"><span>Герой</span><small>покупок</small><b>побед</b></div>${heroRows}<p class="it-note">Доля побед — наблюдение: поздние предметы чаще успевает купить выигрывающая сторона.</p></div>`:''}
        ${impRows?`<div class="it-card"><div class="it-kicker">Кому даёт больше всего</div><div class="it-hhead"><span>Герой</span><small>матчей</small><b>п.п.</b></div>${impRows}<p class="it-note">Разница доли побед «купил вовремя» и «не покупал», с поправкой на силу героя и его другие предметы.</p></div>`:''}
        <p class="it-src">${nf(statsAll.matches)} матчей Stratz из базы Dotamate, обновлено ${new Date(statsAll.builtAt).toLocaleDateString('ru-RU')}.</p>`;
      // Сравнение с соседями по цене.
      const near=entries.filter(([k,y])=>k!==key&&isFull(y)&&y.cost&&statsAll.items[k])
        .sort((a,b)=>Math.abs(a[1].cost-x.cost)-Math.abs(b[1].cost-x.cost)).slice(0,5);
      const rows=[[key,x],...near].sort((a,b)=>a[1].cost-b[1].cost).map(([k,y])=>{const s=statsAll.items[k];const me=k===key;
        const nm=`<img src="${y.img}" alt="" loading="lazy">${escapeHtml(y.dname)}`;
        return `<tr${me?' class="itb-me"':''}><td>${me?`<span>${nm}</span>`:`<a href="/item/${itemSlug(k)}/">${nm}</a>`}</td><td>${nf(y.cost)}</td><td>${playersPct(s)}%</td></tr>`;}).join('');
      compareHtml=`<div class="itb-cmpw"><table class="itb-cmp"><thead><tr><th>Предмет</th><th>Цена</th><th>Покупают</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else if(st&&(type==='comp'||type==='cons')){
      statRows.push(['Покупают',`${playersPct(st)}% игроков`]);
      if(timing) statRows.push(['Медиана покупки',`${mins(timing.t[1])}′`]);
    } else if(!st&&heroesHtml&&type==='item'){
      asideHtml=`<div class="it-card"><div class="it-kicker">Кто покупает чаще</div><ul class="ip-heroes it-heroes-old">${heroesHtml}</ul><p class="it-src">Данные OpenDota.</p></div>`;
    }
    if(type!=='neutral'&&!histHtml) histHtml=timing?timeBar(timing)+`<p class="it-note">${nf(timing.n)} покупателей в ${nf(verifiedMatches)} проверенных реплеях.</p>`:'';
    if(type==='item'&&timing){
      const f=followupsAll?.meta?.source==='Valve replay purchase events'?followupsAll.items?.[key]:null;
      if(f?.eligibleSequences>=100&&Array.isArray(f.next)&&f.next.length){
        const nextRows=f.next.filter(row=>row.n>=30&&store[row.key]).map(row=>{
          const next=store[row.key];
          return `<li><a href="/item/${itemSlug(row.key)}/">${escapeHtml(next.dname||row.key)}</a> · ${nf(row.n)} · ${nf(row.share)}% · ${mins(row.medianDelay)} мин</li>`;
        }).join('');
        if(nextRows) histHtml+=`<h3>Следующая покупка</h3><ul>${nextRows}</ul><p class="it-note">Доля среди ${nf(f.eligibleSequences)} игроков с более поздней покупкой; игроки без следующего предмета не входят в знаменатель.</p>`;
      }
    }
    // Паспорт предмета — есть на каждой странице, поэтому правая колонка
    // никогда не пустует и сетка не «проваливается» у редких предметов.
    const passRows=[
      ['Цена',x.cost?`${nf(x.cost)} золота`:(x.cat==='neutral'?'выпадает с нейтралов':'в лавке не продаётся')],
      ['Раздел',x.cat==='neutral'?'Нейтральный':(x.catRu||'Предмет')],
      x.tier?['Тир',String(x.tier)]:null,
      // Если datafeed даёт перезарядку по уровням («105 / 125 / …»), она точнее одного числа.
      x.cd&&!labelled.some(r=>r[0]==='Перезарядка')?['Перезарядка',`${x.cd} сек`]:null,
      x.mc?['Мана',`${x.mc}`]:null,
      x.charges?['Зарядов',`${x.charges}`]:null,
      ...labelled,
      ...statRows
    ].filter(Boolean).map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    const passportHtml=`<div class="it-card itb-pass"><div class="it-kicker">Характеристики</div><dl>${passRows}</dl>${statRows.length?`<p class="it-src">${nf(statsAll.matches)} матчей из базы Dotamate, обновлено ${new Date(statsAll.builtAt).toLocaleDateString('ru-RU')}.</p>`:''}</div>`;
    asideHtml=passportHtml+asideHtml;
    if(type==='neutral'&&x.tier){
      tierHtml=entries.filter(([k,y])=>k!==key&&y.cat==='neutral'&&y.tier===x.tier)
        .map(([k,y])=>`<a href="/item/${itemSlug(k)}/" title="${escapeHtml(y.dname)}"><img src="${y.img}" alt="" loading="lazy"><span>${escapeHtml(y.dname)}</span></a>`).join('');
    }
    // Похожие: тот же раздел каталога, ближайшие по цене, без вариантов и рецептов.
    const similarHtml=x.cost&&x.cat!=='neutral'?entries.filter(([k,y])=>k!==key&&y.cat===x.cat&&y.cost)
      .sort((a,b)=>Math.abs(a[1].cost-x.cost)-Math.abs(b[1].cost-x.cost)).slice(0,4)
      .map(([k,y])=>`<a href="/item/${itemSlug(k)}/"><img src="${y.img}" alt="" loading="lazy">${escapeHtml(y.dname)}<span>${nf(y.cost)}</span></a>`).join(''):'';
    const meta=[
      x.cost?`<span>💰 ${x.cost} золота</span>`:(x.cat==='neutral'?`<span>Нейтральный${x.tier?` · тир ${x.tier}`:''}</span>`:''),
      x.cat==='neutral'?'':`<span>${escapeHtml(x.catRu||'Предмет')}</span>`,
      x.cd?`<span>⏱ КД ${x.cd} сек</span>`:'',
      x.mc?`<span>💧 ${x.mc} маны</span>`:'',
      x.charges?`<span>Зарядов: ${x.charges}</span>`:''
    ].filter(Boolean).join('');

    const html=`<!doctype html>
<html lang="ru">
<head>
<script>try{document.documentElement.dataset.theme=localStorage.getItem('dotamate-theme')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preload" href="/assets/fonts/inter-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<link rel="stylesheet" href="/css/tokens.css"><script src="/js/theme.js" defer></script>
<script type="application/ld+json">${ldjson}</script>
<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    ${siteNav.navHtml('items')}
<div class="nav-spacer"></div><button class="theme-toggle" type="button" aria-label="Включить светлую тему" aria-pressed="false">☼</button>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container ip-main">
  <nav aria-label="breadcrumb" class="ip-crumbs"> <span>›</span> <a href="/items/">Предметы</a> <span>›</span> <span aria-current="page">${escapeHtml(x.dname)}</span></nav>
  <section class="it-top itb-top">
    <div class="it-art"><img src="${img}" alt="${escapeHtml(x.dname)}" width="88" height="64"></div>
    <div class="it-head">
      <div class="it-kicker">${escapeHtml(kicker)}</div>
      <h1>${escapeHtml(x.dname)}</h1>
      ${chips?`<div class="it-chips">${chips}</div>`:''}
    </div>
    ${type==='item'?summaryHtml:''}
  </section>
  ${type!=='item'?summaryHtml:''}
  <div class="it-grid">
    <div class="it-mainc">
      ${type==='comp'&&treeHtml?`<section class="it-sec"><div class="ip-panel-head"><span>СБОРКА</span><h2>Во что собирается</h2></div>${treeHtml}</section>`:''}
      ${histHtml?`<section class="it-sec"><div class="ip-panel-head"><span>ВРЕМЯ</span><h2>Когда покупают</h2></div>${histHtml}</section>`:''}
      ${descHtml?`<section class="it-sec"><div class="ip-panel-head"><span>ЭФФЕКТ</span><h2>Что даёт</h2></div><div class="ip-desc">${descHtml}</div>${notesHtml?`<details class="itb-more"><summary>Примечания</summary><div class="ip-notes">${notesHtml}</div></details>`:''}</section>`:''}
      ${guideByItem.has(key)?`<section class="it-sec"><div class="ip-panel-head"><span>ГАЙД</span><h2>Гайд по предмету</h2></div><div class="linked-list">${guideByItem.get(key).map(gd=>`<a href="/guide/${gd.slug}/">${escapeHtml(gd.title)}<span>→</span></a>`).join('')}</div></section>`:''}
      ${levelsHtml?`<section class="it-sec item-levels"><div class="ip-panel-head"><span>УЛУЧШЕНИЕ</span><h2>Уровни улучшения</h2></div>
        <p class="item-levels-note">Предмет улучшается прямо в инвентаре: каждый следующий уровень покупается отдельно и усиливает все его показатели. Числа в характеристиках перечислены по уровням — от первого к последнему.</p>
        ${levelsHtml}</section>`:''}
      ${type!=='comp'&&type!=='neutral'&&treeHtml?`<section class="it-sec"><div class="ip-panel-head"><span>СБОРКА</span><h2>${componentsHtml?'Из чего собирается и во что идёт':'Во что собирается'}</h2></div>${treeHtml}</section>`:''}
      ${compareHtml?`<section class="it-sec"><div class="ip-panel-head"><span>СРАВНЕНИЕ</span><h2>Соседи по цене</h2></div>${compareHtml}</section>`:(type!=='neutral'&&similarHtml?`<section class="it-sec"><div class="ip-panel-head"><span>ПОХОЖИЕ</span><h2>Похожие предметы</h2></div><div class="linked-list ip-recipe">${similarHtml}</div></section>`:'')}
      ${tierHtml?`<section class="it-sec"><div class="ip-panel-head"><span>ТИР ${x.tier}</span><h2>Другие нейтральные предметы тира</h2></div><div class="itb-tier">${tierHtml}</div></section>`:''}
      ${x.lore?`<details class="it-sec itb-more ip-lore"><summary>История предмета</summary><p>${escapeHtml(x.lore)}</p></details>`:''}
    </div>
    ${asideHtml?`<aside class="it-aside">${asideHtml}</aside>`:''}
  </div>
</main>
${st&&st.heroes.length?heroCardHtml:''}<footer><div class="container footer-row"><span class="footer-brand">© 2026 DotaMate.ru. Dota 2 и логотип Dota 2 являются зарегистрированными товарными знаками корпорации Valve.</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="https://t.me/Dotamate_ru" target="_blank" rel="noopener">Telegram-канал</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
</body>
</html>
`;

    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:x.dname});
  }

  if(!only) fs.writeFileSync(path.join(__dirname,'item-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} item pages.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
