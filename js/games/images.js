// Same-origin portraits/icons already shipped with hero and item pages.
const cache=new Map();
export const itemImage=key=>`/assets/items/${key}.png`;
export function preloadImage(src){
  if(!src||!src.startsWith('/assets/'))return null;
  if(cache.has(src))return cache.get(src);
  const entry={image:new Image(),status:'loading'};cache.set(src,entry);
  entry.image.onload=()=>{entry.status='ready'};
  entry.image.onerror=()=>{entry.status='failed'};
  entry.image.src=src;return entry;
}
export function drawImage(c,src,x,y,w,h,fallback){
  const entry=preloadImage(src);
  if(entry?.status==='ready'){
    const im=entry.image,ratio=Math.max(w/im.naturalWidth,h/im.naturalHeight);
    c.save();c.beginPath();c.rect(x,y,w,h);c.clip();c.drawImage(im,x+(w-im.naturalWidth*ratio)/2,y+(h-im.naturalHeight*ratio)/2,im.naturalWidth*ratio,im.naturalHeight*ratio);c.restore();
  }else if(entry?.status==='loading'){
    c.fillStyle='#34424f';c.fillRect(x,y,w,h);c.fillStyle='#667480';c.fillRect(x+w*.2,y+h*.3,w*.6,h*.12);c.fillRect(x+w*.3,y+h*.55,w*.4,h*.12);
  }else fallback?.();
}
export function tileImage(button,src){
  const box=document.createElement('span');box.className='game-image';box.setAttribute('aria-hidden','true');
  const fallback=document.createElement('span');fallback.className='game-image-fallback';fallback.textContent='◇';
  const img=document.createElement('img');img.alt='';img.width=64;img.height=48;img.decoding='async';
  img.onload=()=>box.dataset.state='ready';img.onerror=()=>box.dataset.state='failed';
  box.append(fallback,img);button.prepend(box);preloadImage(src);img.src=src;
}
