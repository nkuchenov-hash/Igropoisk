import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/enrich-review-media.mjs <game-slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const exists=file=>fs.existsSync(path.join(root,file));
const articlePath=exists(`data/articles/${slug}.json`)?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
if(!exists(articlePath)||!exists(`data/drafts/${slug}.json`))throw new Error('Article and game draft are required');
const article=read(articlePath);
const game=read(`data/drafts/${slug}.json`);
const policy=read('config/parsers/review-media-policy.json');
const balance=policy.article_balance||{};
const quality=policy.quality_gate||{};
const sourcePolicy=policy.source_policy||{};
const minCandidates=Number(balance.minimum_candidate_screenshots||80);
const minApproved=Number(balance.minimum_approved_screenshots||40);
const minTotal=Number(balance.minimum_total_screenshots||30);
const minUnique=Number(balance.minimum_unique_screenshots||30);
const minPerSection=Number(balance.screenshots_per_section?.minimum||3);
const targetPerSection=Number(balance.screenshots_per_section?.target||4);
const maxPerSection=Number(balance.screenshots_per_section?.maximum||6);
const minSources=Number(sourcePolicy.minimum_media_sources||5);
const maxSourceShare=Number(sourcePolicy.maximum_share_from_one_source||0.35);
const historical=Number(game.identity?.release_year||game.release_year||0)<2010;
const minWidth=Number(historical?quality.minimum_width_historical:quality.minimum_width_modern)||1280;
const minHeight=Number(historical?quality.minimum_height_historical:quality.minimum_height_modern)||720;
const minConfidence=Number(quality.visual_quality_confidence||0.84);
const canonical=value=>{try{const u=new URL(value);u.hash='';return `${u.origin}${u.pathname}${u.search}`}catch{return String(value||'')}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};

function dimensions(buffer,type){
  if(type.includes('png')&&buffer.length>24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(type.includes('jpeg')||type.includes('jpg')){let i=2;while(i+9<buffer.length){if(buffer[i]!==0xff){i++;continue}const marker=buffer[i+1];const length=buffer.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};if(!length)break;i+=2+length}}
  if(type.includes('webp')&&buffer.length>30&&buffer.toString('ascii',12,16)==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)};
  return {width:0,height:0};
}
async function inspect(item){
  if(item.width&&item.height)return item;
  try{
    const response=await fetch(item.url,{redirect:'follow'});
    if(!response.ok)return item;
    const type=(response.headers.get('content-type')||'').toLowerCase();
    const buffer=Buffer.from(await response.arrayBuffer());
    return {...item,url:response.url,...dimensions(buffer,type),bytes:buffer.length};
  }catch{return item}
}

const raw=[];
function add(item,kind='screenshot'){
  const normalized=typeof item==='string'?{url:item}:item||{};
  if(!normalized.url||kind!=='screenshot'||raw.some(candidate=>canonical(candidate.url)===canonical(normalized.url)))return;
  const sourceUrl=normalized.source_url||game.links?.media_gallery||game.links?.store||'';
  raw.push({id:`shot-${raw.length+1}`,url:normalized.url,caption:normalized.caption||'Скриншот игры',source_url:sourceUrl,source_domain:host(sourceUrl)||host(normalized.url),source_name:normalized.source_name||host(sourceUrl)||host(normalized.url),width:Number(normalized.width||0),height:Number(normalized.height||0),visual_tags:normalized.visual_tags||[]});
}
for(const item of game.media?.items||[])add(item,item.kind);
for(const item of game.media?.screenshots||[])add(item,'screenshot');
const candidates=[];
for(const item of raw)candidates.push(await inspect(item));
const candidateSources=new Set(candidates.map(item=>item.source_domain).filter(Boolean));
if(candidates.length<minCandidates||candidateSources.size<minSources){write(`data/parser-runs/review-media-${slug}.json`,{status:'blocked',reason:'candidate_gate',required_candidates:minCandidates,found_candidates:candidates.length,required_sources:minSources,found_sources:candidateSources.size});process.exit(2)}

