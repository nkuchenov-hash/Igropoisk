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
const LEAD_TIMEOUT_MS=180000,LEAD_RETRY_TIMEOUT_MS=120000,LEAD_CONTINUATION_TIMEOUT_MS=90000,DEK_TIMEOUT_MS=60000;

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{};
const game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`);
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing for meta preflight`);
if(!await localModelReady({timeoutMs:5000}))throw new Error(`${slug}: local ${LOCAL_EDITORIAL_MODEL} is unavailable for meta preflight`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role);
if(!sources.length)throw new Error(`${slug}: professional review corpus is empty`);
const leadMinWords=Math.max(80,Number(rules.lead_minimum_words||120));
const sourceDigest=sources.map(s=>({id:s.id,publication:s.publication,title:s.title,body_words:s.body_words,dossier:s.dossier}));
const identity={title:game.identity.title,series:game.identity.series||null,release:game.release,developers:game.companies?.developers||[],publishers:game.companies?.publishers||[],genres:game.classification?.genres||[],platforms:game.classification?.platforms||[],description:game.editorial?.integrated_description||game.editorial?.short_description||''};
const corpusSignature=JSON.stringify({sources:sourceDigest.map(s=>[s.id,s.publication,s.body_words]),contract:contract.id});
const statePath=`data/article-section-drafts/${slug}.json`;
let state=read(statePath,{});
if(state?.corpus_signature!==corpusSignature)state={schema_version:1,slug,corpus_signature:corpusSignature,model:LOCAL_EDITORIAL_MODEL,meta:null,sections:{},verdict:null,audit:null,revision_count:0,updated_at:new Date().toISOString()};
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};
const compactText=(v,max=420)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const compactList=(v,n=2,max=220)=>Array.isArray(v)?v.slice(0,n).map(x=>compactText(x,max)).filter(Boolean):[];
const compactEvidence=sourceDigest.slice(0,4).map(s=>({id:s.id,publication:s.publication,summary:compactText(s.dossier?.summary,520),strengths:compactList(s.dossier?.strengths,2),criticisms:compactList(s.dossier?.criticisms,2),systems:compactList(s.dossier?.systems,2),examples:compactList(s.dossier?.specific_examples,2),claims:compactList(s.dossier?.notable_claims,3)}));

