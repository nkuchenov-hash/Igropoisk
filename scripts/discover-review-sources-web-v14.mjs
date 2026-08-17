#!/usr/bin/env node

const networkFetch=globalThis.fetch;
if(typeof networkFetch!=='function')throw new Error('Global fetch is required for review discovery.');
const broadCache=new Map();

export function broadReviewQuery(query){
  return String(query||'')
    .replace(/(?:^|\s)site:(?:www\.)?[a-z0-9.-]+(?=\s|$)/ig,' ')
    .replace(/\b(?:verdict|score)\b/ig,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function validateBroadReviewQuery(){
  const q=broadReviewQuery('site:gamespot.com "Total War: Warhammer III" review verdict 2022');
  if(q!=='"Total War: Warhammer III" review 2022')throw new Error(`Broad review query normalization failed: ${q}`);
  return true;
}
validateBroadReviewQuery();

async function bounded(url,init,timeout=6500){
  try{return await networkFetch(url,{...init,redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/14.0)','accept-language':'en,ru;q=.8'}})}catch{return null}
}
async function broadDuckDuckGo(query,init){
  const broad=broadReviewQuery(query);
  if(!broad)return'';
  if(!broadCache.has(broad))broadCache.set(broad,(async()=>{
    const url=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(broad)}`;
    const response=await bounded(url,init);
    return response?.ok?await response.text():'';
  })());
  return broadCache.get(broad);
}

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let url;
  try{url=new URL(original)}catch{return networkFetch(input,init)}
  const host=url.hostname.replace(/^www\./,'').toLowerCase();
  if(host!=='html.duckduckgo.com'||url.pathname!=='/html/'||!url.searchParams.has('q'))return networkFetch(input,init);
  const query=url.searchParams.get('q')||'';
  const [siteSpecific,broad]=await Promise.allSettled([bounded(original,init),broadDuckDuckGo(query,init)]);
  const parts=[];
  if(siteSpecific.status==='fulfilled'&&siteSpecific.value?.ok)parts.push(await siteSpecific.value.text());
  if(broad.status==='fulfilled'&&broad.value)parts.push(broad.value);
  if(parts.length)return new Response(parts.join('\n'),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  return siteSpecific.status==='fulfilled'&&siteSpecific.value?siteSpecific.value:new Response('',{status:503});
};

try{
  await import('./discover-review-sources-web-v13.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
