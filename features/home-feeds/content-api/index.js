'use strict';
(()=>{
  const scriptUrl=document.currentScript?.src||document.baseURI;
  const siteBase=new URL('../../../',scriptUrl);
  const storageOrigin='https://storage.yandexcloud.net';
  const bucketPath='/igropoisk-content/';
  const manifestUrl=new URL(`${storageOrigin}${bucketPath}home-feeds/manifests/current.json`);
  const runtimeFiles=new Set(['data/popular/current.json','data/releases/current.json']);
  let backendPromise=null;

  async function fetchJson(url,label){
    const target=new URL(url);target.searchParams.set('v',String(Date.now()));
    const response=await fetch(target,{cache:'no-store'});
    if(!response.ok)throw new Error(`${label}: ${response.status}`);
    return response.json();
  }
  function validateStorageUrl(value,version){
    const url=new URL(value);
    const prefix=`${bucketPath}home-feeds/snapshots/${version}/`;
    if(url.origin!==storageOrigin||!url.pathname.startsWith(prefix))throw new Error('Untrusted home-feed snapshot URL.');
    return url.href;
  }
  async function storageBackend(){
    if(backendPromise)return backendPromise;
    backendPromise=(async()=>{
      const manifest=await fetchJson(manifestUrl,'home-feed manifest');
      if(manifest?.schemaVersion!==1||manifest?.channel!=='home-feeds'||!/^[\w.-]+$/.test(manifest?.version||''))throw new Error('Invalid home-feed manifest.');
      const files={};
      for(const file of runtimeFiles){
        const candidate=manifest.files?.[file]?.url;
        if(!candidate)throw new Error(`Home-feed manifest is missing ${file}.`);
        files[file]=validateStorageUrl(candidate,manifest.version);
      }
      return {id:'object-storage',version:manifest.version,files};
    })();
    try{return await backendPromise}catch(error){backendPromise=null;throw error}
  }
  async function load(path){
    if(!runtimeFiles.has(path))throw new Error(`Unsupported home-feed path: ${path}`);
    try{
      const backend=await storageBackend();
      return await fetchJson(backend.files[path],path);
    }catch(storageError){
      console.warn('Игропоиск: Object Storage home feed unavailable, using repository fallback',storageError);
      return fetchJson(new URL(path,siteBase),`${path} fallback`);
    }
  }
  window.IgropoiskHomeFeeds=Object.freeze({load,manifestUrl:manifestUrl.href});
})();
