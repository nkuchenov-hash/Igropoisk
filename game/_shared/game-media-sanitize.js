(()=>{
'use strict';
const blocked=[/landing-pages\.gog-statics\.com\/assets\/images\/hero-image\.png/i,/storepagebackground\/app\//i];
const bad=url=>blocked.some(rx=>rx.test(String(url||'')));
const removeCard=node=>{const card=node.closest('.media-card,.ig-media-card,.ig-card,.card,figure,article,button');if(card)card.remove();else node.remove()};
const refresh=()=>{const grid=document.querySelector('#mediaArt'),count=document.querySelector('#artCount');if(grid&&count)count.textContent=String(grid.children.length)};
let cleaning=false;const clean=()=>{if(cleaning)return;cleaning=true;try{document.querySelectorAll('img').forEach(img=>{const src=img.currentSrc||img.src||'';if(bad(src))removeCard(img)});document.querySelectorAll('[style*="background-image"]').forEach(node=>{const bg=getComputedStyle(node).backgroundImage||'';if(bad(bg))node.style.backgroundImage='none'});refresh()}finally{cleaning=false}};
clean();const observer=new MutationObserver(()=>queueMicrotask(clean));observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','style']});
})();
