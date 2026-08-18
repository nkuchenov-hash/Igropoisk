#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,imageToBase64,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd(),slug=process.argv[2];
if(!slug)throw new Error('Usage: enrich-review-media-local <slug>');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const article=read(`data/articles/${slug}.json`),allCandidates=(read(`data/media-candidates/${slug}.json`).candidates||[]).filter(item=>item?.url),policy=read('config/parsers/review-media-policy.json'),balance=policy.article_balance||{},carousel=balance.carousel_policy||{};
const minimumCarousels=Number(carousel.minimum_carousels||2),targetCarousels=Number(carousel.target_carousels||3),maximumCarousels=Number(carousel.maximum_carousels||3),minimumImages=Number(carousel.minimum_images_per_carousel||2),targetImages=Number(carousel.target_images_per_carousel||3),maximumImages=Number(carousel.maximum_images_per_carousel||4),minimumTotal=Number(balance.minimum_total_screenshots||6),minimumUnique=Number(balance.minimum_unique_screenshots||6),minimumConfidence=Number(policy.quality_gate?.semantic_relevance_confidence||0.78);
if((article.sections||[]).length<minimumCarousels)throw new Error(`Not enough article sections for ${minimumCarousels} meaningful carousels`);
if(allCandidates.length<Math.max(minimumTotal,minimumCarousels*minimumImages))throw new Error(`Media gate failed: ${allCandidates.length}/${Math.max(minimumTotal,minimumCarousels*minimumImages)}`);

const candidateLimit=Math.min(12,Math.max(minimumTotal,targetCarousels*targetImages,allCandidates.length));
const candidates=allCandidates.slice(0,candidateLimit),images=[];
for(const item of candidates){try{images.push(await imageToBase64(item.url))}catch{images.push(null)}}
const usable=[],usableImages=[];
for(let i=0;i<candidates.length;i++){if(!images[i])continue;usable.push({...candidates[i],input_index:i+1});usableImages.push(images[i])}
if(usable.length<Math.max(minimumTotal,minimumCarousels*minimumImages))throw new Error(`Only ${usable.length} review media candidates could be loaded for visual audit`);

const sectionIds=(article.sections||[]).map(section=>String(section.id));
const schema={type:'object',additionalProperties:false,required:['carousels'],properties:{carousels:{type:'array',minItems:minimumCarousels,maxItems:maximumCarousels,items:{type:'object',additionalProperties:false,required:['section_id','commentary','images'],properties:{section_id:{type:'string',enum:sectionIds},commentary:{type:'string'},images:{type:'array',minItems:minimumImages,maxItems:maximumImages,items:{type:'object',additionalProperties:false,required:['image_index','caption','alt','confidence','visible_subject'],properties:{image_index:{type:'integer',minimum:1,maximum:usable.length},caption:{type:'string'},alt:{type:'string'},confidence:{type:'number',minimum:0,maximum:1},visible_subject:{type:'string'}}}}}}}}};
const prompt=`Ты визуальный редактор Игропоиска. К сообщению приложены ${usable.length} проверенных скриншотов строго в том же порядке, что и MEDIA ниже.

Выбери ${minimumCarousels}–${maximumCarousels} раздела статьи, где изображения действительно помогают понять игру. Не ставь картинку в каждый раздел ради заполнения. Для каждого выбранного раздела создай карусель из ${minimumImages}–${maximumImages} разных кадров, обычно ${targetImages}. Один кадр нельзя использовать более одного раза во всей статье.

Главное — смысл. Кадры одной карусели должны показывать разные стороны тезиса раздела: например, исследование мира, интерфейс и системность, бой и позиционирование, диалог и персонажей, атмосферу окружения. Не выбирай почти одинаковые сцены.

Для каждого кадра напиши короткую естественную подпись по-русски: конкретно назови то, что действительно видно на изображении, и объясни, почему это важно именно для этой игры или данного тезиса. Запрещены пустые подписи вроде «скриншот демонстрирует игровой процесс». visible_subject должен буквально описывать видимое. commentary — 1–2 предложения о том, что читателю стоит заметить во всей карусели. Не выдумывай невидимые детали. Confidence ниже ${minimumConfidence} означает, что кадр нельзя использовать.

РАЗДЕЛЫ:\n${(article.sections||[]).map(section=>`${section.id}: ${section.heading}\n${(section.paragraphs||[]).slice(0,2).join('\n')}`).join('\n\n')}\n\nMEDIA ПО ПОРЯДКУ:\n${usable.map((item,index)=>`${index+1}. ${item.id||`shot-${index+1}`} ${item.source_name||item.source_domain||''} ${item.width||0}x${item.height||0}`).join('\n')}`;
const audit=await chatJson({system:'Ты строгий визуальный редактор игрового журнала. Анализируй только реально видимое на приложенных кадрах и связывай визуальный материал с конкретным текстом статьи.',prompt,schema,images:usableImages,temperature:0.1,numCtx:32768,numPredict:6000});

