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
const placeholder=/(?:^|\b)(?:текст\s+от|краткое\s+описание|напиши(?:те)?|создай(?:те)?|русск(?:их|ими)\s+слов|для\s+обзора|целевой\s+объ[её]м)(?:\b|$)/i;
const machineRussian=/(?:экспелир\w*|достоинственност\w*|непоседн\w*\s+NPC|валлта[-\s]?двейлер\w*)/iu;
const LEAD_PACKAGE_TIMEOUT_MS=90000;
const LEAD_PACKAGE_RETRY_TIMEOUT_MS=60000;
const LEAD_GENERATION_NUM_CTX=4096;
const LEAD_PACKAGE_NUM_PREDICT=760;
const MAX_LEAD_GENERATION_ATTEMPTS=2;
const ARCHITECTURE='deterministic-preflight-v2-grounded-bootstrap-failsafe';

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{};
const game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`),bootstrap=read(`data/review-bootstrap/${slug}.json`,{});
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing for deterministic preflight`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role);
if(!sources.length)throw new Error(`${slug}: professional review corpus is empty`);
const leadMinWords=Math.max(80,Number(rules.lead_minimum_words||120));
const sourceDigest=sources.map(s=>({id:s.id,publication:s.publication,title:s.title,body_words:s.body_words,dossier:s.dossier}));
const sourceIds=new Set(sourceDigest.map(s=>s.id));
const identity={title:game.identity.title,series:game.identity.series||null,release_date:game.release?.canonical_date_text||game.release?.date_text||game.release?.date||'',genres:game.classification?.genres||[]};
const corpusSignature=JSON.stringify({sources:sourceDigest.map(s=>[s.id,s.publication,s.body_words]),contract:contract.id});
const statePath=`data/article-section-drafts/${slug}.json`;
let state=read(statePath,{});
if(state?.corpus_signature!==corpusSignature)state={schema_version:1,slug,corpus_signature:corpusSignature,model:LOCAL_EDITORIAL_MODEL,meta:null,meta_parts:{lead:[]},sections:{},verdict:null,audit:null,revision_count:0,updated_at:new Date().toISOString()};
if(!state.sections||typeof state.sections!=='object')state.sections={};
if(!state.meta_parts||typeof state.meta_parts!=='object')state.meta_parts={lead:[]};
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};
const compactText=(v,max=300)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const compactList=(v,n=2,max=150)=>Array.isArray(v)?v.slice(0,n).map(x=>compactText(x,max)).filter(Boolean):[];
const compactSource=s=>({id:s.id,publication:s.publication,summary:compactText(s.dossier?.summary,300),strengths:compactList(s.dossier?.strengths,2),criticisms:compactList(s.dossier?.criticisms,2),systems:compactList(s.dossier?.systems,2),examples:compactList(s.dossier?.specific_examples,2),claims:compactList(s.dossier?.notable_claims,2)});
const compactEvidence=sourceDigest.slice(0,6).map(compactSource);
const tokens=v=>new Set(String(v||'').toLowerCase().normalize('NFKC').replace(/ё/g,'е').match(/[a-zа-я0-9]{3,}/gi)||[]);
function textSimilarity(a,b){const aa=tokens(a),bb=tokens(b);if(!aa.size||!bb.size)return 0;let common=0;for(const t of aa)if(bb.has(t))common++;return common/Math.min(aa.size,bb.size)}
const nearDuplicateText=(a,b)=>textSimilarity(a,b)>=0.72;
function paragraphDuplicateErrors(paragraphs){const p=(paragraphs||[]).map(x=>String(x||'').trim()).filter(Boolean),out=[];for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)if(nearDuplicateText(p[i],p[j]))out.push(`near-duplicate paragraphs ${i+1}/${j+1}`);return out}

