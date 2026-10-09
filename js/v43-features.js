/* Dota Mate v43 — home feature layer (глобальный поиск Ctrl+K). */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function ensureData(){return Array.isArray(window.heroes)?window.heroes:Array.isArray(heroes)?heroes:[]}
  function getItems(){return Array.isArray(window.items)?window.items:Array.isArray(items)?items:[]}
  function heroImg(h){try{return imageUrl(h)}catch{return ''}}
  function itemImg(i){try{return itemImage(i)}catch{return ''}}

  // Поиск — js/search.js: оригинальные названия + синонимы Dota 2 + страницы сайта.
  // Результаты — выпадающий список поверх страницы (css/home-hero.css), по 5 на группу.
  let cursor=-1;
  const row=(attrs,img,text)=>`<button type="button" ${attrs}>${img?`<img src="${img}" alt="" loading="lazy">`:''}<span class="sr-t">${esc(text)}</span></button>`;
  function close(){const el=$('globalSearchResults');if(el){el.innerHTML='';el.classList.remove('show')}cursor=-1}
  function renderGlobal(q=''){
    const el=$('globalSearchResults'); if(!el)return; q=q.trim(); cursor=-1; if(!q){close();return}
    const S=window.D2HSearch,low=q.toLowerCase();
    const hs=(S?S.heroes(ensureData(),q):ensureData().filter(h=>String(h.localized_name).toLowerCase().includes(low))).slice(0,5);
    const is=(S?S.items(getItems(),q):getItems().filter(i=>String(i.dname||i.name).toLowerCase().includes(low))).slice(0,5);
    const ps=(S?S.pages(q):[]).slice(0,5);
    let html='';
    if(hs.length)html+=`<div class="v43-search-group"><b>Герои</b>${hs.map(x=>row(`data-v43-hero="${x.id}"`,heroImg(x),x.localized_name)).join('')}</div>`;
    if(is.length)html+=`<div class="v43-search-group"><b>Предметы</b>${is.map(x=>row(`data-v43-item="${esc(x.name)}"`,itemImg(x),x.dname||x.name)).join('')}</div>`;
    if(ps.length)html+=`<div class="v43-search-group"><b>Страницы</b>${ps.map(p=>`<a href="${esc(p.u)}"><span class="sr-t">${esc(p.t)}</span></a>`).join('')}</div>`;
    el.innerHTML=html||'<div class="empty">Ничего не найдено.</div>';el.classList.add('show');
  }
  function rows(){return Array.from($('globalSearchResults')?.querySelectorAll('button,a')||[])}
  function move(d){const r=rows();if(!r.length)return;r[cursor]?.classList.remove('is-active');cursor=(cursor+d+r.length)%r.length;r[cursor].classList.add('is-active');r[cursor].scrollIntoView({block:'nearest'})}
  function activate(el){if(!el)return;if(el.dataset.v43Hero){close();openHero(Number(el.dataset.v43Hero));}else if(el.dataset.v43Item){close();openItem(el.dataset.v43Item);}else if(el.href){location.href=el.href;}}

  function bind(){
    const inp=$('globalSearch'),res=$('globalSearchResults');
    inp?.addEventListener('input',e=>renderGlobal(e.target.value));
    inp?.addEventListener('focus',e=>{if(e.target.value.trim())renderGlobal(e.target.value)});
    inp?.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();move(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();move(-1)}
      else if(e.key==='Enter'){const r=rows();const t=r[cursor>=0?cursor:0];if(t){e.preventDefault();activate(t)}}
      else if(e.key==='Escape'){close();inp.blur()}
    });
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();inp?.focus()}});
    document.addEventListener('click',e=>{if(res&&!e.target.closest('#globalSearchResults')&&e.target!==inp)close()});
    res?.addEventListener('click',e=>{const t=e.target.closest('[data-v43-hero],[data-v43-item]');if(t)activate(t);});
  }
  function boot(){bind();window.D2HSearch&&D2HSearch.onReady(()=>{const v=$('globalSearch')?.value;if(v)renderGlobal(v);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
