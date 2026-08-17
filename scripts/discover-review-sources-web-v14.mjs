#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
const rawFetch=globalThis.fetch;
if(typeof rawFetch!=='function')throw new Error('Global fetch is required for review discovery.');

const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const decode=value=>String(value||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const plain=value=>decode(String(value||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const esc=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').replace(/\s+/g,' ').trim();
const draft=slug?read(`data/drafts/${slug}.json`,{}):{};
const gameTitle=String(draft?.identity?.title||slug.replace(/-/g,' ')).trim();
const normalizedTitle=normalize(gameTitle);
const titleTokens=normalizedTitle.split(' ').filter(Boolean);
const numberedIndex=titleTokens.findIndex((token,index)=>index>0&&/^\d+$/.test(token));
const identityKey=numberedIndex>0?titleTokens.slice(0,numberedIndex+1).join(' '):titleTokens.filter(token=>token.length>2).slice(0,Math.min(3,titleTokens.length)).join(' ');
const reviewSignal=value=>/(?:review|retroview|recenz|verdict|opinion)/i.test(String(value||''));
const identityMatches=value=>{
  const hay=` ${normalize(value)} `;
  if(!identityKey)return true;
  if(numberedIndex>0)return hay.includes(` ${identityKey} `);
  const required=identityKey.split(' ').filter(Boolean);
  return required.length?required.every(token=>hay.includes(` ${token} `)):true;
};
const timeoutFetch=(url,init={})=>rawFetch(url,{...init,redirect:'follow',signal:init.signal||AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskHistoricalReviewDiscovery/14.0)','accept-language':'en-US,en;q=.9,ru;q=.7',...(init.headers||{})}});
const uniqueCandidates=items=>{
  const out=[],seen=new Set();
  for(const item of items){
    if(!item?.url)continue;
    let href;try{const url=new URL(item.url);url.hash='';href=url.href}catch{continue}
    if(seen.has(href))continue;seen.add(href);out.push({...item,url:href});
  }
  return out.slice(0,24);
};

function extractPublisherLinks(html,baseUrl,{hostname,pathPattern=null,allowQueryPermalink=false}={}){
  const out=[];
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    let url;try{url=new URL(decode(match[1]),baseUrl)}catch{continue}
    const host=url.hostname.replace(/^www\./,'').toLowerCase();
    if(host!==hostname)continue;
    const title=plain(match[2]);
    const queryPermalink=allowQueryPermalink&&/^\d+$/.test(url.searchParams.get('p')||'');
    if(pathPattern&&!pathPattern.test(url.pathname)&&!queryPermalink)continue;
    const signals=`${title} ${url.pathname} ${url.search}`;
    if(!reviewSignal(signals)||!identityMatches(signals))continue;
    out.push({url:url.href,title:title||`${gameTitle} Review`});
  }
  return uniqueCandidates(out);
}

async function rpgFanCandidates(init){
  const candidates=[
    {url:`https://www.rpgfan.com/review/${slug}/`,title:`${gameTitle} Review`},
    {url:`https://www.rpgfan.com/review/${slug}-2/`,title:`${gameTitle} Review`}
  ];
  try{
    const response=await timeoutFetch(`https://www.rpgfan.com/game/${slug}/`,init);
    if(response.ok)candidates.push(...extractPublisherLinks(await response.text(),response.url||`https://www.rpgfan.com/game/${slug}/`,{hostname:'rpgfan.com',pathPattern:/^\/review\//i}));
  }catch{}
  return uniqueCandidates(candidates);
}

async function rpgamerCandidates(init){
  const candidates=[{url:`https://rpgamer.com/review/${slug}-review/`,title:`${gameTitle} Review`}];
  try{
    const response=await timeoutFetch(`https://rpgamer.com/?s=${encodeURIComponent(gameTitle)}`,init);
    if(response.ok)candidates.push(...extractPublisherLinks(await response.text(),response.url||'https://rpgamer.com/',{hostname:'rpgamer.com',pathPattern:/^\/review\//i}));
  }catch{}
  return uniqueCandidates(candidates);
}

async function gameRevolutionCandidates(init){
  const candidates=[];
  try{
    const response=await timeoutFetch(`https://www.gamerevolution.com/?s=${encodeURIComponent(gameTitle)}`,init);
    if(response.ok)candidates.push(...extractPublisherLinks(await response.text(),response.url||'https://www.gamerevolution.com/',{hostname:'gamerevolution.com',pathPattern:/^\/review\//i,allowQueryPermalink:true}));
  }catch{}
  try{
    const response=await timeoutFetch(`https://www.gamerevolution.com/wp-json/wp/v2/search?search=${encodeURIComponent(gameTitle)}&per_page=20`,init);
    if(response.ok){
      const rows=await response.json();
      for(const row of Array.isArray(rows)?rows:[]){
        const title=plain(row?.title||'');const url=String(row?.url||'');
        if(url&&reviewSignal(`${title} ${url}`)&&identityMatches(`${title} ${url}`))candidates.push({url,title:title||`${gameTitle} Review`});
      }
    }
  }catch{}
  return uniqueCandidates(candidates);
}

function sourceFromQuery(query){
  if(/site:(?:www\.)?rpgfan\.com/i.test(query))return'rpgfan';
  if(/site:(?:www\.|archive\.)?rpgamer\.com/i.test(query))return'rpgamer';
  if(/site:(?:www\.)?gamerevolution\.com/i.test(query))return'game-revolution';
  return'';
}
const cache=new Map();
async function historicalCandidates(source,init){
  if(!source||!slug)return[];
  if(!cache.has(source))cache.set(source,source==='rpgfan'?rpgFanCandidates(init):source==='rpgamer'?rpgamerCandidates(init):source==='game-revolution'?gameRevolutionCandidates(init):Promise.resolve([]));
  return cache.get(source);
}

function injectSearchBody(body,candidates,url,response){
  if(!candidates.length)return new Response(body,{status:response?.status||200,statusText:response?.statusText||'',headers:response?.headers||{}});
  const contentType=String(response?.headers?.get?.('content-type')||'');
  const rss=url.searchParams.get('format')==='rss'||/xml|rss/i.test(contentType);
  if(rss){
    const items=candidates.map(item=>`<item><title>${esc(item.title||gameTitle+' Review')}</title><link>${esc(item.url)}</link></item>`).join('');
    const next=/<\/channel>/i.test(body)?body.replace(/<\/channel>/i,`${items}</channel>`):`${body}<rss><channel>${items}</channel></rss>`;
    return new Response(next,{status:200,headers:{'content-type':'application/rss+xml; charset=utf-8'}});
  }
  const anchors=candidates.map(item=>`<a href="${esc(item.url)}">${esc(item.title||gameTitle+' Review')}</a>`).join('\n');
  return new Response(`${body}\n${anchors}`,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
}

function validateV14(){
  if(!identityMatches('Fallout 2 Review https://www.rpgfan.com/review/fallout-2/')){
    if(slug==='fallout-2')throw new Error('Historical adapter exact identity fixture failed.');
  }
  const fixture='<a href="https://www.gamerevolution.com/?p=33045">Fallout 2 Review</a><a href="/review/999-fallout-4-review">Fallout 4 Review</a>';
  if(slug==='fallout-2'){
    const links=extractPublisherLinks(fixture,'https://www.gamerevolution.com/',{hostname:'gamerevolution.com',pathPattern:/^\/review\//i,allowQueryPermalink:true});
    if(links.length!==1||!links[0].url.includes('p=33045'))throw new Error('GameRevolution legacy permalink fixture failed.');
  }
}
validateV14();

globalThis.fetch=async(input,init)=>{
  const requestUrl=String(typeof input==='string'||input instanceof URL?input:input?.url||'');
  let url;try{url=new URL(requestUrl)}catch{return rawFetch(input,init)}
  const host=url.hostname.replace(/^www\./,'').toLowerCase();
  if(!['bing.com','google.com'].includes(host)&&!host.endsWith('.bing.com')&&!host.endsWith('.google.com'))return rawFetch(input,init);
  const query=url.searchParams.get('q')||'';
  const source=sourceFromQuery(query);
  if(!source)return rawFetch(input,init);
  const [networkResult,candidateResult]=await Promise.allSettled([rawFetch(input,init),historicalCandidates(source,init)]);
  const response=networkResult.status==='fulfilled'?networkResult.value:null;
  const candidates=candidateResult.status==='fulfilled'?candidateResult.value:[];
  let body='';try{if(response?.ok)body=await response.text()}catch{}
  if(!candidates.length)return response||new Response('',{status:503});
  return injectSearchBody(body,candidates,url,response);
};

try{
  await import('./discover-review-sources-web-v13.mjs');
}finally{
  globalThis.fetch=rawFetch;
}
