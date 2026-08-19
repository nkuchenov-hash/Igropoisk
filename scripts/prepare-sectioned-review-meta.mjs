#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: prepare-sectioned-review-meta <slug>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const target=path.join(root,r);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(v,null,2)}\n`)};
const words=v=>(String(v||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const lowerLatin=v=>[...String(v||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(x=>x[0]).filter(x=>!['fallout','rpg'].includes(x));
const placeholder=/(?:^|\b)(?:текст\s+от|краткое\s+описание|напиши(?:те)?|создай(?:те)?|русск(?:их|ими)\s+слов|для\s+обзора|формулирует\s+редакционный\s+тезис|целевой\s+объ[её]м)(?:\b|$)/i;
const machineRussian=/(?:экспелир\w*|достоинственност\w*|непоседн\w*\s+NPC|валлта[-\s]?двейлер\w*)/iu;
const LEAD_PART_TIMEOUT_MS=150000,LEAD_PART_RETRY_TIMEOUT_MS=90000,DEK_TIMEOUT_MS=60000,META_QUALITY_TIMEOUT_MS=120000,SECTION_REUSE_AUDIT_TIMEOUT_MS=120000,MAX_LEAD_PARTS=3,MAX_META_QUALITY_PASSES=2;

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{};
const game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`);
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing for meta preflight`);
if(!await localModelReady({timeoutMs:5000}))throw new Error(`${slug}: local ${LOCAL_EDITORIAL_MODEL} is unavailable for meta preflight`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role);
if(!sources.length)throw new Error(`${slug}: professional review corpus is empty`);
const leadMinWords=Math.max(80,Number(rules.lead_minimum_words||120));
const sourceDigest=sources.map(s=>({id:s.id,publication:s.publication,title:s.title,body_words:s.body_words,dossier:s.dossier}));
const sourceById=new Map(sourceDigest.map(s=>[s.id,s]));
const identity={title:game.identity.title,series:game.identity.series||null,release:game.release,developers:game.companies?.developers||[],publishers:game.companies?.publishers||[],genres:game.classification?.genres||[],platforms:game.classification?.platforms||[],description:game.editorial?.integrated_description||game.editorial?.short_description||''};
const corpusSignature=JSON.stringify({sources:sourceDigest.map(s=>[s.id,s.publication,s.body_words]),contract:contract.id});
const statePath=`data/article-section-drafts/${slug}.json`;
let state=read(statePath,{});
if(state?.corpus_signature!==corpusSignature)state={schema_version:1,slug,corpus_signature:corpusSignature,model:LOCAL_EDITORIAL_MODEL,meta:null,meta_parts:{lead:[]},sections:{},verdict:null,audit:null,revision_count:0,updated_at:new Date().toISOString()};
if(!state.meta_parts||typeof state.meta_parts!=='object')state.meta_parts={lead:[]};
if(!Array.isArray(state.meta_parts.lead))state.meta_parts.lead=[];
if(!state.sections||typeof state.sections!=='object')state.sections={};
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};
const compactText=(v,max=360)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const compactList=(v,n=2,max=180)=>Array.isArray(v)?v.slice(0,n).map(x=>compactText(x,max)).filter(Boolean):[];
const compactSource=s=>({id:s.id,publication:s.publication,summary:compactText(s.dossier?.summary,440),strengths:compactList(s.dossier?.strengths,2),criticisms:compactList(s.dossier?.criticisms,2),systems:compactList(s.dossier?.systems,2),examples:compactList(s.dossier?.specific_examples,2),claims:compactList(s.dossier?.notable_claims,2)});
const compactEvidence=sourceDigest.slice(0,6).map(compactSource);
const tokens=v=>new Set(String(v||'').toLowerCase().normalize('NFKC').replace(/ё/g,'е').match(/[a-zа-я0-9]{3,}/gi)||[]);
function textSimilarity(a,b){const aa=tokens(a),bb=tokens(b);if(!aa.size||!bb.size)return 0;let common=0;for(const t of aa)if(bb.has(t))common++;return common/Math.min(aa.size,bb.size)}
const nearDuplicateText=(a,b)=>textSimilarity(a,b)>=0.72;
function paragraphDuplicateErrors(paragraphs){const p=(paragraphs||[]).map(x=>String(x||'').trim()).filter(Boolean),out=[];for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)if(nearDuplicateText(p[i],p[j]))out.push(`near-duplicate paragraphs ${i+1}/${j+1}`);return out}

function errors(meta){
  const out=[];
  const title=String(meta?.title||'').trim(),dek=String(meta?.dek||'').trim(),lead=String(meta?.lead||'').trim();
  if(words(title)<2||title.length<5)out.push('title missing/too short');
  if(words(dek)<18||dek.length<100)out.push(`dek ${words(dek)}/18`);
  const leadWords=words(lead);if(leadWords<leadMinWords)out.push(`lead ${leadWords}/${leadMinWords}`);if(leadWords>220)out.push(`lead ${leadWords}>220`);
  if(placeholder.test(`${title}\n${dek}\n${lead}`))out.push('instruction-placeholder text');
  if(machineRussian.test(`${dek}\n${lead}`))out.push('obvious machine-russian token');
  out.push(...paragraphDuplicateErrors(lead.split(/\n\s*\n/)));
  const latin=lowerLatin(`${dek} ${lead}`);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);
  return out;
}
function partErrors(text){const out=[],wc=words(text);if(wc<45)out.push(`part ${wc}/45`);if(wc>105)out.push(`part ${wc}>105`);if(placeholder.test(text))out.push('instruction-placeholder text');if(machineRussian.test(text))out.push('obvious machine-russian token');const latin=lowerLatin(text);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function dekErrors(dek){const out=[];if(words(dek)<18||String(dek||'').length<100)out.push(`dek ${words(dek)}/18`);if(words(dek)>55)out.push(`dek ${words(dek)}>55`);if(placeholder.test(dek))out.push('instruction-placeholder text');if(machineRussian.test(dek))out.push('obvious machine-russian token');const latin=lowerLatin(dek);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function joinedLead(){return state.meta_parts.lead.map(x=>String(x||'').trim()).filter(Boolean).join('\n\n').trim()}
function dedupeLeadParts(parts){const out=[];for(const part of parts||[]){if(partErrors(part).length)continue;if(out.some(existing=>nearDuplicateText(existing,part)))continue;out.push(String(part).trim());if(out.length>=MAX_LEAD_PARTS)break}return out}

const partSchema={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:{type:'string'}}};
async function generateLeadPart({partIndex,evidence,existing='',timeoutMs=LEAD_PART_TIMEOUT_MS}){
  const focus=partIndex===0?'Сформулируй главный редакционный тезис и конкретно объясни, почему мир, ролевая свобода и системы игры работают.':partIndex===1?'Продолжи без повторов: покажи ограничения, шероховатости, цену этой свободы и то, что критики считают слабее сильных сторон.':'Добавь только недостающий конкретный ракурс из evidence, чтобы вступление стало полноценным; не повторяй уже сказанное.';
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Верни только один готовый абзац в JSON. Никаких инструкций, шаблонов и мета-комментариев. Не добавляй факты вне evidence.',prompt:`Для вступления большого обзора ${identity.title} напиши один самостоятельный абзац на 65–90 русских слов. ${focus}\nАнглийские слова запрещены кроме Fallout/RPG. Избегай кальки с английского и не переводи собственные имена неестественными транслитерациями.\nУЖЕ НАПИСАНО (не повторять ни формулировки, ни тезисы):\n${existing||'(ничего)'}\nКАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nEVIDENCE:\n${JSON.stringify(evidence)}`,schema:partSchema,temperature:0.22,numCtx:6144,numPredict:520,timeoutMs});
}
const dekSchema={type:'object',additionalProperties:false,required:['dek'],properties:{dek:{type:'string'}}};
async function generateDek(lead){return chatJson({system:'Ты выпускающий редактор. Верни только готовый короткий dek в JSON, без инструкций и мета-комментариев.',prompt:`По готовому вступлению обзора ${identity.title} напиши dek на 25–40 русских слов. Он должен кратко передать редакционный тезис, не повторять заголовок и не добавлять новых фактов. Английские слова запрещены кроме Fallout/RPG.\nLEAD:\n${lead}`,schema:dekSchema,temperature:0.15,numCtx:4096,numPredict:320,timeoutMs:DEK_TIMEOUT_MS})}
function deterministicDek(lead){const sentences=String(lead||'').split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);let out='';for(const sentence of sentences){const next=[out,sentence].filter(Boolean).join(' ');if(words(next)>45)break;out=next;if(words(out)>=25)break}if(words(out)<18)out=String(lead||'').split(/\s+/).slice(0,40).join(' ').replace(/[,:;—-]+$/,'').trim()+'.';return out}

