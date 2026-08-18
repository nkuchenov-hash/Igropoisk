#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: enrich-game-media-from-sources <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const mediaUrl=item=>typeof item==='string'?item:String(item?.url||item?.src||item?.image||'');
const canonical=url=>{try{const parsed=new URL(url);parsed.hash='';return `${parsed.origin}${parsed.pathname.replace(/\/$/,'')}${parsed.search}`}catch{return String(url||'')}};
const uniqueByUrl=items=>{const seen=new Set();return items.filter(item=>{const key=canonical(mediaUrl(item));if(!key||seen.has(key))return false;seen.add(key);return true})};
const blockedHost=host=>/(?:yandex\.|bing\.|google\.|duckduckgo\.|facebook\.|twitter\.|x\.com$|doubleclick\.|googlesyndication\.)/i.test(host);
const blockedAsset=url=>/(?:logo|avatar|author|icon|favicon|sprite|badge|emoji|tracking|pixel|analytics|advert|banner-ad|placeholder|1x1|thumbnail|facebook[-_]?thumb|social[-_]?card)/i.test(url);
const htmlDecode=value=>String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
async function mapLimit(items,limit,worker){const out=new Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const index=cursor++;if(index>=items.length)return;out[index]=await worker(items[index],index)}}));return out}
function png(buf){if(buf.length>=24&&buf.slice(1,4).toString()==='PNG')return{width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)}}
function jpeg(buf){if(buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return null;let i=2;while(i+9<buf.length){if(buf[i]!==0xff){i++;continue}const marker=buf[i+1],len=buf.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buf.readUInt16BE(i+5),width:buf.readUInt16BE(i+7)};if(len<2)break;i+=2+len}return null}
function webp(buf){if(buf.length<30||buf.slice(0,4).toString()!=='RIFF'||buf.slice(8,12).toString()!=='WEBP')return null;const type=buf.slice(12,16).toString();if(type==='VP8X')return{width:1+buf.readUIntLE(24,3),height:1+buf.readUIntLE(27,3)};if(type==='VP8 '&&buf.length>=30&&buf[23]===0x9d&&buf[24]===0x01&&buf[25]===0x2a)return{width:buf.readUInt16LE(26)&0x3fff,height:buf.readUInt16LE(28)&0x3fff};return null}

