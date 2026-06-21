// ── 天天過馬路 ──
const XRG_WIDTH = 420;
const XRG_HEIGHT = 720;
const XRG_COLS = 7;
const XRG_COL_WIDTH = 60;
const XRG_ROW_HEIGHT = 56;
const XRG_BEST_KEY = 'xrg_best_distance_v1';
const XRG_ECONOMY_KEY = 'xrg_economy_v1';
const XRG_CHARACTERS = [
  {id:'chick',name:'小雞',emoji:'🐥',price:0},
  {id:'bunny',name:'兔兔',emoji:'🐰',price:50},
  {id:'cat',name:'小貓',emoji:'🐱',price:80},
  {id:'frog',name:'青蛙',emoji:'🐸',price:120},
  {id:'fox',name:'狐狸',emoji:'🦊',price:170},
  {id:'panda',name:'熊貓',emoji:'🐼',price:230},
  {id:'dog',name:'狗狗',emoji:'🐶',price:300},
  {id:'shiba',name:'柴犬',emoji:'🐕',price:360},
  {id:'orange-cat',name:'橘貓',emoji:'😺',price:430},
  {id:'black-cat',name:'黑貓',emoji:'🐈‍⬛',price:500}
];
let xrgCanvas = null;
let xrgCtx = null;
let xrgRunning = false;
let xrgPaused = false;
let xrgGameOver = false;
let xrgRaf = 0;
let xrgLastFrame = 0;
let xrgElapsed = 0;
let xrgPlayer = {col:3,row:0};
let xrgCameraRow = 0;
let xrgMaxRow = 0;
let xrgLanes = [];
let xrgCoinRows = new Map();
let xrgCoinEffects = [];
let xrgAudioContext = null;
let xrgAudioUnlocked = false;
let xrgBest = Number(localStorage.getItem(XRG_BEST_KEY) || 0);
let xrgPointerStart = null;
let xrgLastTouchEnd = 0;
let xrgEconomyListening = false;
let xrgEconomy = xrgLoadEconomy();

function xrgIsActiveScreen(){
  return !!document.getElementById('gs-7')?.classList.contains('active');
}

function xrgPreventGameGestureZoom(event){
  if(!xrgIsActiveScreen()) return;
  event.preventDefault();
}

function xrgBindNoZoomGuards(){
  if(window.__xrgNoZoomGuardsBound) return;
  window.__xrgNoZoomGuardsBound = true;
  document.addEventListener('gesturestart',xrgPreventGameGestureZoom,{passive:false});
  document.addEventListener('gesturechange',xrgPreventGameGestureZoom,{passive:false});
  document.addEventListener('touchmove',event=>{
    if(xrgIsActiveScreen() && event.touches && event.touches.length > 1) event.preventDefault();
  },{passive:false});
  document.addEventListener('touchend',event=>{
    if(!xrgIsActiveScreen()) return;
    const now = Date.now();
    if(now - xrgLastTouchEnd < 380){
      event.preventDefault();
      if(typeof event.stopPropagation==='function') event.stopPropagation();
    }
    xrgLastTouchEnd = now;
  },{passive:false,capture:true});
}

function xrgNormalizeEconomy(value){
  const owned = Array.isArray(value?.owned) ? value.owned.filter(id=>XRG_CHARACTERS.some(character=>character.id===id)) : ['chick'];
  if(!owned.includes('chick')) owned.unshift('chick');
  const selected = owned.includes(value?.selected) ? value.selected : 'chick';
  return {coins:Math.max(0,Math.floor(Number(value?.coins)||0)),owned:[...new Set(owned)],selected};
}

function xrgLoadEconomy(){
  try{return xrgNormalizeEconomy(JSON.parse(localStorage.getItem(XRG_ECONOMY_KEY)||'null')||{});}catch(_err){return xrgNormalizeEconomy({});}
}

function xrgSaveEconomyLocal(){
  localStorage.setItem(XRG_ECONOMY_KEY,JSON.stringify(xrgEconomy));
  xrgUpdateStats();
  xrgRenderShop();
}

function xrgCurrentCharacter(){
  return XRG_CHARACTERS.find(character=>character.id===xrgEconomy.selected) || XRG_CHARACTERS[0];
}

