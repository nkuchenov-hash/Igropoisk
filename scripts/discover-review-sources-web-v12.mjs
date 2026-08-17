#!/usr/bin/env node

const networkFetch=globalThis.fetch;
if(typeof networkFetch!=='function')throw new Error('Global fetch is required for review discovery.');
const slug=String(process.argv[2]||'').trim();

export function sixthAxisTagSlug(value){
  return String(value||'')
    .toLowerCase()
    .replace(/-and-/g,'-')
    .replace(/(^|-)(ii)(?=-|$)/g,'$1'+'2')
    .replace(/(^|-)(iii)(?=-|$)/g,'$1'+'3')
    .replace(/(^|-)(iv)(?=-|$)/g,'$1'+'4');
}

export function validatePublisherTagFallback(){
  if(sixthAxisTagSlug('mount-and-blade-ii-bannerlord')!=='mount-blade-2-bannerlord')throw new Error('TheSixthAxis tag slug normalization failed.');
  return true;
}
validatePublisherTagFallback();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let url;
  try{url=new URL(original)}catch{return networkFetch(input,init)}
  const host=url.hostname.replace(/^www\./,'').toLowerCase();
  if(host!=='thesixthaxis.com'||url.pathname!=='/'||!url.searchParams.has('s')||!slug)return networkFetch(input,init);

  const tagUrl=`https://www.thesixthaxis.com/tag/${sixthAxisTagSlug(slug)}/`;
  const bounded=()=>({...init,redirect:'follow',signal:AbortSignal.timeout(7000),headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/12.1)','accept-language':'en,ru;q=.8'}});
  const [search,tag]=await Promise.allSettled([
    networkFetch(input,bounded()),
    networkFetch(tagUrl,bounded())
  ]);
  const parts=[];
  for(const result of [tag,search]){
    if(result.status!=='fulfilled'||!result.value?.ok)continue;
    parts.push(await result.value.text());
  }
  if(!parts.length)return search.status==='fulfilled'?search.value:new Response('',{status:503});
  return new Response(parts.join('\n'),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
};

try{
  await import('./discover-review-sources-web-v11.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
