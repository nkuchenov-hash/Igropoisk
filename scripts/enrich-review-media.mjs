import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/enrich-review-media.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=file=>fs.existsSync(path.join(root,file));
const articlePath=exists(`data/articles/${slug}.json`)?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
if(!exists(articlePath)||!exists(`data/drafts/${slug}.json`)){console.error('Article and verified game media are required');process.exit(1)}

const article=read(articlePath);
const game=read(`data/drafts/${slug}.json`);
const synthesis=read('config/parsers/review-synthesis.json');
const mediaPolicy=exists('config/parsers/review-media-policy.json')?read('config/parsers/review-media-policy.json'):{};
const balance=mediaPolicy.article_balance||{};
const qualityPolicy=mediaPolicy.quality_gate||{};
const sourcePolicy=mediaPolicy.source_policy||{};
const minCandidates=Number(balance.minimum_candidate_screenshots||30);
const minApproved=Number(balance.minimum_approved_screenshots||18);
const minTotal=Number(balance.minimum_total_screenshots||18);
const minUnique=Number(balance.minimum_unique_screenshots||12);
const minPerSection=Number(balance.screenshots_per_section?.minimum||2);
const targetPerSection=Number(balance.screenshots_per_section?.target||3);
const maxPerSection=Number(balance.screenshots_per_section?.maximum||5);
const minSources=Number(sourcePolicy.minimum_media_sources||3);
const minConfidence=Number(qualityPolicy.visual_quality_confidence||0.78);
const minWidth=Number(game.identity?.release_year<2010?qualityPolicy.minimum_width_historical||1024:qualityPolicy.minimum_width_modern||1280);
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';return `${u.origin}${u.pathname}${u.search}`}catch{return String(value||'')}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};

const candidates=[];
const add=(item,kind='screenshot')=>{
  const normalized=typeof item==='string'?{url:item}:item||{};
  if(!normalized.url||kind!=='screenshot'||candidates.some(candidate=>canonical(candidate.url)===canonical(normalized.url)))return;
  const sourceUrl=normalized.source_url||game.links?.media_gallery||game.links?.store||'';
  candidates.push({id:`shot-${candidates.length+1}`,url:normalized.url,caption:normalized.caption||'Скриншот игры',source_url:sourceUrl,source_domain:host(sourceUrl)||host(normalized.url),width:Number(normalized.width||0),height:Number(normalized.height||0),visual_tags:normalized.visual_tags||[]});
};
if(Array.isArray(game.media?.items))for(const item of game.media.items)add(item,item.kind);
for(const item of game.media?.screenshots||[])add(item,'screenshot');

const candidateSources=new Set(candidates.map(item=>item.source_domain).filter(Boolean));
if(candidates.length<minCandidates||candidateSources.size<minSources){
  const log={parser:'review-media-audit',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),candidate_gate:{required:minCandidates,found:candidates.length},source_gate:{required:minSources,found:candidateSources.size,sources:[...candidateSources]},note:'The game-data/media parser must collect dozens of screenshots from several independent galleries before article enrichment.'};
  write(`data/parser-runs/review-media-${slug}.json`,log);
  console.error(`Media discovery gate failed: ${candidates.length}/${minCandidates} candidates, ${candidateSources.size}/${minSources} sources`);
  process.exit(2);
}

async function call(body){const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}

