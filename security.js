/* Dota 2 Helper browser security bootstrap. */
window.__D2H_CSRF_PROMISE__=(async()=>{try{const r=await fetch('/api/security/csrf',{credentials:'same-origin'});const d=await r.json();window.__D2H_CSRF__=d.csrfToken||'';return window.__D2H_CSRF__}catch{return ''}})();
(()=>{
 const original=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
   const url=typeof input==='string'?input:(input&&input.url)||'';
   const same=url.startsWith('/')||url.startsWith(location.origin);
   const method=String(init.method||'GET').toUpperCase();
   if(same&&!['GET','HEAD','OPTIONS'].includes(method)&&!url.includes('/api/security/csrf')){
     await window.__D2H_CSRF_PROMISE__;
     init.headers={...(init.headers||{}),'X-CSRF-Token':window.__D2H_CSRF__||''};
   }
   return original(input,init);
 };
})();
