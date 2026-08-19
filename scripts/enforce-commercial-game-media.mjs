#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: enforce-commercial-game-media <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);if(!draft)throw new Error(`${slug}: draft missing`);
const contract=read('config/review-commercial-contract.json',{}).game_media||{};
const registry=read('config/parsers/review-source-registry.json',{sources:[]});
const minScreens=Math.max(15,Number(contract.minimum_unique_screenshots||15));
const targetScreens=Math.max(minScreens,Math.min(24,Number(contract.target_unique_screenshots||20)));
const maxScreens=Math.max(targetScreens,Math.min(30,Number(contract.maximum_unique_screenshots||24)));
const targetArt=Math.max(3,Math.min(8,Number(contract.target_artwork||6)));
const maxArt=Math.max(targetArt,Math.min(10,Number(contract.maximum_artwork||8)));
const historical=Number(String(draft.release?.canonical_date_text||draft.release?.date_text||draft.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||0)<2010;
const minWidth=historical?480:720,minHeight=historical?270:400,minBytes=historical?18000:30000;
const urlOf=item=>typeof item==='string'?item:String(item?.url||item?.src||'');
const textOf=item=>typeof item==='object'?`${item?.caption||''} ${item?.alt||''} ${item?.kind||''} ${item?.source_url||''}`:'';
const decode=value=>String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['w','h','width','height','quality','format','auto','crop','fit'])u.searchParams.delete(key);return `${u.origin}${u.pathname}${u.search}`}catch{return String(value||'')}};
const familyKey=value=>{try{const u=new URL(value);let p=decodeURIComponent(u.pathname).toLowerCase();p=p.replace(/-(?:\d{2,5})x(?:\d{2,5})(?=\.[a-z0-9]+$)/i,'').replace(/@(?:2x|3x)(?=\.[a-z0-9]+$)/i,'').replace(/(?:[_-](?:thumb|thumbnail|small|medium|large|original))(?=\.[a-z0-9]+$)/i,'');return `${u.hostname.toLowerCase()}${p}`}catch{return String(value||'').toLowerCase()}};
const artRe=/(?:artwork|cover[-_ ]?art|coverart|key[-_ ]?art|concept[-_ ]?art|poster|wallpaper|box[-_ ]?art|storepagebackground|library_600x900|capsule|header|hero)/i;
const shotRe=/(?:screen[-_ ]?shot|screenshots?|gameplay|in[-_ ]?game|\/ss_[a-f0-9]+|[-_]ss[-_])/i;
function classify(item,sourceUrl=''){
  const explicit=String(typeof item==='object'?item?.kind||'':'').toLowerCase();
  const hay=`${urlOf(item)} ${textOf(item)} ${sourceUrl}`;
  if(explicit==='artwork'||explicit==='art'||artRe.test(hay))return'artwork';
  if(explicit==='screenshot'||explicit==='screen'||shotRe.test(hay))return'screenshot';
  return'ambiguous';
}
function dims(buffer,mime){
  if(/png/.test(mime)&&buffer.length>=24)return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(/jpe?g/.test(mime)&&buffer.length>4){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff){i++;continue}const marker=buffer[i+1],len=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};if(len<2)break;i+=2+len}}
  if(/webp/.test(mime)&&buffer.length>=30&&buffer.slice(0,4).toString()==='RIFF'&&buffer.slice(8,12).toString()==='WEBP'){if(buffer.slice(12,16).toString()==='VP8X')return{width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)}}
  return{width:0,height:0};
}
async function probe(record){
  const url=urlOf(record);if(!url)return null;
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 IgropoiskMediaContract/1.0',accept:'image/avif,image/webp,image/png,image/jpeg,*/*'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;const mime=String(r.headers.get('content-type')||'').toLowerCase();if(!mime.startsWith('image/'))return null;
    const buffer=Buffer.from(await r.arrayBuffer());if(buffer.length<minBytes||buffer.length>25_000_000)return null;
    const size=dims(buffer,mime);if(size.width<minWidth||size.height<minHeight)return null;
    return{...record,url:r.url||url,width:size.width,height:size.height,bytes:buffer.length,mime:mime.split(';')[0],content_hash:crypto.createHash('sha256').update(buffer).digest('hex')};
  }catch{return null}
}
async function mapLimit(items,limit,fn){const out=[];let cursor=0;await Promise.all(Array.from({length:Math.min(limit,Math.max(1,items.length))},async()=>{while(true){const i=cursor++;if(i>=items.length)return;const value=await fn(items[i],i);if(value)out.push(value)}}));return out}
function extractPageImages(html,sourceUrl){
  const rows=[];
  for(const m of String(html||'').matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0],src=(tag.match(/(?:src|data-src|data-original|data-lazy-src|data-large-file|data-orig-file|data-full)=["']([^"']+)["']/i)||[])[1],alt=(tag.match(/(?:alt|title)=["']([^"']*)["']/i)||[])[1]||'';
    if(!src)continue;try{rows.push({url:new URL(decode(src),sourceUrl).href,context:decode(alt),source_url:sourceUrl})}catch{}
  }
  for(const m of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>/gi)){try{rows.push({url:new URL(decode(m[1]),sourceUrl).href,context:m[0],source_url:sourceUrl})}catch{}}
  return rows;
}
async function pageImages(sourceUrl){
  try{const r=await fetch(sourceUrl,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 IgropoiskMediaContract/1.0','accept-language':'en-US,en;q=0.8,ru;q=0.7'},signal:AbortSignal.timeout(10000)});if(!r.ok||!/text\/html/i.test(String(r.headers.get('content-type')||'')))return[];return extractPageImages(await r.text(),r.url||sourceUrl)}catch{return[]}
}
function sourcePages(){
  const out=[],seen=new Set();const add=(url,kind='unknown')=>{if(!url)return;try{const u=new URL(url);const key=canonical(u.href);if(!/^https?:$/.test(u.protocol)||seen.has(key))return;seen.add(key);out.push({url:u.href,kind})}catch{}};
  add(draft.links?.store,'store');add(draft.links?.official,'official');
  for(const source of draft.sources||[])add(typeof source==='string'?source:source?.url,'draft');
  for(const source of registry.sources||[]){const media=source?.media||{};for(const template of [media.url_template,...(media.url_templates||[])].filter(Boolean)){const expanded=String(template).replace(/\{slug\}/g,slug).replace(/\{title\}/g,encodeURIComponent(draft.identity?.title||slug));add(expanded,/art/i.test(expanded)?'artwork':/screen/i.test(expanded)?'screenshot':'gallery')}}
  for(const url of [`https://www.rpgfan.com/game/${slug}/`,`https://www.rpgfan.com/gallery/${slug}-screenshots/`,`https://www.rpgfan.com/gallery/${slug}-artwork/`,`https://www.ign.com/games/${slug}/images`])add(url,/artwork/.test(url)?'artwork':/screenshots/.test(url)?'screenshot':'gallery');
  return out.slice(0,24);
}
const initial=[];
for(const item of draft.media?.screenshots||[])initial.push({...(typeof item==='object'?item:{url:item}),declared_kind:'screenshot'});
for(const item of draft.media?.artwork||[])initial.push({...(typeof item==='object'?item:{url:item}),declared_kind:'artwork'});
for(const item of draft.media?.items||[])if(item?.url)initial.push({...item,declared_kind:item.kind||''});
const pageRows=[];
for(const page of sourcePages()){for(const row of await pageImages(page.url)){pageRows.push({...row,page_kind:page.kind});if(pageRows.length>=220)break}if(pageRows.length>=220)break}
const raw=[...initial,...pageRows].filter(item=>urlOf(item));
const urlSeen=new Set(),familySeen=new Set(),hashSeen=new Set();
const prepared=[];
for(const item of raw){const key=canonical(urlOf(item)),family=familyKey(urlOf(item));if(!key||urlSeen.has(key)||familySeen.has(family))continue;urlSeen.add(key);familySeen.add(family);prepared.push(item);if(prepared.length>=180)break}
const measured=await mapLimit(prepared,10,probe);
const screens=[],art=[];let ambiguous=0,duplicates=0;
for(const item of measured){if(hashSeen.has(item.content_hash)){duplicates++;continue}hashSeen.add(item.content_hash);const sourceUrl=item.source_url||'';let kind=classify({...item,kind:item.declared_kind||item.kind,caption:`${item.caption||''} ${item.context||''}`},sourceUrl);if(kind==='ambiguous'&&item.page_kind==='screenshot')kind='screenshot';if(kind==='ambiguous'&&item.page_kind==='artwork')kind='artwork';if(kind==='ambiguous'){ambiguous++;continue}
  const normalized={url:item.url,caption:item.caption||(kind==='screenshot'?`${draft.identity?.title||slug} — игровой кадр`:`${draft.identity?.title||slug} — арт`),source_url:sourceUrl,width:item.width,height:item.height,mime:item.mime,bytes:item.bytes,provider:item.provider||'verified-source-page',kind,asset_family:familyKey(item.url),content_hash:item.content_hash};
  if(kind==='screenshot'&&screens.length<maxScreens)screens.push(normalized);else if(kind==='artwork'&&art.length<maxArt)art.push(normalized);
}
if(screens.length<minScreens){write(`data/parser-runs/game-media-commercial-${slug}.json`,{parser:'game-media-commercial-v1',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),minimum_screenshots:minScreens,target_screenshots:targetScreens,screenshots:screens.length,artwork:art.length,ambiguous_rejected:ambiguous,duplicates_rejected:duplicates,reason:'not_enough_verified_unique_screenshots'});throw new Error(`${slug}: commercial media blocked — ${screens.length}/${minScreens} verified unique screenshots`)}
const finalScreens=screens.slice(0,targetScreens),finalArt=art.slice(0,targetArt);const other=(draft.media?.items||[]).filter(item=>!['screenshot','artwork','art'].includes(String(item?.kind||'').toLowerCase()));
draft.media={...(draft.media||{}),screenshots:finalScreens,artwork:finalArt,items:[...other,...finalScreens.map((item,i)=>({...item,id:`shot-${i+1}`,kind:'screenshot',origin:'verified_gameplay_media'})),...finalArt.map((item,i)=>({...item,id:`art-${i+1}`,kind:'artwork',origin:'verified_artwork'}))]};
draft.publication={...(draft.publication||{}),commercial_media_checked_at:new Date().toISOString(),commercial_media_ready:true};write(draftPath,draft);
write(`data/parser-runs/game-media-commercial-${slug}.json`,{parser:'game-media-commercial-v1',status:'green',game_slug:slug,checked_at:new Date().toISOString(),minimum_screenshots:minScreens,target_screenshots:targetScreens,total_screenshots:finalScreens.length,total_artwork:finalArt.length,ambiguous_rejected:ambiguous,duplicates_rejected:duplicates,policy:'Artwork and screenshots are separate pools. Only explicit gameplay/screenshot evidence may enter screenshots; URL variants, resized derivatives and byte-identical files are deduplicated.'});
console.log(JSON.stringify({slug,status:'green',screenshots:finalScreens.length,artwork:finalArt.length,ambiguous_rejected:ambiguous,duplicates_rejected:duplicates},null,2));
