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

export function validateBingRssAdapter(){
  const xml='<?xml version="1.0"?><rss><channel><item><title>Rainbow Six Siege Review</title><link>https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/</link></item></channel></rss>';
  const html=bingRssToSearchHtml(xml);
  if(!html.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('Bing RSS adapter lost direct result URL.');
  if(!html.includes('Rainbow Six Siege Review'))throw new Error('Bing RSS adapter lost result title.');
  return true;
}

validateBingRssAdapter();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  if(!/^https:\/\/www\.bing\.com\/search\?/i.test(original))return networkFetch(input,init);
  try{
    const rssUrl=new URL(original);
    rssUrl.searchParams.set('format','rss');
    const response=await networkFetch(rssUrl,init);
    if(response.ok){
      const xml=await response.text();
      const html=bingRssToSearchHtml(xml);
      if(html){
        const headers=new Headers(response.headers);
        headers.set('content-type','text/html; charset=utf-8');
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(html,{status:response.status,statusText:response.statusText,headers});
      }
    }
  }catch{}
  return networkFetch(input,init);
};

try{
  await import('./discover-review-sources-web-v9.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