function errors(meta){
  const out=[];
  const title=String(meta?.title||'').trim(),dek=String(meta?.dek||'').trim(),lead=String(meta?.lead||'').trim();
  if(words(title)<2||title.length<5)out.push('title missing/too short');
  if(words(dek)<18||dek.length<100)out.push(`dek ${words(dek)}/18`);
  const leadWords=words(lead);if(leadWords<leadMinWords)out.push(`lead ${leadWords}/${leadMinWords}`);if(leadWords>220)out.push(`lead ${leadWords}>220`);
  if(placeholder.test(`${title}\n${dek}\n${lead}`))out.push('instruction-placeholder text');
  const latin=lowerLatin(`${dek} ${lead}`);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);
  return out;
}
function leadErrors(lead){const out=[];const wc=words(lead);if(wc<leadMinWords)out.push(`lead ${wc}/${leadMinWords}`);if(wc>220)out.push(`lead ${wc}>220`);if(placeholder.test(lead))out.push('instruction-placeholder text');const latin=lowerLatin(lead);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function continuationErrors(text){const out=[];const wc=words(text);if(wc<35)out.push(`continuation ${wc}/35`);if(wc>110)out.push(`continuation ${wc}>110`);if(placeholder.test(text))out.push('instruction-placeholder text');const latin=lowerLatin(text);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function dekErrors(dek){const out=[];if(words(dek)<18||String(dek||'').length<100)out.push(`dek ${words(dek)}/18`);if(words(dek)>55)out.push(`dek ${words(dek)}>55`);if(placeholder.test(dek))out.push('instruction-placeholder text');const latin=lowerLatin(dek);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}

const leadSchema={type:'object',additionalProperties:false,required:['lead'],properties:{lead:{type:'string'}}};
async function generateLead(evidence,timeoutMs,extra=''){
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Верни только готовое вступление в JSON, без шаблонов, инструкций и мета-комментариев. Не добавляй факты вне evidence.',prompt:`Напиши lead большого обзора ${identity.title}: 140–180 русских слов, 2–3 связных абзаца. Сразу сформулируй редакционный тезис, покажи главные сильные стороны и важные ограничения по критическим рецензиям. Никакого пересказа задания и фраз о количестве слов. Английские слова запрещены кроме Fallout/RPG.\nКАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nКОМПАКТНОЕ EVIDENCE:\n${JSON.stringify(evidence)}${extra}`,schema:leadSchema,temperature:0.22,numCtx:8192,numPredict:850,timeoutMs})
}
const continuationSchema={type:'object',additionalProperties:false,required:['continuation'],properties:{continuation:{type:'string'}}};
async function generateLeadContinuation(lead,evidence){
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Верни только естественное продолжение уже написанного вступления в JSON. Не повторяй существующие фразы и не добавляй факты вне evidence.',prompt:`Продолжи вступление обзора ${identity.title} ещё на 55–85 русских слов. Не переписывай и не пересказывай существующий lead: добавь один связный абзац, который углубляет редакционный тезис через конкретные достоинства, ограничения или особенности, подтверждённые evidence. Продолжение должно естественно читаться сразу после исходного текста. Английские слова запрещены кроме Fallout/RPG.\nИСХОДНЫЙ LEAD:\n${lead}\nКОМПАКТНОЕ EVIDENCE:\n${JSON.stringify(evidence)}`,schema:continuationSchema,temperature:0.18,numCtx:6144,numPredict:520,timeoutMs:LEAD_CONTINUATION_TIMEOUT_MS})
}
const dekSchema={type:'object',additionalProperties:false,required:['dek'],properties:{dek:{type:'string'}}};
async function generateDek(lead,extra=''){
  return chatJson({system:'Ты выпускающий редактор. Верни только готовый короткий dek в JSON, без инструкций и мета-комментариев.',prompt:`По готовому вступлению обзора ${identity.title} напиши dek на 25–40 русских слов. Он должен кратко передать редакционный тезис, не повторять заголовок и не добавлять новых фактов. Английские слова запрещены кроме Fallout/RPG.\nLEAD:\n${lead}${extra}`,schema:dekSchema,temperature:0.15,numCtx:4096,numPredict:320,timeoutMs:DEK_TIMEOUT_MS})
}
function deterministicDek(lead){const sentences=String(lead||'').split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);let out='';for(const sentence of sentences){const next=[out,sentence].filter(Boolean).join(' ');if(words(next)>45)break;out=next;if(words(out)>=25)break}if(words(out)<18)out=String(lead||'').split(/\s+/).slice(0,40).join(' ').replace(/[,:;—-]+$/,'').trim()+'.';return out}

state.meta={...(state.meta||{}),title:identity.title};
let currentLead=String(state.meta.lead||'').trim(),leadGate=leadErrors(currentLead);
if(leadGate.length){
  const attempts=[{evidence:compactEvidence,timeout:LEAD_TIMEOUT_MS},{evidence:compactEvidence.slice(0,2),timeout:LEAD_RETRY_TIMEOUT_MS}];
  let lastError='';
  for(let i=0;i<attempts.length;i++){
    try{
      const result=await generateLead(attempts[i].evidence,attempts[i].timeout,i?`\nПредыдущая попытка не прошла gate или timeout. Верни именно готовый содержательный lead не короче ${leadMinWords} слов.`:'');
      currentLead=String(result?.lead||'').trim();state.meta.lead=currentLead;persist();leadGate=leadErrors(currentLead);if(!leadGate.length)break;lastError=leadGate.join('; ');
    }catch(error){lastError=error.message;leadGate=[`generation ${error.message}`]}
  }
  if(leadGate.length&&words(currentLead)>=60&&words(currentLead)<leadMinWords&&leadGate.every(x=>x.startsWith('lead '))){
    try{
      const result=await generateLeadContinuation(currentLead,compactEvidence.slice(0,3));
      const continuation=String(result?.continuation||'').trim(),fragmentGate=continuationErrors(continuation);
      if(fragmentGate.length){lastError=fragmentGate.join('; ')}else{
        const combined=`${currentLead}\n\n${continuation}`.trim(),combinedGate=leadErrors(combined);
        currentLead=combined;state.meta.lead=currentLead;persist();leadGate=combinedGate;lastError=combinedGate.join('; ');
      }
    }catch(error){lastError=error.message}
  }
  if(leadGate.length){persist();throw new Error(`${slug}: compact lead preflight failed: ${lastError||leadGate.join('; ')}`)}
}

let currentDek=String(state.meta.dek||'').trim(),dekGate=dekErrors(currentDek);
if(dekGate.length){
  try{const result=await generateDek(currentLead);currentDek=String(result?.dek||'').trim()}catch{currentDek=deterministicDek(currentLead)}
  if(dekErrors(currentDek).length)currentDek=deterministicDek(currentLead);
  state.meta.dek=currentDek;persist();dekGate=dekErrors(currentDek);
}
const finalErrors=errors(state.meta);if(finalErrors.length){persist();throw new Error(`${slug}: compact meta preflight failed: ${finalErrors.join('; ')}`)}
persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama',architecture:'compact-split-meta-v3',model:LOCAL_EDITORIAL_MODEL,title:state.meta.title,dek_words:words(state.meta.dek),lead_words:words(state.meta.lead),evidence_sources:compactEvidence.length,placeholder:false,bounded_component_timeouts:true,bounded_short_lead_continuation:true},null,2));
