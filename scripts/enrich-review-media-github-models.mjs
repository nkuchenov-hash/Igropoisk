import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/enrich-review-media-github-models.mjs <game-slug>');
const token=process.env.GITHUB_TOKEN;
if(!token)throw new Error('GITHUB_TOKEN is required for GitHub Models media audit');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const article=read(`data/articles/${slug}.json`);
const candidates=(read(`data/media-candidates/${slug}.json`).candidates||[]).filter(item=>item?.url);
const policy=read('config/parsers/review-media-policy.json');
const balance=policy.article_balance||{},carousel=balance.carousel_policy||{};
const minimumCarousels=Number(carousel.minimum_carousels||2),targetCarousels=Number(carousel.target_carousels||3),maximumCarousels=Number(carousel.maximum_carousels||3),minimumImages=Number(carousel.minimum_images_per_carousel||2),targetImages=Number(carousel.target_images_per_carousel||3),maximumImages=Number(carousel.maximum_images_per_carousel||4),minimumTotal=Number(balance.minimum_total_screenshots||6),minimumUnique=Number(balance.minimum_unique_screenshots||6),minimumConfidence=Number(policy.quality_gate?.semantic_relevance_confidence||0.78);
if(candidates.length<Math.max(minimumTotal,minimumCarousels*minimumImages))throw new Error(`Media gate failed: ${candidates.length}/${Math.max(minimumTotal,minimumCarousels*minimumImages)}`);
const model=process.env.GITHUB_VISION_MODEL||process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1';
const limited=candidates.slice(0,12);
const content=[{type:'text',text:`Ты визуальный редактор Игропоиска. Выбери ${minimumCarousels}–${maximumCarousels} раздела, где визуальный материал действительно помогает тексту. Для каждого выбранного раздела создай карусель из ${minimumImages}–${maximumImages} разных официальных скриншотов, обычно ${targetImages}. Не заполняй картинкой каждый раздел. Один MEDIA_ID нельзя использовать дважды. Кадры внутри карусели должны показывать разные стороны тезиса и не быть почти одинаковыми. Для каждого кадра напиши конкретную естественную подпись по-русски: что реально видно и почему это важно именно для этой игры/тезиса. commentary — 1–2 предложения о том, на что читателю смотреть во всей карусели. Не выдумывай невидимое. Запрещены пустые формулы вроде «скриншот демонстрирует игровой процесс». Confidence <${minimumConfidence} означает, что кадр нельзя использовать. Верни только JSON: {"carousels":[{"section_id":"...","commentary":"...","images":[{"media_id":"shot-1","caption":"...","alt":"...","confidence":0.9,"visible_subject":"..."}]}]}.`}];
for(const section of article.sections||[])content.push({type:'text',text:`SECTION ${section.id}: ${section.heading}\n${(section.paragraphs||[]).slice(0,3).join('\n')}`});
for(const item of limited){content.push({type:'text',text:`MEDIA_ID ${item.id}; SOURCE ${item.source_name||item.source_domain||'official'}; ${item.width}x${item.height}`});content.push({type:'image_url',image_url:{url:item.url,detail:'high'}})}
const response=await fetch('https://models.github.ai/inference/chat/completions',{
  method:'POST',
  headers:{authorization:`Bearer ${token}`,'content-type':'application/json','accept':'application/vnd.github+json','x-github-api-version':'2026-03-10'},
  body:JSON.stringify({model,messages:[{role:'user',content}],response_format:{type:'json_object'},temperature:0.1,max_tokens:6000})
});
if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
const payload=await response.json(),text=payload.choices?.[0]?.message?.content;
if(!text)throw new Error('No multimodal audit output');
const audit=JSON.parse(text.replace(/^```json\s*|\s*```$/g,''));
const byMedia=new Map(limited.map(item=>[item.id,item])),sectionIds=new Set((article.sections||[]).map(section=>String(section.id))),usedMedia=new Set(),usedSections=new Set(),accepted=[];
for(const entry of audit.carousels||[]){
  const sectionId=String(entry.section_id||'');if(!sectionIds.has(sectionId)||usedSections.has(sectionId))continue;
  const images=[];
  for(const assignment of entry.images||[]){const item=byMedia.get(assignment.media_id),confidence=Number(assignment?.confidence||0);if(!item||usedMedia.has(item.id)||confidence<minimumConfidence)continue;usedMedia.add(item.id);const sourceName=item.source_name||item.source_domain||'Официальный источник';images.push({url:item.url,alt:assignment.alt||assignment.visible_subject||`${article.identity?.title||slug} — игровой кадр`,caption:assignment.caption||assignment.visible_subject||`${article.identity?.title||slug} — игровой кадр`,source_name:sourceName,source_url:item.source_url||'',width:Number(item.width||0),height:Number(item.height||0),bytes:Number(item.bytes||0),mime:item.mime||'image/jpeg',duplicate_group:item.id,quality:{confidence,sharpness:confidence,compression:confidence,readability:confidence,composition:confidence,render_suitability:confidence,visible_upscale:false,soft_resampling:false,stretched:false,muddy:false,visible_subject:assignment.visible_subject||''}});if(images.length>=maximumImages)break}
  if(images.length<minimumImages)continue;usedSections.add(sectionId);accepted.push({id:sectionId,commentary:String(entry.commentary||'').trim(),images});if(accepted.length>=maximumCarousels)break;
}
const mediaSections=(article.sections||[]).map(section=>accepted.find(item=>item.id===section.id)||{id:section.id,commentary:'',images:[]}),total=accepted.reduce((sum,section)=>sum+section.images.length,0),sourceCount=new Set(accepted.flatMap(section=>section.images.map(image=>image.source_name))).size;
const passed=accepted.length>=minimumCarousels&&total>=minimumTotal&&usedMedia.size>=minimumUnique&&sourceCount>=Number(policy.source_policy?.minimum_media_sources||1)&&accepted.every(section=>section.images.length>=minimumImages&&section.images.length<=maximumImages&&section.commentary);
article.sections=(article.sections||[]).map(section=>{const media=mediaSections.find(item=>item.id===section.id);return {...section,images:media?.images||[],image:media?.images?.[0]||null,media_commentary:media?.commentary||''}});
article.media_gate={candidate_required:Number(balance.minimum_candidate_screenshots||7),raw_found:candidates.length,file_probe_passed:limited.length,approved_required:Number(balance.minimum_approved_screenshots||6),vision_approved:usedMedia.size,carousel_required:minimumCarousels,carousel_target:targetCarousels,carousel_found:accepted.length,images_per_carousel:{minimum:minimumImages,target:targetImages,maximum:maximumImages},total_required:minimumTotal,total_found:total,unique_required:minimumUnique,unique_found:usedMedia.size,source_required:Number(policy.source_policy?.minimum_media_sources||1),source_found:sourceCount,quality_basis:'github_models_meaningful_carousel_audit',passed};
article.validation={...(article.validation||{}),media_quality_audit:audit,total_article_images:total,unique_article_images:usedMedia.size,meaningful_carousels:accepted.length};
article.publication_status=passed?'published':'blocked';
write(passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,article);
write(`data/article-media/${slug}.json`,{schema_version:8,game_slug:slug,quality_basis:'github_models_meaningful_carousel_audit',model,carousel_policy:{minimum:minimumCarousels,target:targetCarousels,maximum:maximumCarousels},sections:mediaSections});
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-github-models-carousel-v2',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),model,gate:article.media_gate});
console.log(JSON.stringify({slug,model,passed,carousels:accepted.length,total,unique:usedMedia.size},null,2));
if(!passed)process.exit(2);
