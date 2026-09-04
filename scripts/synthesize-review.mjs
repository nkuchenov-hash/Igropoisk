import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/synthesize-review.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const readOptional=(file,fallback=null)=>{try{return read(file)}catch{return fallback}};
const exists=file=>fs.existsSync(path.join(root,file));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const legacyConfig=read('config/parsers/review-synthesis.json');
const policy=read('config/review-editorial-policy.json');
const mediaPolicy=readOptional('config/parsers/review-media-policy.json',{});
const files={draft:`data/drafts/${slug}.json`,ratings:`data/ratings/${slug}.json`};
for(const file of Object.values(files))if(!exists(file)){console.error(`Missing ${file}`);process.exit(1)}
const game=read(files.draft),ratings=read(files.ratings);
const canonicalCorpus=readOptional(`data/game-sources/${slug}.json`);
const legacyReviews=readOptional(`data/reviews/${slug}.json`,{});
const legacyResearch=readOptional(`data/research/${slug}-source-matrix.json`,{});
const checkedAt=new Date().toISOString();
const writingModel=process.env.OPENAI_MODEL||'gpt-5';
const articlePolicy=policy.article||{};
const sourcePolicy=policy.source_policy||{};
const mediaBalance=mediaPolicy.article_balance||{};
const minEvidence=Number(sourcePolicy.minimum_usable_evidence_sources??1);
const minSections=Number(articlePolicy.minimum_sections||7);
const maxSections=Number(articlePolicy.maximum_sections||10);
const minWords=Number(articlePolicy.minimum_words||1800);
const targetWordsMin=Number(articlePolicy.target_words_min||2000);
const targetWordsMax=Number(articlePolicy.target_words_max||2600);
const minImages=Number(mediaBalance.minimum_unique_screenshots||legacyConfig.publication_gate?.verified_screenshots_required||6);
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
async function call(body){const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}

function normalizedSources(){
  const raw=canonicalCorpus?.sources?.length?canonicalCorpus.sources:(legacyResearch.accepted?.length?legacyResearch.accepted:(legacyReviews.reviews||[]));
  return raw.map((source,index)=>({
    ...source,
    id:source.id||`source-${index+1}`,
    publication:source.publication||source.name||source.source||`Источник ${index+1}`,
    role:source.role||source.type||'editorial',
    url:source.resolved_url||source.url||''
  })).filter(source=>source.url||source.title||source.name||source.publication);
}
const sources=normalizedSources();
const corpusOwner=canonicalCorpus?'game-page-canonical-corpus':'legacy-review-corpus-migration-fallback';
const discoveryExplicitlyIncomplete=canonicalCorpus
  ? (canonicalCorpus.source_scan_complete===false||canonicalCorpus.discovery?.complete===false)
  : (legacyResearch.source_registry_scan?.complete===false||legacyResearch.external_search?.complete===false);
if(sources.length<minEvidence){console.error(`Evidence gate failed: ${sources.length}/${minEvidence} usable source(s)`);process.exit(2)}
if(sourcePolicy.require_completed_source_discovery_when_corpus_exposes_status&&discoveryExplicitlyIncomplete){console.error('Evidence gate failed: source discovery is explicitly incomplete');process.exit(2)}
const sourceMap=new Map(sources.map(source=>[source.id,source]));

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

