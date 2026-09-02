(()=>{
'use strict';
const blocked=[
  /landing-pages\.gog-statics\.com\/assets\/images\/hero-image\.png/i
];
const artOnlyBlocked=[
  /storepagebackground\/app\//i
];
const bad=url=>blocked.some(rx=>rx.test(String(url||'')));
const badInArt=(url,node)=>{
  const inArt=Boolean(node?.closest?.('#mediaArt,#artGroup,.ig-media-art,.media-art'));
  return inArt&&artOnlyBlocked.some(rx=>rx.test(String(url||'')));
};
const removeCard=node=>{
  const card=node.closest('.media-card,.ig-media-card,.ig-card,.card,figure,article,button');
  if(card)card.remove();else node.remove();
};
const refreshArtCount=()=>{
  const grid=document.querySelector('#mediaArt');
  const count=document.querySelector('#artCount');
  if(!grid||!count)return;
  const next=String(grid.querySelectorAll('.media-card,.ig-media-card,.ig-card,.card,figure,article').length||grid.children.length);
  if(count.textContent!==next)count.textContent=next;
};
let cleaning=false;
const clean=()=>{
  if(cleaning)return;
  cleaning=true;
  try{
    document.querySelectorAll('img').forEach(img=>{
      const src=img.currentSrc||img.src||'';
      if(!bad(src)&&!badInArt(src,img))return;
      removeCard(img);
    });
    document.querySelectorAll('[style*="background-image"]').forEach(node=>{
      const bg=getComputedStyle(node).backgroundImage||'';
      if(bad(bg)||badInArt(bg,node))removeCard(node);
    });
    refreshArtCount();
  }finally{
    cleaning=false;
  }
};
clean();
const observer=new MutationObserver(()=>queueMicrotask(clean));
observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','style']});
document.addEventListener('click',event=>{
  if(event.target?.closest?.('[data-tab="media"],a[href="#media"],button[aria-controls="media"]'))setTimeout(clean,0);
},true);
})();
