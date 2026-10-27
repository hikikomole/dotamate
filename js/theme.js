(function(){
  'use strict';
  var key='dotamate-theme';
  window.D2HGoal=window.D2HGoal||function(name){try{if(typeof window.ym==='function')window.ym(112755250,'reachGoal',name)}catch(e){}};
  function update(){
    var button=document.querySelector('.theme-toggle');
    if(!button)return;
    var light=document.documentElement.dataset.theme==='light';
    button.setAttribute('aria-pressed',String(light));
    button.setAttribute('aria-label',light?'Включить тёмную тему':'Включить светлую тему');
    button.textContent=light?'☾':'☼';
  }
  document.addEventListener('DOMContentLoaded',function(){
    update();
    var button=document.querySelector('.theme-toggle');
    if(!button)return;
    button.addEventListener('click',function(){
      var next=document.documentElement.dataset.theme==='light'?'dark':'light';
      document.documentElement.dataset.theme=next;
      try{localStorage.setItem(key,next)}catch(e){}
      update();
      window.D2HGoal('theme_toggle');
    });
    document.addEventListener('click',function(e){
      var a=e.target.closest&&e.target.closest('a[href]');
      if(!a)return;
      var href=a.getAttribute('href')||'';
      if(/^\/guide\//.test(location.pathname)&&/^\/(game|items)\//.test(href))window.D2HGoal('guide_internal_link');
      if(/\.(exe|msi|dmg|appx|zip)(?:[?#]|$)/i.test(href)&&/download|скачать/i.test((a.textContent||'')+' '+href))window.D2HGoal('app_download');
      if(a.closest('.gd-grid,.gd-hero-results,.search-results')&&document.querySelector('input[type="search"]:not([value=""])'))window.D2HGoal('site_search');
    });
    document.addEventListener('submit',function(e){
      if(e.target.closest('[role="search"],.site-search,.gd-search')&&e.target.querySelector('input')?.value.trim())window.D2HGoal('site_search');
    });
  });
})();
