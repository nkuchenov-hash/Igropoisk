(()=>{
'use strict';
function ensureReleaseNav(){
  const nav=document.querySelector('.ig-site-header__nav');
  if(!nav)return false;
  let link=nav.querySelector('[data-ig-release-nav]');
  if(!link){
    link=document.createElement('a');
    link.href='/Igropoisk/calendar/';
    link.textContent='Календарь релизов';
    link.dataset.igReleaseNav='true';
    const news=nav.querySelector('[data-page="news"]');
    nav.insertBefore(link,news||null);
  }
  nav.querySelectorAll('a').forEach(item=>{
    const active=item===link;
    item.classList.toggle('is-active',active);
    if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
  });
  return true;
}
const observer=new MutationObserver(()=>{if(ensureReleaseNav())observer.disconnect()});
observer.observe(document.documentElement,{subtree:true,childList:true});
ensureReleaseNav();
})();
