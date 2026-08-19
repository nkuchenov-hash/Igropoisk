#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: synthesize-commercial-review-resilient <slug>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const OPENAI_ACCELERATOR_TIMEOUT_MS=300000,LOCAL_GENERATION_TIMEOUT_MS=900000,LOCAL_AUDIT_TIMEOUT_MS=300000,MAX_FRESH_GENERATIONS=2,MAX_RETRY_REWRITES=1;

if(process.env.OPENAI_API_KEY){
  const legacy=spawnSync('node',['scripts/synthesize-commercial-review-openai.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:48*1024*1024,timeout:OPENAI_ACCELERATOR_TIMEOUT_MS});
  const accelerated=read(`data/articles/${slug}.json`);
  if(legacy.status===0&&accelerated?.generation?.editorial_audit?.passed===true){
    console.log(JSON.stringify({slug,status:'openai-accelerator-ready',words:accelerated.generation?.words||0},null,2));
    process.exit(0);
  }
  console.warn(`${slug}: OpenAI synthesis unavailable or exceeded bounded budget; switching to local ${LOCAL_EDITORIAL_MODEL}`);
}

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{},sourceRules=contract.source_corpus||{},game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`),reviews=read(`data/reviews/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{}),discovery=read(`data/review-discovery-audits/${slug}.json`,{});
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing`);
if(!await localModelReady({timeoutMs:5000}))throw new Error(`${slug}: neither OpenAI nor local ${LOCAL_EDITORIAL_MODEL} is available`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role),preferred=Math.max(8,Number(sourceRules.preferred_minimum_independent_full_reviews||15)),exhaustive=corpus.coverage?.exhaustive_discovery===true&&discovery?.exhaustive===true;
if(!sources.length)throw new Error(`${slug}: no professional full-text review dossiers`);
if(sources.length<preferred&&!exhaustive)throw new Error(`${slug}: source corpus below preferred target without exhaustive discovery proof`);

const minWords=Math.max(2800,Number(rules.minimum_words||3000)),targetWords=Math.max(minWords,Number(rules.target_words||3400)),maxWords=Math.max(targetWords,Number(rules.maximum_words_without_editor_approval||4500)),minSections=Math.max(7,Number(rules.minimum_sections||8)),targetSections=Math.max(minSections,Number(rules.target_sections||9)),maxSections=Math.max(targetSections,Number(rules.maximum_sections||10)),minParagraphs=Math.max(3,Number(rules.minimum_paragraphs_per_section||3)),minSectionWords=Math.max(220,Number(rules.minimum_words_per_section||260)),leadMinWords=Math.max(80,Number(rules.lead_minimum_words||120)),minSectionSources=sources.length>=preferred?Math.max(2,Number(rules.preferred_minimum_sources_per_section||3)):Math.max(1,Number(rules.minimum_sources_per_section_after_exhaustive_discovery||1)),minUsed=sources.length>=preferred?Math.min(sources.length,Math.max(10,Number(rules.preferred_minimum_materially_used_sources||12))):sources.length;
const countWords=v=>(String(v||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length,lowerLatin=v=>[...String(v||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(x=>x[0]).filter(x=>!['fallout','rpg'].includes(x));
const sourceDigest=sources.map(s=>({id:s.id,publication:s.publication,title:s.title,body_words:s.body_words,dossier:s.dossier})),identity={title:game.identity.title,series:game.identity.series||null,release:game.release,developers:game.companies?.developers||[],publishers:game.companies?.publishers||[],genres:game.classification?.genres||[],platforms:game.classification?.platforms||[],description:game.editorial?.integrated_description||game.editorial?.short_description||''};
const corpusSignature=JSON.stringify({generated_at:corpus.generated_at||'',sources:sourceDigest.map(s=>s.id),publications:sourceDigest.map(s=>s.publication)});
const schema={type:'object',additionalProperties:false,required:['title','dek','lead','sections','verdict','used_source_ids'],properties:{title:{type:'string'},dek:{type:'string'},lead:{type:'string'},sections:{type:'array',minItems:minSections,maxItems:maxSections,items:{type:'object',additionalProperties:false,required:['id','heading','paragraphs','source_ids','image_caption'],properties:{id:{type:'string'},heading:{type:'string'},paragraphs:{type:'array',minItems:minParagraphs,maxItems:6,items:{type:'string'}},source_ids:{type:'array',minItems:minSectionSources,items:{type:'string'}},image_caption:{type:'string'}}}},verdict:{type:'object',additionalProperties:false,required:['summary','best_for','not_for'],properties:{summary:{type:'string'},best_for:{type:'array',items:{type:'string'}},not_for:{type:'array',items:{type:'string'}}}},used_source_ids:{type:'array',items:{type:'string'}}}};
const corpusNote=sources.length>=preferred?`Корпус широкий: ${sources.length} полнотекстовых независимых рецензий; используй минимум ${minUsed}.`:`После документированного исчерпывающего поиска реально найдено ${sources.length} полнотекстовых профессиональных рецензий. Используй ВСЕ ${sources.length} глубоко и не придумывай отсутствующие мнения.`;
const basePrompt=`Напиши большой журнальный обзор Игропоиска игры ${identity.title}. ${corpusNote}
ЖЁСТКИЕ ПРАВИЛА:
- ${minSections}–${maxSections} смысловых разделов, цель ${targetSections}; минимум ${minParagraphs} полноценных абзаца в каждом.
- Не меньше ${minWords} содержательных слов, цель ${targetWords}, максимум ${maxWords}; lead минимум ${leadMinWords} слов.
- Каждый раздел раскрывает конкретную сторону именно этой игры и имеет минимум ${minSectionSources} source_ids из предоставленных досье.
- По статье в целом используй минимум ${minUsed} разных источников.
- Не выдумывай факты, числа, механику, события или оценки. Если досье не подтверждает деталь — не пиши её.
- Обязательно раскрой как достоинства, так и реальные ограничения/недостатки, подтверждённые источниками.
- Живой современный русский язык без кальки, канцелярита, рекламной интонации, AI-филлера и повторов.
- В каждом разделе image_caption описывает только игровой скриншот, не artwork.
КАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:
${JSON.stringify(identity)}
SOURCE DOSSIERS:
${JSON.stringify(sourceDigest)}`;
function metrics(a){const sections=Array.isArray(a?.sections)?a.sections:[],total=countWords([a?.lead,...sections.flatMap(s=>s.paragraphs||[]),a?.verdict?.summary].join(' '));return{sections,total,leadWords:countWords(a?.lead),perSection:sections.map(s=>({id:s.id,words:countWords((s.paragraphs||[]).join(' ')),paragraphs:(s.paragraphs||[]).length,sources:new Set(s.source_ids||[]).size}))}}
function deterministicErrors(a){const valid=new Set(sourceDigest.map(s=>s.id)),m=metrics(a),errors=[];if(m.total<minWords)errors.push(`words ${m.total}/${minWords}`);if(m.total>maxWords)errors.push(`words ${m.total}>${maxWords}`);if(m.leadWords<leadMinWords)errors.push(`lead words ${m.leadWords}/${leadMinWords}`);if(m.sections.length<minSections||m.sections.length>maxSections)errors.push(`sections ${m.sections.length}/${minSections}-${maxSections}`);for(const row of m.perSection){if(row.words<minSectionWords)errors.push(`${row.id}: words ${row.words}/${minSectionWords}`);if(row.paragraphs<minParagraphs)errors.push(`${row.id}: paragraphs ${row.paragraphs}/${minParagraphs}`);if(row.sources<minSectionSources)errors.push(`${row.id}: sources ${row.sources}/${minSectionSources}`)}const used=new Set(m.sections.flatMap(s=>(s.source_ids||[]).filter(id=>valid.has(id))));if(used.size<minUsed)errors.push(`materially used sources ${used.size}/${minUsed}`);for(const section of m.sections){for(const id of section.source_ids||[])if(!valid.has(id))errors.push(`${section.id}: unknown source ${id}`)}if(rules.require_strengths_and_weaknesses!==false){if(!(a?.verdict?.best_for||[]).length)errors.push('verdict best_for missing');if(!(a?.verdict?.not_for||[]).length)errors.push('verdict not_for missing')}const latin=lowerLatin([a?.lead,...m.sections.flatMap(s=>s.paragraphs||[]),a?.verdict?.summary].join(' '));if(latin.length)errors.push(`lowercase latin intrusions: ${[...new Set(latin)].slice(0,20).join(', ')}`);return errors}
async function generate(extra=''){return chatJson({system:'Ты старший русскоязычный игровой журналист. Пишешь оригинальный большой журнальный текст только по предоставленным профессиональным досье и не додумываешь факты.',prompt:`${basePrompt}${extra}`,schema,temperature:0.18,numCtx:32768,numPredict:10000,timeoutMs:LOCAL_GENERATION_TIMEOUT_MS})}
const auditSchema={type:'object',additionalProperties:false,required:['natural_russian','interesting_editorial_voice','source_grounding','specificity','balanced_criticism','no_generic_filler','issues'],properties:{natural_russian:{type:'boolean'},interesting_editorial_voice:{type:'boolean'},source_grounding:{type:'boolean'},specificity:{type:'boolean'},balanced_criticism:{type:'boolean'},no_generic_filler:{type:'boolean'},issues:{type:'array',items:{type:'string'}}}};
async function audit(a){return chatJson({system:'Ты строгий выпускающий редактор и фактчекер. Не пропускай машинный русский, повторы, общие слова и неподтверждённые факты.',prompt:`Проверь статью по досье. Все шесть булевых полей могут быть true только если статья естественная, конкретная, сбалансированная, без AI-филлера и каждое существенное утверждение реально поддерживается указанными source_ids.
ARTICLE:
${JSON.stringify(a)}
DOSSIERS:
${JSON.stringify(sourceDigest)}`,schema:auditSchema,temperature:0.03,numCtx:32768,numPredict:1800,timeoutMs:LOCAL_AUDIT_TIMEOUT_MS})}
const auditPassed=a=>['natural_russian','interesting_editorial_voice','source_grounding','specificity','balanced_criticism','no_generic_filler'].every(k=>a?.[k]===true);
function articleShape(value){return value?{title:value.title,dek:value.dek,lead:value.lead,sections:value.sections,verdict:value.verdict,used_source_ids:value.used_source_ids||[]}:null}
function outputFor(article,{publicationStatus,auditResult=null,deterministicPassed=true,revisionCount=0}={}){const m=metrics(article),score=Number(reviews?.review_score?.calculation?.score_10??ratings?.calculation?.score_10??ratings?.score??game.ratings?.igropoisk);if(!Number.isFinite(score))throw new Error(`${slug}: canonical score missing`);const valid=new Set(sourceDigest.map(s=>s.id));for(const section of article.sections)section.source_ids=[...new Set(section.source_ids||[])].filter(id=>valid.has(id));const used=[...new Set(article.sections.flatMap(s=>s.source_ids||[]))];return{schema_version:12,slug,game_slug:slug,game_id:game.game_id||game.identity?.game_id||null,title:article.title,dek:article.dek,author:'Редакция Игропоиска',published_at:new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}),updated_at:new Date().toISOString(),score,hero:game.media?.hero||game.media?.artwork?.[0]?.url||game.media?.artwork?.[0]||game.media?.cover||'',lead:article.lead,reading_time_minutes:Math.max(10,Math.ceil(m.total/190)),publication_status:publicationStatus,source_gate:{preferred_full_reviews:preferred,accepted_full_reviews:sourceDigest.length,materially_used:used.length,exhaustive_discovery:exhaustive,passed:used.length>=minUsed},source_coverage:{available:sourceDigest.length,materially_used:used.length,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive},methodology:sourceDigest.length>=preferred?`Материал основан на ${sourceDigest.length} независимых полнотекстовых профессиональных рецензиях.`:`Материал основан на всех ${sourceDigest.length} полнотекстовых профессиональных рецензиях, найденных после документированного исчерпывающего поиска.`,identity:{title:identity.title,developer:identity.developers.join(', '),publisher:identity.publishers.join(', '),release_date:game.release?.canonical_date_text||game.release?.date_text||'',genres:identity.genres,platforms:identity.platforms},sections:article.sections,verdict:article.verdict,used_source_ids:used,sources:sourceDigest.map(s=>({id:s.id,name:s.publication,title:s.title,url:s.url,body_words:s.body_words,purpose:'Полнотекстовая профессиональная рецензия, прочитанная и превращённая в source dossier'})),generation:{provider:'local-ollama-fallback',model:LOCAL_EDITORIAL_MODEL,checked_at:new Date().toISOString(),commercial_contract:contract.id,corpus_signature:corpusSignature,words:m.total,sections:m.sections.length,deterministic_gate:{passed:deterministicPassed},revision_count:revisionCount,editorial_audit:auditResult?{passed:auditPassed(auditResult),...auditResult}:{passed:false,issues:['pending_editorial_audit']}}}}

const previous=read(`data/article-drafts/${slug}.json`),previousShape=articleShape(previous),previousReusable=previous?.generation?.provider==='local-ollama-fallback'&&previous?.generation?.commercial_contract===contract.id&&previous?.generation?.corpus_signature===corpusSignature&&previous?.generation?.deterministic_gate?.passed===true&&!deterministicErrors(previousShape).length;
let article=null,revisionCount=Number(previous?.generation?.revision_count||0),generationCount=0;
if(previousReusable){
  article=previousShape;
  const oldAudit=previous?.generation?.editorial_audit;
  if(oldAudit?.passed!==true&&(oldAudit?.issues||[]).length&&!(oldAudit.issues||[]).includes('pending_editorial_audit')){
    if(MAX_RETRY_REWRITES<1)throw new Error(`${slug}: persisted article needs editorial revision`);
    article=await generate(`\n\nПРЕДЫДУЩИЙ ДЕТЕРМИНИСТИЧЕСКИ ВАЛИДНЫЙ ЧЕРНОВИК:\n${JSON.stringify(article)}\nВыпускающий редактор отклонил его. Перепиши целиком, сохранив фактическую опору и формальный объём, и исправь замечания: ${(oldAudit.issues||[]).join('; ')}`);
    generationCount++;revisionCount++;
    const errors=deterministicErrors(article);
    if(errors.length)throw new Error(`${slug}: persisted-review rewrite failed deterministic gate: ${errors.join('; ')}`);
  }
}else{
  let errors=[];
  for(let attempt=1;attempt<=MAX_FRESH_GENERATIONS;attempt++){
    article=await generate(attempt===1?'':`\n\nПредыдущая версия не прошла формальный gate: ${errors.join('; ')}. Перепиши материал целиком и исправь каждый пункт без снижения фактической точности.`);
    generationCount++;
    errors=deterministicErrors(article);
    if(!errors.length)break;
  }
  const finalErrors=deterministicErrors(article);
  if(finalErrors.length)throw new Error(`${slug}: local long review deterministic gate failed after bounded ${MAX_FRESH_GENERATIONS} generations: ${finalErrors.join('; ')}`);
}
const provisional=outputFor(article,{publicationStatus:'needs_editorial_audit',deterministicPassed:true,revisionCount});
write(`data/article-drafts/${slug}.json`,provisional);
write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'commercial-long-review-resilient-v4',status:'awaiting-editorial-audit',game_slug:slug,checked_at:new Date().toISOString(),provider:'local-ollama-fallback',model:LOCAL_EDITORIAL_MODEL,words:provisional.generation.words,sections:provisional.generation.sections,full_review_sources:sourceDigest.length,materially_used_sources:provisional.source_coverage.materially_used,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive,generation_count_this_run:generationCount,revision_count:revisionCount,bounded_latency:true});

let auditResult;
try{auditResult=await audit(article)}catch(error){auditResult={natural_russian:false,interesting_editorial_voice:false,source_grounding:false,specificity:false,balanced_criticism:false,no_generic_filler:false,issues:[`audit_transport_failed: ${error?.message||String(error)}`]}}
if(!auditPassed(auditResult)){
  const rejected=outputFor(article,{publicationStatus:'needs_revision',auditResult,deterministicPassed:true,revisionCount});
  write(`data/article-drafts/${slug}.json`,rejected);
  write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'commercial-long-review-resilient-v4',status:'needs_revision',game_slug:slug,checked_at:new Date().toISOString(),provider:'local-ollama-fallback',model:LOCAL_EDITORIAL_MODEL,words:rejected.generation.words,sections:rejected.generation.sections,full_review_sources:sourceDigest.length,materially_used_sources:rejected.source_coverage.materially_used,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive,generation_count_this_run:generationCount,revision_count:revisionCount,bounded_latency:true,audit:auditResult});
  throw new Error(`${slug}: local editorial audit failed; deterministic draft persisted for retry: ${(auditResult.issues||[]).join('; ')}`);
}
const output=outputFor(article,{publicationStatus:'awaiting_media',auditResult,deterministicPassed:true,revisionCount});
write(`data/article-drafts/${slug}.json`,output);
write(`data/articles/${slug}.json`,output);
write(`data/parser-runs/review-synthesis-${slug}.json`,{parser:'commercial-long-review-resilient-v4',status:'green-awaiting-media',game_slug:slug,checked_at:new Date().toISOString(),provider:'local-ollama-fallback',model:LOCAL_EDITORIAL_MODEL,words:output.generation.words,sections:output.generation.sections,full_review_sources:sourceDigest.length,materially_used_sources:output.source_coverage.materially_used,preferred_target_met:sourceDigest.length>=preferred,exhaustive_discovery:exhaustive,generation_count_this_run:generationCount,revision_count:revisionCount,bounded_latency:true,audit:auditResult});
console.log(JSON.stringify({slug,status:'green-awaiting-media',provider:'local-ollama-fallback',model:LOCAL_EDITORIAL_MODEL,words:output.generation.words,sections:output.generation.sections,sources:sourceDigest.length,used:output.source_coverage.materially_used,generation_count_this_run:generationCount,revision_count:revisionCount},null,2));