async function call(body){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  return JSON.parse(data.output_text);
}
const auditSchema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:candidates.length,maxItems:candidates.length,items:{type:'object',additionalProperties:false,required:['media_id','quality_passed','quality_confidence','sharpness','compression','readability','visible_subject','duplicate_group','problems'],properties:{media_id:{type:'string'},quality_passed:{type:'boolean'},quality_confidence:{type:'number'},sharpness:{type:'number'},compression:{type:'number'},readability:{type:'number'},visible_subject:{type:'string'},duplicate_group:{type:'string'},problems:{type:'array',items:{type:'string'}}}}}}};
const auditContent=[{type:'input_text',text:`Audit genuine screenshots for technical quality and correct game version. Reject blur, visible upscale, heavy compression, thumbnails, dominant watermarks, stretched aspect ratios, wrong versions, duplicate scenes and near-duplicate crops. Required size is at least ${minWidth}x${minHeight}. Old graphics are acceptable; bad image files are not.`}];
for(const item of candidates){auditContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nSIZE: ${item.width}x${item.height}\nSOURCE: ${item.source_domain}\nCAPTION: ${item.caption}`});auditContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const audit=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:auditContent}],text:{format:{type:'json_schema',name:'review_media_quality',strict:true,schema:auditSchema}}});
const auditMap=new Map(audit.results.map(result=>[result.media_id,result]));
const usedGroups=new Set();
const approved=candidates.filter(item=>{
  const result=auditMap.get(item.id);
  const group=result?.duplicate_group||item.id;
  const passed=Boolean(item.width>=minWidth&&item.height>=minHeight&&result?.quality_passed&&Number(result.quality_confidence)>=minConfidence&&Number(result.sharpness)>=0.68&&Number(result.compression)>=0.68&&Number(result.readability)>=0.62&&!usedGroups.has(group));
  if(passed)usedGroups.add(group);
  return passed;
});
const approvedSources=new Set(approved.map(item=>item.source_domain).filter(Boolean));
if(approved.length<minApproved||approvedSources.size<minSources){write(`data/parser-runs/review-media-${slug}.json`,{status:'blocked',reason:'quality_gate',approved:approved.length,required_approved:minApproved,sources:approvedSources.size,required_sources:minSources,audit});process.exit(2)}

const selectionSchema={type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:article.sections.length,maxItems:article.sections.length,items:{type:'object',additionalProperties:false,required:['section_id','media_ids','captions'],properties:{section_id:{type:'string'},media_ids:{type:'array',minItems:minPerSection,maxItems:maxPerSection,items:{type:'string'}},captions:{type:'array',minItems:minPerSection,maxItems:maxPerSection,items:{type:'string'}}}}}}};
const selectionContent=[{type:'input_text',text:`Assign ${minPerSection}-${maxPerSection} unique screenshots to every section, normally ${targetPerSection}. Never reuse an image or duplicate scene. Each image must show a different concrete aspect of the section. Write a useful caption explaining what is visible and why it matters.`}];
for(const section of article.sections)selectionContent.push({type:'input_text',text:`SECTION_ID: ${section.id}\nHEADING: ${section.heading}\nTEXT: ${(section.paragraphs||[]).join('\n')}`});
for(const item of approved){selectionContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nSOURCE: ${item.source_domain}\nVISIBLE: ${auditMap.get(item.id)?.visible_subject||item.caption}`});selectionContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const selection=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:selectionContent}],text:{format:{type:'json_schema',name:'review_section_carousels',strict:true,schema:selectionSchema}}});
const approvedMap=new Map(approved.map(item=>[item.id,item]));
const used=new Set();
for(const section of article.sections){
  const picked=selection.sections.find(item=>item.section_id===section.id)||{media_ids:[],captions:[]};
  const ids=picked.media_ids.filter(id=>approvedMap.has(id)&&!used.has(id)).slice(0,maxPerSection);
  while(ids.length<minPerSection){const fallback=approved.find(item=>!used.has(item.id)&&!ids.includes(item.id));if(!fallback)break;ids.push(fallback.id)}
  ids.forEach(id=>used.add(id));
  section.images=ids.map((id,index)=>{const item=approvedMap.get(id);const result=auditMap.get(id);return {url:item.url,alt:result.visible_subject||item.caption,caption:picked.captions[index]||item.caption,source_name:item.source_name||item.source_domain,source_url:item.source_url,width:item.width,height:item.height,duplicate_group:result.duplicate_group,quality:{confidence:result.quality_confidence,sharpness:result.sharpness,compression:result.compression,readability:result.readability}}});
  section.image=section.images[0]||null;
}
const images=article.sections.flatMap(section=>section.images||[]);
const uniqueUrls=new Set(images.map(item=>canonical(item.url)));
const sourceCounts=new Map();
for(const image of images){const domain=host(image.source_url)||host(image.url);sourceCounts.set(domain,(sourceCounts.get(domain)||0)+1)}
const largestShare=Math.max(0,...sourceCounts.values())/Math.max(1,images.length);
const passed=images.length>=minTotal&&uniqueUrls.size===images.length&&uniqueUrls.size>=minUnique&&sourceCounts.size>=minSources&&largestShare<=maxSourceShare&&article.sections.every(section=>(section.images||[]).length>=minPerSection);
article.schema_version=Math.max(Number(article.schema_version||4),7);
article.media_gate={candidate_required:minCandidates,candidate_found:candidates.length,approved_required:minApproved,approved_found:approved.length,total_required:minTotal,total_found:images.length,unique_required:minUnique,unique_found:uniqueUrls.size,source_required:minSources,source_found:sourceCounts.size,largest_source_share:largestShare,maximum_source_share:maxSourceShare,passed};
article.validation={...(article.validation||{}),media_quality_audit:audit,total_article_images:images.length,unique_article_images:uniqueUrls.size};
if(!passed)article.publication_status='blocked';
const output=passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
write(output,article);
write(`data/article-media/${slug}.json`,{schema_version:2,game_slug:slug,sections:article.sections.map(section=>({id:section.id,images:section.images||[]}))});
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-audit',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),gate:article.media_gate,output});
console.log(JSON.stringify({slug,...article.media_gate},null,2));
if(!passed)process.exitCode=2;
