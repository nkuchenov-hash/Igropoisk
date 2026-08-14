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
const publisherReviewScopes=[
  {match:/site:(?:www\.)?gamespot\.com/i,scope:'site:gamespot.com/reviews'},
  {match:/site:(?:www\.)?gamerevolution\.com/i,scope:'site:gamerevolution.com/review'},
  {match:/site:(?:www\.)?gry-online\.pl/i,scope:'site:gry-online.pl/recenzje'},
  {match:/site:(?:www\.)?worthplaying\.com/i,scope:'site:worthplaying.com/article'}
];

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

export function publisherHubLinksToSearchHtml(html,baseUrl,{pathPattern=/\/review\//i}={}){
  const anchors=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url;
    try{url=new URL(decodeXml(match[1]),baseUrl)}catch{continue}
    if(!pathPattern.test(url.pathname))continue;
    const title=decodeXml(match[2]).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    if(!anchors.some(item=>item.url===url.href))anchors.push({url:url.href,title:title||url.href});
  }
  return anchors.map(item=>`<a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a>`).join('\n');
}

export function bingRssSearchUrls(searchUrl){
  let original;
  try{original=new URL(String(searchUrl||''))}catch{return[]}
  const query=original.searchParams.get('q')||'',queries=[query];
  for(const {match,scope} of publisherReviewScopes){
    if(!match.test(query))continue;
    queries.push(query.replace(match,scope));
    break;
  }
  return [...new Set(queries)].map(q=>{
    const url=new URL(original);
    url.searchParams.set('q',q);
    url.searchParams.set('format','rss');
    return url;
  });
}

function publisherHubRequest(searchUrl,{slug=process.argv[2]||''}={}){
  if(!slug)return null;
  let query='';
  try{query=new URL(String(searchUrl||'')).searchParams.get('q')||''}catch{return null}
  if(/(?:^|\s)site:(?:www\.)?gamerevolution\.com(?:\s|$)/i.test(query)){
    return{url:`https://www.gamerevolution.com/game/${encodeURIComponent(slug)}`,pathPattern:/\/review\//i};
  }
  return null;
}

export function validateBingRssAdapter(){
  const xml='<?xml version="1.0"?><rss><channel><item><title>Rainbow Six Siege Review</title><link>https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/</link></item></channel></rss>';
  const html=bingRssToSearchHtml(xml);
  if(!html.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('Bing RSS adapter lost direct result URL.');
  if(!html.includes('Rainbow Six Siege Review'))throw new Error('Bing RSS adapter lost result title.');
  const cases=[
    ['gamespot.com','gamespot.com/reviews'],
    ['gamerevolution.com','gamerevolution.com/review'],
    ['gry-online.pl','gry-online.pl/recenzje'],
    ['worthplaying.com','worthplaying.com/article']
  ];
  for(const [domain,scope] of cases){
    const urls=bingRssSearchUrls(`https://www.bing.com/search?q=${encodeURIComponent(`site:${domain} "Rainbow Six Siege" review 2015`)}`);
    if(urls.length!==2)throw new Error(`${domain} must receive generic and review-path RSS queries.`);
    if(!decodeURIComponent(urls[1].toString()).includes(`site:${scope}`))throw new Error(`${domain} review-path scope contract failed.`);
  }
  const ign=bingRssSearchUrls('https://www.bing.com/search?q=site%3Aign.com+Rainbow+Six+Siege+review');
  if(ign.length!==1)throw new Error('Unconfigured path-scoped search must stay publisher-specific.');
  const hub=publisherHubRequest('https://www.bing.com/search?q=site%3Agamerevolution.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'});
  if(hub?.url!=='https://www.gamerevolution.com/game/tom-clancys-rainbow-six-siege')throw new Error('GameRevolution game-hub request contract failed.');
  const hubHtml='<a href="/review/69596-tom-clancys-rainbow-six-siege-review"><span>Tom Clancy’s Rainbow Six: Siege Review</span></a><a href="/guides/1-other">Guide</a>';
  const convertedHub=publisherHubLinksToSearchHtml(hubHtml,hub.url,hub);
  if(!convertedHub.includes('https://www.gamerevolution.com/review/69596-tom-clancys-rainbow-six-siege-review'))throw new Error('Publisher hub review-link extraction failed.');
  if(convertedHub.includes('/guides/'))throw new Error('Publisher hub leaked non-review links.');
  return true;
}

validateBingRssAdapter();

globalThis.fetch=async(input,init)=>{
  const original=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  if(!/^https:\/\/www\.bing\.com\/search\?/i.test(original))return networkFetch(input,init);
  const html=[];
  try{
    const requests=bingRssSearchUrls(original).map(async rssUrl=>{
      const response=await networkFetch(rssUrl,init);
      if(!response.ok)return'';
      return bingRssToSearchHtml(await response.text());
    });
    const hub=publisherHubRequest(original);
    if(hub)requests.push((async()=>{
      const response=await networkFetch(hub.url,init);
      if(!response.ok)return'';
      return publisherHubLinksToSearchHtml(await response.text(),response.url||hub.url,hub);
    })());
    const parts=await Promise.allSettled(requests);
    for(const part of parts)if(part.status==='fulfilled'&&part.value)html.push(part.value);
    if(html.length)return new Response(html.join('\n'),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  }catch{}
  return networkFetch(input,init);
};

try{
  await import('./discover-review-sources-web-v9.mjs');
}finally{
  globalThis.fetch=networkFetch;
}