async function buildMeta(){
  state.meta={...(state.meta||{}),title:identity.title};
  const oldLead=String(state.meta.lead||'').trim();
  if(!state.meta_parts.lead.length&&!partErrors(oldLead).length&&words(oldLead)<leadMinWords)state.meta_parts.lead=[oldLead];
  state.meta_parts.lead=dedupeLeadParts(state.meta_parts.lead);
  let currentLead=joinedLead();
  for(let partIndex=state.meta_parts.lead.length;words(currentLead)<leadMinWords&&partIndex<MAX_LEAD_PARTS;partIndex++){
    const evidence=compactEvidence.slice(partIndex*2,partIndex*2+2).length?compactEvidence.slice(partIndex*2,partIndex*2+2):compactEvidence.slice(0,2);
    let part='',lastError='';
    for(const timeoutMs of [LEAD_PART_TIMEOUT_MS,LEAD_PART_RETRY_TIMEOUT_MS]){
      try{
        const result=await generateLeadPart({partIndex,evidence,existing:currentLead,timeoutMs});part=String(result?.paragraph||'').trim();
        const gate=partErrors(part);if(state.meta_parts.lead.some(existing=>nearDuplicateText(existing,part)))gate.push('near-duplicate existing lead paragraph');
        if(!gate.length)break;lastError=gate.join('; ');part='';
      }catch(error){lastError=error.message;part=''}
    }
    if(!part){persist();throw new Error(`${slug}: lead paragraph ${partIndex+1} failed: ${lastError||'no valid paragraph'}`)}
    state.meta_parts.lead.push(part);currentLead=joinedLead();state.meta.lead=currentLead;persist();
  }
  currentLead=joinedLead()||oldLead;state.meta.lead=currentLead;persist();
  const leadWords=words(currentLead);if(leadWords<leadMinWords||leadWords>220||placeholder.test(currentLead)||machineRussian.test(currentLead)||lowerLatin(currentLead).length||paragraphDuplicateErrors(currentLead.split(/\n\s*\n/)).length)throw new Error(`${slug}: persistent multi-paragraph lead failed: ${leadWords}/${leadMinWords}`);
  let currentDek=String(state.meta.dek||'').trim();if(dekErrors(currentDek).length){try{const result=await generateDek(currentLead);currentDek=String(result?.dek||'').trim()}catch{currentDek=deterministicDek(currentLead)}if(dekErrors(currentDek).length)currentDek=deterministicDek(currentLead);state.meta.dek=currentDek;persist()}
  const finalErrors=errors(state.meta);if(finalErrors.length){persist();throw new Error(`${slug}: meta preflight failed: ${finalErrors.join('; ')}`)}
}