function xrgRenderShop(){
  const grid = document.getElementById('xrg-shop-grid');
  if(!grid) return;
  grid.innerHTML = XRG_CHARACTERS.map(character=>{
    const owned = xrgEconomy.owned.includes(character.id);
    const selected = xrgEconomy.selected===character.id;
    const label = selected ? '使用中' : owned ? '使用角色' : `${character.price} 金幣購買`;
    return `<div class="xrg-shop-item"><div class="xrg-shop-emoji">${character.emoji}</div><div><div class="xrg-shop-name">${character.name}</div><div class="xrg-shop-price">${owned ? '已擁有' : `價格：${character.price} 🪙`}</div><button type="button" class="xrg-shop-action" ${selected?'disabled':''} onclick="xrgBuyOrSelectCharacter('${character.id}')">${label}</button></div></div>`;
  }).join('');
}

function xrgToggleShop(force){
  const shop = document.getElementById('xrg-shop');
  if(!shop) return;
  const open = typeof force==='boolean' ? force : shop.classList.contains('hidden');
  shop.classList.toggle('hidden',!open);
  if(open){
    xrgPauseIfHidden();
    xrgRenderShop();
  }
}

function xrgBuyOrSelectCharacter(characterId){
  const character = XRG_CHARACTERS.find(item=>item.id===characterId);
  if(!character) return;
  if(xrgEconomy.owned.includes(characterId)){
    xrgEconomy.selected = characterId;
    xrgSaveEconomyLocal();
    if(window._fb){
      const {db,ref,set}=window._fb;
      set(ref(db,'crossyEconomy/selected'),characterId).catch(()=>{});
    }
    xrgDraw();
    return;
  }
  if(xrgEconomy.coins < character.price){
    alert(`還差 ${character.price-xrgEconomy.coins} 枚金幣才能購買 ${character.name}。`);
    return;
  }
  xrgEconomy.coins -= character.price;
  xrgEconomy.owned.push(characterId);
  xrgEconomy.selected = characterId;
  xrgSaveEconomyLocal();
  if(window._fb){
    const {db,ref,runTransaction}=window._fb;
    runTransaction(ref(db,'crossyEconomy'),current=>{
      const economy = xrgNormalizeEconomy(current || xrgEconomy);
      if(economy.owned.includes(characterId)){
        economy.selected = characterId;
        return economy;
      }
      if(economy.coins < character.price) return economy;
      economy.coins -= character.price;
      economy.owned.push(characterId);
      economy.selected = characterId;
      return economy;
    }).catch(()=>{});
  }
  xrgDraw();
}

function xrgCollectCoin(){
  if(xrgCoinRows.get(xrgPlayer.row)!==xrgPlayer.col) return;
  xrgSpawnCoinEffect(xrgPlayer.col,xrgPlayer.row);
  xrgPlayCoinSound();
  xrgCoinRows.delete(xrgPlayer.row);
  xrgEconomy.coins += 1;
  xrgSaveEconomyLocal();
  if(window._fb){
    const {db,ref,runTransaction}=window._fb;
    runTransaction(ref(db,'crossyEconomy/coins'),current=>(Math.max(0,Number(current)||0)+1)).catch(()=>{});
  }
}

function xrgEnsureAudioContext(){
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if(!AudioContextClass) return null;
  try{
    if(!xrgAudioContext) xrgAudioContext = new AudioContextClass();
    return xrgAudioContext;
  }catch(_err){
    return null;
  }
}

function xrgWithAudioContext(callback){
  const context = xrgEnsureAudioContext();
  if(!context) return;
  const run = () => {
    if(context.state !== 'running') return;
    xrgAudioUnlocked = true;
    try{ callback(context); }catch(_err){}
  };
  if(context.state === 'suspended'){
    try{
      const resumePromise = context.resume();
      if(resumePromise && typeof resumePromise.then==='function'){
        resumePromise.then(run).catch(()=>{});
      }else{
        setTimeout(run,0);
      }
    }catch(_err){}
    return;
  }
  run();
}

