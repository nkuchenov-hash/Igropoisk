import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/discover-review-media.mjs <game-slug>');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);
const policy=read('config/parsers/review-media-policy.json');
const quality=policy.quality_gate||{};
const balance=policy.article_balance||{};
const minCandidates=Math.max(1,Number(balance.minimum_candidate_screenshots||7));
const minWidth=Number(quality.minimum_width_historical||quality.minimum_width_modern||480);
const minHeight=Number(quality.minimum_height_historical||quality.minimum_height_modern||270);
const minBytes=Number(quality.minimum_bytes_historical||quality.minimum_bytes_modern||25000);
const maxBytes=Number(quality.maximum_download_bytes||25000000);
const canonical=value=>{try{const url=new URL(value);url.hash='';return `${url.origin}${url.pathname}${url.search}`}catch{return String(value||'')}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const urlOf=item=>typeof item==='string'?item:String(item?.url||'');

function dimensions(buffer,type){
  if(type.includes('png')&&buffer.length>24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(type.includes('jpeg')||type.includes('jpg')){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff){i++;continue}const marker=buffer[i+1];const length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};if(!length)break;i+=2+length}}
  if(type.includes('webp')&&buffer.length>30&&buffer.toString('ascii',12,16)==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
  return {width:0,height:0};
}
async function probe(item){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(item.url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 IgropoiskMediaAudit/3.0'}});
    if(!response.ok)return null;
    const mime=(response.headers.get('content-type')||'').toLowerCase();
    if(!mime.startsWith('image/'))return null;
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>maxBytes||buffer.length<minBytes)return null;
    const measured=dimensions(buffer,mime);
    if(measured.width<minWidth||measured.height<minHeight)return null;
    return {...item,url:response.url,mime,bytes:buffer.length,width:measured.width,height:measured.height,aspect_ratio:measured.width/measured.height,file_probe_passed:true};
  }catch{return null}finally{clearTimeout(timer)}
}

const candidates=[];
const seen=new Set();
const add=(item,origin='official_game_media')=>{
  const url=urlOf(item);const key=canonical(url);if(!url||seen.has(key))return;seen.add(key);
  const sourceUrl=typeof item==='object'&&item?.source_url?item.source_url:(draft.links?.store||draft.links?.official||'');
  candidates.push({id:`shot-${candidates.length+1}`,url,kind:'screenshot',caption:typeof item==='object'&&item?.caption?item.caption:`${draft.identity?.title||slug} — игровой кадр`,source_url:sourceUrl,source_name:host(sourceUrl)||'Официальный источник',source_domain:host(sourceUrl)||host(url),visual_tags:[],origin});
};
for(const item of draft.media?.screenshots||[])add(item);
for(const item of draft.media?.items||[])if(item?.kind==='screenshot')add(item);

const measured=[];
for(let i=0;i<candidates.length;i+=6)measured.push(...await Promise.all(candidates.slice(i,i+6).map(probe)));
const approved=measured.filter(Boolean);
write(`data/media-candidates/${slug}.json`,{schema_version:4,game_slug:slug,discovery_mode:'verified_official_media_first',approved_count:approved.length,required_candidates:minCandidates,candidates:approved});
if(approved.length<minCandidates){
  write(`data/parser-runs/review-media-discovery-${slug}.json`,{parser:'review-media-discovery',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),required:minCandidates,approved:approved.length,reason:'not_enough_verified_game_specific_screenshots'});
  console.error(`${slug}: only ${approved.length}/${minCandidates} verified game-specific screenshots`);
  process.exit(2);
}
draft.media=draft.media||{};
const nonScreenshots=(draft.media.items||[]).filter(item=>item.kind!=='screenshot');
draft.media.items=[...nonScreenshots,...approved];
write(draftPath,draft);
write(`data/parser-runs/review-media-discovery-${slug}.json`,{parser:'review-media-discovery',status:'success',game_slug:slug,checked_at:new Date().toISOString(),required:minCandidates,approved:approved.length,mode:'verified_official_media_first'});
console.log(JSON.stringify({slug,mode:'verified_official_media_first',approved:approved.length,required:minCandidates},null,2));
