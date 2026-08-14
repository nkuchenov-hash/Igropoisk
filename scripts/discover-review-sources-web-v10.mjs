#!/usr/bin/env node

const networkFetch=globalThis.fetch;
if(typeof networkFetch!=='function')throw new Error('Global fetch is required for review discovery.');

const decodeXml=value=>String(value||'')
  .replace(/^<!\[CDATA\[|\]\]>$/g,'')
  .replace(/&amp;/gi,'&')
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'");
const escapeAttr=value=>String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
const escapeText=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function bingRssToSearchHtml(xml){
  const anchors=[];
  for(const item of String(xml||'').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
    const body=item[1];
    const title=decodeXml((body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const link=decodeXml((body.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)||[])[1]||'').trim();
    if(!/^https?:\/\//i.test(link))continue;
    anchors.push(`<a href="${escapeAttr(link)}">${escapeText(title||link)}</a>`);
  }
  return anchors.join('\n');
}

export function bingRssSearchUrls(searchUrl){
  let original;
  try{original=new URL(String(searchUrl||''))}catch{return[]}
  const query=original.searchParams.get('q')||'';
  const queries=[query];
  if(/(?:^|\s)site:(?:www\.)?gamespot\.com(?:\s|$)/i.test(query)){
    queries.push(query.replace(/site:(?:www\.)?gamespot\.com/i,'site:gamespot.com/reviews'));
  }
  return [...new Set(queries)].map(q=>{
    const url=new URL(original);
    url.searchParams.set('q',q);
    url.searchParams.set('format','rss');
    return url;
  });
}

export function validateBingRssAdapter(){
  const xml='<?xml version="1.0"?><rss><channel><item><title>Rainbow Six Siege Review</title><link>https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/</link></item></channel></rss>';
  const html=bingRssToSearchHtml(xml);
  if(!html.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('Bing RSS adapter lost direct result URL.');
  if(!html.includes('Rainbow Six Siege Review'))throw new Error('Bing RSS adapter lost result title.');
  const urls=bingRssSearchUrls('https://www.bing.com/search?q=site%3Agamespot.com+%22Tom+Clancy%27s+Rainbow+Six+Siege%22+review+2015');
  if(urls.length!==2)throw new Error('GameSpot must receive generic and direct-review-path RSS queries.');
  if(!decodeURIComponent(urls[1].toString()).includes('site:gamespot.com/reviews'))throw new Error('GameSpot direct review path scope contract failed.');
  const ign=bingRssSearchUrls('https://www.bing.com/search?q=site%3Aign.com+Rainbow+Six+Siege+review');
  if(ign.length!==1)throw new Error('Path-scoped search must stay publisher-specific.');
  return true;
}

validateBingRssAdapter();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  if(!/^https:\/\/www\.bing\.com\/search\?/i.test(original))return networkFetch(input,init);
  const html=[];
  try{
    for(const rssUrl of bingRssSearchUrls(original)){
      const response=await networkFetch(rssUrl,init);
      if(!response.ok)continue;
      const converted=bingRssToSearchHtml(await response.text());
      if(converted)html.push(converted);
    }
    if(html.length)return new Response(html.join('\n'),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  }catch{}
  return networkFetch(input,init);
};

try{
  await import('./discover-review-sources-web-v9.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
