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
  if(grid&&count)count.textContent=String(grid.querySelectorAll('.media-card,.ig-media-card,.ig-card,.card,figure,article').length||grid.children.length);
};
const clean=()=>{
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
};
clean();
const observer=new MutationObserver(clean);
observer.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(()=>observer.disconnect(),30000);
})();