const auditSchema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:candidates.length,maxItems:candidates.length,items:{type:'object',additionalProperties:false,required:['media_id','quality_passed','quality_confidence','sharpness','compression','readability','visible_subject','duplicate_group','problems'],properties:{media_id:{type:'string'},quality_passed:{type:'boolean'},quality_confidence:{type:'number'},sharpness:{type:'number'},compression:{type:'number'},readability:{type:'number'},visible_subject:{type:'string'},duplicate_group:{type:'string'},problems:{type:'array',items:{type:'string'}}}}}}};
const qualityContent=[{type:'input_text',text:`Проведи строгую техническую и содержательную проверку скриншотов. Отклоняй миниатюры, размытие, тяжёлые JPEG-артефакты, заметный апскейл, неверную версию игры и почти одинаковые кадры. Старая графика допустима, плохой файл нет. Для исторической игры целевая ширина не ниже ${minWidth}px. duplicate_group должен объединять одинаковую сцену или почти одинаковую композицию.`}];
for(const item of candidates){qualityContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nDECLARED_SIZE: ${item.width||'?'}x${item.height||'?'}\nSOURCE: ${item.source_domain}\nCAPTION: ${item.caption}\nTAGS: ${item.visual_tags.join(', ')}`});qualityContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const qualityAudit=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:qualityContent}],text:{format:{type:'json_schema',name:'igropoisk_media_quality_audit',strict:true,schema:auditSchema}}});
const auditMap=new Map(qualityAudit.results.map(result=>[result.media_id,result]));
const seenGroups=new Set();
const approved=candidates.filter(candidate=>{
  const audit=auditMap.get(candidate.id);
  const sizePassed=!candidate.width||candidate.width>=minWidth;
  const group=audit?.duplicate_group||candidate.id;
  const passed=audit?.quality_passed===true&&Number(audit.quality_confidence)>=minConfidence&&Number(audit.sharpness)>=0.62&&Number(audit.compression)>=0.6&&Number(audit.readability)>=0.58&&sizePassed&&!seenGroups.has(group);
  if(passed)seenGroups.add(group);
  return passed;
});
const approvedSources=new Set(approved.map(item=>item.source_domain).filter(Boolean));
if(approved.length<minApproved||approvedSources.size<minSources){
  write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-audit',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),candidate_count:candidates.length,approved_count:approved.length,required_approved:minApproved,approved_sources:[...approvedSources],required_sources:minSources,quality_audit:qualityAudit});
  console.error(`Quality media gate failed: ${approved.length}/${minApproved} approved, ${approvedSources.size}/${minSources} sources`);
  process.exit(2);
}

const selectionSchema={type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:article.sections.length,maxItems:article.sections.length,items:{type:'object',additionalProperties:false,required:['section_id','media_ids','captions'],properties:{section_id:{type:'string'},media_ids:{type:'array',minItems:minPerSection,maxItems:maxPerSection,items:{type:'string'}},captions:{type:'array',minItems:minPerSection,maxItems:maxPerSection,items:{type:'string'}}}}}}};
const selectionContent=[{type:'input_text',text:`Подбери для каждого раздела ${minPerSection}-${maxPerSection} разных скриншотов, обычно ${targetPerSection}. Каждый кадр должен показывать отдельную деталь темы. Не повторяй кадры между разделами. Напиши к каждому кадру конкретную подпись: что видно и как это подтверждает тезис раздела. Используй только одобренные MEDIA_ID.`}];
for(const section of article.sections)selectionContent.push({type:'input_text',text:`SECTION_ID: ${section.id}\nHEADING: ${section.heading}\nTEXT: ${(section.paragraphs||[]).join('\n')}`});
for(const item of approved){selectionContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nSOURCE: ${item.source_domain}\nVISIBLE_SUBJECT: ${auditMap.get(item.id)?.visible_subject||item.caption}`});selectionContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const selection=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:selectionContent}],text:{format:{type:'json_schema',name:'igropoisk_section_carousels',strict:true,schema:selectionSchema}}});
const approvedMap=new Map(approved.map(item=>[item.id,item]));
const used=new Set();
for(const section of article.sections){
  const picked=selection.sections.find(item=>item.section_id===section.id)||{media_ids:[],captions:[]};
  const ids=picked.media_ids.filter(id=>approvedMap.has(id)&&!used.has(id)).slice(0,maxPerSection);
  while(ids.length<minPerSection){const fallback=approved.find(item=>!used.has(item.id)&&!ids.includes(item.id));if(!fallback)break;ids.push(fallback.id)}
  ids.forEach(id=>used.add(id));
  section.images=ids.map((id,index)=>{const item=approvedMap.get(id);const audit=auditMap.get(id);return {url:item.url,alt:audit?.visible_subject||item.caption,caption:picked.captions[index]||item.caption,source_name:item.source_domain||'Источник изображения',source_url:item.source_url,width:item.width||null,height:item.height||null,quality:{confidence:audit.quality_confidence,sharpness:audit.sharpness,compression:audit.compression,readability:audit.readability}}});
  section.image=section.images[0]||section.image;
}
const allImages=article.sections.flatMap(section=>section.images||[]);
const totalImages=allImages.length;
const uniqueImages=new Set(allImages.map(item=>canonical(item.url))).size;
const usedMediaSources=new Set(allImages.map(item=>host(item.source_url)).filter(Boolean));
const passed=totalImages>=minTotal&&uniqueImages>=minUnique&&usedMediaSources.size>=minSources&&article.sections.every(section=>(section.images?.length||0)>=minPerSection);
article.schema_version=Math.max(Number(article.schema_version||4),6);
article.media_gate={candidate_required:minCandidates,candidate_found:candidates.length,approved_required:minApproved,approved_found:approved.length,total_required:minTotal,total_found:totalImages,unique_required:minUnique,unique_found:uniqueImages,source_required:minSources,source_found:usedMediaSources.size,passed};
article.validation={...(article.validation||{}),media_quality_audit:qualityAudit,total_article_images:totalImages,unique_article_images:uniqueImages};
if(!passed)article.publication_status='blocked';
const output=passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
write(output,article);
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-audit',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),gate:article.media_gate,output});
console.log(JSON.stringify({slug,...article.media_gate},null,2));
if(!passed)process.exitCode=2;
