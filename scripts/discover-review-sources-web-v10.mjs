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

export function googleSearchToSearchHtml(html){
  const anchors=[];
  const add=(rawUrl,rawTitle='')=>{
    let value=decodeXml(rawUrl);
    try{
      const parsed=new URL(value,'https://www.google.com');
      if(parsed.hostname.endsWith('google.com')&&parsed.pathname==='/url'&&parsed.searchParams.get('q'))value=parsed.searchParams.get('q');
    }catch{return}
    let url;
    try{url=new URL(value)}catch{return}
    const domain=url.hostname.replace(/^www\./,'').toLowerCase();
    if(!/^https?:$/i.test(url.protocol)||domain==='google.com'||domain.endsWith('.google.com')||domain.endsWith('gstatic.com')||domain.endsWith('googleusercontent.com'))return;
    if(anchors.some(item=>item.url===url.href))return;
    const title=decodeXml(rawTitle).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    anchors.push({url:url.href,title:title||url.href});
  };
  const source=String(html||'');
  for(const match of source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(match[1],match[2]);
  return anchors.slice(0,32).map(item=>`<a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a>`).join('\n');
}

export function publisherLinksToSearchHtml(html,baseUrl,{pathPattern=/\/review\//i}={}){
  const anchors=[];
  const add=(rawUrl,rawTitle='')=>{
    let url;
    try{url=new URL(decodeXml(rawUrl),baseUrl)}catch{return}
    if(!pathPattern.test(url.pathname))return;
    if(anchors.some(item=>item.url===url.href))return;
    const title=decodeXml(rawTitle).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    anchors.push({url:url.href,title:title||url.href});
  };
  const source=String(html||'');
  for(const match of source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(match[1],match[2]);
  const normalized=source.replace(/\\u002f/gi,'/').replace(/\\\//g,'/');
  for(const match of normalized.matchAll(/(?:https?:\/\/[^"'<>\s]+|\/[A-Za-z0-9][^"'<>\s]*)/gi)){
    const candidate=match[0].replace(/[),.;]+$/,'');
    add(candidate);
    if(anchors.length>=64)break;
  }
  return anchors.map(item=>`<a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a>`).join('\n');
}

const relaxPublisherQuery=query=>String(query||'')
  .replace(/\b(?:score|verdict)\b/gi,' ')
  .replace(/\s+/g,' ')
  .trim();
const dropPublisherYear=query=>String(query||'')
  .replace(/\s+(?:19|20)\d{2}\b/g,' ')
  .replace(/\s+/g,' ')
  .trim();
const variantsFor=(query,{relaxed=false}={})=>{
  const yearless=dropPublisherYear(query),variants=[query,yearless];
  if(relaxed)variants.push(relaxPublisherQuery(query),relaxPublisherQuery(yearless));
  return variants;
};

export function bingRssSearchUrls(searchUrl){
  let original;
  try{original=new URL(String(searchUrl||''))}catch{return[]}
  const query=original.searchParams.get('q')||'',queries=[...variantsFor(query)];
  for(const {match,scope} of publisherReviewScopes){
    if(!match.test(query))continue;
    const scoped=query.replace(match,scope);
    queries.push(...variantsFor(query,{relaxed:true}),...variantsFor(scoped,{relaxed:true}));
    break;
  }
  return [...new Set(queries.filter(Boolean))].map(q=>{
    const url=new URL(original);
    url.searchParams.set('q',q);
    url.searchParams.set('format','rss');
    return url;
  });
}

function googleSearchUrls(searchUrl){
  let original;
  try{original=new URL(String(searchUrl||''))}catch{return[]}
  const query=original.searchParams.get('q')||'';
  return [...new Set(variantsFor(query,{relaxed:true}).filter(Boolean))].map(q=>{
    const url=new URL('https://www.google.com/search');
    url.searchParams.set('q',q);
    url.searchParams.set('num','12');
    url.searchParams.set('filter','0');
    return url;
  });
}

const creatorPrefixVariant=slug=>{
  const value=String(slug||'');
  const stripped=value.replace(/^[a-z0-9]+-[a-z0-9]+s-(?=.+)/i,'');
  return stripped!==value?stripped:null;
};
const romanSlugVariant=slug=>String(slug||'')
  .replace(/(^|-)(ii)(?=-|$)/gi,'$12')
  .replace(/(^|-)(iii)(?=-|$)/gi,'$13')
  .replace(/(^|-)(iv)(?=-|$)/gi,'$14')
  .replace(/(^|-)(vi)(?=-|$)/gi,'$16');

function publisherNativeRequests(searchUrl,{slug=process.argv[2]||''}={}){
  if(!slug)return[];
  let query='';
  try{query=new URL(String(searchUrl||'')).searchParams.get('q')||''}catch{return[]}
  if(/(?:^|\s)site:(?:www\.)?pcgamer\.com(?:\s|$)/i.test(query)){
    const variants=[slug,romanSlugVariant(slug)].filter(Boolean);
    return[...new Set(variants)].map(reviewSlug=>({url:`https://www.pcgamer.com/${reviewSlug}-review/`,pathPattern:/review\/?$/i}));
  }
  if(/(?:^|\s)site:(?:www\.)?gamespot\.com(?:\s|$)/i.test(query)){
    return[{url:`https://www.gamespot.com/games/${slug}/reviews/`,pathPattern:/^\/reviews\//i}];
  }
  if(/(?:^|\s)site:(?:www\.)?gameinformer\.com(?:\s|$)/i.test(query)){
    const variants=[slug,creatorPrefixVariant(slug)].filter(Boolean);
    return[...new Set(variants)].map(productSlug=>({
      url:`https://gameinformer.com/product/${productSlug}`,
      pathPattern:/(?:^\/review\/|\/review(?:[\/_-]|\.|$)|review\.aspx$)/i
    }));
  }
  if(/(?:^|\s)site:(?:www\.)?pushsquare\.com(?:\s|$)/i.test(query)){
    return['ps5','ps4'].map(platform=>({url:`https://www.pushsquare.com/reviews/${platform}/${slug}`,pathPattern:/^\/reviews\//i}));
  }
  if(/(?:^|\s)site:(?:www\.)?gamerevolution\.com(?:\s|$)/i.test(query)){
    const terms=slug.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
    return[{url:`https://www.gamerevolution.com/?s=${encodeURIComponent(terms)}`,pathPattern:/^\/review\//i}];
  }
  return[];
}

export function validateBingRssAdapter(){
  const xml='<?xml version="1.0"?><rss><channel><item><title>Rainbow Six Siege Review</title><link>https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/</link></item></channel></rss>';
  const html=bingRssToSearchHtml(xml);
  if(!html.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('Bing RSS adapter lost direct result URL.');
  if(!html.includes('Rainbow Six Siege Review'))throw new Error('Bing RSS adapter lost result title.');
  const googleFixture='<a href="/url?q=https%3A%2F%2Fwww.pcgamer.com%2Fmount-and-blade-2-bannerlord-review%2F&sa=U">Mount &amp; Blade 2: Bannerlord review</a><a href="https://www.google.com/preferences">Preferences</a>';
  const googleHtml=googleSearchToSearchHtml(googleFixture);
  if(!googleHtml.includes('https://www.pcgamer.com/mount-and-blade-2-bannerlord-review/'))throw new Error('Google fallback adapter lost direct publisher result URL.');
  if(googleHtml.includes('google.com/preferences'))throw new Error('Google fallback adapter leaked search-engine navigation.');
  const cases=[
    ['gamespot.com','gamespot.com/reviews'],
    ['gamerevolution.com','gamerevolution.com/review'],
    ['gry-online.pl','gry-online.pl/recenzje'],
    ['worthplaying.com','worthplaying.com/article']
  ];
  for(const [domain,scope] of cases){
    const urls=bingRssSearchUrls(`https://www.bing.com/search?q=${encodeURIComponent(`site:${domain} "Rainbow Six Siege" review score verdict 2015`)}`);
    if(urls.length!==8)throw new Error(`${domain} must receive year-bound, yearless, review-path and relaxed RSS queries.`);
    const queries=urls.map(url=>url.searchParams.get('q')||'');
    if(!queries.some(query=>query.includes(`site:${scope}`)))throw new Error(`${domain} review-path scope contract failed.`);
    if(!queries.some(query=>query.includes('review 2015')&&!/\b(?:score|verdict)\b/i.test(query)))throw new Error(`${domain} relaxed review query contract failed.`);
    if(!queries.some(query=>query.includes('review')&&!/\b(?:19|20)\d{2}\b/.test(query)))throw new Error(`${domain} yearless review query contract failed.`);
  }
  const pcgamerYear=bingRssSearchUrls(`https://www.bing.com/search?q=${encodeURIComponent('site:pcgamer.com "Mount & Blade II: Bannerlord" review verdict 2020')}`);
  if(pcgamerYear.length!==2)throw new Error('Unscoped publishers must receive both release-year and yearless queries.');
  if(!pcgamerYear.some(url=>!/\b2020\b/.test(url.searchParams.get('q')||'')))throw new Error('Unscoped publisher yearless query contract failed.');
  const googleYear=googleSearchUrls(`https://www.bing.com/search?q=${encodeURIComponent('site:pcgamer.com "Mount & Blade II: Bannerlord" review verdict 2020')}`);
  if(googleYear.length!==4||!googleYear.some(url=>!/\b2020\b/.test(url.searchParams.get('q')||'')))throw new Error('Google fallback must receive year-bound and yearless relaxed queries.');
  const ign=bingRssSearchUrls('https://www.bing.com/search?q=site%3Aign.com+Rainbow+Six+Siege+review');
  if(ign.length!==1)throw new Error('Yearless unconfigured search must remain deduplicated.');
  const pcgamerNative=publisherNativeRequests('https://www.bing.com/search?q=site%3Apcgamer.com+Mount+Blade+II+Bannerlord+review',{slug:'mount-and-blade-ii-bannerlord'});
  if(!pcgamerNative.some(item=>item.url==='https://www.pcgamer.com/mount-and-blade-2-bannerlord-review/'))throw new Error('PC Gamer roman-numeral direct review candidate contract failed.');
  const pushNative=publisherNativeRequests('https://www.bing.com/search?q=site%3Apushsquare.com+Mount+Blade+II+Bannerlord+review',{slug:'mount-and-blade-ii-bannerlord'});
  if(!pushNative.some(item=>item.url==='https://www.pushsquare.com/reviews/ps5/mount-and-blade-ii-bannerlord'))throw new Error('Push Square direct review candidate contract failed.');
  const gamespotNative=publisherNativeRequests('https://www.bing.com/search?q=site%3Agamespot.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'})[0];
  if(gamespotNative?.url!=='https://www.gamespot.com/games/tom-clancys-rainbow-six-siege/reviews/')throw new Error('GameSpot game-review hub contract failed.');
  const gamespotHtml='<a href="/reviews/rainbow-six-siege-review-2015/1900-6416324/">Rainbow Six Siege Review (2015)</a><a href="/articles/rainbow-six-siege-guide/1100-1/">Guide</a>';
  const convertedGameSpot=publisherLinksToSearchHtml(gamespotHtml,gamespotNative.url,gamespotNative);
  if(!convertedGameSpot.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('GameSpot review-hub extraction failed.');
  if(convertedGameSpot.includes('/articles/'))throw new Error('GameSpot review-hub extraction leaked non-review links.');
  const embeddedGameSpot='{"canonicalUrl":"https:\\/\\/www.gamespot.com\\/reviews\\/rainbow-six-siege-review-2015\\/1900-6416324\\/","other":"\\/articles\\/not-a-review\\/"}';
  const convertedEmbedded=publisherLinksToSearchHtml(embeddedGameSpot,gamespotNative.url,gamespotNative);
  if(!convertedEmbedded.includes('https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/'))throw new Error('GameSpot hydration-data extraction failed.');
  const giNative=publisherNativeRequests('https://www.bing.com/search?q=site%3Agameinformer.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'});
  if(!giNative.some(item=>item.url==='https://gameinformer.com/product/rainbow-six-siege'))throw new Error('Game Informer creator-prefix product normalization failed.');
  const giHtml='<a href="/games/rainbow_six_siege/b/playstation4/archive/2015/12/04/game-informer-rainbow-six-siege-review.aspx">Rainbow Six Siege Review – The Under-Equipped Combatant</a><a href="/2019/02/17/rainbow-six-news">News</a>';
  const convertedGi=publisherLinksToSearchHtml(giHtml,'https://gameinformer.com/product/rainbow-six-siege',giNative.at(-1));
  if(!convertedGi.includes('game-informer-rainbow-six-siege-review.aspx'))throw new Error('Game Informer product-hub review extraction failed.');
  if(convertedGi.includes('rainbow-six-news'))throw new Error('Game Informer product-hub extraction leaked non-review links.');
  const native=publisherNativeRequests('https://www.bing.com/search?q=site%3Agamerevolution.com+Rainbow+Six+Siege+review',{slug:'tom-clancys-rainbow-six-siege'})[0];
  if(!native?.url.includes('gamerevolution.com/?s=tom%20clancys%20rainbow%20six%20siege'))throw new Error('GameRevolution publisher-search request contract failed.');
  const nativeHtml='<a href="/review/69596-tom-clancys-rainbow-six-siege-review"><span>Tom Clancy’s Rainbow Six: Siege Review</span></a><a href="/guides/1-other">Guide</a>';
  const convertedNative=publisherLinksToSearchHtml(nativeHtml,native.url,native);
  if(!convertedNative.includes('https://www.gamerevolution.com/review/69596-tom-clancys-rainbow-six-siege-review'))throw new Error('Publisher search review-link extraction failed.');
  if(convertedNative.includes('/guides/'))throw new Error('Publisher search leaked non-review links.');
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
    for(const googleUrl of googleSearchUrls(original))requests.push((async()=>{
      const response=await networkFetch(googleUrl,{...init,headers:{...(init?.headers||{}),'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/127 Safari/537.36'}});
      if(!response.ok)return'';
      return googleSearchToSearchHtml(await response.text());
    })());
    for(const native of publisherNativeRequests(original))requests.push((async()=>{
      const response=await networkFetch(native.url,init);
      if(!response.ok)return'';
      return publisherLinksToSearchHtml(await response.text(),response.url||native.url,native);
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
