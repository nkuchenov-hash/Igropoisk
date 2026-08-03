(()=>{
  'use strict';

  const selector=[
    '.ig-container',
    '.ig-page-container',
    '.ig-content-frame',
    '.site-header__inner',
    '.hero-content',
    '.wtp-layout',
    '.wtp-results-section',
    '.news-page',
    '.news-page-wrap',
    '.page#news > .wrap',
    '.game-header__inner',
    '.game-hero__inner',
    '.article-header__inner',
    '.article-hero__inner',
    '.article-shell',
    '.article-layout'
  ].join(',');

  const declarations={
    width:'min(100%, var(--ig-contract-max))',
    'max-width':'var(--ig-contract-max)',
    'margin-left':'auto',
    'margin-right':'auto',
    'padding-left':'var(--ig-contract-gutter)',
    'padding-right':'var(--ig-contract-gutter)',
    'box-sizing':'border-box'
  };

  function setImportant(node,property,value){
    if(node.style.getPropertyValue(property)!==value||node.style.getPropertyPriority(property)!=='important'){
      node.style.setProperty(property,value,'important');
    }
  }

  function enforceRoot(){
    const root=document.documentElement;
    setImportant(root,'--ig-container','var(--ig-contract-max)');
    setImportant(root,'--ig-gutter','var(--ig-contract-gutter)');
  }

  function enforceElement(node){
    if(!(node instanceof HTMLElement)||node.hasAttribute('data-ig-width-exception'))return;
    Object.entries(declarations).forEach(([property,value])=>setImportant(node,property,value));
  }

  function enforceTree(root=document){
    enforceRoot();
    if(root instanceof HTMLElement&&root.matches(selector))enforceElement(root);
    root.querySelectorAll?.(selector).forEach(enforceElement);
  }

  let queued=false;
  function schedule(root=document){
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      enforceTree(root);
    });
  }

  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      if(mutation.type==='childList'){
        mutation.addedNodes.forEach(node=>{
          if(node instanceof HTMLElement)schedule(node);
        });
      }else if(mutation.target instanceof HTMLElement){
        schedule(mutation.target);
      }
    }
  });

  observer.observe(document.documentElement,{
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['class','style','data-ig-width-exception']
  });

  window.addEventListener('resize',()=>schedule(),{passive:true});
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>schedule(),{once:true});
  }else{
    schedule();
  }
})();
