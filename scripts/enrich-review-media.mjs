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
const config=read('config/parsers/review-synthesis.json');
const policy=config.media_quality_policy||{};
const minTotal=Number(policy.minimum_total_article_images||12);
const minConfidence=Number(policy.minimum_quality_confidence||0.78);
const maxPerSection=Number(policy.maximum_images_per_section||3);
const longSectionWords=Number(policy.long_section_words||260);
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';return `${u.origin}${u.pathname}${u.search}`}catch{return String(value||'')}};

const candidates=[];
const add=(item,kind='screenshot')=>{
  const normalized=typeof item==='string'?{url:item}:item||{};
  if(!normalized.url||kind!=='screenshot'||candidates.some(candidate=>canonical(candidate.url)===canonical(normalized.url)))return;
  candidates.push({id:`shot-${candidates.length+1}`,url:normalized.url,caption:normalized.caption||'Скриншот игры',source_url:normalized.source_url||game.links?.media_gallery||game.links?.store||'',visual_tags:normalized.visual_tags||[]});
};
if(Array.isArray(game.media?.items))for(const item of game.media.items)add(item,item.kind);
for(const item of game.media?.screenshots||[])add(item,'screenshot');
if(candidates.length<minTotal){console.error(`Not enough candidate screenshots: ${candidates.length}/${minTotal}`);process.exit(2)}

async function call(body){
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json();
  const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
  if(!text)throw new Error('No structured output');
  return JSON.parse(text);
}

const auditSchema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:candidates.length,maxItems:candidates.length,items:{type:'object',additionalProperties:false,required:['media_id','quality_passed','quality_confidence','sharpness','compression','readability','visible_subject','problems'],properties:{media_id:{type:'string'},quality_passed:{type:'boolean'},quality_confidence:{type:'number'},sharpness:{type:'number'},compression:{type:'number'},readability:{type:'number'},visible_subject:{type:'string'},problems:{type:'array',items:{type:'string'}}}}}}};
const qualityContent=[{type:'input_text',text:'Проведи строгую техническую проверку скриншотов игры. Оцени реальное качество изображения, а не художественное качество старой графики. Отклоняй миниатюры, сильное размытие, JPEG-блоки, апскейл с артефактами, нечитаемый интерфейс и кадры, которые плохо выдерживают показ на всю ширину статьи. Старая графика допустима, плохой файл — нет. sharpness, compression и readability: 0..1, где 1 — хорошо.'}];
for(const item of candidates){qualityContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nCAPTION: ${item.caption}\nTAGS: ${item.visual_tags.join(', ')}`});qualityContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const qualityAudit=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:qualityContent}],text:{format:{type:'json_schema',name:'igropoisk_media_quality_audit',strict:true,schema:auditSchema}}});
const auditMap=new Map(qualityAudit.results.map(result=>[result.media_id,result]));
const approved=candidates.filter(candidate=>{const audit=auditMap.get(candidate.id);return audit?.quality_passed===true&&Number(audit.quality_confidence)>=minConfidence&&Number(audit.sharpness)>=0.62&&Number(audit.compression)>=0.6&&Number(audit.readability)>=0.58});
if(approved.length<minTotal){
  const log={parser:'review-media-audit',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),required:minTotal,approved:approved.length,rejected:candidates.length-approved.length,quality_audit:qualityAudit};
  write(`data/parser-runs/review-media-${slug}.json`,log);
  console.error(`Quality media gate failed: ${approved.length}/${minTotal}`);
  process.exit(2);
}

const selectionSchema={type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:article.sections.length,maxItems:article.sections.length,items:{type:'object',additionalProperties:false,required:['section_id','media_ids'],properties:{section_id:{type:'string'},media_ids:{type:'array',minItems:1,maxItems:maxPerSection,items:{type:'string'}}}}}}};
const selectionContent=[{type:'input_text',text:`Подбери для каждого раздела обзорной статьи релевантную галерею. Длинному разделу от ${longSectionWords} слов обычно нужны 2–3 разных кадра; короткому — 1–2. Не повторяй один кадр в разных разделах. Каждый выбранный кадр должен буквально показывать тему раздела. Используй только MEDIA_ID из одобренного списка.`}];
for(const section of article.sections){selectionContent.push({type:'input_text',text:`SECTION_ID: ${section.id}\nHEADING: ${section.heading}\nTEXT: ${(section.paragraphs||[]).join('\n')}`})}
for(const item of approved){selectionContent.push({type:'input_text',text:`MEDIA_ID: ${item.id}\nCAPTION: ${item.caption}\nVISIBLE_SUBJECT: ${auditMap.get(item.id)?.visible_subject||''}`});selectionContent.push({type:'input_image',image_url:item.url,detail:'high'})}
const selection=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content:selectionContent}],text:{format:{type:'json_schema',name:'igropoisk_section_galleries',strict:true,schema:selectionSchema}}});
const approvedMap=new Map(approved.map(item=>[item.id,item]));
const used=new Set();
for(const section of article.sections){
  const selected=selection.sections.find(item=>item.section_id===section.id)?.media_ids||[];
  const desired=countWords((section.paragraphs||[]).join(' '))>=longSectionWords?Math.min(3,maxPerSection):Math.min(2,maxPerSection);
  const unique=selected.filter(id=>approvedMap.has(id)&&!used.has(id)).slice(0,desired);
  if(!unique.length){
    const fallback=approved.find(item=>!used.has(item.id));
    if(fallback)unique.push(fallback.id);
  }
  unique.forEach(id=>used.add(id));
  section.images=unique.map(id=>{const item=approvedMap.get(id);const audit=auditMap.get(id);return {url:item.url,alt:audit?.visible_subject||item.caption,caption:item.caption,source_name:'Проверенный скриншот',source_url:item.source_url,quality:{confidence:audit.quality_confidence,sharpness:audit.sharpness,compression:audit.compression,readability:audit.readability}}});
  section.image=section.images[0]||section.image;
}
const totalImages=article.sections.reduce((sum,section)=>sum+(section.images?.length||0),0);
const passed=totalImages>=minTotal&&article.sections.every(section=>(section.images?.length||0)>=1);
article.schema_version=Math.max(Number(article.schema_version||4),5);
article.media_gate={required_total:minTotal,accepted_total:totalImages,approved_pool:approved.length,rejected_pool:candidates.length-approved.length,passed};
article.validation={...(article.validation||{}),media_quality_audit:qualityAudit,total_article_images:totalImages};
if(!passed)article.publication_status='blocked';
write(passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,article);
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-audit',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),required:minTotal,approved_pool:approved.length,total_article_images:totalImages,output:passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`});
console.log(JSON.stringify({slug,approved_pool:approved.length,total_article_images:totalImages,passed},null,2));
if(!passed)process.exitCode=2;