function xrgUnlockAudio(){
  xrgWithAudioContext(context=>{
    try{
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001,context.currentTime);
      gain.connect(context.destination);
      if(context.createBuffer && context.createBufferSource){
        const buffer = context.createBuffer(1,1,22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(context.currentTime);
        source.stop(context.currentTime+.01);
      }else{
        const oscillator = context.createOscillator();
        oscillator.connect(gain);
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime+.01);
      }
    }catch(_err){}
  });
}

function xrgPlayStepSound(){
  xrgWithAudioContext(context=>{
    const startAt = context.currentTime+.005;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(285,startAt);
    oscillator.frequency.exponentialRampToValueAtTime(205,startAt+.055);
    gain.gain.setValueAtTime(.14,startAt);
    gain.gain.exponentialRampToValueAtTime(.0001,startAt+.065);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt+.07);
  });
}

function xrgPlayCoinSound(){
  xrgWithAudioContext(context=>{
    const startAt = context.currentTime+.005;
    [880,1320,1760].forEach((frequency,index)=>{
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * .055;
      oscillator.type = index===2 ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency,noteStart);
      gain.gain.setValueAtTime(.0001,noteStart);
      gain.gain.exponentialRampToValueAtTime(.24,noteStart+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,noteStart+.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart+.17);
    });
  });
}

function xrgPlayCrashSound(){
  xrgWithAudioContext(context=>{
    const startAt = context.currentTime+.005;
    const gain = context.createGain();
    gain.gain.setValueAtTime(.34,startAt);
    gain.gain.exponentialRampToValueAtTime(.0001,startAt+.38);
    gain.connect(context.destination);
    [
      {type:'sawtooth',start:150,end:48,delay:0},
      {type:'square',start:86,end:34,delay:.035}
    ].forEach(note=>{
      const oscillator = context.createOscillator();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.start,startAt+note.delay);
      oscillator.frequency.exponentialRampToValueAtTime(note.end,startAt+.34);
      oscillator.connect(gain);
      oscillator.start(startAt+note.delay);
      oscillator.stop(startAt+.38);
    });
  });
}

function xrgSpawnCoinEffect(col,row){
  const x = col * XRG_COL_WIDTH + 30;
  const y = xrgRowY(row) + 27;
  const particles = Array.from({length:12},(_,index)=>{
    const angle = (Math.PI*2*index/12) + Math.random()*.18;
    const speed = 48 + Math.random()*58;
    return {x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-22,size:2.5+Math.random()*3};
  });
  xrgCoinEffects.push({x,y,life:.72,maxLife:.72,particles});
}

function xrgUpdateCoinEffects(delta){
  xrgCoinEffects.forEach(effect=>{
    effect.life -= delta;
    effect.particles.forEach(particle=>{
      particle.x += particle.vx*delta;
      particle.y += particle.vy*delta;
      particle.vy += 105*delta;
    });
  });
  xrgCoinEffects = xrgCoinEffects.filter(effect=>effect.life>0);
}

function xrgDrawCoinEffects(){
  xrgCoinEffects.forEach(effect=>{
    const alpha = Math.max(0,effect.life/effect.maxLife);
    xrgCtx.save();
    xrgCtx.globalAlpha = alpha;
    effect.particles.forEach((particle,index)=>{
      xrgCtx.fillStyle = index%2 ? '#fff3a6' : '#ffd43b';
      xrgCtx.beginPath();
      xrgCtx.arc(particle.x,particle.y,particle.size,0,Math.PI*2);
      xrgCtx.fill();
    });
    xrgCtx.fillStyle = '#fff7b8';
    xrgCtx.strokeStyle = '#b87912';
    xrgCtx.lineWidth = 3;
    xrgCtx.font = 'bold 22px Arial';
    xrgCtx.textAlign = 'center';
    xrgCtx.textBaseline = 'middle';
    const textY = effect.y - 18 - (1-alpha)*28;
    xrgCtx.strokeText('+1',effect.x,textY);
    xrgCtx.fillText('+1',effect.x,textY);
    xrgCtx.restore();
  });
}

