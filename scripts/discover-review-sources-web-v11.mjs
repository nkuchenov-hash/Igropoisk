#!/usr/bin/env node

const networkFetch=globalThis.fetch;
if(typeof networkFetch!=='function')throw new Error('Global fetch is required for review discovery.');

const slug=String(process.argv[2]||'').trim();
const tokens=slug.toLowerCase().split(/[-_]+/).filter(token=>token.length>2&&!['and','the','for','with'].includes(token));
const nativeCache=new Map();

const decode=value=>String(value||'')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>');
const escapeAttr=value=>String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
const escapeText=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const plain=value=>decode(String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const reviewSignal=value=>/(?:review|reviews|recenz|opinion|verdict)/i.test(String(value||''));
const identitySignal=value=>{
  const hay=String(value||'').toLowerCase();
  if(!tokens.length)return true;
  const matched=tokens.filter(token=>hay.includes(token)).length;
  return matched>=Math.min(2,tokens.length);
};

function anchoredPublisherLinks(html,base,{pathPattern=null}={}){
  const out=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url;
    try{url=new URL(decode(match[1]),base)}catch{continue}
    if(!/^https?:$/i.test(url.protocol))continue;
    if(pathPattern&&!pathPattern.test(url.pathname))continue;
    const title=plain(match[2]);
    if(!reviewSignal(`${url.pathname} ${title}`)||!identitySignal(`${url.pathname} ${title}`))continue;
    if(out.some(item=>item.url===url.href))continue;
    out.push({url:url.href,title:title||url.href});
  }
  return out.slice(0,16).map(item=>`<a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a>`).join('\n');
}

const titleTerms=()=>slug.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
const hookedVariants=()=>{
  const base=slug.replace(/-/g,'_');
  const noAnd=slug.replace(/-and-/g,'__').replace(/-/g,'_');
  const numeric=noAnd.replace(/(^|_)(ii)(?=_|$)/gi,'$1'+'2').replace(/(^|_)(iii)(?=_|$)/gi,'$1'+'3').replace(/(^|_)(iv)(?=_|$)/gi,'$1'+'4');
  return [...new Set([base,noAnd,numeric].filter(Boolean))];
};

function nativeRequests(query){
  if(!slug)return[];
  const terms=titleTerms();
  if(/(?:^|\s)site:(?:www\.)?thesixthaxis\.com(?:\s|$)/i.test(query)){
    return[{url:`https://www.thesixthaxis.com/?s=${encodeURIComponent(terms)}`,pathPattern:/\/\d{4}\/\d{2}\/\d{2}\//i}];
  }
  if(/(?:^|\s)site:(?:www\.)?gamespew\.com(?:\s|$)/i.test(query)){
    return[{url:`https://www.gamespew.com/?s=${encodeURIComponent(terms)}`,pathPattern:/\/\d{4}\/\d{2}\//i}];
  }
  if(/(?:^|\s)site:(?:www\.)?pcinvasion\.com(?:\s|$)/i.test(query)){
    return[{url:`https://www.pcinvasion.com/?s=${encodeURIComponent(terms)}`}];
  }
  if(/(?:^|\s)site:(?:www\.)?hookedgamers\.com(?:\s|$)/i.test(query)){
    return hookedVariants().map(gameSlug=>({url:`https://www.hookedgamers.com/pc/${gameSlug}.html`,pathPattern:/\/review\//i}));
  }
  return[];
}

async function publisherNativeHtml(query,init){
  const requests=nativeRequests(query);
  if(!requests.length)return'';
  const cacheKey=requests.map(item=>item.url).sort().join('|');
  if(!nativeCache.has(cacheKey))nativeCache.set(cacheKey,(async()=>{
    const parts=await Promise.allSettled(requests.map(async request=>{
      const response=await networkFetch(request.url,{...init,redirect:'follow',signal:AbortSignal.timeout(7000),headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewDiscovery/11.0)','accept-language':'en,ru;q=.8'}});
      if(!response.ok)return'';
      const body=await response.text();
      return anchoredPublisherLinks(body,response.url||request.url,request);
    }));
    return parts.filter(part=>part.status==='fulfilled'&&part.value).map(part=>part.value).join('\n');
  })());
  return nativeCache.get(cacheKey);
}

export function validateNativeReviewSearchAdapter(){
  const fixture='<a href="/2022/11/22/mount-blade-2-bannerlord-review/">Mount & Blade 2: Bannerlord Review</a><a href="/2022/11/21/unrelated-review/">Other Review</a>';
  const converted=anchoredPublisherLinks(fixture,'https://www.thesixthaxis.com/2022/11/22/',{pathPattern:/\/\d{4}\/\d{2}\/\d{2}\//i});
  if(!converted.includes('mount-blade-2-bannerlord-review'))throw new Error('Publisher-native review search lost the matching direct review.');
  if(converted.includes('unrelated-review'))throw new Error('Publisher-native review search leaked an unrelated review.');
  const tsa=nativeRequests('site:thesixthaxis.com "Mount & Blade II: Bannerlord" review');
  if(!tsa.some(item=>item.url.startsWith('https://www.thesixthaxis.com/?s=')))throw new Error('TheSixthAxis native search contract failed.');
  const hooked=nativeRequests('site:hookedgamers.com "Mount & Blade II: Bannerlord" review');
  if(!hooked.some(item=>item.url.includes('/pc/mount__blade_ii_bannerlord.html')))throw new Error('Hooked Gamers game-hub variant contract failed.');
  return true;
}

validateNativeReviewSearchAdapter();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let url;
  try{url=new URL(original)}catch{return networkFetch(input,init)}
  if(url.hostname.replace(/^www\./,'').toLowerCase()!=='google.com'||url.pathname!=='/search')return networkFetch(input,init);
  const query=url.searchParams.get('q')||'';
  const native=await publisherNativeHtml(query,init).catch(()=> '');
  const response=await networkFetch(input,init).catch(()=>null);
  if(!native)return response||new Response('',{status:503});
  const googleBody=response?.ok?await response.text():'';
  return new Response(`${googleBody}\n${native}`,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
};

try{
  await import('./discover-review-sources-web-v10.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
