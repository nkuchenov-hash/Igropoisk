#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {generateGamePageEditorialJSON} from './lib/game-page-editorial-ai.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page.mjs <slug>');

const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const cyrillicRatio=v=>{const s=clean(v);const letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;return letters?(s.match(/[А-Яа-яЁё]/g)||[]).length/letters:0};
const stripNoise=v=>clean(v)
  .replace(/^Discovered by existing verified corpus;\s*/i,'')
  .replace(/^matched alias:\s*[^.;:]+[.;:]?\s*/i,'');
const junk=/\b(add source|review filters|widget-maker|creating an account|sign in|privacy policy|cookie|subscriber|purchase this game|all rights reserved|advertisement|newsletter|release date:|publisher:|developer:)\b/i;
const normalizeForDup=v=>clean(v).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const wordSet=v=>new Set(normalizeForDup(v).split(/\s+/).filter(x=>x.length>=4));
const similarity=(a,b)=>{const A=wordSet(a),B=wordSet(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.min(A.size,B.size)};
const bound=(value,min,max)=>{const text=clean(value);if(text.length<=max)return text;const parts=text.match(/[^.!?…]+(?:[.!?…]+|$)/g)||[];let out='';for(const part of parts){const next=clean(`${out} ${part}`);if(next.length>max)break;out=next}return out.length>=min?out:text};

const draft=read(`data/drafts/${slug}.json`);
const knowledge=read(`data/game-knowledge/${slug}.json`,{});
const ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
if(knowledge?.status!=='green'||!Array.isArray(knowledge.defining_claims)||knowledge.defining_claims.length<4)throw new Error(`${slug}: green accumulated game knowledge is required before editorial writing`);

const claims=[];const seen=new Set();
for(const [index,item] of knowledge.defining_claims.entries()){
  const claim=stripNoise(item?.claim);const key=normalizeForDup(claim).slice(0,220);
  if(claim.length<35||junk.test(claim)||seen.has(key))continue;
  seen.add(key);claims.push({...item,claim,claim_id:String(item?.claim_id||`claim-${index+1}`)});
}
if(claims.length<4)throw new Error(`${slug}: only ${claims.length} clean source-grounded claims remain after evidence hygiene`);
knowledge.defining_claims=claims;
knowledge.evidence_hygiene={version:2,clean_claims:claims.length,boilerplate_forbidden:true,duplicate_claims_forbidden:true};
knowledge.status='green';
write(`data/game-knowledge/${slug}.json`,knowledge);

const facts=claims.slice(0,8).map(x=>({claim_id:x.claim_id,fact:x.claim}));
const prompt=`Игра: ${draft.identity.title}.

На основе ТОЛЬКО фактов ниже создай весь редакторский текст страницы игры за один проход. Ничего не добавляй из памяти. Английские факты перескажи естественным русским языком, не калькируй их.

Верни только JSON:
{
  "short_description":"...",
  "integrated_description":"...",
  "campaign":"...",
  "features":["..."],
  "grounding_claim_ids":["claim-..."]
}

Требования:
- short_description: 100–260 символов, 1–2 предложения, сразу объясняет главную идею и действие игрока;
- integrated_description: 450–950 символов, 5–7 связанных предложений; роль игрока, игровой цикл, развитие/структура, масштаб и главное отличие игры;
- campaign: 180–520 символов, 3–5 предложений о ходе прохождения/развития; не выдумывай сюжет, если его нет в фактах;
- features: 5–7 конкретных, неповторяющихся пунктов по 35–150 символов;
- grounding_claim_ids: 4–8 реально использованных claim_id;
- не упоминай источники, ИИ, сбор данных, оценки, жанровые ярлыки вместо сути;
- запрещены канцелярит, рекламные формулы, "уникальный опыт", "сочетает жанры", повторы одной мысли разными словами;
- каждый блок должен добавлять новую информацию, а не пересказывать предыдущий.

Факты:
${JSON.stringify(facts,null,2)}`;

let lastError='';let generated=null;let providerInfo={};
for(let attempt=1;attempt<=2;attempt++){
  try{
    const result=await generateGamePageEditorialJSON({
      system:'Ты сильный русскоязычный редактор игрового издания. Пиши живо, конкретно и естественно. Используй только переданные проверенные факты. Верни только валидный JSON.',
      prompt,
      temperature:attempt===1?0.35:0.15,
      maxTokens:1900
    });
    const data=result?.data||{};
    const short_description=bound(data.short_description,100,280);
    const integrated_description=bound(data.integrated_description,430,980);
    const campaign=bound(data.campaign,170,550);
    const features=(Array.isArray(data.features)?data.features:[]).map(clean).filter(Boolean).slice(0,7);
    const grounding=[...new Set((Array.isArray(data.grounding_claim_ids)?data.grounding_claim_ids:[]).map(String))].filter(id=>claims.some(c=>c.claim_id===id));
    const texts=[short_description,integrated_description,campaign,...features];
    const russian=texts.every(x=>cyrillicRatio(x)>=0.55);
    const lengths=short_description.length>=100&&integrated_description.length>=430&&campaign.length>=170&&features.length>=5&&features.every(x=>x.length>=28);
    const duplicateFeatures=features.some((x,i)=>features.some((y,j)=>j>i&&similarity(x,y)>=0.72));
    const crossDup=similarity(short_description,integrated_description)>=0.9||similarity(campaign,integrated_description)>=0.9;
    const forbidden=texts.some(x=>/\b(?:ai|ии[- ]?систем|искусственн\w+ интеллект|создавательск\w*)\b/i.test(x));
    if(!russian||!lengths||duplicateFeatures||crossDup||forbidden||grounding.length<4){
      throw new Error(`quality bounds: russian=${russian} lengths=${lengths} duplicateFeatures=${duplicateFeatures} crossDup=${crossDup} forbidden=${forbidden} grounding=${grounding.length}`);
    }
    generated={short_description,integrated_description,campaign,features,grounding_claim_ids:grounding};
    providerInfo={provider:result.provider,model:result.model};
    break;
  }catch(error){lastError=String(error?.message||error)}
}
if(!generated)throw new Error(`${slug}: single-pass editorial failed after 2 attempts: ${lastError}`);

draft.editorial={...(draft.editorial||{}),...generated,language:'ru',editorial_mode:'source_grounded_editorial',knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||''};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'source_grounded_editorial_pending_qc'};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{
  parser:'game-page-source-grounded-editorial-v5',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,
  provider:providerInfo.provider||'unknown',model:providerInfo.model||null,paid_api:false,
  knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',source_count:knowledge.source_count||0,
  defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids,rating_sources:(ratings.sources||[]).length,output:`data/drafts/${slug}.json`
});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider:providerInfo.provider,model:providerInfo.model,requests_max:2,defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids},null,2));
