(()=>{
'use strict';

const root=document.documentElement;
const headerInner=document.querySelector('.site-header__inner');
const logo=document.querySelector('.site-logo');
if(!headerInner||!logo)return;

const sync=()=>{
  const innerRect=headerInner.getBoundingClientRect();
  const logoRect=logo.getBoundingClientRect();
  const styles=getComputedStyle(headerInner);
  const paddingRight=parseFloat(styles.paddingRight)||0;
  const left=Math.max(14,logoRect.left);
  const right=Math.max(14,window.innerWidth-innerRect.right+paddingRight);
  root.style.setProperty('--home-header-left',`${left}px`);
  root.style.setProperty('--home-header-right',`${right}px`);
};

let frame=0;
const schedule=()=>{
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(sync);
};

sync();
window.addEventListener('resize',schedule,{passive:true});
window.addEventListener('load',schedule,{once:true});
document.fonts?.ready?.then(schedule).catch(()=>{});
new ResizeObserver(schedule).observe(headerInner);
})();
