/* Dota Mate v43 — home feature layer (глобальный поиск Ctrl+K). */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function ensureData(){return Array.isArray(window.heroes)?window.heroes:Array.isArray(heroes)?heroes:[]}
  function getItems(){return Array.isArray(window.items)?window.items:Array.isArray(items)?items:[]}
  function heroImg(h){try{return imageUrl(h)}catch{return ''}}
  function itemImg(i){try{return itemImage(i)}catch{return ''}}

  function renderGlobal(q=''){
    const el=$('globalSearchResults'); if(!el)return; q=q.trim().toLowerCase(); if(!q){el.innerHTML='';el.classList.remove('show');return}
    const hs=ensureData().filter(h=>String(h.localized_name).toLowerCase().includes(q)).slice(0,5);
    const is=getItems().filter(i=>String(i.dname||i.name).toLowerCase().includes(q)).slice(0,5);
    const sections=[['Разделы',[['Герои','heroes'],['Предметы','items'],['Статистика','stats'],['Гайды','guides']].filter(x=>x[0].toLowerCase().includes(q))],['Герои',hs],['Предметы',is]];
    let html=''; sections.forEach(([title,arr])=>{if(!arr.length)return;html+=`<div class="v43-search-group"><b>${title}</b>${arr.map(x=>title==='Разделы'?`<button data-v43-go="${x[1]}">→ ${esc(x[0])}</button>`:title==='Герои'?`<button data-v43-hero="${x.id}"><img src="${heroImg(x)}">${esc(x.localized_name)}</button>`:`<button data-v43-item="${esc(x.name)}"><img src="${itemImg(x)}">${esc(x.dname||x.name)}</button>`).join('')}</div>`});
    el.innerHTML=html||'<div class="empty">Ничего не найдено.</div>';el.classList.add('show');
  }

  function bind(){
    $('globalSearch')?.addEventListener('input',e=>renderGlobal(e.target.value));
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('globalSearch')?.focus()}});
    $('globalSearchResults')?.addEventListener('click',e=>{const h=e.target.closest('[data-v43-hero]'),it=e.target.closest('[data-v43-item]'),goEl=e.target.closest('[data-v43-go]');if(h){openHero(Number(h.dataset.v43Hero));return}if(it){openItem(it.dataset.v43Item);return}if(goEl){go(goEl.dataset.v43Go);$('globalSearch').value='';renderGlobal('');}});
  }
  function boot(){bind();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
