(()=>{
'use strict';
if(window.__IG_GAME_RUNTIME_NETWORK_GUARD__)return;
window.__IG_GAME_RUNTIME_NETWORK_GUARD__=true;
const nativeFetch=window.fetch.bind(window);
const timeoutMs=7000;
const isGuardedUrl=input=>{
  try{
    const raw=typeof input==='string'||input instanceof URL?String(input):String(input?.url||'');
    const url=new URL(raw,location.href);
    return url.origin===location.origin&&(
      url.pathname.includes('/game/_shared/')||
      url.pathname.includes('/data/')||
      url.pathname.endsWith('/config/runtime.json')
    );
  }catch{return false}
};
window.fetch=(input,init={})=>{
  if(init?.signal||!isGuardedUrl(input))return nativeFetch(input,init);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new DOMException('Game runtime request timed out','TimeoutError')),timeoutMs);
  return nativeFetch(input,{...init,signal:controller.signal}).finally(()=>clearTimeout(timer));
};
window.__IG_GAME_RUNTIME_FETCH_TIMEOUT_MS__=timeoutMs;
})();
