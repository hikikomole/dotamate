#!/usr/bin/env node
// Generates static, SEO-indexable articles under deploy/guide/<slug>/index.html
// from the hand-written, evergreen content in guide-content.js.

const siteNav = require('./tools/site-nav');
const fs = require('fs');
const path = require('path');
const guides = require('./guide-content.js');

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
// Раздел «Инструменты» удалён в сессии 5 — гайды, которые на него ссылались,
// отправляем в «Гайды».
const actionLabels={heroes:"Герои",items:"Предметы",stats:"Статистика",guides:"Гайды"};
const actionHref=a=>({heroes:"/heroes/",items:"/items/",stats:"/stats/",guides:"/guides/"}[a]||"/guides/");

const analyticsSnippet=`\n<!-- Yandex.RTB --><script>window.yaContextCb=window.yaContextCb||[]</script><script type="text/plain" data-consent="ads" data-src="https://yandex.ru/ads/system/context.js"></script><!-- End Yandex.RTB -->\n<!-- Yandex.Metrika counter --><script type="text/plain" data-consent="analytics">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document,'script','https://mc.webvisor.org/metrika/tag_ww.js?id=112755250', 'ym');ym(112755250, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});</script><!-- /Yandex.Metrika counter -->`;

// Таблицы, которые считаются из data/ при каждой сборке, чтобы статья
// не устаревала вместе с цифрами. Ключ — значение поля dataTable в разделе гайда.
const dataTables={
  // Контрпики — из data/hero-counters.json (tools/build-hero-counters.js):
  // тот же расчёт, что на страницах героев и в их гайдах.
  counters(){
    const C=JSON.parse(fs.readFileSync(path.join(__dirname,'data','hero-counters.json'),'utf8'));
    const heroes=JSON.parse(fs.readFileSync(path.join(__dirname,'data','heroes.json'),'utf8')).heroes;
    const {slugForHero:slug}=require('./tools/hero-common.js');
    const TOP=3;
    const byId=new Map(heroes.map(h=>[Number(h.id),h]));
    const rows=heroes.slice().sort((a,b)=>a.localized_name.localeCompare(b.localized_name,'en')).map(h=>{
      const top=((C.heroes[String(h.id)]||{}).against||[]).slice(0,TOP).map(x=>{const o=byId.get(Number(x.id));return o?{t:`${o.localized_name} (${x.d.toFixed(1).replace('.',',').replace('-','−')})`,href:`/hero/${slug(o)}/`,hero:Number(o.id)}:null;}).filter(Boolean);
      return [{t:h.localized_name,href:`/hero/${slug(h)}/`,hero:Number(h.id)},...[0,1,2].map(k=>top[k]||'—')];
    });
    return {head:['Герой','Контрпик 1','Контрпик 2','Контрпик 3'],rows,
      note:`${C.slice}, ${Number(C.matchesUsed).toLocaleString('ru-RU')} матчей, база обновлена ${String(C.dataAt).slice(0,10)}. В скобках — на сколько процентных пунктов герой выигрывает реже, чем ожидалось бы по силе обоих героев. Учитываются пары, сыгранные не меньше ${C.minGames} раз; прочерк — таких пар для героя пока нет.`};
  }
  ,
  // Статья «Драфт в Dota 2» (draft-fundamentals): цифры только из своих файлов — draft-calibration.json
  // (проверка прогноза DraftMate на отложенных матчах) и stats.json (связки, контрпики, винрейт по длительности).
  ...(()=>{
    const rd=f=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',f),'utf8'));
    const {slugForHero:slug}=require('./tools/hero-common.js');
    const heroes=()=>new Map(rd('heroes.json').heroes.map(h=>[Number(h.id),h]));
    const cell=(byId,id)=>{const o=byId.get(Number(id));return o?{t:o.localized_name,href:`/hero/${slug(o)}/`,hero:Number(o.id)}:'—';};
    const f1=x=>Number(x).toFixed(1).replace('.',',');
    const sg=x=>(x>0?'+':x<0?'−':'')+f1(Math.abs(x));
    const n=x=>Number(x).toLocaleString('ru-RU');
    const day=s=>String(s||'').slice(0,10).split('-').reverse().join('.');
    const S=()=>rd('stats.json');
    const period=st=>`${st.base.src==='steam'?'рейтинговые матчи Steam':'рейтинговые матчи из нашей базы'} (${st.base.patch?'патч '+st.base.patch+', ':''}${day(st.base.from)}–${day(st.base.to)}, ${n(st.base.matches)} матчей)`;
    return {
      draftWeight(){
        const c=rd('draft-calibration.json');
        const P=x=>Math.round(100/(1+Math.exp(-c.alpha*x))*10)/10;
        return {head:['Показатель','Значение'],rows:[
          ['Матчей в проверке (не участвовали в расчёте)',n(c.matchesTest)],
          ['Как часто прогноз по драфту угадывает победителя',f1(c.testAccuracy)+'% (подбрасывание монетки — 50%)'],
          ['Шанс фаворита при типичном перевесе в драфте (медиана)',f1(P(c.absScoreP50))+'%'],
          ['Шанс фаворита в 5% матчей с самым неравным драфтом',`от ${f1(P(c.absScoreP95))}%`],
          ['Ошибка прогноза, log-loss (меньше — лучше)',`${String(c.testLogLoss).replace('.',',')} против ${String(c.baselineLogLoss).replace('.',',')} у прогноза «50 на 50»`]],
          note:`Источник: ${c.source}, всего ${n(c.matchesTotal)} матчей, проверка обновлена ${day(c.builtAt)}. Прогноз — сумма отклонений всех пар героев (союзники и соперники) от ожидаемого, переведённая в вероятность логистической калибровкой; линии и ранги игроков не учитываются.`};
      },
      synergyTop(){
        const st=S(),byId=heroes();
        const rows=(st.synergy||[]).slice(0,8).map(x=>[cell(byId,x.a),cell(byId,x.b),n(x.g),f1(x.w)+'%',f1(x.e)+'%',sg(x.d)]);
        return {head:['Герой','Союзник','Матчей вместе','Побед','Ожидалось','Разница, п. п.'],rows,
          note:`Источник: ${period(st)}; пары, сыгранные вместе меньше ${(st.method||{}).minPair||300} раз, не учитываются. «Ожидалось» — доля побед по общим винрейтам обоих героев; разница показывает, насколько связка лучше простой суммы героев.`};
      },
      countersTop(){
        const st=S(),byId=heroes();
        const rows=(st.counters||[]).slice(0,8).map(x=>[cell(byId,x.hero),cell(byId,x.by),n(x.g),f1(x.w)+'%',f1(x.e)+'%',sg(x.d)]);
        return {head:['Герой','Против него','Матчей','Побед у героя','Ожидалось','Разница, п. п.'],rows,
          note:`Источник: ${period(st)}; пары меньше ${(st.method||{}).minPair||300} матчей не учитываются. Ожидаемая доля побед — по формуле log5 из общих винрейтов обоих героев.`};
      },
      timeCurve(){
        const st=S(),byId=heroes(),min=(st.method||{}).minDur||300;
        const dur=(st.base||{}).duration||[],tot=dur.reduce((t,x)=>t+x[1],0);
        const short=tot?f1(dur.filter(x=>x[0]<25).reduce((t,x)=>t+x[1],0)/tot*100):'—';
        const list=(st.heroes||[]).map(h=>({id:h.id,m:(h.dur||{})['25_35'],l:(h.dur||{}).gt45})).filter(x=>x.m&&x.l&&x.m[0]>=min&&x.l[0]>=min).map(x=>({...x,d:x.l[1]-x.m[1]}));
        const top=k=>list.slice().sort((a,b)=>k*(b.d-a.d)).slice(0,5);
        const row=(x,tag)=>[cell(byId,x.id),tag,f1(x.m[1])+'%',f1(x.l[1])+'%',sg(x.d)];
        return {head:['Герой','Чем силён','Винрейт в матчах 25–35 мин','Винрейт в матчах 45+ мин','Разница, п. п.'],
          rows:[...top(1).map(x=>row(x,'поздней игрой')),...top(-1).map(x=>row(x,'серединой игры'))],
          note:`Источник: ${period(st)}; у героя должно быть не меньше ${min} матчей в каждой корзине. Матчи короче 25 минут не берём: это ${short}% базы, и в этой корзине есть аномальные значения, которые мы ещё проверяем.`};
      }
    };
  })()
};