function xrgInitEconomyFirebase(){
  if(xrgEconomyListening || !window._fb) return;
  xrgEconomyListening = true;
  const {db,ref,onValue,set}=window._fb;
  onValue(ref(db,'crossyEconomy'),snapshot=>{
    const remote = snapshot.val();
    if(remote){
      const cloud = xrgNormalizeEconomy(remote);
      const mergedOwned = [...new Set([...cloud.owned,...xrgEconomy.owned])];
      const mergedSelected = mergedOwned.includes(xrgEconomy.selected) ? xrgEconomy.selected : cloud.selected;
      xrgEconomy = xrgNormalizeEconomy({coins:Math.max(cloud.coins,xrgEconomy.coins),owned:mergedOwned,selected:mergedSelected});
      xrgSaveEconomyLocal();
      xrgDraw();
      if(JSON.stringify(cloud)!==JSON.stringify(xrgEconomy)) set(ref(db,'crossyEconomy'),xrgEconomy).catch(()=>{});
    }else{
      set(ref(db,'crossyEconomy'),xrgEconomy).catch(()=>{});
    }
  });
}

function xrgMod(value, divisor){
  return ((value % divisor) + divisor) % divisor;
}

function xrgMakeLane(row){
  if(row < 3 || row % 6 === 0){
    return {type:'grass',shade:row % 2};
  }
  const direction = Math.random() > .5 ? 1 : -1;
  const colors = ['#ff758f','#f8b84e','#6aa8ff','#9d7bea','#53c5a1','#ff8b61'];
  return {
    type:'road',
    speed:direction * Math.min(165, 48 + row * 2 + Math.random() * 34),
    gap:225 + Math.random() * 105,
    offset:Math.random() * 280,
    carWidth:46 + Math.random() * 18,
    color:colors[Math.floor(Math.random() * colors.length)]
  };
}

function xrgEnsureLanes(targetRow){
  while(xrgLanes.length <= targetRow){
    const row = xrgLanes.length;
    xrgLanes.push(xrgMakeLane(row));
    if(row>=3 && Math.random()<.42) xrgCoinRows.set(row,Math.floor(Math.random()*XRG_COLS));
  }
}

function xrgRowY(row){
  return XRG_HEIGHT - ((row - xrgCameraRow) + 1) * XRG_ROW_HEIGHT;
}

function xrgCarRects(lane,rowY){
  if(!lane || lane.type!=='road') return [];
  const phase = xrgMod(lane.offset + xrgElapsed * lane.speed, lane.gap);
  const cars = [];
  for(let x=phase-lane.gap; x<XRG_WIDTH+lane.gap; x+=lane.gap){
    cars.push({x,y:rowY+11,w:lane.carWidth,h:34});
  }
  return cars;
}

function xrgRoundedRect(ctx,x,y,w,h,r){
  const radius = Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+radius,y);
  ctx.arcTo(x+w,y,x+w,y+h,radius);
  ctx.arcTo(x+w,y+h,x,y+h,radius);
  ctx.arcTo(x,y+h,x,y,radius);
  ctx.arcTo(x,y,x+w,y,radius);
  ctx.closePath();
}

function xrgDrawLane(row,lane){
  const y = xrgRowY(row);
  if(y < -XRG_ROW_HEIGHT || y > XRG_HEIGHT) return;
  if(lane.type==='grass'){
    xrgCtx.fillStyle = lane.shade ? '#82cb70' : '#75be66';
    xrgCtx.fillRect(0,y,XRG_WIDTH,XRG_ROW_HEIGHT+1);
    xrgCtx.fillStyle = 'rgba(255,255,255,.10)';
    for(let x=14+(row%3)*19;x<XRG_WIDTH;x+=74) xrgCtx.fillRect(x,y+13,5,5);
    return;
  }
  xrgCtx.fillStyle = '#4c4f58';
  xrgCtx.fillRect(0,y,XRG_WIDTH,XRG_ROW_HEIGHT+1);
  xrgCtx.fillStyle = 'rgba(255,255,255,.4)';
  for(let x=(row%2)*26;x<XRG_WIDTH;x+=62) xrgCtx.fillRect(x,y+27,34,3);
  xrgCarRects(lane,y).forEach(car=>{
    xrgCtx.fillStyle = 'rgba(0,0,0,.18)';
    xrgRoundedRect(xrgCtx,car.x+3,car.y+4,car.w,car.h,8);
    xrgCtx.fill();
    xrgCtx.fillStyle = lane.color;
    xrgRoundedRect(xrgCtx,car.x,car.y,car.w,car.h,8);
    xrgCtx.fill();
    xrgCtx.fillStyle = '#dff3ff';
    const front = lane.speed > 0 ? car.x+car.w-18 : car.x+6;
    xrgCtx.fillRect(front,car.y+6,12,9);
    xrgCtx.fillStyle = '#252830';
    xrgCtx.fillRect(car.x+8,car.y+29,11,7);
    xrgCtx.fillRect(car.x+car.w-19,car.y+29,11,7);
  });
}

