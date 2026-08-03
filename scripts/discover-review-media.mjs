import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/discover-review-media.mjs <game-slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,data)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const draft=read(draftPath);
const policy=read('config/parsers/review-media-policy.json');
const balance=policy.article_balance||{};
const quality=policy.quality_gate||{};
const identity=draft.identity||{};
const title=identity.title||draft.title||slug;
const year=Number(identity.release_year||draft.release_year||0);
const platform=(identity.platforms||draft.platforms||[]).join(' ');
const historical=year>0&&year<2010;
const minWidth=Number(historical?quality.minimum_width_historical:quality.minimum_width_modern)||1280;
const minHeight=Number(historical?quality.minimum_height_historical:quality.minimum_height_modern)||720;
const minBytes=Number(historical?quality.minimum_bytes_historical:quality.minimum_bytes_modern)||80000;
const maxBytes=Number(quality.maximum_download_bytes||25000000);
const topics=['gameplay','locations','characters','combat','vehicles','interface map','missions','official screenshots','high resolution screenshots','original version screenshots'];
const queries=topics.map(topic=>`${title} ${year||''} ${platform} ${topic}`.trim());

async function responseJson(body){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  return JSON.parse(data.output_text);
}

function dimensions(buffer,type){
  if(type.includes('png')&&buffer.length>24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(type.includes('jpeg')||type.includes('jpg')){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff){i++;continue}const marker=buffer[i+1];const length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};if(!length)break;i+=2+length}}
  if(type.includes('webp')&&buffer.length>30&&buffer.toString('ascii',12,16)==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
  return {width:0,height:0};
}
async function probe(item){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(item.url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'IgropoiskMediaAudit/1.0'}});
    if(!response.ok)return {...item,probe_passed:false,reject_reason:`http_${response.status}`};
    const type=(response.headers.get('content-type')||'').toLowerCase();
    if(!type.startsWith('image/'))return {...item,probe_passed:false,reject_reason:'not_image',mime:type};
    const declared=Number(response.headers.get('content-length')||0);
    if(declared&&declared>maxBytes)return {...item,probe_passed:false,reject_reason:'file_too_large',bytes:declared,mime:type};
    const buffer=Buffer.from(await response.arrayBuffer());
    const measured=dimensions(buffer,type);
    const aspect=measured.width&&measured.height?measured.width/measured.height:0;
    const validAspect=aspect>=1.2&&aspect<=2.4;
    const passed=measured.width>=minWidth&&measured.height>=minHeight&&buffer.length>=minBytes&&validAspect;
    return {...item,url:response.url,mime:type,bytes:buffer.length,width:measured.width,height:measured.height,aspect_ratio:aspect,probe_passed:passed,reject_reason:passed?null:(!measured.width||!measured.height?'unknown_dimensions':measured.width<minWidth||measured.height<minHeight?'below_resolution':buffer.length<minBytes?'file_too_small':'invalid_aspect_ratio')};
  }catch(error){return {...item,probe_passed:false,reject_reason:error.name==='AbortError'?'timeout':'download_failed'} }
  finally{clearTimeout(timer)}
}

const schema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:30,maxItems:160,items:{type:'object',additionalProperties:false,required:['url','source_url','source_name','caption','visual_tags'],properties:{url:{type:'string'},source_url:{type:'string'},source_name:{type:'string'},caption:{type:'string'},visual_tags:{type:'array',items:{type:'string'}}}}}}};
const result=await responseJson({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search'}],input:`Find direct URLs to a large and varied set of genuine screenshots for ${title} (${year}, ${platform}). Use official galleries, professional publications, historical game databases and image-result pages. Prefer the largest original file. Exclude covers, artwork, logos, fan art, remakes and sequels. Search intents: ${queries.join(' | ')}. Return direct jpg, jpeg, png or webp URLs and their source pages.`,text:{format:{type:'json_schema',name:'review_media_candidates',strict:true,schema}}});

const seen=new Set();
const raw=[];
for(const item of result.candidates){
  try{const url=new URL(item.url);url.hash='';const key=url.toString();if(seen.has(key))continue;seen.add(key);raw.push({...item,kind:'screenshot'});}catch{}
}
const measured=[];
for(let i=0;i<raw.length;i+=8){const batch=raw.slice(i,i+8);measured.push(...await Promise.all(batch.map(probe)))}
const candidates=measured.filter(item=>item.probe_passed);
const rejected=measured.filter(item=>!item.probe_passed).map(item=>({url:item.url,source_url:item.source_url,reason:item.reject_reason,width:item.width||0,height:item.height||0,bytes:item.bytes||0,mime:item.mime||''}));
write(`data/media-candidates/${slug}.json`,{schema_version:2,game_slug:slug,queries,found_raw:raw.length,found_measured:measured.length,approved_by_file_probe:candidates.length,rejected_count:rejected.length,requirements:{min_width:minWidth,min_height:minHeight,min_bytes:minBytes},candidates,rejected});
draft.media=draft.media||{};
const nonScreenshots=(draft.media.items||[]).filter(item=>item.kind!=='screenshot');
draft.media.items=[...nonScreenshots,...candidates];
write(draftPath,draft);
console.log(JSON.stringify({slug,raw:raw.length,measured:measured.length,approved:candidates.length,rejected:rejected.length},null,2));
if(candidates.length<Number(balance.minimum_candidate_screenshots||80))process.exitCode=2;