// Окно карточки героя и тот же набор скриптов, что на страницах разделов
// (build-pages.js): карточку строит js/app.js, отдельной копии нет.
const heroCardHtml=require('./tools/hero-card.js');

// «Предмет в цифрах»: ссылки на /item/ и до 6 героев, которые чаще всего
// покупают предмет (data/item-heroes.json, tools/build-hero-items.js — своя база покупок Stratz).
// Связь статьи с предметами — tools/guide-items.js.
const guideItems=require('./tools/guide-items.js').linkGuideItems();
const itemHeroes=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'data','item-heroes.json'),'utf8')).items;}catch{return {};}})();
const heroesById=new Map(JSON.parse(fs.readFileSync(path.join(__dirname,'data','heroes.json'),'utf8')).heroes.map(h=>[Number(h.id),h]));
const {slugForHero:heroSlugOf,imageUrl:heroImgOf}=require('./tools/hero-common.js');
function itemFactsHtml(slug){
  const keys=guideItems.byGuide.get(slug);
  if(!keys) return '';
  const st=guideItems.store;
  const itemsHtml=keys.map(k=>`<a href="/item/${guideItems.itemSlug(k)}/"><img src="${escapeHtml(st[k].img)}" alt="" loading="lazy">${escapeHtml(st[k].dname)}<span>${Number(st[k].cost)>0?Number(st[k].cost).toLocaleString('ru-RU')+' з.':'→'}</span></a>`).join('');
  const sum=new Map();
  for(const k of keys) for(const r of ((itemHeroes[st[k].id]||{}).heroes||[])) sum.set(r.h,(sum.get(r.h)||0)+Number(r.g||0));
  const top=[...sum].sort((a,b)=>b[1]-a[1]).map(([id])=>heroesById.get(Number(id))).filter(Boolean).slice(0,6);
  const heroesHtml=top.map(h=>`<a href="/hero/${heroSlugOf(h)}/"><img src="${heroImgOf(h)}" alt="" loading="lazy">${escapeHtml(h.localized_name)}<span>→</span></a>`).join('');
  return `<div class="detail-section" style="margin-top:34px;">
    <h3>Предмет в цифрах</h3>
    <div class="linked-list">${itemsHtml}</div>${heroesHtml?`
    <p style="color:#9aa0ab;font-size:13px;margin:16px 0 8px;">Чаще всего покупают (OpenDota):</p>
    <div class="linked-list">${heroesHtml}</div>`:''}
  </div>`;
}