function xrgDrawCoins(){
  xrgCtx.save();
  xrgCoinRows.forEach((col,row)=>{
    const y = xrgRowY(row);
    if(y < -XRG_ROW_HEIGHT || y > XRG_HEIGHT) return;
    const x = col * XRG_COL_WIDTH + 30;
    xrgCtx.fillStyle = 'rgba(0,0,0,.18)';
    xrgCtx.beginPath();
    xrgCtx.arc(x+2,y+31,13,0,Math.PI*2);
    xrgCtx.fill();
    xrgCtx.fillStyle = '#ffd34e';
    xrgCtx.beginPath();
    xrgCtx.arc(x,y+27,13,0,Math.PI*2);
    xrgCtx.fill();
    xrgCtx.strokeStyle = '#e5a91e';
    xrgCtx.lineWidth = 3;
    xrgCtx.stroke();
    xrgCtx.fillStyle = '#9a6710';
    xrgCtx.font = 'bold 15px Arial';
    xrgCtx.textAlign = 'center';
    xrgCtx.textBaseline = 'middle';
    xrgCtx.fillText('$',x,y+27);
  });
  xrgCtx.restore();
}

function xrgDrawPlayer(){
  const x = xrgPlayer.col * XRG_COL_WIDTH + 30;
  const y = xrgRowY(xrgPlayer.row) + 31;
  const character = xrgCurrentCharacter();
  xrgCtx.save();
  xrgCtx.fillStyle = 'rgba(0,0,0,.18)';
  xrgCtx.beginPath();
  xrgCtx.ellipse(x+2,y+18,18,6,0,0,Math.PI*2);
  xrgCtx.fill();
  xrgCtx.font = '40px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
  xrgCtx.textAlign = 'center';
  xrgCtx.textBaseline = 'middle';
  xrgCtx.fillText(character.emoji,x,y);
  xrgCtx.restore();
}

function xrgDraw(){
  if(!xrgCtx) return;
  xrgEnsureLanes(xrgCameraRow + 13);
  xrgCtx.clearRect(0,0,XRG_WIDTH,XRG_HEIGHT);
  xrgCtx.fillStyle = '#75be66';
  xrgCtx.fillRect(0,0,XRG_WIDTH,XRG_HEIGHT);
  for(let row=xrgCameraRow;row<=xrgCameraRow+12;row++) xrgDrawLane(row,xrgLanes[row]);
  xrgDrawCoins();
  xrgDrawCoinEffects();
  xrgDrawPlayer();
}

function xrgRectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

function xrgCheckCollision(){
  const lane = xrgLanes[xrgPlayer.row];
  if(!lane || lane.type!=='road') return false;
  const playerRect = {x:xrgPlayer.col*XRG_COL_WIDTH+18,y:xrgRowY(xrgPlayer.row)+17,w:24,h:25};
  return xrgCarRects(lane,xrgRowY(xrgPlayer.row)).some(car=>{
    const carHitbox = {x:car.x+5,y:car.y+4,w:Math.max(1,car.w-10),h:car.h-8};
    return xrgRectsOverlap(playerRect,carHitbox);
  });
}