// PASS 1 — evidence extraction. The writing model first maps evidence instead of drafting from memory.
const evidenceSchema={type:'object',additionalProperties:false,required:['game_thesis','version_identity','items','distinctive_details','concrete_problems','interface_feedback'],properties:{
  game_thesis:{type:'string'},
  version_identity:{type:'string'},
  items:{type:'array',minItems:6,items:{type:'object',additionalProperties:false,required:['category','claim','source_ids'],properties:{category:{type:'string'},claim:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}},
  distinctive_details:{type:'array',minItems:2,items:{type:'object',additionalProperties:false,required:['detail','why_it_matters','source_ids'],properties:{detail:{type:'string'},why_it_matters:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}},
  concrete_problems:{type:'array',items:{type:'object',additionalProperties:false,required:['problem','effect','source_ids'],properties:{problem:{type:'string'},effect:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}},
  interface_feedback:{type:'array',items:{type:'object',additionalProperties:false,required:['detail','source_ids'],properties:{detail:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}}
}};
const evidence=await call({model:writingModel,input:`Ты редактор Игропоиска. Это первый, внутренний проход Review Skill v1: извлеки доказательную карту из предоставленного корпуса. Не пиши статью. Не добавляй фактов из памяти. Отдельно ищи маленькие, но характерные детали интерфейса, HUD, навигации, визуальной и звуковой обратной связи: они могут быть важнее общих тезисов. Недостатки формулируй как конкретные свойства систем, а не как "игра устарела". Точно соблюдай версию игры. Используй только существующие source_ids.\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nКАНОНИЧЕСКИЙ КОРПУС (${corpusOwner}):\n${JSON.stringify(sources,null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_review_evidence',strict:true,schema:evidenceSchema}}});

// PASS 2 — game-specific editorial structure.
const outlineSchema={type:'object',additionalProperties:false,required:['thesis','reader_promise','sections'],properties:{thesis:{type:'string'},reader_promise:{type:'string'},sections:{type:'array',minItems:minSections,maxItems:maxSections,items:{type:'object',additionalProperties:false,required:['id','heading','purpose','questions','source_ids','visual_intent'],properties:{id:{type:'string'},heading:{type:'string'},purpose:{type:'string'},questions:{type:'array',minItems:2,items:{type:'string'}},source_ids:{type:'array',minItems:1,items:{type:'string'}},visual_intent:{type:'string'}}}}}};
const outline=await call({model:writingModel,input:`Ты редактор Игропоиска. Построй структуру большого обзора именно этой игры по evidence-карте. Нужны ${minSections}-${maxSections} непересекающихся смысловых разделов. Не используй механический шаблон "сюжет — геймплей — графика — что устарело — итог". Не создавай обязательный раздел про возраст игры, "сегодня", "что состарилось" или "современного игрока". Если есть проблемы, рассматривай конкретные системы там, где это естественно. Исторический контекст допустим только если он объясняет дизайн или значение решения. Заголовок обязан ясно сообщать, о каком аспекте раздел, и по одним заголовкам читатель должен понимать маршрут статьи. Приоритет характерным деталям из evidence, включая HUD/интерфейс/feedback, если они содержательны. Используй только существующие source_ids.\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nEVIDENCE:\n${JSON.stringify(evidence,null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_review_outline',strict:true,schema:outlineSchema}}});

const articleSchema={type:'object',additionalProperties:false,required:['title','dek','author','lead','sections','verdict','used_source_ids','claim_sources'],properties:{title:{type:'string'},dek:{type:'string'},author:{type:'string'},lead:{type:'string'},sections:{type:'array',minItems:minSections,maxItems:maxSections,items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','source_ids','media_id','image_caption'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:3,items:{type:'string'}},source_ids:{type:'array',minItems:1,items:{type:'string'}},media_id:{type:'string'},image_caption:{type:'string'}}}},verdict:{type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',items:{type:'string'}},not_for:{type:'array',items:{type:'string'}}}},used_source_ids:{type:'array',minItems:1,items:{type:'string'}},claim_sources:{type:'array',minItems:5,items:{type:'object',additionalProperties:false,required:['claim','source_ids'],properties:{claim:{type:'string'},source_ids:{type:'array',minItems:1,items:{type:'string'}}}}}}};
const draftPrompt=`Напиши оригинальный подробный обзор Игропоиска на русском языке по утверждённому плану. Ориентир ${targetWordsMin}-${targetWordsMax} содержательных слов; минимум ${minWords}. Это журнальная статья, а не энциклопедия и не набор коротких драматических строк. Пиши полноценными естественными абзацами; отдельные короткие абзацы — только редкий осмысленный акцент. Входи в игру через сцену, героя, механику или центральное ощущение, а не через сухую справку. Конкретные наблюдения важнее общих похвал. Механики описывай в настоящем времени, даже если игра старая. Не делай текущий год точкой отсчёта, не пиши обязательных рассуждений о том, "как игра ощущается сегодня" или "что состарилось". Недостатки называй прямо: что именно не работает и как влияет на игру. Историческое сравнение используй только когда оно реально что-то объясняет. Не пересказывай издания по очереди и не упоминай процесс/корпус/source_ids в публичной прозе. Не раскрывай крупные сюжетные повороты. Финальный summary должен быть самостоятельным редакционным выводом и оставлять послевкусие, а не повторять список разделов. best_for/not_for заполни кратко только как структурные метаданные; они не должны определять стиль статьи. Используй только существующие source_ids и media_id. Изображение должно буквально показывать предмет раздела.\n\nПЛАН:\n${JSON.stringify(outline,null,2)}\n\nEVIDENCE:\n${JSON.stringify(evidence,null,2)}\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nИСТОЧНИКИ:\n${JSON.stringify(sources,null,2)}\n\nМЕДИА:\n${JSON.stringify(media,null,2)}\n\nОЦЕНКА ИГРОПОИСКА ИЗ ПАРСЕРА: ${ratings.calculation?.score_10??ratings.score??'не рассчитана'}`;

// PASS 3 — draft.
let articleDraft=await call({model:writingModel,input:draftPrompt,text:{format:{type:'json_schema',name:'igropoisk_review_body',strict:true,schema:articleSchema}}});

// PASS 4 — same-model evergreen / anti-generic audit and one repair pass when needed.
const editorialAuditSchema={type:'object',additionalProperties:false,required:['passed','grounding','natural_russian','structure','heading_clarity','paragraph_rhythm','evergreen','specificity','distinctive_details','conclusion','problems'],properties:{passed:{type:'boolean'},grounding:{type:'number'},natural_russian:{type:'number'},structure:{type:'number'},heading_clarity:{type:'number'},paragraph_rhythm:{type:'number'},evergreen:{type:'number'},specificity:{type:'number'},distinctive_details:{type:'number'},conclusion:{type:'number'},problems:{type:'array',items:{type:'string'}}}};
async function auditArticle(draft){return call({model:writingModel,input:`Проведи строгий четвёртый проход Review Skill v1. Проверяй только этот текст и evidence. passed=true допустим только если каждый показатель >=0.78. Ищи: привязку к текущему году; ритуальные разделы "что устарело"; фразы вроде "выдаёт свой возраст", "сегодня ощущается", "для современного игрока", "игрово"; механики, ошибочно описанные в прошедшем времени; универсальную структуру; заголовки, из которых неясен предмет раздела; повторяющиеся разделы; цепочки коротких абзацев в стиле LLM; сухую энциклопедичность; служебный язык источников; пропущенные характерные детали evidence; финал-пересказ вместо самостоятельной мысли. Недостатки должны быть конкретными и относиться к системам игры.\n\nEVIDENCE:\n${JSON.stringify(evidence,null,2)}\n\nПЛАН:\n${JSON.stringify(outline,null,2)}\n\nТЕКСТ:\n${JSON.stringify(articleDraft,null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_review_editorial_audit',strict:true,schema:editorialAuditSchema}}})}
let editorialAudit=await auditArticle(articleDraft);
if(!editorialAudit.passed){
  articleDraft=await call({model:writingModel,input:`Исправь обзор по замечаниям собственного редакционного аудита. Сохрани фактические утверждения в пределах того же evidence и те же реальные source_ids/media_id. Не добавляй новых фактов. Не сокращай статью ниже ${minWords} слов. Перепиши проблемные заголовки и абзацы, убери current-day/age framing, LLM-ритм и служебный язык. Финал должен быть редакционным выводом, а не сводкой.\n\nАУДИТ:\n${JSON.stringify(editorialAudit,null,2)}\n\nEVIDENCE:\n${JSON.stringify(evidence,null,2)}\n\nПЛАН:\n${JSON.stringify(outline,null,2)}\n\nЧЕРНОВИК:\n${JSON.stringify(articleDraft,null,2)}`,text:{format:{type:'json_schema',name:'igropoisk_review_body_repaired',strict:true,schema:articleSchema}}});
  editorialAudit=await auditArticle(articleDraft);
}

const rejected=[];
const validSourceIds=new Set(sourceMap.keys()),mediaMap=new Map(media.map(item=>[item.id,item]));
const sections=[];
for(const section of articleDraft.sections||[]){
  const sourceIds=[...new Set(section.source_ids||[])].filter(id=>validSourceIds.has(id));
  const mediaItem=mediaMap.get(section.media_id);
  const reasons=[];
  if(sourceIds.length<1)reasons.push('no verified source');
  if(!mediaItem||mediaItem.kind!=='screenshot')reasons.push('invalid or non-screenshot media');
  if((section.paragraphs||[]).reduce((sum,p)=>sum+countWords(p),0)<150)reasons.push('section is too short');
  if(reasons.length){rejected.push({section:section.id,reasons});continue}
  sections.push({...section,source_ids:sourceIds,media:mediaItem});
}

async function auditImages(items){if(!items.length)return[];const schema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',minItems:items.length,maxItems:items.length,items:{type:'object',additionalProperties:false,required:['section_id','matches','confidence','visible_subject','problem'],properties:{section_id:{type:'string'},matches:{type:'boolean'},confidence:{type:'number'},visible_subject:{type:'string'},problem:{type:'string'}}}}}};const content=[{type:'input_text',text:'Проверь каждый скриншот относительно текста раздела. Оцени только то, что реально видно. Портрет не может иллюстрировать бой, автомобильная поездка — перестрелку, а меню — исследование города. Порог соответствия строгий.'}];for(const item of items){content.push({type:'input_text',text:`SECTION_ID: ${item.id}\nHEADING: ${item.heading}\nTEXT: ${item.paragraphs.join('\n')}\nCAPTION: ${item.image_caption}`});content.push({type:'input_image',image_url:item.media.url,detail:'high'})}const result=await call({model:process.env.OPENAI_VISION_MODEL||writingModel,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'igropoisk_visual_audit',strict:true,schema}}});return result.results||[]}
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
    const choice=await call({model:process.env.OPENAI_VISION_MODEL||writingModel,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'igropoisk_image_repair',strict:true,schema}}});
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
const passed=usedSources.length>=minEvidence&&auditedSections.length>=minSections&&auditedSections.length<=maxSections&&words>=minWords&&uniqueImages>=minImages&&editorialAudit.passed===true;
const score=ratings.calculation?.score_10??ratings.score??null;
const article={schema_version:5,slug,game_slug:slug,game_id:game.identity?.game_id||canonicalCorpus?.game_id||legacyReviews.game_id||null,title:articleDraft.title,dek:articleDraft.dek,author:articleDraft.author||'Редакция Игропоиска',published_at:new Date().toLocaleDateString('ru-RU'),updated_at:new Date().toISOString(),score,hero:game.media?.hero||media.find(item=>item.kind==='hero')?.url||media[0]?.url||'',lead:articleDraft.lead,reading_time_minutes:Math.max(1,Math.ceil(words/180)),publication_status:passed?'published':'blocked',source_gate:{fixed_count_required:false,minimum_usable_evidence:minEvidence,available:sources.length,materially_used:usedSources.length,discovery_explicitly_incomplete:discoveryExplicitlyIncomplete,passed:usedSources.length>=minEvidence&&!discoveryExplicitlyIncomplete,owner:corpusOwner},sections:auditedSections.map(section=>({id:section.id,heading:section.heading,paragraphs:section.paragraphs,image:{url:section.media.url,alt:section.image_caption,caption:section.image_caption,source_name:section.media.caption||'Проверенный скриншот',source_url:section.media.source_url||'',reason:byId.get(section.id)?.visible_subject||section.image_caption},source_ids:section.source_ids})),verdict:articleDraft.verdict,sources:usedSources.map(source=>({id:source.id,name:source.publication,publication:source.publication,url:source.resolved_url||source.url,purpose:[...(source.praise||[]),...(source.criticism||[])].slice(0,2).join(' · '),type:source.role||source.type||'editorial'})),methodology:'Редакционный обзор Игропоиска, основанный на проверенном каноническом корпусе материалов об игре.',claim_sources:(articleDraft.claim_sources||[]).map(item=>({claim:item.claim,urls:(item.source_ids||[]).map(id=>sourceMap.get(id)?.resolved_url||sourceMap.get(id)?.url).filter(Boolean)})),source_coverage:{available:sources.length,materially_used:usedSources.length,rejected:rejected.length,owner:corpusOwner},validation:{checked_at:checkedAt,words,sections:auditedSections.length,unique_images:uniqueImages,evidence,outline,editorial_audit:editorialAudit,image_audit:audits,rejected}};
const output=passed?`data/articles/${slug}.json`:`data/article-drafts/${slug}.json`;
write(output,article);
const run={parser:'review-synthesis',status:passed?'success':'blocked',game_slug:slug,checked_at:checkedAt,execution_mode:'evidence-structure-draft-evergreen-audit-image-audit',model:writingModel,source_owner:corpusOwner,gate:{fixed_source_count_required:false,minimum_usable_evidence:minEvidence,available_sources:sources.length,materially_used_sources:usedSources.length,minimum_sections:minSections,accepted_sections:auditedSections.length,minimum_words:minWords,accepted_words:words,required_screenshots:minImages,accepted_screenshots:uniqueImages,image_audit_passed:auditedSections.length===sections.length,editorial_audit_passed:editorialAudit.passed,passed},output,note:passed?'Evidence, editorial, length and visual gates passed.':'Draft saved; publication blocked by one or more quality gates.'};
write('data/parser-runs/review-synthesis.json',run);write(`data/parser-runs/review-synthesis-${slug}.json`,run);
console.log(JSON.stringify(run,null,2));
if(!passed)process.exitCode=2;
