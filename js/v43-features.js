/* Dota 2 Companion v43 — home feature layer. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('ru-RU');
  let metaRole='all', selectedBuild=[], matchMine=[], matchEnemy=[];
  const store={get(k,d=[]){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};

  function ensureData(){return Array.isArray(window.heroes)?window.heroes:Array.isArray(heroes)?heroes:[]}
  function getItems(){return Array.isArray(window.items)?window.items:Array.isArray(items)?items:[]}
  function heroImg(h){try{return imageUrl(h)}catch{return ''}}
  function itemImg(i){try{return itemImage(i)}catch{return ''}}
  function rate(h){return h.pro_pick?Number(h.pro_win||0)/Number(h.pro_pick)*100:0}
  function role(h,r){return (h.roles||[]).includes(r)}

  function renderMeta(){
    const el=$('metaGrid'); if(!el)return; let list=ensureData().filter(h=>metaRole==='all'||role(h,metaRole));
    list=list.map(h=>({h,score:(rate(h)*0.7)+Math.log10(1+Number(h.pro_pick||0))*7+(Number(h.pro_ban||0)>0?Math.log10(1+Number(h.pro_ban))*2:0)})).sort((a,b)=>b.score-a.score).slice(0,8);
    el.innerHTML=list.map((x,i)=>`<article class="v43-meta-card"><div class="v43-meta-rank">#${i+1}</div><img src="${heroImg(x.h)}" alt=""><div class="v43-meta-info"><button data-v43-hero="${x.h.id}"><h3>${esc(x.h.localized_name)}</h3></button><span>${esc(roleText(x.h))}</span><div class="v43-metrics"><b>${rate(x.h).toFixed(1)}%</b><small>pro winrate</small><b>${fmt(x.h.pro_pick)}</b><small>picks</small></div></div></article>`).join('')||'<div class="empty">Нет данных для выбранной роли.</div>';
  }

  function renderGlobal(q=''){
    const el=$('globalSearchResults'); if(!el)return; q=q.trim().toLowerCase(); if(!q){el.innerHTML='';el.classList.remove('show');return}
    const hs=ensureData().filter(h=>String(h.localized_name).toLowerCase().includes(q)).slice(0,5);
    const is=getItems().filter(i=>String(i.dname||i.name).toLowerCase().includes(q)).slice(0,5);
    const sections=[['Разделы',[['Герои','heroes'],['Предметы','items'],['Статистика','stats'],['Мета','meta'],['Гайды','guides'],['Инструменты','tools']].filter(x=>x[0].toLowerCase().includes(q))],['Герои',hs],['Предметы',is]];
    let html=''; sections.forEach(([title,arr])=>{if(!arr.length)return;html+=`<div class="v43-search-group"><b>${title}</b>${arr.map(x=>title==='Разделы'?`<button data-v43-go="${x[1]}">→ ${esc(x[0])}</button>`:title==='Герои'?`<button data-v43-hero="${x.id}"><img src="${heroImg(x)}">${esc(x.localized_name)}</button>`:`<button data-v43-item="${esc(x.name)}"><img src="${itemImg(x)}">${esc(x.dname||x.name)}</button>`).join('')}</div>`});
    el.innerHTML=html||'<div class="empty">Ничего не найдено.</div>';el.classList.add('show');
  }

  function populateBuildHeroes(){const s=$('buildHeroSelect');if(!s)return;s.innerHTML=ensureData().map(h=>`<option value="${h.id}">${esc(h.localized_name)}</option>`).join('');}
  function renderBuildPool(){const el=$('buildItemPool');if(!el)return;const q=($('buildItemSearch')?.value||'').toLowerCase();const list=getItems().filter(i=>String(i.dname||i.name).toLowerCase().includes(q)).slice(0,80);el.innerHTML=list.map(i=>`<button data-v43-build-item="${i.id}"><img src="${itemImg(i)}"><span>${esc(i.dname||i.name)}</span></button>`).join('')||'<div class="empty">Предметов не найдено.</div>';}
  function renderSelectedBuild(){const el=$('selectedBuildItems');if(!el)return;el.innerHTML=selectedBuild.map((i,n)=>`<button data-v43-remove-build="${i.id}"><span>${n+1}</span><img src="${itemImg(i)}"><b>${esc(i.dname||i.name)}</b> ×</button>`).join('')||'<div class="empty">Добавь до 6 предметов.</div>';if($('buildCount'))$('buildCount').textContent=`${selectedBuild.length}/6`;}
  async function saveBuildV43(){const hero=ensureData().find(h=>h.id===Number($('buildHeroSelect')?.value));if(!hero||!selectedBuild.length){alert('Выбери героя и хотя бы один предмет.');return}const build={heroId:hero.id,hero:hero.localized_name,items:selectedBuild.map(i=>i.dname||i.name),name:$('buildName')?.value.trim()||'Мой билд'};if(localStorage.getItem('d2h_token')&&window.D2HPlatform?.api){try{const d=await window.D2HPlatform.api('/api/profile/builds',{method:'POST',body:JSON.stringify(build)});const all=store.get('d2h_builds',[]);all.unshift(d.build||build);store.set('d2h_builds',all.slice(0,50));if(typeof renderProfile==='function')await renderProfile();alert('Билд сохранён на сервере.')}catch(e){alert(e.message||'Не удалось сохранить билд.')}}else{const all=store.get('d2h_builds',[]);all.unshift(build);store.set('d2h_builds',all.slice(0,50));if(typeof renderProfile==='function')await renderProfile();alert('Войдите в аккаунт, чтобы синхронизировать билд с сервером.')}}

  function renderMatch(){
    const renderSlots=(elId,arr,prefix)=>{const el=$(elId);if(!el)return;el.innerHTML=Array.from({length:5},(_,i)=>{const h=arr[i];return h?`<button data-v43-remove-match="${prefix}:${i}"><img src="${heroImg(h)}"><span>${esc(h.localized_name)}</span> ×</button>`:`<button class="empty-slot" data-v43-add-match="${prefix}:${i}">+ ${i+1} герой</button>`}).join('')};
    renderSlots('matchMyTeam',matchMine,'my');renderSlots('matchEnemyTeam',matchEnemy,'enemy');
    const el=$('matchResult');const all=[...matchMine,...matchEnemy];if(all.length<2){el.innerHTML='<div class="empty">Добавь хотя бы двух героев, чтобы получить анализ.</div>';return}
    const score=team=>team.reduce((n,h)=>n+(h.roles||[]).includes('Disabler')?2:0,0)+team.reduce((n,h)=>n+(h.roles||[]).includes('Initiator')?2:0,0)+team.reduce((n,h)=>n+(h.roles||[]).includes('Durable')?1:0,0);
    const my=score(matchMine),en=score(matchEnemy), carries=matchMine.filter(h=>role(h,'Carry')).length, supports=matchMine.filter(h=>role(h,'Support')||role(h,'Hard Support')).length;
    const notes=[];if(carries===0)notes.push('Нет явного Carry в вашем составе.');if(supports===0)notes.push('Нет очевидной поддержки.');if(my<en)notes.push('У соперника сейчас больше героев с ролями контроля/инициации.');if(my>en)notes.push('Ваш состав выглядит сильнее по контролю и инициации.');if(!notes.length)notes.push('Состав выглядит сбалансированным по выбранным героям.');
    el.innerHTML=`<div class="v43-analysis-score"><span>Оценка состава</span><strong>${Math.max(1,Math.min(10,5+my-en)).toFixed(1)}/10</strong></div><div class="v43-analysis-columns"><div><b>Ваши сильные стороны</b><p>Контроль: ${my}. Роли: ${matchMine.length}/5.</p></div><div><b>Что проверить</b>${notes.map(n=>`<p>• ${esc(n)}</p>`).join('')}</div></div><small>Оценка основана на ролях и характеристиках загруженной базы, а не на выдуманном winrate.</small>`;
  }
  function pickMatch(prefix,index){const used=[...matchMine,...matchEnemy];const q=prompt('Введи имя героя:');if(!q)return;const h=ensureData().find(x=>String(x.localized_name).toLowerCase().includes(q.toLowerCase()));if(!h){alert('Герой не найден.');return}if(used.some(x=>x.id===h.id)){alert('Этот герой уже выбран.');return}if(prefix==='my')matchMine[index]=h;else matchEnemy[index]=h;renderMatch();}

  function bind(){
    $('globalSearch')?.addEventListener('input',e=>renderGlobal(e.target.value));
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('globalSearch')?.focus()}});
    $('globalSearchResults')?.addEventListener('click',e=>{const h=e.target.closest('[data-v43-hero]'),it=e.target.closest('[data-v43-item]'),goEl=e.target.closest('[data-v43-go]');if(h){openHero(Number(h.dataset.v43Hero));return}if(it){openItem(it.dataset.v43Item);return}if(goEl){go(goEl.dataset.v43Go);$('globalSearch').value='';renderGlobal('');}});
    document.querySelectorAll('[data-meta-role]').forEach(b=>b.addEventListener('click',()=>{metaRole=b.dataset.metaRole;document.querySelectorAll('[data-meta-role]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderMeta()}));
    $('metaRefresh')?.addEventListener('click',renderMeta);
    $('buildHeroSelect')?.addEventListener('change',()=>{});$('buildItemSearch')?.addEventListener('input',renderBuildPool);$('saveBuildV43')?.addEventListener('click',saveBuildV43);$('clearBuild')?.addEventListener('click',()=>{selectedBuild=[];renderSelectedBuild()});
    $('buildItemPool')?.addEventListener('click',e=>{const b=e.target.closest('[data-v43-build-item]');if(!b)return;const i=getItems().find(x=>x.id===Number(b.dataset.v43BuildItem));if(i&&!selectedBuild.some(x=>x.id===i.id)&&selectedBuild.length<6){selectedBuild.push(i);renderSelectedBuild()}});
    $('selectedBuildItems')?.addEventListener('click',e=>{const b=e.target.closest('[data-v43-remove-build]');if(b){selectedBuild=selectedBuild.filter(x=>x.id!==Number(b.dataset.v43RemoveBuild));renderSelectedBuild()}});
    ['matchMyTeam','matchEnemyTeam'].forEach(id=>$(id)?.addEventListener('click',e=>{const rem=e.target.closest('[data-v43-remove-match]'),add=e.target.closest('[data-v43-add-match]');if(rem){const [p,i]=rem.dataset.v43RemoveMatch.split(':');(p==='my'?matchMine:matchEnemy).splice(Number(i),1);renderMatch()}else if(add){const [p,i]=add.dataset.v43AddMatch.split(':');pickMatch(p,Number(i))}}));
  }
  function boot(){populateBuildHeroes();renderMeta();renderBuildPool();renderSelectedBuild();renderMatch();bind();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  const oldRenderProfile=window.renderProfile; if(typeof oldRenderProfile==='function'){window.renderProfile=function(){oldRenderProfile();};}
  // Re-render feature panels when Dota data refreshes.
  let lastH=0,lastI=0;setInterval(()=>{const h=ensureData().length,i=getItems().length;if(h!==lastH||i!==lastI){lastH=h;lastI=i;populateBuildHeroes();renderMeta();renderBuildPool()}},1000);
})();
