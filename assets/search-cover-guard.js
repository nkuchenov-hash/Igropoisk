(()=>{
'use strict';

if(window.IgropoiskSearchCoverGuard)return;
window.IgropoiskSearchCoverGuard=true;

const POSTER_RATIO_MAX=.82;
const posterUrlForSteam=id=>`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const steamAppId=url=>String(url||'').match(/\/steam\/apps\/(\d+)\//i)?.[1]||String(url||'').match(/\/apps\/(\d+)\//i)?.[1]||'';

function placeholderFor(img){
  if(!img?.isConnected)return;
  const host=img.closest('.result-media');
  if(!host)return;
  const fallback=document.createElement('div');
  fallback.className='result-placeholder';
  fallback.textContent=img.dataset.fallback||'ИП';
  img.replaceWith(fallback);
}

function validatePortrait(img){
  if(!img?.isConnected||!img.naturalWidth||!img.naturalHeight)return;
  if(img.naturalWidth/img.naturalHeight>POSTER_RATIO_MAX)placeholderFor(img);
}

function enforce(img){
  if(!(img instanceof HTMLImageElement)||!img.closest('#search .result-media'))return;
  const current=img.currentSrc||img.src||'';
  const appid=steamAppId(current);
  if(appid){
    const poster=posterUrlForSteam(appid);
    if(current!==poster&&img.dataset.posterGuard!=='steam'){
      img.dataset.posterGuard='steam';
      img.src=poster;
    }
  }
  img.addEventListener('load',()=>validatePortrait(img),{once:true});
  img.addEventListener('error',()=>placeholderFor(img),{once:true});
  if(img.complete)validatePortrait(img);
}

function scan(root=document){
  if(root instanceof HTMLImageElement)enforce(root);
  root.querySelectorAll?.('#search .result-media img').forEach(enforce);
}

const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
  if(node.nodeType===1)scan(node);
})));
observer.observe(document.documentElement,{childList:true,subtree:true});
scan();
})();
