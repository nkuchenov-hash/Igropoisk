(()=>{
'use strict';
const blocked=[
  /landing-pages\.gog-statics\.com\/assets\/images\/hero-image\.png/i
];
const bad=url=>blocked.some(rx=>rx.test(String(url||'')));
const clean=()=>{
  document.querySelectorAll('img').forEach(img=>{
    const src=img.currentSrc||img.src||'';
    if(!bad(src))return;
    const card=img.closest('.media-card,.ig-media-card,.ig-card,.card,figure,article,button');
    if(card)card.remove();else img.remove();
  });
  document.querySelectorAll('[style*="background-image"]').forEach(node=>{
    const bg=getComputedStyle(node).backgroundImage||'';
    if(bad(bg))node.remove();
  });
};
clean();
const observer=new MutationObserver(clean);
observer.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(()=>observer.disconnect(),20000);
})();