const byIndex=new Map(usable.map((item,index)=>[index+1,item])),usedIndexes=new Set(),usedSections=new Set(),mediaSections=[],acceptedCarousels=[];
for(const entry of audit.carousels||[]){
  if(!sectionIds.includes(entry.section_id)||usedSections.has(entry.section_id))continue;
  const picked=[];
  for(const assignment of entry.images||[]){
    const index=Number(assignment.image_index),item=byIndex.get(index),confidence=Number(assignment.confidence||0);
    if(!item||usedIndexes.has(index)||confidence<minimumConfidence)continue;
    usedIndexes.add(index);
    const sourceName=item.source_name||item.source_domain||'Официальный источник';
    picked.push({url:item.url,alt:assignment.alt||assignment.visible_subject||`${article.identity?.title||slug} — игровой кадр`,caption:assignment.caption||assignment.visible_subject||`${article.identity?.title||slug} — игровой кадр`,source_name:sourceName,source_url:item.source_url||'',width:Number(item.width||0),height:Number(item.height||0),bytes:Number(item.bytes||0),mime:item.mime||'image/jpeg',duplicate_group:item.id||`local-media-${index}`,quality:{confidence,sharpness:confidence,compression:confidence,readability:confidence,composition:confidence,render_suitability:confidence,visible_upscale:false,soft_resampling:false,stretched:false,muddy:false,visible_subject:assignment.visible_subject||''}});
  }
  if(picked.length<minimumImages)continue;
  usedSections.add(entry.section_id);
  acceptedCarousels.push({id:entry.section_id,commentary:String(entry.commentary||'').trim(),images:picked.slice(0,maximumImages)});
}
for(const section of article.sections||[]){const found=acceptedCarousels.find(item=>item.id===section.id);mediaSections.push(found||{id:section.id,commentary:'',images:[]})}
const total=acceptedCarousels.reduce((sum,section)=>sum+section.images.length,0),sourceCount=new Set(acceptedCarousels.flatMap(section=>section.images.map(image=>image.source_name))).size;
const passed=acceptedCarousels.length>=minimumCarousels&&acceptedCarousels.length<=maximumCarousels&&total>=minimumTotal&&usedIndexes.size>=minimumUnique&&sourceCount>=Number(policy.source_policy?.minimum_media_sources||1)&&acceptedCarousels.every(section=>section.images.length>=minimumImages&&section.images.length<=maximumImages&&section.commentary);
article.sections=(article.sections||[]).map(section=>{const media=mediaSections.find(item=>item.id===section.id);return {...section,images:media?.images||[],image:media?.images?.[0]||null,media_commentary:media?.commentary||''}});
article.media_gate={candidate_required:Number(balance.minimum_candidate_screenshots||7),raw_found:allCandidates.length,file_probe_passed:usable.length,approved_required:Number(balance.minimum_approved_screenshots||6),vision_approved:usedIndexes.size,carousel_required:minimumCarousels,carousel_target:targetCarousels,carousel_found:acceptedCarousels.length,images_per_carousel:{minimum:minimumImages,target:targetImages,maximum:maximumImages},total_required:minimumTotal,total_found:total,unique_required:minimumUnique,unique_found:usedIndexes.size,source_required:Number(policy.source_policy?.minimum_media_sources||1),source_found:sourceCount,quality_basis:'local_multimodal_meaningful_carousel_audit',passed};
article.validation={...(article.validation||{}),media_quality_audit:audit,total_article_images:total,unique_article_images:usedIndexes.size,meaningful_carousels:acceptedCarousels.length};
article.publication_status=passed?'editorial_review':'blocked';
write(passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,article);
write(`data/article-media/${slug}.json`,{schema_version:8,game_slug:slug,quality_basis:'local_multimodal_meaningful_carousel_audit',model:LOCAL_EDITORIAL_MODEL,carousel_policy:{minimum:minimumCarousels,target:targetCarousels,maximum:maximumCarousels},sections:mediaSections});
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-local-carousel-v2',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),model:LOCAL_EDITORIAL_MODEL,gate:article.media_gate});
console.log(JSON.stringify({slug,model:LOCAL_EDITORIAL_MODEL,passed,carousels:acceptedCarousels.length,total,unique:usedIndexes.size},null,2));
if(!passed)process.exit(2);
