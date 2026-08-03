import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/synthesize-review.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const exists=file=>fs.existsSync(path.join(root,file));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const config=read('config/parsers/review-synthesis.json');
const files={draft:`data/drafts/${slug}.json`,ratings:`data/ratings/${slug}.json`,reviews:`data/reviews/${slug}.json`,research:`data/research/${slug}-source-matrix.json`};
for(const file of Object.values(files))if(!exists(file)){console.error(`Missing ${file}`);process.exit(1)}
const game=read(files.draft),ratings=read(files.ratings),reviews=read(files.reviews),research=read(files.research);
const checkedAt=new Date().toISOString();
const gate=config.publication_gate||{};
const requiredSources=Number(gate.editorial_reviews_required||20),minSections=Number(gate.minimum_sections||8),maxSections=Number(gate.maximum_sections||10),minWords=Number(gate.minimum_article_words||2000),minImages=Number(gate.verified_screenshots_required||6);
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
async function call(body){const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}

const sources=(research.accepted||reviews.reviews||[]).slice(0,requiredSources);
if(sources.length<requiredSources||research.coverage?.passed===false){console.error(`Source gate failed: ${sources.length}/${requiredSources}`);process.exit(2)}
const sourceMap=new Map(sources.map((source,index)=>[source.id||`source-${index+1}`,{...source,id:source.id||`source-${index+1}`}]))
const media=[];
const pushMedia=(url,kind,caption,sourceUrl)=>{if(!url||media.some(item=>canonical(item.url)===canonical(url)))return;media.push({id:`media-${media.length+1}`,url,kind,caption:caption||'',source_url:sourceUrl||game.links?.store||game.links?.official||''})};
if(Array.isArray(game.media?.items))for(const item of game.media.items)pushMedia(item.url,item.kind,item.caption,item.source_url);
else{
  pushMedia(game.media?.hero,'hero','Официальное главное изображение');
  pushMedia(game.media?.cover,'cover','Официальная обложка');
  for(const item of game.media?.screenshots||[])typeof item==='string'?pushMedia(item,'screenshot','Официальный скриншот'):pushMedia(item.url,'screenshot',item.caption,item.source_url);
  for(const item of game.media?.artwork||[])typeof item==='string'?pushMedia(item,'artwork','Официальный арт'):pushMedia(item.url,'artwork',item.caption,item.source_url);
}
if(media.filter(item=>item.kind==='screenshot').length<minImages){console.error(`Media gate failed: need ${minImages} screenshots`);process.exit(2)}
const identity={identity:game.identity,release:game.release,companies:game.companies,classification:game.classification,editorial:game.editorial,requirements:game.requirements,links:game.links};

