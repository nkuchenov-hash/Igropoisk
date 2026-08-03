(()=>{
'use strict';

const target=document.querySelector('#homeNews');
if(!target)return;

let initialized=false;

function ensureControls(){
  const heading=target.closest('.section')?.querySelector('.section-head');
  if(!heading)return;
  let meta=heading.querySelector('.section-head__meta');
  if(!meta){
    meta=document.createElement('div');
    meta.className='section-head__meta';
    heading.appendChild(meta);
  }
  let controls=meta.querySelector('[data-controls-for="homeNews"]');
  if(!controls){
    controls=document.createElement('div');
    controls.className='rail-controls';
    controls.dataset.controlsFor='homeNews';
    controls.innerHTML='<button class="rail-button" type="button" data-direction="prev" aria-label="Прокрутить новости влево">←</button><button class="rail-button" type="button" data-direction="next" aria-label="Прокрутить новости вправо">→</button>';
    meta.appendChild(controls);
  }
  if(initialized)return;
  initialized=true;
  controls.addEventListener('click',event=>{
    const button=event.target.closest('[data-direction]');
    if(!button)return;
    const card=target.querySelector('.news-card');
    const gap=parseFloat(getComputedStyle(target).gap)||16;
    const step=(card?.getBoundingClientRect().width||360)+gap;
    target.scrollBy({left:button.dataset.direction==='prev'?-step:step,behavior:'smooth'});
  });
}

new MutationObserver(()=>ensureControls()).observe(target,{childList:true});
ensureControls();
})();