function xrgUpdateStats(){
  const score = document.getElementById('xrg-score');
  const best = document.getElementById('xrg-best');
  const coins = document.getElementById('xrg-coins');
  const hudDistance = document.getElementById('xrg-hud-distance');
  if(score) score.textContent = String(xrgMaxRow);
  if(best) best.textContent = String(xrgBest);
  if(coins) coins.textContent = String(xrgEconomy.coins);
  if(hudDistance) hudDistance.textContent = `距離 ${xrgMaxRow}`;
}

function xrgSetHudVisible(visible){
  const hud = document.getElementById('xrg-hud');
  if(hud) hud.classList.toggle('hidden',!visible);
}

function xrgShowOverlay(title,sub,button,emoji='🐥',mode='start'){
  document.getElementById('xrg-overlay')?.classList.remove('hidden');
  const titleEl = document.getElementById('xrg-overlay-title');
  const subEl = document.getElementById('xrg-overlay-sub');
  const buttonEl = document.getElementById('xrg-start-btn');
  const resumeEl = document.getElementById('xrg-resume-btn');
  const emojiEl = document.getElementById('xrg-overlay-emoji');
  if(titleEl) titleEl.textContent = title;
  if(subEl) subEl.textContent = sub;
  if(buttonEl) buttonEl.textContent = button;
  if(resumeEl) resumeEl.classList.toggle('hidden',mode !== 'pause');
  if(emojiEl) emojiEl.textContent = emoji;
}

function xrgGameOverNow(){
  if(xrgGameOver) return;
  xrgPlayCrashSound();
  xrgRunning = false;
  xrgPaused = false;
  xrgGameOver = true;
  cancelAnimationFrame(xrgRaf);
  xrgRaf = 0;
  if(xrgMaxRow > xrgBest){
    xrgBest = xrgMaxRow;
    localStorage.setItem(XRG_BEST_KEY,String(xrgBest));
  }
  xrgUpdateStats();
  xrgShowOverlay('被車撞到了！',`這次前進 ${xrgMaxRow} 格，避開車流再挑戰一次吧。`,'再玩一次','💥');
}

function xrgTick(timestamp){
  if(!xrgRunning) return;
  const delta = xrgLastFrame ? Math.min(.05,(timestamp-xrgLastFrame)/1000) : 0;
  xrgLastFrame = timestamp;
  xrgElapsed += delta;
  xrgUpdateCoinEffects(delta);
  xrgDraw();
  if(xrgCheckCollision()){
    xrgGameOverNow();
    return;
  }
  xrgRaf = requestAnimationFrame(xrgTick);
}

function xrgStart(){
  xrgInit();
  xrgUnlockAudio();
  setTimeout(xrgUnlockAudio,80);
  cancelAnimationFrame(xrgRaf);
  xrgPlayer = {col:3,row:0};
  xrgCameraRow = 0;
  xrgMaxRow = 0;
  xrgElapsed = 0;
  xrgLastFrame = 0;
  xrgLanes = [];
  xrgCoinRows = new Map();
  xrgCoinEffects = [];
  xrgGameOver = false;
  xrgPaused = false;
  xrgRunning = true;
  xrgEnsureLanes(16);
  xrgUpdateStats();
  xrgSetHudVisible(true);
  document.getElementById('xrg-overlay')?.classList.add('hidden');
  xrgDraw();
  xrgRaf = requestAnimationFrame(xrgTick);
}

function xrgMove(direction){
  if(!xrgRunning || xrgGameOver) return;
  let nextCol = xrgPlayer.col;
  let nextRow = xrgPlayer.row;
  if(direction==='up') nextRow += 1;
  if(direction==='down') nextRow = Math.max(xrgCameraRow,nextRow-1);
  if(direction==='left') nextCol = Math.max(0,nextCol-1);
  if(direction==='right') nextCol = Math.min(XRG_COLS-1,nextCol+1);
  if(nextCol===xrgPlayer.col && nextRow===xrgPlayer.row) return;
  xrgPlayer = {col:nextCol,row:nextRow};
  xrgPlayStepSound();
  xrgCollectCoin();
  if(nextRow > xrgMaxRow){
    xrgMaxRow = nextRow;
    xrgCameraRow = Math.max(xrgCameraRow,nextRow-3);
    xrgEnsureLanes(nextRow+13);
    xrgUpdateStats();
  }
  xrgDraw();
  if(xrgCheckCollision()) xrgGameOverNow();
}

