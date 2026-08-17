#!/usr/bin/env node

const networkFetch=globalThis.fetch;
if(typeof networkFetch!=='function')throw new Error('Global fetch is required for review discovery.');
const slug=String(process.argv[2]||'').trim();
const cache=new Map();

const decode=value=>String(value||'')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>');
const escapeAttr=value=>String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
const escapeText=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const plain=value=>decode(String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const reviewSignal=value=>/(?:\breview\b|\breviews\b|recenz|opinion|verdict|обзор|рецензи)/i.test(String(value||''));
const tokens=String(slug||'').toLowerCase().split(/[-_]+/).filter(token=>token.length>2&&!['and','the','for','with','edition','game'].includes(token));
const identitySignal=value=>{const hay=String(value||'').toLowerCase();if(!tokens.length)return true;return tokens.filter(token=>hay.includes(token)).length>=Math.min(2,tokens.length)};

export function publisherDomainFromQuery(query){
  const match=String(query||'').match(/(?:^|\s)site:(?:www\.)?([a-z0-9.-]+)(?:\s|$)/i);
  return String(match?.[1]||'').replace(/^www\./,'').toLowerCase();
}
export function genericPublisherLinks(html,baseUrl){
  const out=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url;
    try{url=new URL(decode(match[1]),baseUrl)}catch{continue}
    if(!/^https?:$/i.test(url.protocol))continue;
    const title=plain(match[2]),signals=`${url.pathname} ${title}`;
    if(!reviewSignal(signals)||!identitySignal(signals))continue;
    if(out.some(item=>item.url===url.href))continue;
    out.push({url:url.href,title:title||url.href});
    if(out.length>=20)break;
  }
  return out.map(item=>`<a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a>`).join('\n');
}

async function genericPublisherSearch(query,init){
  const domain=publisherDomainFromQuery(query);
  if(!domain||!slug)return'';
  const terms=slug.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
  const searchUrl=`https://${domain}/?s=${encodeURIComponent(terms)}`;
  if(!cache.has(searchUrl))cache.set(searchUrl,(async()=>{
    try{
      const response=await networkFetch(searchUrl,{...init,redirect:'follow',signal:AbortSignal.timeout(7000),headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/13.0)','accept-language':'en,ru;q=.8'}});
      if(!response.ok)return'';
      return genericPublisherLinks(await response.text(),response.url||searchUrl);
    }catch{return''}
  })());
  return cache.get(searchUrl);
}

export function validateGenericPublisherSearch(){
  if(publisherDomainFromQuery('site:pcgamer.com "Total War: Warhammer III" review')!=='pcgamer.com')throw new Error('Generic publisher domain extraction failed.');
  const fixture='<a href="/total-war-warhammer-3-review/">Total War: Warhammer 3 review</a><a href="/total-war-warhammer-3-guide/">Total War: Warhammer 3 guide</a><a href="/other-game-review/">Other Game review</a>';
  const converted=genericPublisherLinks(fixture,'https://www.pcgamer.com/');
  if(!converted.includes('total-war-warhammer-3-review'))throw new Error('Generic publisher search lost a matching direct review link.');
  if(converted.includes('guide')||converted.includes('other-game'))throw new Error('Generic publisher search leaked non-review or unrelated links.');
  return true;
}
validateGenericPublisherSearch();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let url;
  try{url=new URL(original)}catch{return networkFetch(input,init)}
  if(url.hostname.replace(/^www\./,'').toLowerCase()!=='google.com'||url.pathname!=='/search')return networkFetch(input,init);
  const query=url.searchParams.get('q')||'';
  const [ordinary,native]=await Promise.allSettled([
    networkFetch(input,{...init,signal:AbortSignal.timeout(8000)}),
    genericPublisherSearch(query,init)
  ]);
  const parts=[];
  if(native.status==='fulfilled'&&native.value)parts.push(native.value);
  if(ordinary.status==='fulfilled'&&ordinary.value?.ok)parts.push(await ordinary.value.text());
  if(!parts.length)return ordinary.status==='fulfilled'?ordinary.value:new Response('',{status:503});
  return new Response(parts.join('\n'),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
};

try{
  await import('./discover-review-sources-web-v12.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
