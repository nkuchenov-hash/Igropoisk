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
const LEAD_PART_TIMEOUT_MS=150000,LEAD_PART_RETRY_TIMEOUT_MS=90000,DEK_TIMEOUT_MS=60000,MAX_LEAD_PARTS=3;

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
if(state?.corpus_signature!==corpusSignature)state={schema_version:1,slug,corpus_signature:corpusSignature,model:LOCAL_EDITORIAL_MODEL,meta:null,meta_parts:{lead:[]},sections:{},verdict:null,audit:null,revision_count:0,updated_at:new Date().toISOString()};
if(!state.meta_parts||typeof state.meta_parts!=='object')state.meta_parts={lead:[]};
if(!Array.isArray(state.meta_parts.lead))state.meta_parts.lead=[];
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};
const compactText=(v,max=360)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const compactList=(v,n=2,max=180)=>Array.isArray(v)?v.slice(0,n).map(x=>compactText(x,max)).filter(Boolean):[];
const compactEvidence=sourceDigest.slice(0,6).map(s=>({id:s.id,publication:s.publication,summary:compactText(s.dossier?.summary,440),strengths:compactList(s.dossier?.strengths,2),criticisms:compactList(s.dossier?.criticisms,2),systems:compactList(s.dossier?.systems,2),examples:compactList(s.dossier?.specific_examples,2),claims:compactList(s.dossier?.notable_claims,2)}));

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
function partErrors(text){const out=[],wc=words(text);if(wc<45)out.push(`part ${wc}/45`);if(wc>105)out.push(`part ${wc}>105`);if(placeholder.test(text))out.push('instruction-placeholder text');const latin=lowerLatin(text);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function dekErrors(dek){const out=[];if(words(dek)<18||String(dek||'').length<100)out.push(`dek ${words(dek)}/18`);if(words(dek)>55)out.push(`dek ${words(dek)}>55`);if(placeholder.test(dek))out.push('instruction-placeholder text');const latin=lowerLatin(dek);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);return out}
function joinedLead(){return state.meta_parts.lead.map(x=>String(x||'').trim()).filter(Boolean).join('\n\n').trim()}

const partSchema={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:{type:'string'}}};
async function generateLeadPart({partIndex,evidence,existing='',timeoutMs=LEAD_PART_TIMEOUT_MS}){
  const focus=partIndex===0?'Сформулируй главный редакционный тезис и конкретно объясни, почему мир, ролевая свобода и системы игры работают.':partIndex===1?'Продолжи без повторов: покажи ограничения, шероховатости, цену этой свободы и то, что критики считают слабее сильных сторон.':'Добавь только недостающий конкретный ракурс из evidence, чтобы вступление стало полноценным; не повторяй уже сказанное.';
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Верни только один готовый абзац в JSON. Никаких инструкций, шаблонов и мета-комментариев. Не добавляй факты вне evidence.',prompt:`Для вступления большого обзора ${identity.title} напиши один самостоятельный абзац на 65–90 русских слов. ${focus}\nАнглийские слова запрещены кроме Fallout/RPG.\nУЖЕ НАПИСАНО (не повторять):\n${existing||'(ничего)'}\nКАНОНИЧЕСКАЯ ИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nEVIDENCE:\n${JSON.stringify(evidence)}`,schema:partSchema,temperature:0.22,numCtx:6144,numPredict:520,timeoutMs});
}
const dekSchema={type:'object',additionalProperties:false,required:['dek'],properties:{dek:{type:'string'}}};
async function generateDek(lead){return chatJson({system:'Ты выпускающий редактор. Верни только готовый короткий dek в JSON, без инструкций и мета-комментариев.',prompt:`По готовому вступлению обзора ${identity.title} напиши dek на 25–40 русских слов. Он должен кратко передать редакционный тезис, не повторять заголовок и не добавлять новых фактов. Английские слова запрещены кроме Fallout/RPG.\nLEAD:\n${lead}`,schema:dekSchema,temperature:0.15,numCtx:4096,numPredict:320,timeoutMs:DEK_TIMEOUT_MS})}
function deterministicDek(lead){const sentences=String(lead||'').split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);let out='';for(const sentence of sentences){const next=[out,sentence].filter(Boolean).join(' ');if(words(next)>45)break;out=next;if(words(out)>=25)break}if(words(out)<18)out=String(lead||'').split(/\s+/).slice(0,40).join(' ').replace(/[,:;—-]+$/,'').trim()+'.';return out}

state.meta={...(state.meta||{}),title:identity.title};
const oldLead=String(state.meta.lead||'').trim();
if(!state.meta_parts.lead.length&&!partErrors(oldLead).length&&words(oldLead)<leadMinWords)state.meta_parts.lead=[oldLead];
state.meta_parts.lead=state.meta_parts.lead.filter(part=>!partErrors(part).length).slice(0,MAX_LEAD_PARTS);
let currentLead=joinedLead();
for(let partIndex=state.meta_parts.lead.length;words(currentLead)<leadMinWords&&partIndex<MAX_LEAD_PARTS;partIndex++){
  const evidence=compactEvidence.slice(partIndex*2,partIndex*2+2).length?compactEvidence.slice(partIndex*2,partIndex*2+2):compactEvidence.slice(0,2);
  let part='',lastError='';
  for(const timeoutMs of [LEAD_PART_TIMEOUT_MS,LEAD_PART_RETRY_TIMEOUT_MS]){
    try{const result=await generateLeadPart({partIndex,evidence,existing:currentLead,timeoutMs});part=String(result?.paragraph||'').trim();const gate=partErrors(part);if(!gate.length)break;lastError=gate.join('; ');part=''}catch(error){lastError=error.message;part=''}
  }
  if(!part){persist();throw new Error(`${slug}: lead paragraph ${partIndex+1} failed: ${lastError||'no valid paragraph'}`)}
  state.meta_parts.lead.push(part);currentLead=joinedLead();state.meta.lead=currentLead;persist();
}
currentLead=joinedLead()||oldLead;state.meta.lead=currentLead;persist();
const leadWords=words(currentLead);if(leadWords<leadMinWords||leadWords>220||placeholder.test(currentLead)||lowerLatin(currentLead).length){throw new Error(`${slug}: persistent multi-paragraph lead failed: ${leadWords}/${leadMinWords}`)}

let currentDek=String(state.meta.dek||'').trim();if(dekErrors(currentDek).length){try{const result=await generateDek(currentLead);currentDek=String(result?.dek||'').trim()}catch{currentDek=deterministicDek(currentLead)}if(dekErrors(currentDek).length)currentDek=deterministicDek(currentLead);state.meta.dek=currentDek;persist()}
const finalErrors=errors(state.meta);if(finalErrors.length){persist();throw new Error(`${slug}: meta preflight failed: ${finalErrors.join('; ')}`)}
persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama',architecture:'persistent-multi-paragraph-meta-v3',model:LOCAL_EDITORIAL_MODEL,title:state.meta.title,dek_words:words(state.meta.dek),lead_words:words(state.meta.lead),lead_parts:state.meta_parts.lead.length,evidence_sources:compactEvidence.length,placeholder:false,bounded_component_timeouts:true},null,2));