const outlineSchema={type:'object',additionalProperties:false,required:['thesis','reader_promise','sections'],properties:{thesis:{type:'string'},reader_promise:{type:'string'},sections:{type:'array',minItems:minSections,maxItems:maxSections,items:{type:'object',additionalProperties:false,required:['id','heading','purpose','questions','source_ids','visual_intent'],properties:{id:{type:'string'},heading:{type:'string'},purpose:{type:'string'},questions:{type:'array',minItems:2,items:{type:'string'}},source_ids:{type:'array',minItems:2,items:{type:'string'}},visual_intent:{type:'string'}}}}}};
const outline=await call({model:process.env.OPENAI_MODEL||'gpt-5',input:`Ты редактор Игропоиска. Построй план большого обзора конкретной игры, исходя из её жанра и реальных особенностей. Не используй универсальный шаблон механически. План должен дать читателю практическое понимание того, как игра устроена, как в неё играют, что она делает хорошо и что состарилось или не работает. Нужны ${minSections}-${maxSections} непересекающихся разделов. Каждый раздел опирается на существующие source_ids и получает конкретный visual_intent.\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nМАТРИЦА ИСТОЧНИКОВ:\n${JSON.stringify(sources,null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_review_outline',strict:true,schema:outlineSchema}}});

const articleSchema={type:'object',additionalProperties:false,required:['title','dek','author','published_at','lead','sections','verdict','used_source_ids','claim_sources'],properties:{title:{type:'string'},dek:{type:'string'},author:{type:'string'},published_at:{type:'string'},lead:{type:'string'},sections:{type:'array',minItems:minSections,maxItems:maxSections,items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','source_ids','media_id','image_caption'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:3,items:{type:'string'}},source_ids:{type:'array',minItems:2,items:{type:'string'}},media_id:{type:'string'},image_caption:{type:'string'}}}},verdict:{type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',items:{type:'string'}},not_for:{type:'array',items:{type:'string'}}}},used_source_ids:{type:'array',minItems:requiredSources,items:{type:'string'}},claim_sources:{type:'array',minItems:10,items:{type:'object',additionalProperties:false,required:['claim','source_ids'],properties:{claim:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}}}};
const articleDraft=await call({model:process.env.OPENAI_MODEL||'gpt-5',input:`Напиши оригинальный подробный обзор Игропоиска на русском языке по утверждённому плану. Минимум ${minWords} содержательных слов без списка источников. Не пересказывай издания по очереди. Объясни игровой цикл, управление, устройство миссий и мира, сильные стороны, конкретные проблемы, исторический контекст и современную пригодность. Не раскрывай крупные сюжетные повороты. Используй только существующие source_ids и media_id. Изображение должно буквально показывать предмет раздела: бой — бой, вождение — автомобиль в движении, персонажи — сюжетную сцену, город — город.\n\nПЛАН:\n${JSON.stringify(outline,null,2)}\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nИСТОЧНИКИ:\n${JSON.stringify(sources,null,2)}\n\nМЕДИА:\n${JSON.stringify(media,null,2)}\n\nОЦЕНКА ИГРОПОИСКА ИЗ ПАРСЕРА: ${ratings.calculation?.score_10??ratings.score??'не рассчитана'}`,text:{format:{type:'json_schema',name:'igropoisk_review_body',strict:true,schema:articleSchema}}});

const rejected=[];
const validSourceIds=new Set(sourceMap.keys()),mediaMap=new Map(media.map(item=>[item.id,item]));
const sections=[];
for(const section of articleDraft.sections||[]){
  const sourceIds=[...new Set(section.source_ids||[])].filter(id=>validSourceIds.has(id));
  const mediaItem=mediaMap.get(section.media_id);
  const reasons=[];
  if(sourceIds.length<2)reasons.push('fewer than two verified sources');
  if(!mediaItem||mediaItem.kind!=='screenshot')reasons.push('invalid or non-screenshot media');
  if((section.paragraphs||[]).reduce((sum,p)=>sum+countWords(p),0)<150)reasons.push('section is too short');
  if(reasons.length){rejected.push({section:section.id,reasons});continue}
  sections.push({...section,source_ids:sourceIds,media:mediaItem});
}

async function auditImages(items){if(!items.length)return[];const schema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:items.length,maxItems:items.length,items:{type:'object',additionalProperties:false,required:['section_id','matches','confidence','visible_subject','problem'],properties:{section_id:{type:'string'},matches:{type:'boolean'},confidence:{type:'number'},visible_subject:{type:'string'},problem:{type:'string'}}}}}};const content=[{type:'input_text',text:'Проверь каждый скриншот относительно текста раздела. Оцени только то, что реально видно. Портрет не может иллюстрировать бой, автомобильная поездка — перестрелку, а меню — исследование города. Порог соответствия строгий.'}];for(const item of items){content.push({type:'input_text',text:`SECTION_ID: ${item.id}\nHEADING: ${item.heading}\nTEXT: ${item.paragraphs.join('\n')}\nCAPTION: ${item.image_caption}`});content.push({type:'input_image',image_url:item.media.url,detail:'high'})}const result=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content}],text:{format:{type:'json_schema',name:'igropoisk_visual_audit',strict:true,schema}}});return result.results||[]}
let audits=await auditImages(sections);
const auditMap=()=>new Map(audits.map(item=>[item.section_id,item]));
for(let attempt=0;attempt<2;attempt++){
  const byId=auditMap();const failed=sections.filter(section=>{const audit=byId.get(section.id);return !audit||!audit.matches||Number(audit.confidence)<0.75});
  if(!failed.length)break;
  for(const section of failed){
    const candidates=media.filter(item=>item.kind==='screenshot'&&!sections.some(other=>other.id!==section.id&&other.media.id===item.id)).slice(0,12);
    if(!candidates.length)continue;
    const schema={type:'object',additionalProperties:false,required:['selected_media_id','reason'],properties:{selected_media_id:{type:'string'},reason:{type:'string'}}};
    const content=[{type:'input_text',text:`Выбери единственный скриншот, который буквально соответствует разделу. SECTION: ${section.heading}\nTEXT: ${section.paragraphs.join('\n')}\nКандидаты идут в порядке MEDIA_ID.`}];
    for(const candidate of candidates){content.push({type:'input_text',text:`MEDIA_ID: ${candidate.id} — ${candidate.caption||candidate.kind}`});content.push({type:'input_image',image_url:candidate.url,detail:'high'})}
    const choice=await call({model:process.env.OPENAI_VISION_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:[{role:'user',content}],text:{format:{type:'json_schema',name:'igropoisk_image_repair',strict:true,schema}}});
    if(mediaMap.has(choice.selected_media_id)){section.media=mediaMap.get(choice.selected_media_id);section.media_id=choice.selected_media_id;section.image_caption=choice.reason}
  }
  audits=await auditImages(sections);
}
const byId=auditMap();
const auditedSections=sections.filter(section=>{const audit=byId.get(section.id);const ok=audit?.matches===true&&Number(audit.confidence)>=0.75;if(!ok)rejected.push({section:section.id,reasons:['semantic image audit failed'],audit:audit||null});return ok});
const words=countWords(articleDraft.lead)+auditedSections.reduce((sum,section)=>sum+section.paragraphs.reduce((n,p)=>n+countWords(p),0),0)+countWords(articleDraft.verdict?.summary);
const usedIds=new Set([...(articleDraft.used_source_ids||[]),...(articleDraft.claim_sources||[]).flatMap(item=>item.source_ids||[]),...auditedSections.flatMap(item=>item.source_ids||[])]);
const usedSources=[...usedIds].filter(id=>sourceMap.has(id)).map(id=>sourceMap.get(id));
const uniqueImages=new Set(auditedSections.map(section=>section.media.id)).size;

const qualitySchema={type:'object',additionalProperties:false,required:['passed','coverage','specificity','balance','clarity','redundancy','spoiler_control','problems'],properties:{passed:{type:'boolean'},coverage:{type:'number'},specificity:{type:'number'},balance:{type:'number'},clarity:{type:'number'},redundancy:{type:'number'},spoiler_control:{type:'number'},problems:{type:'array',items:{type:'string'}}}};
const quality=await call({model:process.env.OPENAI_AUDIT_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:`Проведи строгий редакционный аудит обзора. Он должен давать рабочее представление об игре, объяснять игровой процесс и ограничения, содержать конкретные наблюдения, не повторяться, не быть рекламным и не раскрывать крупные повороты. Поставь passed=true только если каждый показатель не ниже 0.75.\n\nПЛАН:\n${JSON.stringify(outline,null,2)}\n\nТЕКСТ:\n${JSON.stringify({lead:articleDraft.lead,sections:auditedSections,verdict:articleDraft.verdict},null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_editorial_quality_audit',strict:true,schema:qualitySchema}}});
const passed=usedSources.length>=requiredSources&&auditedSections.length>=minSections&&auditedSections.length<=maxSections&&words>=minWords&&uniqueImages>=minImages&&quality.passed===true;
const score=ratings.calculation?.score_10??ratings.score??null;
const article={schema_version:4,slug,game_slug:slug,title:articleDraft.title,dek:articleDraft.dek,author:articleDraft.author||'Редакция Игропоиска',published_at:articleDraft.published_at||new Date().toLocaleDateString('ru-RU'),updated_at:new Date().toISOString(),score,hero:game.media?.hero||media.find(item=>item.kind==='hero')?.url||media[0]?.url||'',lead:articleDraft.lead,reading_time_minutes:Math.max(1,Math.ceil(words/180)),publication_status:passed?'published':'blocked',source_gate:{required_editorial:requiredSources,accepted_editorial:usedSources.length,passed:usedSources.length>=requiredSources},sections:auditedSections.map(section=>({id:section.id,heading:section.heading,paragraphs:section.paragraphs,image:{url:section.media.url,alt:section.image_caption,caption:section.image_caption,source_name:section.media.caption||'Проверенный скриншот',source_url:section.media.source_url||'',reason:byId.get(section.id)?.visible_subject||section.image_caption},source_ids:section.source_ids})),verdict:articleDraft.verdict,sources:usedSources.map(source=>({id:source.id,name:source.publication,publication:source.publication,url:source.resolved_url||source.url,purpose:[...(source.praise||[]),...(source.criticism||[])].slice(0,2).join(' · '),type:'editorial'})),methodology:`Многоэтапный синтез ${usedSources.length} независимых профессиональных материалов: проверка корпуса, динамический план, написание, мультимодальный подбор изображений и финальный редакционный аудит.`,claim_sources:(articleDraft.claim_sources||[]).map(item=>({claim:item.claim,urls:(item.source_ids||[]).map(id=>sourceMap.get(id)?.resolved_url||sourceMap.get(id)?.url).filter(Boolean)})),source_coverage:{available:sources.length,materially_used:usedSources.length,rejected:rejected.length},validation:{checked_at:checkedAt,words,sections:auditedSections.length,unique_images:uniqueImages,image_audit:audits,quality,rejected}};
const output=passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
write(output,article);
const run={parser:'review-synthesis',status:passed?'success':'blocked',game_slug:slug,checked_at:checkedAt,execution_mode:'research-plan-write-image-audit-quality-audit',gate:{required_editorial:requiredSources,accepted_editorial:usedSources.length,minimum_sections:minSections,accepted_sections:auditedSections.length,minimum_words:minWords,accepted_words:words,required_screenshots:minImages,accepted_screenshots:uniqueImages,image_audit_passed:auditedSections.length===sections.length,quality_audit_passed:quality.passed,passed},output,note:passed?'All source, length, visual and editorial gates passed.':'Draft saved; publication blocked by one or more quality gates.'};
write('data/parser-runs/review-synthesis.json',run);write(`data/parser-runs/review-synthesis-${slug}.json`,run);
console.log(JSON.stringify(run,null,2));
if(!passed)process.exitCode=2;
