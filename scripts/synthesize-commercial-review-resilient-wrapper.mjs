#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chatJson,localModelReady,LOCAL_EDITORIAL_MODEL} from './lib/local-editorial-model.mjs';
import {countWords,tokenOverlap,paragraphQualityReasons,sanitizePersistedState} from './lib/review-fragment-quality.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: synthesize-commercial-review-resilient-wrapper <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const compact=(value,max=280)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);

const contract=read('config/review-commercial-contract.json',{});
const minSectionWords=Math.max(260,Number(contract.article?.minimum_words_per_section||260));
const minParagraphs=Math.max(3,Number(contract.article?.minimum_paragraphs_per_section||3));
const statePath=`data/article-section-drafts/${slug}.json`;
const corpus=read(`data/review-article-corpus/${slug}.json`,{});
const sourceList=(corpus.sources||[]).filter(source=>source?.source_role==='professional_review'||!source?.source_role);
const sourceById=new Map(sourceList.map(source=>[source.id,source]));
const schema={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:{type:'string'}}};
const MAX_WRAPPER_PASSES=6;
const MAX_REPAIR_ATTEMPTS_PER_SECTION=18;
const MAX_TOTAL_REPAIR_ATTEMPTS=96;
let totalRepairCalls=0;
const repairCallsBySection=new Map();

function sourceAtoms(source){
  const dossier=source?.dossier||{};
  const atoms=[];
  const add=(kind,value)=>{const text=compact(value,180);if(countWords(text)>=5)atoms.push({id:source.id,publication:source.publication,kind,text})};
  add('summary',dossier.summary);
  for(const value of dossier.strengths||[])add('strength',value);
  for(const value of dossier.criticisms||[])add('criticism',value);
  for(const value of dossier.systems||[])add('system',value);
  for(const value of dossier.specific_examples||[])add('example',value);
  for(const value of dossier.notable_claims||[])add('claim',value);
  return atoms;
}

function evidenceForRepair(section,{shortTail=false,attempt=1}={}){
  const paragraphs=Array.isArray(section?.paragraphs)?section.paragraphs:[];
  const existing=paragraphs.join(' ');
  const preferred=new Set((section?.source_ids||[]).filter(id=>sourceById.has(id)));
  const atoms=sourceList.flatMap(source=>sourceAtoms(source)).map(atom=>({
    ...atom,
    overlap:tokenOverlap(atom.text,existing),
    preferred:preferred.has(atom.id)
  })).filter(atom=>atom.overlap<0.72);
  atoms.sort((a,b)=>{
    const scoreA=(a.preferred?0.18:0)+(1-a.overlap);
    const scoreB=(b.preferred?0.18:0)+(1-b.overlap);
    return scoreB-scoreA;
  });
  if(!atoms.length)return [];
  const width=shortTail?2:3;
  const offset=((attempt-1)*width)%atoms.length;
  const selected=[...atoms.slice(offset,offset+width),...atoms.slice(0,Math.max(0,offset+width-atoms.length))].slice(0,width);
  return selected.map(({id,publication,kind,text})=>({id,publication,kind,text}));
}

function incomplete(section){
  const paragraphs=Array.isArray(section?.paragraphs)?section.paragraphs:[];
  return countWords(paragraphs.join(' '))<minSectionWords||paragraphs.length<minParagraphs;
}

function sectionRepairCalls(section){
  return Number(repairCallsBySection.get(section?.id)||0);
}

function canRepair(section){
  return totalRepairCalls<MAX_TOTAL_REPAIR_ATTEMPTS&&sectionRepairCalls(section)<MAX_REPAIR_ATTEMPTS_PER_SECTION;
}

function registerRepairCall(section){
  totalRepairCalls++;
  repairCallsBySection.set(section.id,sectionRepairCalls(section)+1);
}

function paragraphRejectionReasons(paragraph,paragraphs,minimum){
  return paragraphQualityReasons(paragraph,{existing:paragraphs,minWords:minimum,maxWords:140});
}

function cleanStateBeforeRepair(){
  const current=read(statePath,{});
  const cleaned=sanitizePersistedState(current);
  if(cleaned.changed){
    write(statePath,cleaned.state);
    console.warn(`${slug}: removed ${cleaned.removed.length} invalid persisted review fragment(s) before repair`);
    console.log(JSON.stringify({slug,status:'persisted-quality-cleanup',removed:cleaned.removed},null,2));
  }
  return cleaned.state;
}

function repairPrompt(section,{words,paragraphs,evidence,shortTail}){
  const facts=evidence.map(item=>`— ${item.text}`).join('\n');
  const lengthHint=shortTail?'Коротко заверши мысль раздела.':'Развей одну новую грань темы.';
  return `Продолжи журнальный обзор игры ${slug}, раздел «${section.heading||section.id}». В разделе уже ${words} слов. ${lengthHint}\nМатериал для продолжения:\n${facts}`;
}