async function main(){
  const outRoot=path.join(__dirname,'deploy','guide');
  fs.mkdirSync(outRoot,{recursive:true});
  const urls=[];

  for(let i=0;i<guides.length;i++){
    const g=guides[i];
    const dir=path.join(outRoot,g.slug);
    fs.mkdirSync(dir,{recursive:true});

    const canonical=`https://dotamate.ru/guide/${g.slug}/`;
    const desc=g.excerpt;
    const title=[`${g.title} | Гайд Dota Mate`,`${g.title} | Dota Mate`].find(t=>t.length<=70)||g.title;   // до 70 знаков (дальше поисковики обрезают): длинное название статьи — без приписки
    const ldjson=JSON.stringify({
      "@context":"https://schema.org","@type":"Article",
      "headline":g.title,"description":g.excerpt,
      "mainEntityOfPage":canonical,
      ...(g.published?{"datePublished":g.published}:{}),
      ...(g.updated?{"dateModified":g.updated}:{}),
      "author":{"@type":"Organization","name":"Dota Mate"}
    });
    // Необязательные поля гайда: answer — короткий ответ в начале статьи
    // (под запросы-вопросы из поиска), faq — [{q,a}], рендерится блоком
    // «Частые вопросы» и размечается FAQPage для расширенного сниппета.
    const faq=Array.isArray(g.faq)?g.faq:[];
    const faqJson=faq.length?JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":faq.map(f=>({"@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a}}))}):'';
    const answerHtml=g.answer?`<section class="detail-section hx-quick"><h2 class="hq-title">Коротко</h2><p class="hq-answer">${escapeHtml(g.answer)}</p></section>`:'';
    const faqHtml=faq.length?`<section class="detail-section"><h2>Частые вопросы</h2>${faq.map(f=>`<h3 style="margin:18px 0 8px;">${escapeHtml(f.q)}</h3><p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(f.a)}</p>`).join('')}</section>`:'';
    const breadcrumbJson=JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Главная","item":"https://dotamate.ru/"},{"@type":"ListItem","position":2,"name":"Гайды","item":"https://dotamate.ru/guides/"},{"@type":"ListItem","position":3,"name":g.title,"item":canonical}]});

    // Раздел статьи умеет три блока: абзацы (p), маркированный список (list)
    // и таблицу (table: {head:[], rows:[[]]}). Таблица оборачивается в контейнер
    // с горизонтальной прокруткой, иначе на телефоне она растягивает страницу.
    // Ячейка таблицы — строка или {t, href}: ссылка на страницу сайта.
    // {t, href, hero} — ссылка на героя: js/app.js открывает по обычному клику
    // карточку героя, а Ctrl/колесо и роботы идут по href на страницу героя.
    const renderCell=c=>c&&typeof c==='object'?`<a href="${escapeHtml(c.href)}"${c.hero?` data-hero-open="${Number(c.hero)}"`:''}>${escapeHtml(c.t)}</a>${c.hero?`<span class="hr-badges" data-hero-badges="${Number(c.hero)}"></span>`:''}`:escapeHtml(c);
    // Карточке героя нужны окно и скрипты разделов — только статьям с такой таблицей.
    const heroCard=g.sections.some(sec=>['counters','synergyTop','countersTop','timeCurve'].includes(sec.dataTable));
    const renderTable=t=>`<div style="overflow-x:auto;margin:16px 0;"><table><thead><tr>${t.head.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map((c,ci)=>`<td>${ci===0?`<b style="color:#e8ecf3;">${renderCell(c)}</b>`:renderCell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note?`<p style="font-size:13px;color:#8b919c;margin:6px 0 0;">${escapeHtml(t.note)}</p>`:''}</div>`;
    const bodyHtml=g.sections.map(sec=>{
      const parts=[];
      (sec.p||[]).forEach(par=>parts.push(`<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(par)}</p>`));
      if(sec.table) parts.push(renderTable(sec.table));
      if(sec.dataTable) parts.push(renderTable(dataTables[sec.dataTable]()));
      if(sec.list) parts.push(`<ul style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${sec.list.map(li=>`<li>${escapeHtml(li)}</li>`).join('')}</ul>`);
      (sec.after||[]).forEach(par=>parts.push(`<p style="line-height:1.7;color:#c7cbd4;margin:0 0 14px;">${escapeHtml(par)}</p>`));
      const quick=sec.h==='Коротко';
      return `<section class="detail-section${quick?' hx-quick':''}"><h2${quick?' class="hq-title"':''}>${escapeHtml(sec.h)}</h2>${parts.join('')}</section>`;
    }).join('');

    // deterministic "related" picks: next three guides in list order, wrapping around
    // сначала гайды той же темы (tag), затем следующие по списку; всего 4
    const related=guides.filter((r,j)=>j!==i&&r.tag===g.tag).slice(0,2);
    for(let k=1;related.length<4&&k<guides.length;k++){const r=guides[(i+k)%guides.length];if(!related.includes(r))related.push(r);}
    const relatedHtml=related.map(r=>`<a href="/guide/${r.slug}/"><span style="font-size:20px;">${r.icon}</span>${escapeHtml(r.title)}<span>→</span></a>`).join('');

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
<meta property="og:image" content="https://dotamate.ru/assets/dotamate-og.jpg">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="preload" href="/assets/fonts/inter-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/style.css">
<script src="/security.js"></script>
<link rel="stylesheet" href="/css/v43-platform.css">
<link rel="stylesheet" href="/css/theme-dark.css">
<link rel="stylesheet" href="/css/tokens.css"><script src="/js/theme.js" defer></script>
<link rel="stylesheet" href="/css/hero-quick.css">
<script type="application/ld+json">${ldjson}</script>
<script type="application/ld+json">${breadcrumbJson}</script>
${faqJson?`<script type="application/ld+json">${faqJson.replace(/</g,'\\u003c')}</script>\n`:''}${analyticsSnippet}
</head>
<body id="top" class="d2-dark">
<div class="bg"></div>
<header class="topbar">
  <div class="container nav">
    <a class="brand" href="/" aria-label="Dota Mate — помощник по Dota 2"><span class="dm-dot" aria-hidden="true"></span><span class="dm-word">Dotamate</span></a>
    ${siteNav.navHtml('guides')}
<div class="nav-spacer"></div><button class="theme-toggle" type="button" aria-label="Включить светлую тему" aria-pressed="false">☼</button>
    <button class="menu" id="menu" aria-expanded="false" aria-controls="navMenu" aria-label="Открыть меню">☰</button>
  </div>
</header>
<main class="container article-main" style="padding-top:24px;padding-bottom:56px;max-width:820px;">
  <nav aria-label="breadcrumb" style="font-size:14px;opacity:.7;margin-bottom:16px;">
     / <a href="/guides/">Гайды</a> / ${escapeHtml(g.title)}
  </nav>
  <div class="eyebrow">${escapeHtml(g.tag)}</div>
  <h1 style="margin:6px 0 20px;">${escapeHtml(g.title)}</h1>
  <p style="font-size:17px;line-height:1.6;color:#e2e4e9;margin:0 0 28px;">${escapeHtml(g.excerpt)}</p>
  ${answerHtml}${bodyHtml}${faqHtml}
  <div class="ad-slot ad-active" id="yandex_rtb_R-A-20064201-1" data-ad-slot="guide-article-mid"></div>
<script>window.yaContextCb.push(()=>{Ya.Context.AdvManager.render({"blockId":"R-A-20064201-1","renderTo":"yandex_rtb_R-A-20064201-1"})})</script>
  <div class="hero-detail-actions" style="margin-top:26px;">
    <a class="btn red" href="${actionHref(g.action)}">Открыть раздел «${escapeHtml(actionLabels[g.action]||"Гайды")}» →</a>
  </div>
  ${itemFactsHtml(g.slug)}
  <div class="detail-section" style="margin-top:34px;">
    <h3>Другие гайды</h3>
    <div class="linked-list">${relatedHtml}</div>
  </div>
</main>
${heroCard?heroCardHtml:''}<footer><div class="container footer-row"><span class="footer-brand">© 2026 DotaMate.ru. Dota 2 и логотип Dota 2 являются зарегистрированными товарными знаками корпорации Valve.</span><nav class="footer-links" aria-label="Информация"><a href="/contact/">Обратная связь</a><a href="/privacy/">Конфиденциальность</a><a href="https://t.me/Dotamate_ru" target="_blank" rel="noopener">Telegram-канал</a><a href="#" data-consent-revoke>Отключить cookies</a></nav></div></footer>
</body>
</html>
`;

    fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
    urls.push({loc:canonical,name:g.title});
  }

  fs.writeFileSync(path.join(__dirname,'guide-urls.json'),JSON.stringify(urls,null,2),'utf8');
  console.log(`Generated ${urls.length} guide pages.`);
  console.log(`Статей о предметах со ссылкой на /item/: ${guideItems.byGuide.size}; не связаны (${guideItems.unlinked.length}): ${guideItems.unlinked.join(', ')}`);
}

main().catch(e=>{console.error(e);process.exit(1);});