const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);if(!draft)throw new Error(`${slug}: canonical draft is missing`);
const research=read(`data/research/${slug}-source-matrix.json`,{});
const registry=read('config/parsers/review-source-registry.json',{sources:[]});
const mediaPolicy=read('config/parsers/review-media-policy.json',{});
const releaseYear=Number(String(draft.release?.canonical_date_text||draft.release?.date_text||draft.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const historical=releaseYear>0&&releaseYear<2010;
const quality=mediaPolicy.quality_gate||{};
const balance=mediaPolicy.article_balance||{};
const minimumWidth=Number(historical?quality.minimum_width_historical:quality.minimum_width_modern)||480;
const minimumHeight=Number(historical?quality.minimum_height_historical:quality.minimum_height_modern)||270;
const minimumBytes=Number(historical?quality.minimum_bytes_historical:quality.minimum_bytes_modern)||18000;
const minimumScreens=Math.max(5,Math.min(10,Number(balance.minimum_candidate_screenshots||7)));
const targetScreens=Math.max(minimumScreens,Math.min(15,Number(process.env.GAME_MEDIA_TARGET_SCREENSHOTS||balance.target_candidate_screenshots||12)));
const targetArt=Math.max(1,Math.min(6,Number(process.env.GAME_MEDIA_TARGET_ARTWORK||4)));
const pageConcurrency=Math.max(1,Math.min(8,Number(process.env.GAME_MEDIA_PAGE_CONCURRENCY||6)));
const probeConcurrency=Math.max(1,Math.min(16,Number(process.env.GAME_MEDIA_PROBE_CONCURRENCY||10)));

function sourceBucket(item){
  const raw=typeof item==='object'?(item?.source_url||item?.provider||mediaUrl(item)):mediaUrl(item);
  try{return new URL(raw).hostname.replace(/^www\./,'').toLowerCase()}catch{return String(raw||'unknown').toLowerCase()||'unknown'}
}
function selectDiverse(items,limit){
  const clean=uniqueByUrl(items);
  const buckets=new Map();
  for(const item of clean){const key=sourceBucket(item);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(item)}
  for(const bucket of buckets.values())bucket.sort((a,b)=>(Number(b?.width||0)*Number(b?.height||0))-(Number(a?.width||0)*Number(a?.height||0)));
  const out=[];let progressed=true;
  while(out.length<limit&&progressed){progressed=false;for(const bucket of buckets.values()){const item=bucket.shift();if(!item)continue;out.push(item);progressed=true;if(out.length>=limit)break}}
  return out;
}

async function probe(url){
  try{
    const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol)||blockedHost(parsed.hostname)||blockedAsset(parsed.pathname))return null;
    const response=await fetch(url,{redirect:'follow',headers:{Range:'bytes=0-1048575','user-agent':'IgropoiskMediaEnricher/2.3',accept:'image/avif,image/webp,image/png,image/jpeg,*/*'},signal:AbortSignal.timeout(7000)});
    if(!response.ok)return null;const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.startsWith('image/'))return null;
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<minimumBytes)return null;const size=png(bytes)||jpeg(bytes)||webp(bytes);if(!size?.width||!size?.height)return null;
    return{url:response.url||url,width:size.width,height:size.height,bytes:bytes.length,mime:type.split(';')[0]};
  }catch{return null}
}
function extractImages(html,sourceUrl){
  const raw=[];
  const patterns=[
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/gi,
    /<(?:img|a)[^>]+(?:data-src|data-original|data-lazy-src|data-large-file|data-orig-file|data-full|data-image|href|src)=["']([^"']+)["']/gi
  ];
  for(const pattern of patterns){let match;while((match=pattern.exec(html)))raw.push(match[1])}
  const srcsets=[...html.matchAll(/<(?:img|source)[^>]+(?:data-srcset|srcset)=["']([^"']+)["']/gi)].flatMap(match=>match[1].split(',').map(part=>part.trim().split(/\s+/)[0]));
  raw.push(...srcsets);
  const normalized=String(html||'').replace(/\\u002f/gi,'/').replace(/\\\//g,'/');
  for(const match of normalized.matchAll(/https?:\/\/[^"'<>\s)]+\.(?:jpe?g|png|webp)(?:\?[^"'<>\s)]*)?/gi))raw.push(match[0]);
  const resolved=[];
  for(const candidate of raw){
    const value=htmlDecode(candidate).trim();if(!value||value.startsWith('data:'))continue;
    try{const url=new URL(value,sourceUrl);if(!/^https?:$/.test(url.protocol)||blockedHost(url.hostname)||blockedAsset(url.pathname))continue;resolved.push(url.href)}catch{}
  }
  return[...new Set(resolved)].slice(0,100);
}
async function fetchPageImages(sourceUrl){
  try{
    const parsed=new URL(sourceUrl);if(!/^https?:$/.test(parsed.protocol)||blockedHost(parsed.hostname))return[];
    const response=await fetch(sourceUrl,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskMediaEnricher/2.3)','accept-language':'en-US,en;q=0.8,ru;q=0.7'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)return[];const type=String(response.headers.get('content-type')||'');if(!/text\/html/i.test(type))return[];
    const html=await response.text();return extractImages(html,response.url||sourceUrl);
  }catch{return[]}
}

const sourceRecords=[];
const addSource=(url,kind)=>{if(!url)return;try{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol)||blockedHost(parsed.hostname))return;const key=canonical(parsed.href);if(sourceRecords.some(item=>item.key===key))return;sourceRecords.push({url:parsed.href,key,kind})}catch{}};
for(const source of draft.sources||[]){const url=typeof source==='string'?source:source?.url;addSource(url,'draft-source')}
for(const url of [draft.links?.official,draft.links?.store])addSource(url,'official-or-store');
let registryMediaSurfaces=0;
for(const source of registry.sources||[]){
  const media=source?.media||{};
  const templates=[media.url_template,...(Array.isArray(media.url_templates)?media.url_templates:[])].filter(Boolean);
  for(const template of templates){const expanded=String(template).replace(/\{slug\}/g,slug).replace(/\{title\}/g,encodeURIComponent(draft.identity?.title||slug));addSource(expanded,`registered-gallery:${source.id||source.name||'source'}`);registryMediaSurfaces++}
  if(String(source?.id||'').toLowerCase()==='rpgfan'){
    for(const url of [`https://www.rpgfan.com/game/${slug}/`,`https://www.rpgfan.com/media/${slug}/`,`https://www.rpgfan.com/gallery/${slug}-screenshots/`,`https://www.rpgfan.com/gallery/${slug}-artwork/`,`https://www.rpgfan.com/gallery/${slug}-cover-art/`]){addSource(url,'registered-gallery:rpgfan');registryMediaSurfaces++}
  }
}
for(const source of research.accepted||[]){const url=source?.resolved_url||source?.url;addSource(url,'accepted-review')}
const allowedSourceKeys=new Set(sourceRecords.map(item=>item.key));
const trustExisting=item=>{
  const url=mediaUrl(item);try{if(blockedAsset(new URL(url).pathname))return false}catch{}
  if(typeof item==='string')return true;
  if(String(item?.provider||'')!=='verified-source-page')return true;
  const sourceKey=canonical(item?.source_url||'');return Boolean(sourceKey&&allowedSourceKeys.has(sourceKey));
};
const originalScreens=draft.media?.screenshots||[],originalArt=draft.media?.artwork||[];
const existingScreens=uniqueByUrl(originalScreens.filter(trustExisting)),existingArt=uniqueByUrl(originalArt.filter(trustExisting));
const removedStaleScreens=Math.max(0,originalScreens.length-existingScreens.length),removedStaleArt=Math.max(0,originalArt.length-existingArt.length);
const known=new Set([...existingScreens,...existingArt,draft.media?.hero,draft.media?.cover].map(mediaUrl).map(canonical).filter(Boolean));
const discoveryNeeded=existingScreens.length<targetScreens||existingArt.length<1;
const sourceUrls=discoveryNeeded?sourceRecords.slice(0,14).map(item=>item.url):[];

const pageSets=await mapLimit(sourceUrls,pageConcurrency,async sourceUrl=>({sourceUrl,candidates:await fetchPageImages(sourceUrl)}));
const pagesChecked=pageSets.length,candidateSeen=new Set(),candidateRecords=[];
const missingScreens=Math.max(0,targetScreens-existingScreens.length),missingArt=Math.max(0,targetArt-existingArt.length),candidateLimit=Math.min(72,Math.max(24,missingScreens*6+missingArt*4));
for(const page of pageSets){
  for(const candidate of (page?.candidates||[]).slice(0,50)){
    const key=canonical(candidate);if(!key||known.has(key)||candidateSeen.has(key))continue;
    candidateSeen.add(key);candidateRecords.push({url:candidate,sourceUrl:page.sourceUrl});
    if(candidateRecords.length>=candidateLimit)break;
  }
  if(candidateRecords.length>=candidateLimit)break;
}
const probeResults=await mapLimit(candidateRecords,probeConcurrency,async record=>({record,image:await probe(record.url)}));
const candidatesChecked=probeResults.length,discoveredScreens=[],discoveredArt=[];
for(const result of probeResults){
  const image=result?.image;if(!image)continue;
  const sourceUrl=result.record.sourceUrl,key=canonical(image.url);if(known.has(key))continue;
  const aspect=image.width/image.height;
  if(image.width>=minimumWidth&&image.height>=minimumHeight&&aspect>=1.15&&aspect<=2.7&&discoveredScreens.length<targetScreens){const item={url:image.url,caption:`${draft.identity?.title||slug} — игровой кадр из проверенного источника`,source_url:sourceUrl,width:image.width,height:image.height,mime:image.mime,provider:'verified-source-page'};discoveredScreens.push(item);known.add(key);continue}
  if(image.width>=Math.max(360,Math.min(minimumWidth,600))&&image.height>=Math.max(360,minimumHeight)&&aspect>=0.45&&aspect<=1.25&&discoveredArt.length<targetArt){const item={url:image.url,caption:`${draft.identity?.title||slug} — арт из проверенного источника`,source_url:sourceUrl,width:image.width,height:image.height,mime:image.mime,provider:'verified-source-page'};discoveredArt.push(item);known.add(key)}
}

const allScreens=[...existingScreens,...discoveredScreens],allArt=[...existingArt,...discoveredArt];
draft.media={...(draft.media||{}),screenshots:selectDiverse(allScreens,targetScreens),artwork:selectDiverse(allArt,targetArt)};
draft.publication={...(draft.publication||{}),media_enriched_at:new Date().toISOString()};
write(draftPath,draft);
const status=draft.media.screenshots.length>=minimumScreens?'green':'needs_revision';
write(`data/parser-runs/game-media-source-enrichment-${slug}.json`,{parser:'game-media-source-enrichment-v2.3-bounded',status,game_slug:slug,checked_at:new Date().toISOString(),historical,quality_floor:{minimum_width:minimumWidth,minimum_height:minimumHeight,minimum_bytes:minimumBytes},targets:{minimum_screenshots:minimumScreens,target_screenshots:targetScreens,target_artwork:targetArt},concurrency:{pages:pageConcurrency,probes:probeConcurrency},source_pages:sourceUrls.length,registered_media_surfaces:registryMediaSurfaces,pages_checked:pagesChecked,candidates_checked:candidatesChecked,discovery_skipped:!discoveryNeeded,removed_stale_screenshots:removedStaleScreens,removed_stale_artwork:removedStaleArt,trimmed_screenshots:Math.max(0,allScreens.length-draft.media.screenshots.length),trimmed_artwork:Math.max(0,allArt.length-draft.media.artwork.length),added_screenshots:discoveredScreens.length,added_artwork:discoveredArt.length,total_screenshots:draft.media.screenshots.length,total_artwork:draft.media.artwork.length,policy:'Keep a compact diverse verified media set. Stop discovery when the useful target is already satisfied; search engines may aid source discovery, but only original publisher/store/gallery URLs are retained.'});
console.log(JSON.stringify({slug,historical,target_screenshots:targetScreens,target_artwork:targetArt,discovery_skipped:!discoveryNeeded,pages_checked:pagesChecked,candidates_checked:candidatesChecked,removed_stale_screenshots:removedStaleScreens,removed_stale_artwork:removedStaleArt,added_screenshots:discoveredScreens.length,added_artwork:discoveredArt.length,total_screenshots:draft.media.screenshots.length,total_artwork:draft.media.artwork.length},null,2));
