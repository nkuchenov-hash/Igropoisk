#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: synthesize-commercial-review-resilient <slug>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const OPENAI_ACCELERATOR_TIMEOUT_MS=300000;
const LOCAL_COMPONENT_TIMEOUT_MS=360000;
const LOCAL_SECTION_CONTINUATION_TIMEOUT_MS=180000;
const LOCAL_AUDIT_TIMEOUT_MS=300000;
const MAX_COMPONENT_ATTEMPTS=2;
const MAX_SECTION_CONTINUATIONS=3;
const MAX_TARGETED_REVISIONS=3;

if(process.env.OPENAI_API_KEY){
  const legacy=spawnSync('node',['scripts/synthesize-commercial-review-openai.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:48*1024*1024,timeout:OPENAI_ACCELERATOR_TIMEOUT_MS});
  const accelerated=read(`data/articles/${slug}.json`);
  if(legacy.status===0&&accelerated?.generation?.editorial_audit?.passed===true){
    console.log(JSON.stringify({slug,status:'openai-accelerator-ready',words:accelerated.generation?.words||0},null,2));
    process.exit(0);
  }
  console.warn(`${slug}: OpenAI synthesis unavailable or exceeded bounded budget; switching to sectioned local ${LOCAL_EDITORIAL_MODEL}`);
}

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{},sourceRules=contract.source_corpus||{};
const game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`),reviews=read(`data/reviews/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{}),discovery=read(`data/review-discovery-audits/${slug}.json`,{});
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing`);
if(!await localModelReady({timeoutMs:5000}))throw new Error(`${slug}: neither OpenAI nor local ${LOCAL_EDITORIAL_MODEL} is available`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role);
const preferred=Math.max(8,Number(sourceRules.preferred_minimum_independent_full_reviews||15));
const exhaustive=corpus.coverage?.exhaustive_discovery===true&&discovery?.exhaustive===true;
if(!sources.length)throw new Error(`${slug}: no professional full-text review dossiers`);
if(sources.length<preferred&&!exhaustive)throw new Error(`${slug}: source corpus below preferred target without exhaustive discovery proof`);

const minWords=Math.max(2800,Number(rules.minimum_words||3000));
const targetWords=Math.max(minWords,Number(rules.target_words||3400));
const maxWords=Math.max(targetWords,Number(rules.maximum_words_without_editor_approval||4500));
const minSections=Math.max(7,Number(rules.minimum_sections||8));
const targetSections=Math.min(Math.max(minSections,Number(rules.target_sections||9)),Math.max(minSections,Number(rules.maximum_sections||10)));
const minParagraphs=Math.max(3,Number(rules.minimum_paragraphs_per_section||3));
const minSectionWords=Math.max(220,Number(rules.minimum_words_per_section||260));
const leadMinWords=Math.max(80,Number(rules.lead_minimum_words||120));
const minSectionSources=sources.length>=preferred?Math.max(2,Number(rules.preferred_minimum_sources_per_section||3)):Math.max(1,Number(rules.minimum_sources_per_section_after_exhaustive_discovery||1));
const minUsed=sources.length>=preferred?Math.min(sources.length,Math.max(10,Number(rules.preferred_minimum_materially_used_sources||12))):sources.length;
const countWords=v=>(String(v||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const lowerLatin=v=>[...String(v||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(x=>x[0]).filter(x=>!['fallout','rpg'].includes(x));
const sourceDigest=sources.map(s=>({id:s.id,publication:s.publication,title:s.title,body_words:s.body_words,dossier:s.dossier}));
const identity={title:game.identity.title,series:game.identity.series||null,release:game.release,developers:game.companies?.developers||[],publishers:game.companies?.publishers||[],genres:game.classification?.genres||[],platforms:game.classification?.platforms||[],description:game.editorial?.integrated_description||game.editorial?.short_description||''};
const corpusSignature=JSON.stringify({sources:sourceDigest.map(s=>[s.id,s.publication,s.body_words]),contract:contract.id});
const statePath=`data/article-section-drafts/${slug}.json`;
let state=read(statePath,{});
if(state?.corpus_signature!==corpusSignature)state={schema_version:1,slug,corpus_signature:corpusSignature,model:LOCAL_EDITORIAL_MODEL,meta:null,sections:{},verdict:null,audit:null,revision_count:0,updated_at:new Date().toISOString()};
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};

const themes=[
  {id:'world-and-premise',focus:'мир, исходная ситуация, тон и то, как игра вводит игрока в свои правила',keywords:['world','wasteland','story','plot','arroyo','geck','atmosphere','setting','мир','сюжет']},
  {id:'character-and-builds',focus:'создание персонажа, навыки, характеристики, перки и разнообразие билдов',keywords:['character','skill','perk','stat','build','level','development','навык','персонаж']},
  {id:'combat-and-tactics',focus:'бой, тактика, оружие, темп столкновений и цена решений',keywords:['combat','battle','weapon','action point','sniper','turn','fight','бой','оруж']},
  {id:'quests-and-choice',focus:'квесты, способы решения задач, свобода выбора и последствия',keywords:['quest','choice','karma','reputation','town','decision','квест','выбор','репутац']},
  {id:'companions-and-people',focus:'спутники, NPC, диалоги и то, как персонажи оживляют путешествие',keywords:['npc','companion','dialog','sulik','marcus','personality','спутник','диалог']},
  {id:'exploration-and-structure',focus:'исследование мира, структура путешествия, города и побочный контент',keywords:['explor','location','town','map','travel','side','world','исслед','город']},
  {id:'presentation-and-tone',focus:'визуальная подача, звук, юмор, культурные отсылки и общий характер игры',keywords:['graphic','visual','sound','music','humor','culture','movie','presentation','звук','юмор']},
  {id:'friction-and-age',focus:'недостатки, шероховатости, баги, интерфейс, темп и то, что состарилось хуже всего',keywords:['bug','problem','flaw','weak','interface','slow','frustrat','annoy','dated','проблем','недостат']},
  {id:'why-it-matters',focus:'почему игра работает как целое, чем отличается от предшественника и какое оставляет итоговое впечатление',keywords:['sequel','improv','strength','replay','classic','overall','worthy','legacy','итог','сиквел']}
].slice(0,targetSections);
while(themes.length<targetSections)themes.push({id:`facet-${themes.length+1}`,focus:'ещё одна конкретная грань игрового опыта, подтверждённая источниками',keywords:[]});

function sourceScore(source,theme){const text=JSON.stringify(source.dossier||{}).toLowerCase();return theme.keywords.reduce((sum,k)=>sum+(text.includes(k.toLowerCase())?1:0),0)}
const assignments=themes.map(theme=>{
  const ranked=[...sourceDigest].sort((a,b)=>sourceScore(b,theme)-sourceScore(a,theme)||String(a.id).localeCompare(String(b.id)));
  return ranked.slice(0,Math.min(sourceDigest.length,Math.max(minSectionSources,2))).map(s=>s.id);
});
const assigned=new Set(assignments.flat());
for(const source of sourceDigest){if(assigned.has(source.id))continue;let target=0;for(let i=1;i<assignments.length;i++)if(assignments[i].length<assignments[target].length)target=i;assignments[target].push(source.id);assigned.add(source.id)}
const byId=new Map(sourceDigest.map(s=>[s.id,s]));

const metaSchema={type:'object',additionalProperties:false,required:['title','dek','lead'],properties:{title:{type:'string'},dek:{type:'string'},lead:{type:'string'}}};
async function generateMeta(extra=''){
  const evidence=sourceDigest.slice(0,Math.min(5,sourceDigest.length));
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Пишешь живо и конкретно, без рекламной интонации и без фактов вне предоставленных материалов.',prompt:`Создай заголовок, короткий dek и вступление для большого обзора Игропоиска игры ${identity.title}. Lead должен быть 150–210 русских слов и сразу формулировать редакционный тезис, а не пересказывать справку. Не используй английские слова кроме Fallout/RPG.\nИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nИСТОЧНИКИ:\n${JSON.stringify(evidence)}${extra}`,schema:metaSchema,temperature:0.18,numCtx:12288,numPredict:1100,timeoutMs:LOCAL_COMPONENT_TIMEOUT_MS})
}
function metaErrors(meta){const errors=[];if(!meta?.title||!meta?.dek)errors.push('title/dek missing');if(countWords(meta?.lead)<leadMinWords)errors.push(`lead ${countWords(meta?.lead)}/${leadMinWords}`);const latin=lowerLatin(`${meta?.dek||''} ${meta?.lead||''}`);if(latin.length)errors.push(`latin ${[...new Set(latin)].join(',')}`);return errors}
if(!state.meta||metaErrors(state.meta).length){let errors=[];for(let attempt=1;attempt<=MAX_COMPONENT_ATTEMPTS;attempt++){state.meta=await generateMeta(errors.length?`\nИсправь: ${errors.join('; ')}.`:'');errors=metaErrors(state.meta);if(!errors.length)break}if(errors.length){persist();throw new Error(`${slug}: sectioned meta gate failed: ${errors.join('; ')}`)}persist()}

const sectionSchema={type:'object',additionalProperties:false,required:['heading','paragraphs','image_caption'],properties:{heading:{type:'string'},paragraphs:{type:'array',minItems:minParagraphs,maxItems:5,items:{type:'string'}},image_caption:{type:'string'}}};
async function generateSection(index,extra=''){
  const theme=themes[index],ids=assignments[index],evidence=ids.map(id=>byId.get(id)).filter(Boolean);
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Пиши самостоятельный журнальный раздел только по данным профессиональных рецензий ниже. Не додумывай факты.',prompt:`Это раздел ${index+1} из ${targetSections} большого обзора ${identity.title}. Фокус: ${theme.focus}. Напиши 3–5 полноценных абзацев, целевой объём 350–420 русских слов, абсолютный минимум ${minSectionWords}. Не повторяй вступление и другие разделы. Сопоставляй свидетельства источников, сохраняй конкретику, показывай достоинства и ограничения там, где они подтверждены. Никакого AI-филлера, кальки и английских слов кроме Fallout/RPG. image_caption — короткое описание подходящего игрового скриншота, не artwork.\nКАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nРАЗРЕШЁННЫЕ SOURCE IDS: ${ids.join(', ')}\nДОСЬЕ ДЛЯ ЭТОГО РАЗДЕЛА:\n${JSON.stringify(evidence)}${extra}`,schema:sectionSchema,temperature:0.18,numCtx:16384,numPredict:2200,timeoutMs:LOCAL_COMPONENT_TIMEOUT_MS})
}
const sectionContinuationSchema={type:'object',additionalProperties:false,required:['paragraphs'],properties:{paragraphs:{type:'array',minItems:1,maxItems:2,items:{type:'string'}}}};
async function generateSectionContinuation(index,section,pass,reason=''){
  const theme=themes[index],ids=assignments[index],evidence=ids.map(id=>byId.get(id)).filter(Boolean);
  const currentWords=countWords((section?.paragraphs||[]).join(' ')),missing=Math.max(0,minSectionWords-currentWords);
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Дополняй уже написанный раздел только новыми, подтверждёнными источниками деталями. Не переписывай и не повторяй существующий текст.',prompt:`Раздел ${index+1} обзора ${identity.title} уже написан, но формально короток: ${currentWords}/${minSectionWords} слов. Это bounded continuation ${pass}/${MAX_SECTION_CONTINUATIONS}. Добавь 1–2 новых полноценных русских абзаца примерно по 80–110 слов каждый, пока не будет покрыт недостающий объём ${missing} слов. Продолжение должно углублять фокус «${theme.focus}», не повторять уже сказанное и не добавлять ни одного факта вне разрешённых source dossiers. Не используй английские слова кроме Fallout/RPG.\nТЕКУЩИЙ РАЗДЕЛ:\n${JSON.stringify({heading:section?.heading,paragraphs:section?.paragraphs})}\nРАЗРЕШЁННЫЕ SOURCE IDS: ${ids.join(', ')}\nДОСЬЕ:\n${JSON.stringify(evidence)}${reason?`\nПРИЧИНА ДОПОЛНЕНИЯ: ${reason}`:''}`,schema:sectionContinuationSchema,temperature:0.14,numCtx:12288,numPredict:900,timeoutMs:LOCAL_SECTION_CONTINUATION_TIMEOUT_MS})
}
function sectionErrors(section){const errors=[];const wc=countWords((section?.paragraphs||[]).join(' '));if((section?.paragraphs||[]).length<minParagraphs)errors.push(`paragraphs ${(section?.paragraphs||[]).length}/${minParagraphs}`);if(wc<minSectionWords)errors.push(`words ${wc}/${minSectionWords}`);const latin=lowerLatin((section?.paragraphs||[]).join(' '));if(latin.length)errors.push(`latin ${[...new Set(latin)].join(',')}`);return errors}
async function topUpSection(index,section,{reason=''}={}){
  const id=themes[index].id;let current=section;
  for(let pass=1;pass<=MAX_SECTION_CONTINUATIONS;pass++){
    const errors=sectionErrors(current);if(!errors.length)return current;
    if(errors.some(x=>x.startsWith('latin ')))return current;
    const raw=await generateSectionContinuation(index,current,pass,reason);
    const fresh=(raw?.paragraphs||[]).map(x=>String(x||'').trim()).filter(x=>countWords(x)>=25&&!lowerLatin(x).length);
    if(!fresh.length)continue;
    current={...current,paragraphs:[...(current.paragraphs||[]),...fresh].slice(0,7),source_ids:[...assignments[index]],continuation_parts:Number(current.continuation_parts||0)+1};
    state.sections[id]=current;persist();
  }
  return current;
}
async function buildSection(index,{force=false,reason=''}={}){
  const id=themes[index].id;
  if(!force&&state.sections?.[id]){
    const topped=await topUpSection(index,state.sections[id],{reason:'Сохрани уже валидный материал и добери только недостающую глубину.'});
    if(!sectionErrors(topped).length)return;
  }
  let errors=[];for(let attempt=1;attempt<=MAX_COMPONENT_ATTEMPTS;attempt++){
    const raw=await generateSection(index,[reason,errors.length?`Формальный gate предыдущей версии: ${errors.join('; ')}.`:''].filter(Boolean).join('\n'));
    let section={id,heading:raw.heading,paragraphs:raw.paragraphs,source_ids:[...assignments[index]],image_caption:raw.image_caption,continuation_parts:0};
    state.sections[id]=section;persist();
    section=await topUpSection(index,section,{reason:reason||'Исходная генерация не достигла неизменного коммерческого объёма раздела.'});
    errors=sectionErrors(section);state.sections[id]=section;persist();if(!errors.length)return;
  }
  throw new Error(`${slug}: section ${id} failed bounded component gate: ${errors.join('; ')}`)
}
for(let i=0;i<themes.length;i++)await buildSection(i);

const verdictSchema={type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',minItems:2,maxItems:5,items:{type:'string'}},not_for:{type:'array',minItems:2,maxItems:5,items:{type:'string'}}}};
async function generateVerdict(extra=''){
  const outline=themes.map(t=>state.sections[t.id]).filter(Boolean).map(s=>({id:s.id,heading:s.heading,paragraphs:s.paragraphs,source_ids:s.source_ids}));
  return chatJson({system:'Ты выпускающий редактор игрового журнала. Итог должен быть конкретным, честным и вытекать из уже написанного материала.',prompt:`Сформулируй итог большого обзора ${identity.title}: summary 170–240 русских слов, 2–5 пунктов best_for и 2–5 not_for. Не добавляй новых фактов, которых нет в разделах. Не используй английские слова кроме Fallout/RPG.\nСТАТЬЯ:\n${JSON.stringify(outline)}${extra}`,schema:verdictSchema,temperature:0.12,numCtx:16384,numPredict:1300,timeoutMs:LOCAL_COMPONENT_TIMEOUT_MS})
}
function verdictErrors(v){const errors=[];if(countWords(v?.summary)<120)errors.push(`summary ${countWords(v?.summary)}/120`);if(!(v?.best_for||[]).length||!(v?.not_for||[]).length)errors.push('best_for/not_for missing');const latin=lowerLatin(v?.summary||'');if(latin.length)errors.push(`latin ${[...new Set(latin)].join(',')}`);return errors}
if(!state.verdict||verdictErrors(state.verdict).length){let errors=[];for(let attempt=1;attempt<=MAX_COMPONENT_ATTEMPTS;attempt++){state.verdict=await generateVerdict(errors.length?`\nИсправь: ${errors.join('; ')}.`:'');errors=verdictErrors(state.verdict);persist();if(!errors.length)break}if(errors.length)throw new Error(`${slug}: sectioned verdict gate failed: ${errors.join('; ')}`)}

function articleShape(){const sections=themes.map(t=>state.sections[t.id]).filter(Boolean);return{title:state.meta.title,dek:state.meta.dek,lead:state.meta.lead,sections,verdict:state.verdict,used_source_ids:[...new Set(sections.flatMap(s=>s.source_ids||[]))]}}
function metrics(a){const sections=Array.isArray(a?.sections)?a.sections:[];const total=countWords([a?.lead,...sections.flatMap(s=>s.paragraphs||[]),a?.verdict?.summary].join(' '));return{sections,total,leadWords:countWords(a?.lead),perSection:sections.map(s=>({id:s.id,words:countWords((s.paragraphs||[]).join(' ')),paragraphs:(s.paragraphs||[]).length,sources:new Set(s.source_ids||[]).size}))}}
function deterministicErrors(a){const valid=new Set(sourceDigest.map(s=>s.id)),m=metrics(a),errors=[];if(m.total<minWords)errors.push(`words ${m.total}/${minWords}`);if(m.total>maxWords)errors.push(`words ${m.total}>${maxWords}`);if(m.leadWords<leadMinWords)errors.push(`lead words ${m.leadWords}/${leadMinWords}`);if(m.sections.length<minSections)errors.push(`sections ${m.sections.length}/${minSections}`);for(const row of m.perSection){if(row.words<minSectionWords)errors.push(`${row.id}: words ${row.words}/${minSectionWords}`);if(row.paragraphs<minParagraphs)errors.push(`${row.id}: paragraphs ${row.paragraphs}/${minParagraphs}`);if(row.sources<minSectionSources)errors.push(`${row.id}: sources ${row.sources}/${minSectionSources}`)}const used=new Set(m.sections.flatMap(s=>(s.source_ids||[]).filter(id=>valid.has(id))));if(used.size<minUsed)errors.push(`materially used sources ${used.size}/${minUsed}`);for(const section of m.sections)for(const id of section.source_ids||[])if(!valid.has(id))errors.push(`${section.id}: unknown source ${id}`);const latin=lowerLatin([a?.lead,...m.sections.flatMap(s=>s.paragraphs||[]),a?.verdict?.summary].join(' '));if(latin.length)errors.push(`lowercase latin intrusions: ${[...new Set(latin)].slice(0,20).join(', ')}`);return errors}
let article=articleShape();
let deterministic=deterministicErrors(article);
if(deterministic.some(x=>x.startsWith('words '))&&metrics(article).total<minWords){
  const candidates=[...metrics(article).perSection].sort((a,b)=>a.words-b.words);
  for(const row of candidates){if(metrics(article).total>=minWords)break;const index=themes.findIndex(t=>t.id===row.id);if(index<0)continue;await buildSection(index,{force:true,reason:`Общий материал пока короче обязательных ${minWords} слов. Раскрой этот раздел глубже, целевой объём 410–460 слов, не добавляя неподтверждённых фактов.`});article=articleShape()}
  deterministic=deterministicErrors(article);
}
if(deterministic.length){persist();throw new Error(`${slug}: sectioned article deterministic gate failed: ${deterministic.join('; ')}`)}

function scoreValue(){const score=Number(reviews?.review_score?.calculation?.score_10??ratings?.calculation?.score_10??ratings?.score??game.ratings?.igropoisk);if(!Number.isFinite(score))throw new Error(`${slug}: canonical score missing`);return score}
const auditSchema={type:'object',additionalProperties:false,required:['natural_russian','interesting_editorial_voice','source_grounding','specificity','balanced_criticism','no_generic_filler','issues','section_ids_to_revise'],properties:{natural_russian:{type:'boolean'},interesting_editorial_voice:{type:'boolean'},source_grounding:{type:'boolean'},specificity:{type:'boolean'},balanced_criticism:{type:'boolean'},no_generic_filler:{type:'boolean'},issues:{type:'array',items:{type:'string'}},section_ids_to_revise:{type:'array',items:{type:'string'}}}};
async function audit(a){return chatJson({system:'Ты строгий выпускающий редактор и фактчекер. Не пропускай машинный русский, повторы, общие слова и неподтверждённые факты.',prompt:`Проверь собранную статью по source dossiers. Булевы поля true только если критерий реально выполнен. Если есть проблема в конкретном разделе, добавь его id в section_ids_to_revise; для вступления используй lead, для итога verdict. Не придирайся к отсутствию деталей, которых источники не подтверждают.\nARTICLE:\n${JSON.stringify(a)}\nSOURCE DOSSIERS:\n${JSON.stringify(sourceDigest)}`,schema:auditSchema,temperature:0.03,numCtx:24576,numPredict:1600,timeoutMs:LOCAL_AUDIT_TIMEOUT_MS})}
const auditPassed=a=>['natural_russian','interesting_editorial_voice','source_grounding','specificity','balanced_criticism','no_generic_filler'].every(k=>a?.[k]===true);
let auditResult=await audit(article);
if(!auditPassed(auditResult)){
  const ids=[...new Set(auditResult.section_ids_to_revise||[])].filter(Boolean).slice(0,MAX_TARGETED_REVISIONS);
  for(const id of ids){
    if(id==='lead'){state.meta=await generateMeta(`\nВыпускающий редактор потребовал исправить вступление: ${(auditResult.issues||[]).join('; ')}.`);persist();continue}
    if(id==='verdict'){state.verdict=await generateVerdict(`\nВыпускающий редактор потребовал исправить итог: ${(auditResult.issues||[]).join('; ')}.`);persist();continue}
    const index=themes.findIndex(t=>t.id===id);if(index>=0)await buildSection(index,{force:true,reason:`Замечания выпускающего редактора: ${(auditResult.issues||[]).join('; ')}. Исправь только этот раздел, сохрани фактическую опору.`})
  }
  article=articleShape();deterministic=deterministicErrors(article);if(!deterministic.length&&ids.length)auditResult=await audit(article);
}
state.audit=auditResult;state.revision_count=Number(state.revision_count||0)+(auditPassed(auditResult)?0:1);persist();

function outputFor(a,{publicationStatus,auditResult}){const m=metrics(a),score=scoreValue(),valid=new Set(sourceDigest.map(s=>s.id));for(const section of a.sections)section.source_ids=[...new Set(section.source_ids||[])].filter(id=>valid.has(id));const used=[...new Set(a.sections.flatMap(s=>s.source_ids||[]))];return{schema_version:12,slug,game_slug:slug,game_id:game.game_id||game.identity?.game_id||null,title:a.title,dek:a.dek,author:'Редакция Игропоиска',published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),updated_at:new Date().toISOString(),score,hero:game.media?.hero||game.media?.artwork?.[0]?.url||game.media?.artwork?.[0]||game.media?.cover||'',lead:a.lead,reading_time_minutes:Math.max(10,Math.ceil(m.total/190)),publication_status:publicationStatus,source_gate:{preferred_full_reviews:preferred,accepted_full_reviews:sourceDigest.length,materially_used:used.length,exhaustive_discovery:exhaustive,passed:used.length>=minUsed},source_coverage:{available:sourceDigest.length,materially_used:used.length,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive},methodology:sourceDigest.length>=preferred?`Материал основан на ${sourceDigest.length} независимых полнотекстовых профессиональных рецензиях.`:`Материал основан на всех ${sourceDigest.length} полнотекстовых профессиональных рецензиях, найденных после документированного исчерпывающего поиска.`,identity:{title:identity.title,developer:identity.developers.join(', '),publisher:identity.publishers.join(', '),release_date:game.release?.canonical_date_text||game.release?.date_text||'',genres:identity.genres,platforms:identity.platforms},sections:a.sections,verdict:a.verdict,used_source_ids:used,sources:sourceDigest.map(s=>({id:s.id,name:s.publication,title:s.title,url:s.url,body_words:s.body_words,purpose:'Полнотекстовая профессиональная рецензия, прочитанная и превращённая в source dossier'})),generation:{provider:'local-ollama-fallback',architecture:'sectioned-persistent-v1',model:LOCAL_EDITORIAL_MODEL,checked_at:new Date().toISOString(),commercial_contract:contract.id,corpus_signature:corpusSignature,words:m.total,sections:m.sections.length,deterministic_gate:{passed:true},revision_count:Number(state.revision_count||0),editorial_audit:{passed:auditPassed(auditResult),...auditResult}}}}
if(!auditPassed(auditResult)){
  const rejected=outputFor(article,{publicationStatus:'needs_revision',auditResult});write(`data/article-drafts/${slug}.json`,rejected);write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'commercial-long-review-sectioned-v5',status:'needs_revision',game_slug:slug,checked_at:new Date().toISOString(),provider:'local-ollama-fallback',architecture:'sectioned-persistent-v1',model:LOCAL_EDITORIAL_MODEL,words:rejected.generation.words,sections:rejected.generation.sections,full_review_sources:sourceDigest.length,materially_used_sources:rejected.source_coverage.materially_used,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive,bounded_latency:true,incremental_persistence:true,audit:auditResult});throw new Error(`${slug}: sectioned local editorial audit failed; completed components persisted for retry: ${(auditResult.issues||[]).join('; ')}`)
}
const output=outputFor(article,{publicationStatus:'awaiting_media',auditResult});write(`data/article-drafts/${slug}.json`,output);write(`data/articles/${slug}.json`,output);write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'commercial-long-review-sectioned-v5',status:'green-awaiting-media',game_slug:slug,checked_at:new Date().toISOString(),provider:'local-ollama-fallback',architecture:'sectioned-persistent-v1',model:LOCAL_EDITORIAL_MODEL,words:output.generation.words,sections:output.generation.sections,full_review_sources:sourceDigest.length,materially_used_sources:output.source_coverage.materially_used,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive,bounded_latency:true,incremental_persistence:true,audit:auditResult});
console.log(JSON.stringify({slug,status:'green-awaiting-media',provider:'local-ollama-fallback',architecture:'sectioned-persistent-v1',model:LOCAL_EDITORIAL_MODEL,words:output.generation.words,sections:output.generation.sections,sources:sourceDigest.length,used:output.source_coverage.materially_used},null,2));