async function add4bParagraph(state,section){
  if(!canRepair(section))return false;
  const paragraphs=Array.isArray(section.paragraphs)?section.paragraphs:[];
  const words=countWords(paragraphs.join(' '));
  const remaining=Math.max(0,minSectionWords-words);
  const missingParagraphs=Math.max(0,minParagraphs-paragraphs.length);
  const shortTail=remaining>0&&remaining<45&&missingParagraphs===0;
  const minimum=shortTail?12:40;
  for(let attempt=1;attempt<=3;attempt++){
    if(!canRepair(section))return false;
    const evidence=evidenceForRepair(section,{shortTail,attempt});
    if(!evidence.length)return false;
    registerRepairCall(section);
    let result;
    try{
      result=await chatJson({
        model:LOCAL_EDITORIAL_MODEL,
        system:'Ты русскоязычный игровой журналист. Продолжи готовый журнальный текст одним содержательным абзацем по фактам ниже. Не упоминай процесс написания, требования, редакционную работу или названия изданий. Переводи английские понятия на русский; допустимы только названия Fallout и RPG.',
        prompt:repairPrompt(section,{words,paragraphs,evidence,shortTail}),
        schema,
        temperature:attempt===1?0.08:0.18,
        numCtx:shortTail?1536:3072,
        numPredict:shortTail?192:360,
        timeoutMs:shortTail?90000:120000,
        repeatLastN:shortTail?128:256
      });
    }catch(error){
      console.warn(`${slug}: ${LOCAL_EDITORIAL_MODEL} paragraph repair attempt ${attempt} failed for ${section.id}: ${error.message}`);
      continue;
    }
    const paragraph=String(result?.paragraph||'').trim();
    const reasons=paragraphRejectionReasons(paragraph,paragraphs,minimum);
    if(reasons.length){
      console.warn(`${slug}: ${LOCAL_EDITORIAL_MODEL} paragraph repair attempt ${attempt} rejected for ${section.id}: ${reasons.join('; ')}`);
      continue;
    }
    section.paragraphs=[...paragraphs,paragraph].slice(0,7);
    section.source_ids=[...new Set([...(section.source_ids||[]),...evidence.map(item=>item.id)])];
    section.writer_fallback_parts=Number(section.writer_fallback_parts||0)+1;
    state.sections[section.id]=section;
    state.updated_at=new Date().toISOString();
    write(statePath,state);
    console.log(JSON.stringify({slug,status:'4b-paragraph-repair',section:section.id,short_tail:shortTail,words_before:words,words_after:countWords(section.paragraphs.join(' ')),paragraphs:section.paragraphs.length,evidence_ids:evidence.map(item=>item.id),section_repair_calls:sectionRepairCalls(section),total_repair_calls:totalRepairCalls,quality_gate:'shared-pre-save-v1'},null,2));
    return true;
  }
  return false;
}

async function repairIncompleteSections({includeEmpty=true}={}){
  const state=cleanStateBeforeRepair();
  if(!state?.sections||typeof state.sections!=='object')return false;
  let changed=false;
  for(const section of Object.values(state.sections)){
    const paragraphs=Array.isArray(section?.paragraphs)?section.paragraphs:[];
    if(!includeEmpty&&!paragraphs.length)continue;
    let guard=0;
    while(incomplete(section)&&guard<4&&canRepair(section)){
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

cleanStateBeforeRepair();
let editorialReady=await localModelReady({timeoutMs:2500,model:LOCAL_EDITORIAL_MODEL});
if(editorialReady)await repairIncompleteSections({includeEmpty:false});
let lastStatus=75;
for(let pass=1;pass<=MAX_WRAPPER_PASSES;pass++){
  lastStatus=runBase();
  if(lastStatus===0){
    console.log(JSON.stringify({slug,status:'resilient-wrapper-green',passes:pass,repair_calls:totalRepairCalls,repair_calls_by_section:Object.fromEntries(repairCallsBySection),quality_gate:'shared-pre-save-v1'},null,2));
    process.exit(0);
  }
  if(!editorialReady)editorialReady=await localModelReady({timeoutMs:5000,model:LOCAL_EDITORIAL_MODEL});
  if(!editorialReady){
    console.warn(`${slug}: base synthesis failed and ${LOCAL_EDITORIAL_MODEL} repair is not available in this provider phase`);
    break;
  }
  const repaired=await repairIncompleteSections({includeEmpty:true});
  if(!repaired)break;
  console.warn(`${slug}: persisted incomplete section repaired with ${LOCAL_EDITORIAL_MODEL}; resuming synthesis in the same run`);
}
process.exit(lastStatus||75);
