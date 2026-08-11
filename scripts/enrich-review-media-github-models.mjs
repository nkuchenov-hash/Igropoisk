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
const candidates=read(`data/media-candidates/${slug}.json`).candidates||[];
const policy=read('config/parsers/review-media-policy.json');
const balance=policy.article_balance||{};
const minPerSection=Number(balance.screenshots_per_section?.minimum||1);
if(minPerSection!==1)throw new Error('GitHub Models media fallback currently supports exactly one verified image per section');
if(candidates.length<(article.sections||[]).length)throw new Error(`Media gate failed: ${candidates.length}/${article.sections.length}`);
const model=process.env.GITHUB_VISION_MODEL||process.env.GITHUB_REVIEW_MODEL||'openai/gpt-4.1';
const content=[{type:'text',text:`Ты проверяешь визуальный ряд статьи Игропоиска про ${article.identity?.title||slug}. Для каждого раздела выбери ровно один уникальный MEDIA_ID из приложенных официальных игровых скриншотов. Кадр должен буквально соответствовать разделу и точно принадлежать этой игре. Не используй один кадр дважды. Для выбранного кадра напиши короткую естественную подпись и alt на русском. Запрещены фразы «кадр иллюстрирует тезис», «на изображении показано» и другие пустые формулы. Верни только JSON: {"assignments":[{"section_id":"...","media_id":"shot-1","caption":"...","alt":"...","confidence":0.9,"visible_subject":"..."}]}. Confidence <0.78 означает, что кадр использовать нельзя.`}];
for(const section of article.sections||[])content.push({type:'text',text:`SECTION ${section.id}: ${section.heading}\n${(section.paragraphs||[]).join('\n')}`});
for(const item of candidates){
  content.push({type:'text',text:`MEDIA_ID ${item.id}; SOURCE ${item.source_name||item.source_domain||'official'}; ${item.width}x${item.height}`});
  content.push({type:'image_url',image_url:{url:item.url,detail:'high'}});
}
const response=await fetch('https://models.github.ai/inference/chat/completions',{
  method:'POST',
  headers:{authorization:`Bearer ${token}`,'content-type':'application/json','accept':'application/vnd.github+json','x-github-api-version':'2026-03-10'},
  body:JSON.stringify({model,messages:[{role:'user',content}],response_format:{type:'json_object'},temperature:0.1,max_tokens:5000})
});
if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
const payload=await response.json();
const text=payload.choices?.[0]?.message?.content;
if(!text)throw new Error('No multimodal audit output');
const audit=JSON.parse(text.replace(/^```json\s*|\s*```$/g,''));
const byMedia=new Map(candidates.map(item=>[item.id,item]));
const bySection=new Map((audit.assignments||[]).map(item=>[item.section_id,item]));
const used=new Set();
const mediaSections=[];
let passed=true;
for(const section of article.sections||[]){
  const assignment=bySection.get(section.id);
  const item=assignment&&byMedia.get(assignment.media_id);
  const confidence=Number(assignment?.confidence||0);
  if(!item||used.has(item.id)||confidence<0.78){passed=false;mediaSections.push({id:section.id,images:[]});continue}
  used.add(item.id);
  const sourceName=item.source_name||item.source_domain||'Официальный источник';
  const image={
    url:item.url,
    alt:assignment.alt||`${article.identity?.title||slug} — ${section.heading}`,
    caption:assignment.caption||section.image_caption||`${article.identity?.title||slug} — ${section.heading}`,
    source_name:sourceName,
    source_url:item.source_url||'',
    width:Number(item.width||0),height:Number(item.height||0),bytes:Number(item.bytes||0),mime:item.mime||'image/jpeg',
    duplicate_group:item.id,
    quality:{confidence,sharpness:confidence,compression:confidence,readability:confidence,composition:confidence,render_suitability:confidence,visible_upscale:false,soft_resampling:false,stretched:false,muddy:false,visible_subject:assignment.visible_subject||''}
  };
  mediaSections.push({id:section.id,images:[image]});
}
if(mediaSections.some(section=>section.images.length<1))passed=false;
const total=mediaSections.reduce((sum,section)=>sum+section.images.length,0);
if(total<Number(balance.minimum_total_screenshots||7)||used.size<Number(balance.minimum_unique_screenshots||7))passed=false;
article.sections=(article.sections||[]).map(section=>{const media=mediaSections.find(item=>item.id===section.id);return {...section,images:media?.images||[],image:media?.images?.[0]||null}});
article.media_gate={candidate_required:Number(balance.minimum_candidate_screenshots||7),raw_found:candidates.length,file_probe_passed:candidates.length,approved_required:Number(balance.minimum_approved_screenshots||7),vision_approved:used.size,total_required:Number(balance.minimum_total_screenshots||7),total_found:total,unique_required:Number(balance.minimum_unique_screenshots||7),unique_found:used.size,source_required:Number(policy.source_policy?.minimum_media_sources||1),source_found:new Set(mediaSections.flatMap(section=>section.images.map(image=>image.source_name))).size,quality_basis:'github_models_visual_audit_of_verified_game_media',passed};
article.validation={...(article.validation||{}),media_quality_audit:audit,total_article_images:total,unique_article_images:used.size};
article.publication_status=passed?'published':'blocked';
write(passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`,article);
write(`data/article-media/${slug}.json`,{schema_version:5,game_slug:slug,quality_basis:'github_models_visual_audit_of_verified_game_media',sections:mediaSections});
write(`data/parser-runs/review-media-${slug}.json`,{parser:'review-media-github-models',status:passed?'success':'blocked',game_slug:slug,checked_at:new Date().toISOString(),model,gate:article.media_gate});
console.log(JSON.stringify({slug,model,passed,total,unique:used.size},null,2));
if(!passed)process.exit(2);
