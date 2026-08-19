#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: prepare-sectioned-review-lead-micro <slug>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const target=path.join(root,r);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(v,null,2)}\n`)};
const words=v=>(String(v||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const normalize=v=>String(v||'').toLowerCase().normalize('NFKC').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
const lowerLatin=v=>[...String(v||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(x=>x[0]).filter(x=>!['fallout','rpg'].includes(x));
const placeholder=/(?:^|\b)(?:текст\s+от|краткое\s+описание|напиши(?:те)?|создай(?:те)?|русск(?:их|ими)\s+слов|для\s+обзора|целевой\s+объ[её]м)(?:\b|$)/iu;
const badRussian=/(?:экспелир\w*|достоинственност\w*|непоседн\w*\s+NPC|валлта[-\s]?двейлер\w*|феноменальн\w*\s+(?:проект|игр\w*)|сквозн\w*\s+нарратив\w*|\bдоминиру\w*\s+среди\s+ретро)/iu;
const MICRO_VERSION='lead-micro-v1';
const MICRO_TIMEOUT_MS=60000,MICRO_RETRY_TIMEOUT_MS=45000,MAX_FRAGMENTS=6;

const contract=read('config/review-commercial-contract.json',{}),rules=contract.article||{};
const minLead=Math.max(120,Number(rules.lead_minimum_words||120)),maxLead=Math.min(220,Number(rules.lead_maximum_words||220)||220);
const game=read(`data/drafts/${slug}.json`),corpus=read(`data/review-article-corpus/${slug}.json`);
if(!game?.identity?.title||!corpus?.coverage?.passed)throw new Error(`${slug}: canonical game/article corpus missing for micro lead preflight`);
if(!await localModelReady({timeoutMs:5000}))throw new Error(`${slug}: local ${LOCAL_EDITORIAL_MODEL} unavailable for micro lead preflight`);
const sources=(corpus.sources||[]).filter(x=>x?.source_role==='professional_review'||!x?.source_role);
if(!sources.length)throw new Error(`${slug}: professional review corpus empty`);
const sourceSignature=JSON.stringify(sources.map(x=>[x.id,x.publication,x.body_words]));
const statePath=`data/article-section-drafts/${slug}.json`;
let state=read(statePath,{});
if(!state||typeof state!=='object')state={};
if(!state.meta||typeof state.meta!=='object')state.meta={title:game.identity.title};
if(!state.meta_parts||typeof state.meta_parts!=='object')state.meta_parts={lead:[]};
if(!Array.isArray(state.meta_parts.lead))state.meta_parts.lead=[];
const persist=()=>{state.updated_at=new Date().toISOString();write(statePath,state)};
const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
const clip=(v,n)=>compact(v).slice(0,n);
const list=(v,n=1,max=150)=>Array.isArray(v)?v.slice(0,n).map(x=>clip(x,max)).filter(Boolean):[];
const evidenceOf=s=>({id:s.id,publication:s.publication,summary:clip(s.dossier?.summary,360),strengths:list(s.dossier?.strengths,1),criticisms:list(s.dossier?.criticisms,1),systems:list(s.dossier?.systems,1),examples:list(s.dossier?.specific_examples,1),claims:list(s.dossier?.notable_claims,2)});
const identity={title:game.identity.title,release_year:String(game.release?.canonical_date_text||game.release?.date_text||game.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||'',developer:(game.companies?.developers||[])[0]||'',genres:(game.classification?.genres||[]).slice(0,3)};
const tokenSet=v=>new Set(normalize(v).split(' ').filter(x=>x.length>=3));
function similarity(a,b){const aa=tokenSet(a),bb=tokenSet(b);if(!aa.size||!bb.size)return 0;let common=0;for(const t of aa)if(bb.has(t))common++;return common/Math.min(aa.size,bb.size)}
const nearDuplicate=(a,b)=>similarity(a,b)>=0.67;
function fragmentErrors(text,existing=[]){const out=[],wc=words(text);if(wc<20)out.push(`fragment ${wc}/20`);if(wc>46)out.push(`fragment ${wc}>46`);if(placeholder.test(text))out.push('placeholder');if(badRussian.test(text))out.push('machine/promotional Russian');const latin=lowerLatin(text);if(latin.length)out.push(`latin ${[...new Set(latin)].join(',')}`);if(existing.some(x=>nearDuplicate(x,text)))out.push('near-duplicate fragment');return out}
function persistedLeadIsAudited(){const lead=String(state.meta?.lead||''),dek=String(state.meta?.dek||''),audit=state.meta_quality_audit;return audit?.passed===true&&audit?.fingerprint===JSON.stringify({dek,lead})&&words(lead)>=minLead&&words(lead)<=maxLead&&!badRussian.test(lead)&&!placeholder.test(lead)&&!lowerLatin(lead).length}
if(persistedLeadIsAudited()){
  console.log(JSON.stringify({slug,status:'green',architecture:MICRO_VERSION,reused_audited_meta:true,lead_words:words(state.meta.lead)},null,2));
  process.exit(0);
}
if(state.lead_micro?.version!==MICRO_VERSION||state.lead_micro?.source_signature!==sourceSignature){
  state.lead_micro={version:MICRO_VERSION,source_signature:sourceSignature,fragments:[],started_at:new Date().toISOString()};
  state.meta_parts.lead=[];state.meta.lead='';state.meta.dek='';state.meta_quality_audit=null;persist();
}
let fragments=(state.lead_micro.fragments||[]).map(x=>({text:compact(x?.text),source_ids:Array.isArray(x?.source_ids)?x.source_ids:[]})).filter(x=>x.text);
const clean=[];for(const f of fragments){if(fragmentErrors(f.text,clean.map(x=>x.text)).length)continue;clean.push(f)}fragments=clean;state.lead_micro.fragments=fragments;persist();

const microSchema={type:'object',additionalProperties:false,required:['sentences'],properties:{sentences:{type:'array',minItems:2,maxItems:2,items:{type:'string'}}}};
const focuses=[
  'Мир и главный редакционный тезис: что именно делает свободу выбора значимой.',
  'Ролевые системы и создание персонажа: конкретная сила и конкретная цена сложности.',
  'Квесты, последствия решений и реакция мира — без общих похвал.',
  'Ограничения и шероховатости, которые критики действительно отмечают.',
  'Почему игра остаётся интересной сегодня, опираясь только на evidence.',
  'Сформулируй недостающий конкретный ракурс без повторов.'
];
async function generateMicro(index,timeoutMs,retry=false){
  const source=sources[index%sources.length],evidence=evidenceOf(source),already=fragments.map(x=>x.text).join(' ').slice(-1100);
  return chatJson({system:'Ты пишешь профессиональный русский игровой обзор. Верни ровно два коротких законченных предложения в JSON. Никакой рекламы, мета-комментариев, кальки с английского и фактов вне evidence.',prompt:`Fallout 2. ${focuses[index]||focuses.at(-1)} Напиши ровно 2 разных русских предложения, каждое 10–18 слов, суммарно примерно 24–34 слова. Используй только факты и оценки из одного приложенного профессионального источника. Не повторяй уже написанное. Не используй слова «феноменальный», «доминирует», «сквозной нарратив». Собственные имена не переводи буквально. ${retry?'Предыдущий ответ не прошёл gate: сделай синтаксис проще и выбери другие подтверждённые детали.':''}\nIDENTITY:${JSON.stringify(identity)}\nSOURCE:${JSON.stringify(evidence)}\nALREADY:${already||'(пусто)'}`,schema:microSchema,temperature:retry?0.12:0.18,numCtx:3072,numPredict:240,timeoutMs});
}
function paragraphSplit(items){
  const texts=items.map(x=>x.text);if(texts.length<4)return null;
  const candidates=[];
  for(let i=1;i<texts.length;i++){
    const a=texts.slice(0,i).join(' '),b=texts.slice(i).join(' '),wa=words(a),wb=words(b),total=wa+wb;
    if(wa>=45&&wa<=105&&wb>=45&&wb<=105&&total>=minLead&&total<=maxLead)candidates.push({paragraphs:[a,b],spread:Math.abs(wa-wb),total});
  }
  if(!candidates.length&&texts.length>=6){
    for(let i=1;i<texts.length-1;i++)for(let j=i+1;j<texts.length;j++){
      const groups=[texts.slice(0,i).join(' '),texts.slice(i,j).join(' '),texts.slice(j).join(' ')],counts=groups.map(words),total=counts.reduce((a,b)=>a+b,0);
      if(counts.every(x=>x>=45&&x<=105)&&total>=minLead&&total<=maxLead)candidates.push({paragraphs:groups,spread:Math.max(...counts)-Math.min(...counts),total});
    }
  }
  return candidates.sort((a,b)=>a.spread-b.spread||Math.abs(a.total-150)-Math.abs(b.total-150))[0]||null;
}
let composition=paragraphSplit(fragments);
for(let index=fragments.length;!composition&&index<MAX_FRAGMENTS;index++){
  let text='',lastError='';
  for(const cfg of [{timeout:MICRO_TIMEOUT_MS,retry:false},{timeout:MICRO_RETRY_TIMEOUT_MS,retry:true}]){
    try{
      const result=await generateMicro(index,cfg.timeout,cfg.retry),sentences=(result?.sentences||[]).map(compact).filter(x=>words(x)>=7&&words(x)<=24);
      const candidate=sentences.join(' ').trim(),gate=fragmentErrors(candidate,fragments.map(x=>x.text));
      if(sentences.length===2&&!gate.length){text=candidate;break}
      lastError=[sentences.length!==2?`sentences ${sentences.length}/2`:null,...gate].filter(Boolean).join('; ');
    }catch(error){lastError=error.message}
  }
  if(!text){state.lead_micro.last_error=lastError;persist();throw new Error(`${slug}: micro lead fragment ${index+1} failed: ${lastError||'no valid fragment'}`)}
  const source=sources[index%sources.length];fragments.push({text,source_ids:[source.id],completed_at:new Date().toISOString()});state.lead_micro.fragments=fragments;state.lead_micro.last_error=null;persist();composition=paragraphSplit(fragments);
}
if(!composition){state.lead_micro.last_error=`cannot compose ${minLead}-${maxLead} word lead from ${fragments.length} validated fragments`;persist();throw new Error(`${slug}: ${state.lead_micro.last_error}`)}
const lead=composition.paragraphs.join('\n\n').trim();
if(words(lead)<minLead||words(lead)>maxLead||badRussian.test(lead)||placeholder.test(lead)||lowerLatin(lead).length)throw new Error(`${slug}: composed micro lead failed deterministic gate`);
state.meta_parts.lead=composition.paragraphs;state.meta.lead=lead;state.meta.dek='';state.meta_quality_audit=null;state.lead_micro.completed_at=new Date().toISOString();state.lead_micro.lead_words=words(lead);persist();
console.log(JSON.stringify({slug,status:'green',provider:'local-ollama',model:LOCAL_EDITORIAL_MODEL,architecture:MICRO_VERSION,fragments:fragments.length,lead_parts:composition.paragraphs.length,lead_words:words(lead),persistent_micro_fragments:true,max_single_component_timeout_ms:MICRO_TIMEOUT_MS},null,2));