const qualitySchema={type:'object',additionalProperties:false,required:['natural_russian','source_grounding','no_repetition','editorial_specificity','issues'],properties:{natural_russian:{type:'boolean'},source_grounding:{type:'boolean'},no_repetition:{type:'boolean'},editorial_specificity:{type:'boolean'},issues:{type:'array',items:{type:'string'}}}};
const qualityPassed=q=>q?.natural_russian===true&&q?.source_grounding===true&&q?.no_repetition===true&&q?.editorial_specificity===true;
async function auditMeta(){return chatJson({system:'Ты строгий русскоязычный выпускающий редактор и фактчекер. Ищи кальку, кривую грамматику, повторы и факты, которых нет в evidence. Не ставь true из вежливости.',prompt:`Проверь только заголовок, dek и lead обзора ${identity.title}. natural_russian=true только если текст читается как профессионально написанный по-русски, без машинной кальки и неестественных транслитераций. source_grounding=true только если каждый конкретный факт является прямым или осторожным пересказом evidence. no_repetition=true только если абзацы не повторяют один и тот же текст или тезис. editorial_specificity=true только если это содержательное вступление об этой игре, а не общий AI-текст.\nMETA:\n${JSON.stringify(state.meta)}\nEVIDENCE:\n${JSON.stringify(compactEvidence)}`,schema:qualitySchema,temperature:0.02,numCtx:8192,numPredict:650,timeoutMs:META_QUALITY_TIMEOUT_MS})}

