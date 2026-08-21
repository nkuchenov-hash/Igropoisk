#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: synthesize-commercial-review-resilient-wrapper <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const lowerLatin=value=>[...String(value||'').matchAll(/\b[a-z][a-z-]{2,}\b/g)].map(match=>match[0]).filter(word=>!['fallout','rpg'].includes(word));
const compact=(value,max=280)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const tokenSet=value=>new Set(String(value||'').toLowerCase().normalize('NFKC').replace(/ё/g,'е').match(/[a-zа-я0-9]{3,}/gi)||[]);
function nearDuplicate(a,b){const A=tokenSet(a),B=tokenSet(b);if(!A.size||!B.size)return false;let shared=0;for(const token of A)if(B.has(token))shared++;return shared/Math.min(A.size,B.size)>=0.72}

const contract=read('config/review-commercial-contract.json',{});
const minSectionWords=Math.max(260,Number(contract.article?.minimum_words_per_section||260));
const minParagraphs=Math.max(3,Number(contract.article?.minimum_paragraphs_per_section||3));
const statePath=`data/article-section-drafts/${slug}.json`;
const corpus=read(`data/review-article-corpus/${slug}.json`,{});
const sourceList=(corpus.sources||[]).filter(source=>source?.source_role==='professional_review'||!source?.source_role);
const sourceById=new Map(sourceList.map(source=>[source.id,source]));
const schema={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:{type:'string'}}};
const MAX_WRAPPER_PASSES=6;
const MAX_4B_REPAIR_PARAGRAPHS=12;
let repairCalls=0;

function evidenceFor(section){
  const ids=(section?.source_ids||[]).filter(id=>sourceById.has(id));
  const selected=(ids.length?ids.map(id=>sourceById.get(id)):sourceList.slice(0,4)).slice(0,5);
  return selected.map(source=>({
    id:source.id,
    publication:source.publication,
    summary:compact(source.dossier?.summary,240),
    strengths:(source.dossier?.strengths||[]).slice(0,2).map(value=>compact(value,130)),
    criticisms:(source.dossier?.criticisms||[]).slice(0,2).map(value=>compact(value,130)),
    systems:(source.dossier?.systems||[]).slice(0,2).map(value=>compact(value,130)),
    examples:(source.dossier?.specific_examples||[]).slice(0,2).map(value=>compact(value,150)),
    claims:(source.dossier?.notable_claims||[]).slice(0,2).map(value=>compact(value,150))
  }));
}

function incomplete(section){
  const paragraphs=Array.isArray(section?.paragraphs)?section.paragraphs:[];
  return countWords(paragraphs.join(' '))<minSectionWords||paragraphs.length<minParagraphs;
}

async function add4bParagraph(state,section){
  if(repairCalls>=MAX_4B_REPAIR_PARAGRAPHS)return false;
  const paragraphs=Array.isArray(section.paragraphs)?section.paragraphs:[];
  const words=countWords(paragraphs.join(' '));
  const remaining=Math.max(0,minSectionWords-words);
  const missingParagraphs=Math.max(0,minParagraphs-paragraphs.length);
  const shortTail=remaining>0&&remaining<45&&missingParagraphs===0;
  const requested=shortTail?'20–70':'70–125';
  const minimum=shortTail?18:45;
  const evidence=evidenceFor(section);
  if(!evidence.length)return false;
  for(let attempt=1;attempt<=2;attempt++){
    repairCalls++;
    const result=await chatJson({
      model:LOCAL_EDITORIAL_MODEL,
      system:'Ты строгий русскоязычный игровой редактор. Напиши только один новый абзац, опираясь исключительно на evidence. Не повторяй существующий текст и не добавляй неподтверждённых фактов.',
      prompt:`Дополни раздел «${section.heading||section.id}» обзора ${slug}. Сейчас ${words} слов и ${paragraphs.length} абзацев; коммерческий минимум — ${minSectionWords} слов и ${minParagraphs} абзаца. Напиши один самостоятельный source-grounded абзац ${requested} русских слов. Английские слова запрещены кроме Fallout/RPG.\nПОСЛЕДНИЕ АБЗАЦЫ:${JSON.stringify(paragraphs.slice(-2).map(value=>compact(value,650)))}\nSOURCE EVIDENCE:${JSON.stringify(evidence)}`,
      schema,
      temperature:0.08,
      numCtx:6144,
      numPredict:420,
      timeoutMs:90000
    });
    const paragraph=String(result?.paragraph||'').trim();
    const wc=countWords(paragraph);
    if(wc<minimum||wc>160||lowerLatin(paragraph).length||paragraphs.some(existing=>nearDuplicate(existing,paragraph)))continue;
    section.paragraphs=[...paragraphs,paragraph].slice(0,7);
    section.writer_fallback_parts=Number(section.writer_fallback_parts||0)+1;
    state.sections[section.id]=section;
    state.updated_at=new Date().toISOString();
    write(statePath,state);
    console.log(JSON.stringify({slug,status:'4b-paragraph-repair',section:section.id,words_before:words,words_after:countWords(section.paragraphs.join(' ')),paragraphs:section.paragraphs.length},null,2));
    return true;
  }
  return false;
}

async function repairIncompleteSections(){
  const state=read(statePath,{});
  if(!state?.sections||typeof state.sections!=='object')return false;
  let changed=false;
  for(const section of Object.values(state.sections)){
    let guard=0;
    while(incomplete(section)&&guard<4&&repairCalls<MAX_4B_REPAIR_PARAGRAPHS){
      guard++;
      const added=await add4bParagraph(state,section);
      if(!added)break;
      changed=true;
    }
  }
  return changed;
}

function runBase(){
  const result=spawnSync('node',['scripts/synthesize-commercial-review-resilient.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:48*1024*1024});
  return Number(result.status??75);
}

let editorialReady=await localModelReady({timeoutMs:2500,model:LOCAL_EDITORIAL_MODEL});
if(editorialReady)await repairIncompleteSections();
let lastStatus=75;
for(let pass=1;pass<=MAX_WRAPPER_PASSES;pass++){
  lastStatus=runBase();
  if(lastStatus===0){
    console.log(JSON.stringify({slug,status:'resilient-wrapper-green',passes:pass,repair_calls:repairCalls},null,2));
    process.exit(0);
  }
  if(!editorialReady)editorialReady=await localModelReady({timeoutMs:5000,model:LOCAL_EDITORIAL_MODEL});
  if(!editorialReady){
    console.warn(`${slug}: base synthesis failed and ${LOCAL_EDITORIAL_MODEL} repair is not available in this provider phase`);
    break;
  }
  const repaired=await repairIncompleteSections();
  if(!repaired)break;
  console.warn(`${slug}: persisted incomplete section repaired with ${LOCAL_EDITORIAL_MODEL}; resuming synthesis in the same run`);
}
process.exit(lastStatus||75);
