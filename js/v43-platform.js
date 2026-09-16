/* Dota 2 Companion v43 — persistent platform layer. */
(function(){
  'use strict';
  const token=()=>localStorage.getItem('d2h_token')||'';
  const authHeaders=()=>token()?{Authorization:'Bearer '+token(),'Content-Type':'application/json'}:{'Content-Type':'application/json'};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async(path,opts={})=>{const r=await fetch(path,{...opts,headers:{...authHeaders(),...(opts.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Ошибка API');return d};
  const store=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};

  async function syncFavorites(){if(!token())return;const migrated=localStorage.getItem('d2h_v43_favorites_migrated')==='1';try{const d=await api('/api/profile/favorites');if(!migrated){const local=store('d2h_favorites',[]);if(local.length)await api('/api/profile/favorites',{method:'POST',body:JSON.stringify({heroIds:local})});localStorage.setItem('d2h_v43_favorites_migrated','1');const fresh=await api('/api/profile/favorites');save('d2h_favorites',(fresh.favorites||[]).map(Number));}else save('d2h_favorites',(d.favorites||[]).map(Number));}catch{}}
  async function syncBuilds(){if(!token())return;const migrated=localStorage.getItem('d2h_v43_builds_migrated')==='1';try{let d=await api('/api/profile/builds');if(!migrated){const local=store('d2h_builds',[]);for(const b of local.slice(0,20)){try{await api('/api/profile/builds',{method:'POST',body:JSON.stringify(b)})}catch{}}localStorage.setItem('d2h_v43_builds_migrated','1');d=await api('/api/profile/builds');}save('d2h_builds',d.builds||[]);}catch{}}
  async function loadProfileData(){if(!token())return null;try{const d=await api('/api/profile');if(Array.isArray(d.favorites)&&d.favorites.length){try{const hd=await fetch('/api/dota/heroes');const hs=await hd.json();const map=new Map((hs||[]).map(h=>[Number(h.id),h]));d.favorites=d.favorites.map(x=>({...x,name:map.get(Number(x.id))?.localized_name||('Герой #'+x.id),image:map.get(Number(x.id))?.img?String(map.get(Number(x.id)).img).replace('\\','/'):(x.image||'')}))}catch{}}return d}catch{return null}}
  window.D2HPlatform={api,loadProfileData,syncFavorites,syncBuilds,esc};

  function injectProfileSections(data){
    const app=document.getElementById('app');if(!app||!data?.user)return;
    const f=(data.favorites||[]),b=(data.builds||[]),g=(data.guides||[]),s=(data.subscriptions||[]),n=(data.stats||{});
    app.innerHTML=`<div class="v43-profile-head"><div><div class="eyebrow">ACCOUNT</div><h1>${esc(data.user.username)}</h1><p>${esc(data.user.email)}</p></div><div class="v43-profile-actions"><a class="btn red" href="studio.html">🎥 Студия</a><a class="btn ghost" href="stream.html">📺 Стримы</a><button class="btn ghost" id="logoutV43">Выйти</button></div></div>
      <div class="v43-profile-stats"><div><b>${n.favorites||0}</b><span>избранных героев</span></div><div><b>${n.builds||0}</b><span>билдов</span></div><div><b>${n.guides||0}</b><span>гайдов</span></div><div><b>${n.subscriptions||0}</b><span>подписок</span></div></div>
      <div class="v43-profile-grid">
        <section class="v43-profile-card"><div class="v43-card-head"><h2>❤️ Избранные герои</h2><a href="index.html#heroes">Открыть героев →</a></div><div class="v43-mini-grid">${f.length?f.map(x=>`<button data-v43-hero="${x.id}"><img src="${esc(x.image||'')}" alt=""><span>${esc(x.name)}</span></button>`).join(''):'<p class="muted">Пока нет избранных героев.</p>'}</div></section>
        <section class="v43-profile-card"><div class="v43-card-head"><h2>🧩 Мои билды</h2><a href="index.html#builds">Build Lab →</a></div><div class="v43-list">${b.length?b.slice(0,8).map(x=>`<div><b>${esc(x.name||'Мой билд')}</b><span>${esc(x.hero_name||x.hero||'Герой')} · ${(x.items||[]).map(esc).join(' · ')}</span></div>`).join(''):'<p class="muted">Сохрани первый билд в Build Lab.</p>'}</div></section>
        <section class="v43-profile-card"><div class="v43-card-head"><h2>📖 Мои гайды</h2><button class="btn ghost" id="newGuideV43">＋ Создать</button></div><div class="v43-list">${g.length?g.slice(0,8).map(x=>`<div><b>${esc(x.title)}</b><span>${esc(x.hero_name||'Без героя')} · ${esc(x.role||'') } · ${x.published?'Опубликован':'Черновик'}</span></div>`).join(''):'<p class="muted">Создай первый гайд сообщества.</p>'}</div></section>
        <section class="v43-profile-card"><div class="v43-card-head"><h2>📺 Подписки</h2><a href="stream.html">Смотреть эфиры →</a></div><div class="v43-list">${s.length?s.slice(0,8).map(x=>`<a href="channel.html?channel=${encodeURIComponent(x.slug)}"><b>🔴 ${esc(x.username)}</b><span>${esc(x.title)} · ${x.live?'LIVE':'offline'}</span></a>`).join(''):'<p class="muted">Ты пока ни на кого не подписан.</p>'}</div></section>
      </div>`;
    document.querySelectorAll('[data-v43-hero]').forEach(el=>el.onclick=()=>{if(typeof openHero==='function')openHero(Number(el.dataset.v43Hero))});
    document.getElementById('logoutV43').onclick=()=>{localStorage.removeItem('d2h_token');localStorage.removeItem('d2h_user');location.href='index.html'};
    document.getElementById('newGuideV43').onclick=createGuide;
  }
  async function createGuide(){if(!token())return location.href='auth.html?next=profile.html';const title=prompt('Название гайда:','Мой гайд');if(!title)return;const hero=prompt('Герой:','');const role=prompt('Позиция (1–5):','2')||'2';try{await api('/api/profile/guides',{method:'POST',body:JSON.stringify({title,hero,role,content:''})});const d=await loadProfileData();injectProfileSections(d);alert('Гайд сохранён на сервере.')}catch(e){alert(e.message)}}

  async function setupShell(){
    const menu=document.getElementById('menu'),nav=document.getElementById('navMenu');
    if(menu&&nav&&!menu.dataset.v43Bound){menu.dataset.v43Bound='1';menu.onclick=()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));};nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')))}
    const bell=document.getElementById('notifyBell'),panel=document.getElementById('notifyPanel'),count=document.getElementById('notifyCount');
    if(!bell||bell.dataset.v43Bound)return;
    bell.dataset.v43Bound='1';
    const load=async()=>{const t=token();if(!t){if(count)count.textContent='0';return}try{const d=await api('/api/notifications');if(count)count.textContent=d.unread||0;if(panel)panel.innerHTML=(d.notifications||[]).slice(0,8).map(n=>`<div class="notify-item ${n.read_at?'':'unread'}"><b>${esc(n.title||'')}</b><span>${esc(n.body||'')}</span></div>`).join('')||'<div class="notify-empty">Нет уведомлений</div>'}catch{}};
    bell.onclick=()=>{panel?.classList.toggle('show');if(panel?.classList.contains('show'))load()};load();setInterval(load,30000);
  }
  function safeNext(raw,fallback='stream.html'){try{const u=new URL(raw||fallback,location.origin);if(u.origin!==location.origin)return fallback;return u.pathname+u.search+u.hash}catch{return fallback}}
  async function boot(){
    setupShell();
    if(location.pathname.endsWith('/profile.html')||location.pathname.endsWith('profile.html')){
      if(!token()){location.replace('auth.html?next=profile.html');return}
      const d=await loadProfileData();if(d)injectProfileSections(d);else location.replace('auth.html?next=profile.html');
    }
    if(token()){syncFavorites();syncBuilds();}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

/* Community guide discovery on the home page. */
(function(){
  const esc=window.D2HPlatform?.esc||((s)=>String(s??''));
  async function loadGuides(){const el=document.getElementById('communityGuides');if(!el)return;try{const r=await fetch('/api/guides?limit=8');const d=await r.json();el.innerHTML=(d.guides||[]).map(g=>`<div><b>${esc(g.title)}</b><span>${esc(g.username)} · ${esc(g.hero_name||'Без героя')} · ♥ ${Number(g.likes||0)}</span></div>`).join('')||'<span class="muted">Пока никто не опубликовал гайд.</span>'}catch{el.innerHTML='<span class="muted">Не удалось загрузить гайды.</span>'}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadGuides);else loadGuides();
  document.getElementById('loadCommunityGuides')?.addEventListener('click',loadGuides);
})();
