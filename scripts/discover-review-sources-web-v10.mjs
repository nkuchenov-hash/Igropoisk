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

export function publisherNativeSearchHtml(searchUrl,{slug=process.argv[2]||''}={}){
  if(!slug)return'';
  let query='';
  try{query=new URL(String(searchUrl||'')).searchParams.get('q')||''}catch{return''}
  const candidates=[];
  if(/(?:^|\s)site:(?:www\.)?gamespot\.com(?:\s|$)/i.test(query)){
    const url=`https://www.gamespot.com/games/${encodeURIComponent(slug)}/reviews/`;
    candidates.push(`<a href="${escapeAttr(url)}">${escapeText(`${slug} reviews`)}</a>`);
  }
  return candidates.join('\n');
}

export function validateBingRssAdapter(){
  const xml='<?xml version="1.0"?><rss><channel><item><title>Rainbow Six Siege Review</title><link>https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/</link></item></channel></rss>';
  const html=bingRssToSearchHtml(xml);
  if(!html.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('Bing RSS adapter lost direct result URL.');
  if(!html.includes('Rainbow Six Siege Review'))throw new Error('Bing RSS adapter lost result title.');
  const hub=publisherNativeSearchHtml('https://www.bing.com/search?q=site%3Agamespot.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'});
  if(!hub.includes('https://www.gamespot.com/games/tom-clancys-rainbow-six-siege/reviews/'))throw new Error('GameSpot native review-hub candidate contract failed.');
  if(publisherNativeSearchHtml('https://www.bing.com/search?q=site%3Aign.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'}))throw new Error('Native hub candidates must stay publisher-scoped.');
  return true;
}

validateBingRssAdapter();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  if(!/^https:\/\/www\.bing\.com\/search\?/i.test(original))return networkFetch(input,init);
  const nativeHtml=publisherNativeSearchHtml(original);
  try{
    const rssUrl=new URL(original);
    rssUrl.searchParams.set('format','rss');
    const response=await networkFetch(rssUrl,init);
    if(response.ok){
      const xml=await response.text();
      const html=[nativeHtml,bingRssToSearchHtml(xml)].filter(Boolean).join('\n');
      if(html){
        const headers=new Headers(response.headers);
        headers.set('content-type','text/html; charset=utf-8');
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(html,{status:response.status,statusText:response.statusText,headers});
      }
    }
  }catch{}
  if(nativeHtml)return new Response(nativeHtml,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  return networkFetch(input,init);
};

try{
  await import('./discover-review-sources-web-v9.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
