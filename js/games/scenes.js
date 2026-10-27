export const scenes={
  'hook-aim':['#142f38','#315854','#edc17d','harbor'],
  'last-hit':['#302b48','#4f6554','#efb37a','lane'],
  'deny':['#202f46','#3e5956','#98d9cc','lane'],
  'item-recipes':['#30243a','#6b4938','#ffcb70','forge'],
  'stun-chain':['#202942','#364669','#a6cfff','arena'],
  'counter-pick':['#11182f','#30345b','#d3b1ff','hall'],
  'budget-build':['#25131b','#653b2a','#ffcb70','shop'],
  'minimap-awareness':['#081e29','#153c38','#72ead5','forest'],
  'rune-timing':['#35335d','#397c87','#ffce9b','river'],
  'cooldown-tracking':['#1e1026','#562c43','#ff8992','dome']
};
export function drawScene(c,w,h,id,time=0,reduced=false){
  const [sky,ground,accent,kind]=scenes[id]||scenes['last-hit'],t=reduced?0:time;
  const dot=(x,y,r,color)=>{c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,7);c.fill()};
  const path=(points,color,width=1)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke()};
  c.save();const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,sky);g.addColorStop(1,ground);c.fillStyle=g;c.fillRect(0,0,w,h);
  // Distant layer moves slower than the foreground; never move gameplay coordinates.
  c.save();c.translate(Math.sin(t*.12)*3,0);
  if(['hall','dome','arena','forge'].includes(kind)){
    c.strokeStyle=accent+'35';c.lineWidth=3;
    for(let i=0;i<5;i++){c.beginPath();c.ellipse(w/2,h*.58,w*(.18+i*.12),h*.57,0,Math.PI,Math.PI*2);c.stroke()}
    for(let i=0;i<7;i++){const x=i*w/6;c.fillStyle=sky;c.fillRect(x-9,h*.12,18,h*.76);c.fillStyle=accent+'22';c.fillRect(x-12,h*.12,24,9)}
    if(kind==='hall')for(let i=0;i<4;i++){const x=w*(.12+i*.25);c.fillStyle=i%2?'#634b75':'#3e536d';c.beginPath();c.moveTo(x,0);c.lineTo(x+35,0);c.lineTo(x+35,h*.3);c.lineTo(x+18,h*.36);c.lineTo(x,h*.3);c.fill();path([[x+17,12],[x+17,h*.27]],accent+'88',2)}
    if(kind==='dome')for(let i=0;i<40;i++)dot((i*137)%w,(i*37)%(h*.7),i%4?1:2,accent+'aa');
    if(kind==='arena')for(let i=0;i<3;i++){c.strokeStyle=accent+'44';c.beginPath();c.ellipse(w/2,h*.72,w*(.18+i*.12),h*.11,0,0,7);c.stroke()}
  }else{
    for(let layer=0;layer<3;layer++){c.fillStyle=[sky+'aa',ground+'99',ground][layer];c.beginPath();c.moveTo(-20,h);for(let i=0;i<=12;i++)c.lineTo(i*w/12,h*(.28+layer*.16)+Math.sin(i*1.8+layer)*h*.11);c.lineTo(w+20,h);c.fill()}
    dot(w*.8,h*.18,h*.08,accent+'88');
  }
  c.restore();
  if(['river','harbor'].includes(kind)){
    c.fillStyle='#458e9b66';c.beginPath();c.moveTo(w*.6,h*.26);c.bezierCurveTo(w*.2,h*.5,w*.8,h*.75,w*.3,h);c.lineTo(w,h);c.bezierCurveTo(w*.4,h*.6,w*.8,h*.4,w*.7,h*.26);c.fill();
    for(let i=0;i<18;i++){const y=h*(.35+i*.035),x=w*(.56+.13*Math.sin(i*.7))+Math.sin(t*.6+i)*5;path([[x,y],[x+w*.08,y]],accent+'44',1)}
  }
  if(['lane','forest','shop','harbor'].includes(kind)){
    if(kind==='lane'){c.fillStyle='#b5986a33';c.beginPath();c.moveTo(w*.45,h*.3);c.lineTo(w*.55,h*.3);c.lineTo(w,h*.9);c.lineTo(0,h*.9);c.fill()}
    for(let i=0;i<10;i++){const x=i*w/9+Math.sin(t*.2+i)*2,y=h*(.36+(i%3)*.08);path([[x,h*.9],[x,y]],'#102d32',9);dot(x,y,h*.11,'#163b3c');dot(x-14,y+12,h*.08,'#204646')}
  }
  c.save();c.translate(Math.sin(t*.25)*5,0);
  if(['shop','forge','hall','harbor'].includes(kind)){
    for(const x of [w*.07,w*.93]){path([[x,0],[x,h*.26]],accent+'66',2);dot(x,h*.28,18+Math.sin(t*2)*2,accent+'12');c.fillStyle=accent;c.fillRect(x-5,h*.25,10,15);path([[x-8,h*.24],[x+8,h*.24]],sky,3)}
    if(kind==='shop'||kind==='forge'){c.fillStyle='#241e27';c.fillRect(w*.08,h*.76,w*.84,h*.24);c.fillStyle=accent+'55';c.fillRect(w*.06,h*.75,w*.88,8);for(let i=0;i<6;i++){c.fillStyle=i%2?ground:sky;c.fillRect(w*(.12+i*.13),h*.82,w*.1,h*.12)}}
  }
  if(kind==='forest'||kind==='dome')for(let i=0;i<20;i++)dot((i*79+31)%w,h*(.2+(i%7)*.1)+Math.sin(t*.6+i)*5,1.5,accent+(Math.sin(t+i)>0?'88':'33'));
  // Low fog sits behind the dark gameplay panels.
  c.fillStyle='#c1d5dd08';for(let i=0;i<3;i++){c.beginPath();c.ellipse(w*(.2+i*.4)+Math.sin(t*.15+i)*12,h*.85,w*.4,h*.06,0,0,7);c.fill()}
  c.restore();c.restore();
}