function proseErrors(text,{min=0,max=Infinity}={}){
  const out=[],wc=words(text);
  if(wc<min)out.push(`words ${wc}/${min}`);
  if(wc>max)out.push(`words ${wc}>${max}`);
  if(placeholder.test(text))out.push('instruction-placeholder text');
  if(machineRussian.test(text))out.push('obvious machine-russian token');
  const latin=lowerLatin(text);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);
  return out;
}
function metaErrors(meta){
  const out=[];
  if(String(meta?.title||'').trim()!==String(identity.title).trim())out.push('title must equal canonical title');
  const dek=String(meta?.dek||'').trim(),lead=String(meta?.lead||'').trim();
  out.push(...proseErrors(dek,{min:18,max:55}).map(x=>`dek ${x}`));
  out.push(...proseErrors(lead,{min:leadMinWords,max:220}).map(x=>`lead ${x}`));
  out.push(...paragraphDuplicateErrors(lead.split(/\n\s*\n/)));
  return out;
}
function leadPackageErrors(paragraphs){
  const parts=(paragraphs||[]).map(x=>String(x||'').replace(/\s+/g,' ').trim()).filter(Boolean),out=[];
  if(parts.length<2||parts.length>3)out.push(`paragraphs ${parts.length}/2-3`);
  for(let i=0;i<parts.length;i++)out.push(...proseErrors(parts[i],{min:45,max:105}).map(x=>`paragraph ${i+1} ${x}`));
  out.push(...paragraphDuplicateErrors(parts));
  const total=words(parts.join(' '));if(total<leadMinWords)out.push(`lead ${total}/${leadMinWords}`);if(total>220)out.push(`lead ${total}>220`);
  return out;
}
function deterministicDek(lead){
  const sentences=String(lead||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let out='';
  for(const sentence of sentences){const next=[out,sentence].filter(Boolean).join(' ');if(words(next)>45)break;out=next;if(words(out)>=25)break}
  if(words(out)<18){out=String(lead||'').replace(/\s+/g,' ').trim().split(' ').slice(0,38).join(' ').replace(/[,:;—-]+$/,'').trim();if(out&&!/[.!?]$/.test(out))out+='.'}
  return out;
}
function groundedBootstrapMeta(){
  if(bootstrap?.publication_status!=='published'||bootstrap?.generation?.grounding_audit?.passed!==true||bootstrap?.generation?.editorial_quality?.passed!==true)return null;
  const pool=[];
  const add=value=>{const text=String(value||'').replace(/\s+/g,' ').trim();if(!text||proseErrors(text,{min:24,max:120}).length)return;if(pool.some(existing=>nearDuplicateText(existing,text)))return;pool.push(text)};
  add(bootstrap.lead);
  for(const section of bootstrap.sections||[])for(const paragraph of section?.paragraphs||[])add(paragraph);
  const parts=[];
  for(const paragraph of pool){
    const total=words([...parts,paragraph].join(' '));
    if(total>215&&words(parts.join(' '))>=leadMinWords)continue;
    parts.push(paragraph);
    if(words(parts.join(' '))>=Math.max(leadMinWords,130))break;
  }
  const lead=parts.join('\n\n');
  if(words(lead)<leadMinWords||words(lead)>220)return null;
  const preferredDek=String(bootstrap.dek||'').replace(/\s+/g,' ').trim();
  const dek=!proseErrors(preferredDek,{min:18,max:55}).length?preferredDek:deterministicDek(lead);
  const candidate={title:identity.title,dek,lead};
  if(metaErrors(candidate).length)return null;
  return{candidate,parts};
}
const leadSchema={type:'object',additionalProperties:false,required:['paragraphs'],properties:{paragraphs:{type:'array',minItems:2,maxItems:3,items:{type:'string'}}}};
async function generateLeadPackage({evidence,timeoutMs,retry=false}){
  return chatJson({
    system:'Ты старший русскоязычный игровой журналист. Верни только 2–3 готовых абзаца вступления в JSON. Пиши естественным журнальным русским, без мета-комментариев и без фактов вне evidence.',
    prompt:`Напиши вступление большого обзора ${identity.title}: 2–3 разных абзаца, каждый 55–80 русских слов, суммарно 130–190 слов. Первый абзац — сильный редакционный тезис и то, чем игра выделяется; второй — цена её достоинств, ограничения и критический ракурс; третий нужен только если без него материал остаётся поверхностным. Не повторяй тезисы между абзацами. ${retry?'Первая версия не прошла формальные проверки: используй более прямой русский синтаксис, меньше общих слов и другой ракурс evidence.':''}\nАнглийские слова запрещены кроме Fallout/RPG. Не калькируй английские обороты и не выдумывай собственные имена.\nКАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nCOMPACT PROFESSIONAL EVIDENCE:\n${JSON.stringify(evidence)}`,
    schema:leadSchema,temperature:retry?0.12:0.18,numCtx:LEAD_GENERATION_NUM_CTX,numPredict:LEAD_PACKAGE_NUM_PREDICT,timeoutMs
  });
}

async function ensureMeta(){
  const existing={title:identity.title,dek:String(state.meta?.dek||'').trim(),lead:String(state.meta?.lead||'').trim()};
  if(!metaErrors(existing).length){state.meta=existing;state.meta_parts.lead=existing.lead.split(/\n\s*\n/).filter(Boolean);return{reused:true,attempts:0,deterministic_fallback:false}}
  let lastErrors=[];
  if(await localModelReady({timeoutMs:5000})){
    const attempts=[
      {timeoutMs:LEAD_PACKAGE_TIMEOUT_MS,evidence:compactEvidence,retry:false},
      {timeoutMs:LEAD_PACKAGE_RETRY_TIMEOUT_MS,evidence:compactEvidence.slice(0,4),retry:true}
    ];
    for(let i=0;i<Math.min(MAX_LEAD_GENERATION_ATTEMPTS,attempts.length);i++){
      try{
        const result=await generateLeadPackage(attempts[i]);
        const parts=(result?.paragraphs||[]).map(x=>String(x||'').replace(/\s+/g,' ').trim()).filter(Boolean);
        lastErrors=leadPackageErrors(parts);
        if(lastErrors.length)continue;
        const lead=parts.join('\n\n'),dek=deterministicDek(lead),candidate={title:identity.title,dek,lead};
        lastErrors=metaErrors(candidate);
        if(lastErrors.length)continue;
        state.meta=candidate;state.meta_parts.lead=parts;persist();return{reused:false,attempts:i+1,deterministic_fallback:false};
      }catch(error){lastErrors=[error.message]}
    }
  }else lastErrors=[`local ${LOCAL_EDITORIAL_MODEL} unavailable`];
  const fallback=groundedBootstrapMeta();
  if(fallback){
    state.meta=fallback.candidate;
    state.meta_parts.lead=fallback.parts;
    state.meta_generation={provider:'deterministic-grounded-bootstrap-v1',reason:'local_lead_unavailable_or_invalid',model_attempt_errors:lastErrors,checked_at:new Date().toISOString()};
    persist();
    return{reused:false,attempts:MAX_LEAD_GENERATION_ATTEMPTS,deterministic_fallback:true};
  }
  persist();throw new Error(`${slug}: lead generation and grounded bootstrap fallback both failed: ${lastErrors.join('; ')||'no valid text'}`);
}

function sectionReuseErrors(section){
  const out=[],paragraphs=(section?.paragraphs||[]).map(x=>String(x||'').trim()).filter(Boolean);
  if(!String(section?.heading||'').trim())out.push('heading missing');
  if(!paragraphs.length)out.push('paragraphs missing');
  out.push(...paragraphDuplicateErrors(paragraphs));
  if(machineRussian.test(paragraphs.join('\n')))out.push('obvious machine-russian token');
  const latin=lowerLatin(paragraphs.join(' '));if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);
  const ids=[...new Set(section?.source_ids||[])];if(!ids.length)out.push('source ids missing');for(const id of ids)if(!sourceIds.has(id))out.push(`unknown source ${id}`);
  return out;
}

