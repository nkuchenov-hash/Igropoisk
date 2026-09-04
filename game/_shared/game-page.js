(()=>{
'use strict';
const moduleVersion='20260904-6';
window.__IG_GAME_PAGE_MODULE_VERSION__=moduleVersion;
window.__IG_GAME_PAGE_ENHANCEMENTS__={loaded:[],failed:[]};
const addStyle=(href)=>{
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.href=href;
  document.head.appendChild(style);
};
const loadScript=(src)=>new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=src;
  script.async=false;
  script.onload=()=>resolve(script);
  script.onerror=()=>reject(new Error(`Не удалось загрузить ${src}`));
  document.head.appendChild(script);
});
const waitForBasePage=(timeoutMs=9000)=>new Promise((resolve,reject)=>{
  const started=Date.now();
  const check=()=>{
    const title=document.querySelector('#gameTitle')?.textContent?.trim();
    if(title)return resolve(title);
    if(Date.now()-started>=timeoutMs)return reject(new Error('Общий модуль страницы игры не завершил базовый рендер вовремя.'));
    setTimeout(check,50);
  };
  check();
});
const failVisible=error=>{
  console.error('Игропоиск: общий модуль страницы игры',error);
  if(document.querySelector('#gameTitle')?.textContent?.trim())return;
  document.body.innerHTML='<main class="ig-container game-runtime-failure"><h1>Не удалось открыть страницу игры</h1><p>Общий модуль страницы не завершил загрузку. Обновите страницу.</p></main>';
};
(async()=>{
  addStyle(`../_shared/game-page-quality.css?v=${moduleVersion}`);
  await loadScript(`../_shared/game-runtime-network-guard.js?v=${moduleVersion}`);
  await loadScript(`../_shared/game-page-v3-bootstrap.js?v=${moduleVersion}`);
  await waitForBasePage();

  const enhancements=[
    '../_shared/game-media-sanitize.js?v=20260902-3',
    '../_shared/game-page-quality.js?v=20260902-3',
    '../_shared/game-page-similarity.js?v=20260812-2',
    `../_shared/game-page-review-publication-control.js?v=${moduleVersion}`,
    `../_shared/game-page-review-sources.js?v=${moduleVersion}`,
    '../_shared/game-page-source-corpus.js?v=20260902-3',
    '../_shared/game-page-materialized-data.js?v=20260902-3',
    `../_shared/game-page-integrity.js?v=${moduleVersion}`,
    '../_shared/game-editions.js?v=20260807-1',
    '../_shared/game-media-categories.js?v=20260808-1',
    '../_shared/game-media-recovery.js?v=20260810-1',
  ];
  for(const src of enhancements){
    try{
      await loadScript(src);
      window.__IG_GAME_PAGE_ENHANCEMENTS__.loaded.push(src);
    }catch(error){
      window.__IG_GAME_PAGE_ENHANCEMENTS__.failed.push(src);
      console.warn('Игропоиск: дополнительный подмодуль пропущен',src,error);
    }
  }
  window.dispatchEvent(new CustomEvent('igropoisk:game-page-module-ready',{detail:{version:moduleVersion,failed:[...window.__IG_GAME_PAGE_ENHANCEMENTS__.failed]}}));
})().catch(failVisible);
})();
