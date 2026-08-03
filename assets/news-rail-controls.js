(()=>{
'use strict';

const target=document.querySelector('#homeNews');
if(!target)return;

let timer=0;
const init=()=>{
  clearTimeout(timer);
  timer=setTimeout(()=>{
    const cards=target.querySelectorAll('.news-card');
    if(cards.length>1&&typeof window.IgropoiskInfiniteRail==='function'){
      window.IgropoiskInfiniteRail(target);
    }
  },0);
};

new MutationObserver(init).observe(target,{childList:true});
init();
})();