const metaResult=await ensureMeta();
const deterministicMetaErrors=metaErrors(state.meta);
state.meta_quality_audit={
  checked_at:new Date().toISOString(),
  architecture:ARCHITECTURE,
  passed:deterministicMetaErrors.length===0,
  criteria:{canonical_title:true,length:true,placeholder_free:true,latin_guard:true,machine_russian_guard:true,no_near_duplicate_paragraphs:true,semantic_editorial_audit:'deferred_to_final_article_audit'},
  deterministic_errors:deterministicMetaErrors
};
if(deterministicMetaErrors.length){persist();throw new Error(`${slug}: deterministic meta preflight failed: ${deterministicMetaErrors.join('; ')}`)}
let reusedSectionsChecked=0,reusedSectionsRejected=0;
for(const [id,section] of Object.entries({...state.sections})){
  reusedSectionsChecked++;
  const deterministic=sectionReuseErrors(section),fingerprint=JSON.stringify({heading:section?.heading||'',paragraphs:section?.paragraphs||[],source_ids:section?.source_ids||[]});
  if(deterministic.length){
    reusedSectionsRejected++;
    if(!state.section_quality_rejections||typeof state.section_quality_rejections!=='object')state.section_quality_rejections={};
    state.section_quality_rejections[id]={checked_at:new Date().toISOString(),architecture:ARCHITECTURE,issues:deterministic};
    delete state.sections[id];
  }else{
    section.quality_reuse_audit={checked_at:new Date().toISOString(),fingerprint,passed:true,architecture:ARCHITECTURE,criteria:{deterministic:true,source_ids_valid:true,semantic_source_grounding:'deferred_to_final_article_audit'},deterministic_errors:[]};
    state.sections[id]=section;
  }
}
persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama-writing-with-grounded-bootstrap-failsafe',architecture:ARCHITECTURE,model:LOCAL_EDITORIAL_MODEL,title:state.meta.title,dek_words:words(state.meta.dek),lead_words:words(state.meta.lead),lead_parts:state.meta_parts.lead.length,lead_generation_attempts:metaResult.attempts,deterministic_lead_fallback:metaResult.deterministic_fallback,reused_meta:metaResult.reused,evidence_sources:compactEvidence.length,ai_preflight_audits:0,ai_section_reuse_audits:0,final_editorial_audit:'synthesize-commercial-review-resilient',reused_sections_checked:reusedSectionsChecked,reused_sections_rejected:reusedSectionsRejected},null,2));