function xrgPause(fromHidden=false){
  if(!xrgRunning || xrgGameOver) return;
  xrgRunning = false;
  xrgPaused = true;
  cancelAnimationFrame(xrgRaf);
  xrgRaf = 0;
  xrgUpdateStats();
  xrgSetHudVisible(true);
  const sub = fromHidden ? '你離開了過馬路畫面，可以按繼續接著玩，或重新開始。' : `目前距離 ${xrgMaxRow}，要繼續還是重新開始？`;
  xrgShowOverlay('遊戲已暫停',sub,'重新開始','⏸️','pause');
}

function xrgResume(){
  if(!xrgPaused || xrgGameOver) return;
  xrgUnlockAudio();
  document.getElementById('xrg-overlay')?.classList.add('hidden');
  xrgPaused = false;
  xrgRunning = true;
  xrgLastFrame = 0;
  xrgSetHudVisible(true);
  xrgDraw();
  cancelAnimationFrame(xrgRaf);
  xrgRaf = requestAnimationFrame(xrgTick);
}

function xrgPauseIfHidden(){
  xrgPause(true);
}

function xrgEnterScreen(){
  xrgInit();
  xrgInitEconomyFirebase();
  xrgUpdateStats();
  xrgRenderShop();
  xrgDraw();
}

function xrgInit(){
  if(xrgCanvas) return;
  xrgCanvas = document.getElementById('xrg-canvas');
  if(!xrgCanvas) return;
  xrgCtx = xrgCanvas.getContext('2d');
  xrgEnsureLanes(16);
  xrgUpdateStats();
  xrgRenderShop();
  xrgDraw();
  xrgSetHudVisible(xrgRunning || xrgPaused || xrgGameOver);
  xrgBindNoZoomGuards();
  const preventCanvasGesture = event=>{
    if(typeof event.preventDefault==='function') event.preventDefault();
  };
  xrgCanvas.addEventListener('pointerdown',event=>{
    preventCanvasGesture(event);
    xrgUnlockAudio();
    xrgPointerStart = {x:event.clientX,y:event.clientY};
    try{ xrgCanvas.setPointerCapture?.(event.pointerId); }catch(_err){}
  });
  xrgCanvas.addEventListener('pointerup',event=>{
    preventCanvasGesture(event);
    xrgUnlockAudio();
    if(!xrgPointerStart) return;
    const dx = event.clientX-xrgPointerStart.x;
    const dy = event.clientY-xrgPointerStart.y;
    xrgPointerStart = null;
    if(Math.max(Math.abs(dx),Math.abs(dy)) < 24){
      xrgMove('up');
      return;
    }
    if(Math.abs(dx)>Math.abs(dy)) xrgMove(dx>0?'right':'left');
    else xrgMove(dy>0?'down':'up');
  });
  xrgCanvas.addEventListener('pointercancel',()=>{xrgPointerStart=null;});
  xrgCanvas.addEventListener('dblclick',event=>event.preventDefault());
  const gamePage = document.getElementById('gs-7');
  const unlockFromGesture = () => xrgUnlockAudio();
  gamePage?.addEventListener('touchstart',unlockFromGesture,{passive:true});
  gamePage?.addEventListener('pointerdown',unlockFromGesture,{passive:true});
  gamePage?.addEventListener('mousedown',unlockFromGesture);
  gamePage?.addEventListener('click',unlockFromGesture);
  gamePage?.addEventListener('dblclick',event=>event.preventDefault());
}

document.addEventListener('keydown',event=>{
  if(!document.getElementById('gs-7')?.classList.contains('active')) return;
  const map = {ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
  if(event.key === 'Escape'){
    event.preventDefault();
    if(xrgPaused) xrgResume();
    else xrgPause();
    return;
  }
  const direction = map[event.key];
  if(!direction) return;
  event.preventDefault();
  xrgUnlockAudio();
  xrgMove(direction);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden) xrgPauseIfHidden();});
window.addEventListener('firebaseReady',xrgInitEconomyFirebase);
if(window._fb) xrgInitEconomyFirebase();