let metaQuality=null;
for(let pass=1;pass<=MAX_META_QUALITY_PASSES;pass++){
  await buildMeta();
  metaQuality=await auditMeta();
  const deterministicQuality=errors(state.meta);
  state.meta_quality_audit={checked_at:new Date().toISOString(),pass,fingerprint:JSON.stringify({dek:state.meta.dek,lead:state.meta.lead}),passed:qualityPassed(metaQuality)&&!deterministicQuality.length,criteria:metaQuality,deterministic_errors:deterministicQuality};persist();
  if(state.meta_quality_audit.passed)break;
  if(pass<MAX_META_QUALITY_PASSES){state.meta_parts.lead=[];state.meta.lead='';state.meta.dek='';persist()}
}
if(!state.meta_quality_audit?.passed)throw new Error(`${slug}: meta editorial quality gate failed: ${(metaQuality?.issues||[]).join('; ')||'quality criteria false'}`);

function sectionFingerprint(section){return JSON.stringify({heading:section?.heading||'',paragraphs:section?.paragraphs||[],source_ids:section?.source_ids||[]})}
async function auditPersistedSection(id,section){
  const fingerprint=sectionFingerprint(section);if(section?.quality_reuse_audit?.fingerprint===fingerprint&&section.quality_reuse_audit.passed===true)return true;
  const evidence=(section?.source_ids||[]).map(x=>sourceById.get(x)).filter(Boolean).map(compactSource);
  const deterministic=[...paragraphDuplicateErrors(section?.paragraphs||[])];if(machineRussian.test((section?.paragraphs||[]).join('\n')))deterministic.push('obvious machine-russian token');
  let verdict={natural_russian:false,source_grounding:false,no_repetition:false,editorial_specificity:false,issues:['missing source evidence']};
  if(evidence.length){
    verdict=await chatJson({system:'Ты строгий русскоязычный выпускающий редактор и фактчекер. Проверяй только предоставленный раздел против его разрешённых source dossiers. Ищи машинный русский, неправильный перевод терминов, повторы и додуманные детали.',prompt:`Проверь сохранённый раздел обзора ${identity.title}. natural_russian=true только для естественного профессионального русского без кальки, сломанной грамматики и нелепой транслитерации. source_grounding=true только если все конкретные утверждения поддержаны приложенными source dossiers; любое придуманное имя, предмет, механика, причинность или оценка делает критерий false. no_repetition=true только при отсутствии смысловых и почти дословных повторов. editorial_specificity=true только если раздел конкретен и аналитичен, без пустого AI-филлера.\nSECTION ID: ${id}\nSECTION:\n${JSON.stringify({heading:section?.heading,paragraphs:section?.paragraphs})}\nALLOWED EVIDENCE:\n${JSON.stringify(evidence)}`,schema:qualitySchema,temperature:0.02,numCtx:8192,numPredict:700,timeoutMs:SECTION_REUSE_AUDIT_TIMEOUT_MS});
  }
  const passed=qualityPassed(verdict)&&!deterministic.length;
  section.quality_reuse_audit={checked_at:new Date().toISOString(),fingerprint,passed,criteria:verdict,deterministic_errors:deterministic};state.sections[id]=section;persist();
  if(!passed){if(!state.section_quality_rejections||typeof state.section_quality_rejections!=='object')state.section_quality_rejections={};state.section_quality_rejections[id]={checked_at:new Date().toISOString(),issues:[...(verdict?.issues||[]),...deterministic]};delete state.sections[id];persist()}
  return passed;
}
let reusedSectionsChecked=0,reusedSectionsRejected=0;
for(const [id,section] of Object.entries({...state.sections})){reusedSectionsChecked++;if(!await auditPersistedSection(id,section))reusedSectionsRejected++}

persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama',architecture:'persistent-multi-paragraph-meta-v4-quality-gated',model:LOCAL_EDITORIAL_MODEL,title:state.meta.title,dek_words:words(state.meta.dek),lead_words:words(state.meta.lead),lead_parts:state.meta_parts.lead.length,evidence_sources:compactEvidence.length,placeholder:false,bounded_component_timeouts:true,meta_quality_passed:true,reused_sections_checked:reusedSectionsChecked,reused_sections_rejected:reusedSectionsRejected},null,2));
