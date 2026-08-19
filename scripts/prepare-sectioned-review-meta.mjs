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

function errors(meta){
  const out=[];
  const title=String(meta?.title||'').trim(),dek=String(meta?.dek||'').trim(),lead=String(meta?.lead||'').trim();
  if(words(title)<2||title.length<5)out.push('title missing/too short');
  if(words(dek)<18||dek.length<100)out.push(`dek ${words(dek)}/18`);
  const leadWords=words(lead);if(leadWords<leadMinWords)out.push(`lead ${leadWords}/${leadMinWords}`);if(leadWords>240)out.push(`lead ${leadWords}>240`);
  if(placeholder.test(`${title}\n${dek}\n${lead}`))out.push('instruction-placeholder text');
  const latin=lowerLatin(`${dek} ${lead}`);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);
  return out;
}

const evidence=sourceDigest.slice(0,Math.min(6,sourceDigest.length));
const metaSchema={type:'object',additionalProperties:false,required:['title','dek','lead'],properties:{title:{type:'string',minLength:5},dek:{type:'string',minLength:120},lead:{type:'string',minLength:800}}};
async function generateMeta(extra=''){
  return chatJson({system:'Ты старший русскоязычный игровой журналист. Верни готовый редакционный текст, а не описание задания, шаблон или инструкцию. Каждый факт должен вытекать из предоставленных материалов.',prompt:`Напиши готовую шапку большого обзора Игропоиска игры ${identity.title}: выразительный заголовок, dek на 25–45 русских слов и lead на 150–190 русских слов. Lead сразу формулирует редакционный тезис, сочетает сильные стороны и ограничения игры и опирается только на professional review dossiers. Запрещено писать фразы вроде «текст от ... слов», «краткое описание», «для обзора», пересказывать требования или возвращать шаблон. Не используй английские слова кроме Fallout/RPG.\nИДЕНТИЧНОСТЬ:\n${JSON.stringify(identity)}\nSOURCE DOSSIERS:\n${JSON.stringify(evidence)}${extra}`,schema:metaSchema,temperature:0.22,numCtx:12288,numPredict:1400,timeoutMs:360000})
}
const leadSchema={type:'object',additionalProperties:false,required:['lead'],properties:{lead:{type:'string',minLength:800}}};
async function expandLead(meta,extra=''){
  return chatJson({system:'Ты выпускающий редактор. Верни только готовое содержательное вступление, не инструкцию и не мета-комментарий.',prompt:`Перепиши и расширь вступление обзора ${identity.title} до 150–190 русских слов. Сохрани редакционный тезис из текущей версии, но сделай его содержательным: конкретно объясни, почему игра работает, где её сильные стороны и какие ограничения отмечают критики. Не добавляй фактов вне source dossiers. Запрещены шаблонные фразы о количестве слов и описании задания.\nЗАГОЛОВОК: ${meta?.title||identity.title}\nDEK: ${meta?.dek||''}\nТЕКУЩИЙ LEAD: ${meta?.lead||''}\nSOURCE DOSSIERS:\n${JSON.stringify(evidence)}${extra}`,schema:leadSchema,temperature:0.2,numCtx:12288,numPredict:1200,timeoutMs:360000})
}

let currentErrors=errors(state.meta);
if(currentErrors.length){
  for(let attempt=1;attempt<=2;attempt++){
    const candidate=await generateMeta(attempt>1?`\nПредыдущая версия не прошла gate: ${currentErrors.join('; ')}. Верни именно готовый текст.`:'');
    state.meta=candidate;persist();currentErrors=errors(state.meta);if(!currentErrors.length)break;
  }
}
if(currentErrors.length&&state.meta?.title&&state.meta?.dek){
  for(let attempt=1;attempt<=2;attempt++){
    const expanded=await expandLead(state.meta,attempt>1?`\nПредыдущий lead всё ещё не прошёл gate: ${currentErrors.join('; ')}.`:'');
    state.meta={...state.meta,lead:expanded.lead};persist();currentErrors=errors(state.meta);if(!currentErrors.length)break;
  }
}
if(currentErrors.length){persist();throw new Error(`${slug}: sectioned meta preflight failed: ${currentErrors.join('; ')}`)}
persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,title:state.meta.title,dek_words:words(state.meta.dek),lead_words:words(state.meta.lead),placeholder:false},null,2));
