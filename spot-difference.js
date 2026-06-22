// ── 大家來找碴 ──
const SD_LEVELS={
  easy:{count:3,size:42,hit:48,opacity:.88},
  medium:{count:5,size:32,hit:38,opacity:.72},
  hard:{count:7,size:24,hit:30,opacity:.56}
};
let sdDifficulty='easy';
let sdPhoto=null;
let sdImage=null;
let sdBaseCanvas=null;
let sdDifferences=[];
let sdFound=new Set();
let sdHintIndex=-1;
let sdStartedAt=0;
let sdElapsed=0;
let sdTimer=0;
let sdInitialized=false;
let sdRetryCount=0;

function sdClamp(value,min,max){return Math.max(min,Math.min(max,value));}
function sdCanvas(id){return document.getElementById(id);}
function sdMessage(text,success=false){
  const el=document.getElementById('sd-message');
  if(!el) return;
  el.textContent=text;
  el.classList.toggle('success',!!success);
}
function sdFormatTime(seconds){
  const safe=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(safe/60)).padStart(2,'0')}:${String(safe%60).padStart(2,'0')}`;
}
function sdUpdateTimer(){
  const seconds=sdElapsed+(sdStartedAt?(Date.now()-sdStartedAt)/1000:0);
  const el=document.getElementById('sd-time');
  if(el) el.textContent=sdFormatTime(seconds);
}
function sdStartTimer(){
  clearInterval(sdTimer);
  if(sdFound.size>=sdDifferences.length || !sdDifferences.length) return;
  sdStartedAt=Date.now();
  sdTimer=setInterval(sdUpdateTimer,500);
  sdUpdateTimer();
}
function sdPauseTimer(){
  if(sdStartedAt) sdElapsed+=(Date.now()-sdStartedAt)/1000;
  sdStartedAt=0;
  clearInterval(sdTimer);
  sdTimer=0;
  sdUpdateTimer();
}
function sdUpdateProgress(){
  const total=SD_LEVELS[sdDifficulty].count;
  const el=document.getElementById('sd-progress');
  if(el) el.textContent=`找到 ${sdFound.size} / ${total}`;
}
function sdSetDifficulty(level,button){
  if(!SD_LEVELS[level]) return;
  sdDifficulty=level;
  document.querySelectorAll('.sd-level').forEach(item=>item.classList.toggle('active',item===button||item.dataset.level===level));
  sdStartRound(false);
}
function sdCollectPhotos(){
  return typeof pzCollectPhotos==='function' ? pzCollectPhotos().filter(photo=>photo?.src) : [];
}
function sdChoosePhoto(forceNew){
  const photos=sdCollectPhotos();
  if(!photos.length) return null;
  const pool=forceNew&&sdPhoto&&photos.length>1 ? photos.filter(photo=>photo.src!==sdPhoto.src) : photos;
  return pool[Math.floor(Math.random()*pool.length)] || photos[0];
}
function sdFitRect(image,width,height){
  const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight);
  const drawWidth=image.naturalWidth*scale;
  const drawHeight=image.naturalHeight*scale;
  return {x:(width-drawWidth)/2,y:(height-drawHeight)/2,w:drawWidth,h:drawHeight};
}
function sdConfigureCanvases(image){
  const width=480;
  const ratio=image.naturalHeight/image.naturalWidth;
  const height=Math.round(width*sdClamp(ratio,.68,1.48));
  ['sd-original','sd-edited'].forEach(id=>{
    const canvas=sdCanvas(id);
    if(canvas){canvas.width=width;canvas.height=height;}
  });
  sdBaseCanvas=document.createElement('canvas');
  sdBaseCanvas.width=width;
  sdBaseCanvas.height=height;
  const ctx=sdBaseCanvas.getContext('2d');
  const rect=sdFitRect(image,width,height);
  ctx.fillStyle='#171317';
  ctx.fillRect(0,0,width,height);
  ctx.drawImage(image,rect.x,rect.y,rect.w,rect.h);
  return rect;
}
function sdMakeDifferences(rect){
  const config=SD_LEVELS[sdDifficulty];
  const differences=[];
  let attempts=0;
  while(differences.length<config.count&&attempts<300){
    attempts++;
    const radius=config.size*(.72+Math.random()*.28);
    const x=rect.x+radius+Math.random()*Math.max(1,rect.w-radius*2);
    const y=rect.y+radius+Math.random()*Math.max(1,rect.h-radius*2);
    if(differences.some(item=>Math.hypot(item.x-x,item.y-y)<item.radius+radius+12)) continue;
    differences.push({x,y,radius,hitRadius:Math.max(config.hit,radius*1.15),mode:differences.length%3,seed:Math.random()});
  }
  return differences;
}
function sdApplyDifference(ctx,difference,index){
  const {x,y,radius,mode,seed}=difference;
  ctx.save();
  if(mode===0){
    const size=radius*1.65;
    const sourceX=sdClamp(x+(seed>.5?size:-size)-size/2,0,sdBaseCanvas.width-size);
    const sourceY=sdClamp(y+(seed>.35?-size:size)-size/2,0,sdBaseCanvas.height-size);
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.clip();
    ctx.drawImage(sdBaseCanvas,sourceX,sourceY,size,size,x-radius,y-radius,radius*2,radius*2);
  }else if(mode===1){
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.clip();
    ctx.filter=`hue-rotate(${index%2?18:-18}deg) saturate(${sdDifficulty==='hard'?1.12:1.28}) brightness(${seed>.5?1.1:.9})`;
    ctx.drawImage(sdBaseCanvas,0,0);
  }else{
    const size=radius*1.8;
    const shift=Math.max(5,radius*(sdDifficulty==='hard'?.24:.38));
    ctx.beginPath();
    ctx.ellipse(x,y,radius,radius*.78,0,0,Math.PI*2);
    ctx.clip();
    ctx.globalAlpha=.96;
    ctx.drawImage(sdBaseCanvas,x-size/2+shift,y-size/2,size,size,x-size/2,y-size/2,size,size);
  }
  ctx.restore();
}
function sdDrawFoundMarker(ctx,difference,color='#55c96f'){
  ctx.save();
  ctx.strokeStyle=color;
  ctx.lineWidth=Math.max(4,difference.radius*.14);
  ctx.shadowColor='rgba(255,255,255,.95)';
  ctx.shadowBlur=5;
  ctx.beginPath();
  ctx.arc(difference.x,difference.y,difference.radius*1.08,0,Math.PI*2);
  ctx.stroke();
  ctx.restore();
}
function sdRender(){
  const original=sdCanvas('sd-original');
  const edited=sdCanvas('sd-edited');
  if(!original||!edited||!sdBaseCanvas) return;
  const originalCtx=original.getContext('2d');
  const editedCtx=edited.getContext('2d');
  originalCtx.clearRect(0,0,original.width,original.height);
  editedCtx.clearRect(0,0,edited.width,edited.height);
  originalCtx.drawImage(sdBaseCanvas,0,0);
  editedCtx.drawImage(sdBaseCanvas,0,0);
  sdDifferences.forEach((difference,index)=>sdApplyDifference(editedCtx,difference,index));
  sdDifferences.forEach((difference,index)=>{
    if(sdFound.has(index)){
      sdDrawFoundMarker(originalCtx,difference);
      sdDrawFoundMarker(editedCtx,difference);
    }else if(sdHintIndex===index){
      sdDrawFoundMarker(originalCtx,difference,'#ffb526');
      sdDrawFoundMarker(editedCtx,difference,'#ffb526');
    }
  });
}
function sdStartRound(forceNew=false){
  sdInit();
  sdPauseTimer();
  sdElapsed=0;
  sdStartedAt=0;
  sdFound=new Set();
  sdHintIndex=-1;
  sdUpdateProgress();
  sdUpdateTimer();
  const photo=sdChoosePhoto(forceNew||!sdPhoto);
  if(!photo){
    sdMessage('相簿還沒有可用照片，先到相簿新增照片吧。');
    if(sdRetryCount<5){sdRetryCount++;setTimeout(()=>{if(document.getElementById('gs-8')?.classList.contains('active'))sdStartRound(true);},900);}
    return;
  }
  sdRetryCount=0;
  sdPhoto=photo;
  sdMessage('正在製作找碴照片...');
  const image=new Image();
  image.onload=()=>{
    sdImage=image;
    const rect=sdConfigureCanvases(image);
    sdDifferences=sdMakeDifferences(rect);
    sdFound=new Set();
    sdRender();
    sdUpdateProgress();
    sdMessage(`這張照片藏了 ${sdDifferences.length} 個不同，兩張都可以點。`);
    sdStartTimer();
  };
  image.onerror=()=>sdMessage('這張照片暫時讀不到，請換一張再試。');
  image.src=photo.src;
}
function sdCanvasPoint(event,canvas){
  const rect=canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};
}
function sdHandleTap(event){
  if(!sdDifferences.length||sdFound.size>=sdDifferences.length) return;
  event.preventDefault();
  const canvas=event.currentTarget;
  const point=sdCanvasPoint(event,canvas);
  const index=sdDifferences.findIndex((difference,i)=>!sdFound.has(i)&&Math.hypot(point.x-difference.x,point.y-difference.y)<=difference.hitRadius);
  if(index<0){
    canvas.classList.remove('sd-miss');
    void canvas.offsetWidth;
    canvas.classList.add('sd-miss');
    sdMessage('這裡一樣，再仔細看看 👀');
    if(navigator.vibrate) try{navigator.vibrate(22);}catch(_err){}
    return;
  }
  sdFound.add(index);
  sdHintIndex=-1;
  sdRender();
  sdUpdateProgress();
  if(navigator.vibrate) try{navigator.vibrate([12,35,12]);}catch(_err){}
  if(sdFound.size>=sdDifferences.length){
    sdPauseTimer();
    sdMessage(`全部找到了！完成時間 ${document.getElementById('sd-time')?.textContent||'00:00'} 🎉`,true);
    if(typeof launchConfetti==='function') launchConfetti();
  }else{
    sdMessage(`找到了！還剩 ${sdDifferences.length-sdFound.size} 個。`);
  }
}
function sdShowHint(){
  const index=sdDifferences.findIndex((_,i)=>!sdFound.has(i));
  if(index<0) return;
  sdHintIndex=index;
  sdRender();
  sdMessage('橘色圈圈附近有一個不同。');
  setTimeout(()=>{if(sdHintIndex===index){sdHintIndex=-1;sdRender();}},1200);
}
function sdInit(){
  if(sdInitialized) return;
  sdInitialized=true;
  ['sd-original','sd-edited'].forEach(id=>sdCanvas(id)?.addEventListener('pointerdown',sdHandleTap));
}
function sdEnterScreen(){
  sdInit();
  if(!sdImage) sdStartRound(true);
  else if(sdFound.size<sdDifferences.length) sdStartTimer();
  sdRender();
}
function sdPauseIfHidden(){sdPauseTimer();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)sdPauseIfHidden();});
window.addEventListener('firebaseReady',()=>{
  if(document.getElementById('gs-8')?.classList.contains('active')&&!sdImage) setTimeout(()=>sdStartRound(true),250);
});
window.addEventListener('albumDataReady',()=>{
  if(document.getElementById('gs-8')?.classList.contains('active')&&!sdImage) sdStartRound(true);
});
