import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const CACHE_DIR=path.join(root,'tmp','review-sitemap-cache');
const STOP=new Set(['the','and','for','with','wild','hunt','game','edition','review','reviews','tom','clancy','of','a','an']);
const ROMAN={ii:'2',iii:'3',iv:'4',v:'5',vi:'6',vii:'7',viii:'8',ix:'9',x:'10'};
const decode=value=>String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
const locs=xml=>[...String(xml||'').matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map(match=>decode(match[1].trim())).filter(Boolean);
const safe=value=>String(value||'source').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();
const tokens=value=>String(value||'').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').split(/\s+/).filter(Boolean).filter(token=>token.length>2||ROMAN[token]).filter(token=>!STOP.has(token));
const urlTokens=value=>{try{return decodeURIComponent(new URL(value).pathname).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').split(/\s+/).filter(Boolean)}catch{return[]}};

export function rankSitemapReviewUrls(urls,{title,limit=12}={}){
  const wanted=[...new Set(tokens(title))];
  if(!wanted.length)return[];
  const scored=[];
  for(const url of urls||[]){
    if(!/review/i.test(String(url||'')))continue;
    const actual=urlTokens(url),actualSet=new Set(actual),matched=wanted.filter(token=>actualSet.has(token)||(ROMAN[token]&&actualSet.has(ROMAN[token])));
    const minMatches=wanted.length>=4?3:wanted.length>=2?2:1;
    if(matched.length<minMatches)continue;
    const coverage=matched.length/wanted.length;
    if(wanted.length>=4&&coverage<0.5)continue;
    const extras=actual.filter(token=>token!=='review'&&!wanted.includes(token)&&!Object.values(ROMAN).includes(token)&&!STOP.has(token));
    const exactTail=/\/review\/?$/i.test(String(url||''))||/-review\/?$/i.test(String(url||''));
    const score=matched.length*20+coverage*20-(extras.length*3)+(exactTail?8:0)-Math.max(0,actual.length-wanted.length-1);
    scored.push({url,score,matched:matched.length,coverage,extras:extras.length});
  }
  return scored.sort((a,b)=>b.score-a.score||a.url.length-b.url.length||a.url.localeCompare(b.url)).slice(0,limit).map(item=>({url:item.url,title:'',sitemap_rank:item.score,sitemap_match:{matched:item.matched,coverage:item.coverage,extras:item.extras}}));
}

async function get(url,timeoutMs=9000){
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeoutMs),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskPublisherSitemap/1.0)','accept-language':'en,ru;q=.8'}});
    return{ok:response.ok,status:response.status,url:response.url||url,body:response.ok?await response.text():''};
  }catch(error){return{ok:false,status:0,url,error:error.message,body:''}}
}
function readCache(file){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(value.urls)?value:null}catch{return null}}
function writeCache(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value));
  try{fs.renameSync(temp,file)}catch{try{fs.rmSync(temp,{force:true})}catch{}}
}
async function yearUrls({sourceId,indexUrl,year}){
  if(!year||!indexUrl)return{reachable:false,urls:[]};
  const file=path.join(CACHE_DIR,`${safe(sourceId)}-${year}.json`),cached=readCache(file);
  if(cached)return{reachable:true,urls:cached.urls,cached:true};
  const index=await get(indexUrl);if(!index.ok)return{reachable:false,urls:[]};
  const children=locs(index.body).filter(url=>new RegExp(`sitemap-${year}-\\d{2}\\.xml(?:$|\\?)`,'i').test(url));
  let reachable=true;const urls=[];
  for(let i=0;i<children.length;i+=6){
    const batch=await Promise.all(children.slice(i,i+6).map(url=>get(url)));
    for(const response of batch){if(!response.ok){reachable=false;continue}urls.push(...locs(response.body))}
  }
  const unique=[...new Set(urls)];writeCache(file,{source_id:sourceId,year,index_url:indexUrl,urls:unique,generated_at:new Date().toISOString()});
  return{reachable:index.ok&&(children.length===0||reachable),urls:unique,cached:false};
}

export async function publisherSitemapCandidates({sourceId,indexUrl,title,year,yearOffsets=[0,1],limit=12}={}){
  if(!indexUrl||!year)return{reachable:false,items:[],years:[]};
  const years=[...new Set((yearOffsets||[0,1]).map(offset=>Number(year)+Number(offset||0)).filter(Number.isFinite))];
  const results=await Promise.all(years.map(target=>yearUrls({sourceId,indexUrl,year:target})));
  const urls=[...new Set(results.flatMap(result=>result.urls||[]))];
  return{reachable:results.some(result=>result.reachable),items:rankSitemapReviewUrls(urls,{title,limit}),years};
}
