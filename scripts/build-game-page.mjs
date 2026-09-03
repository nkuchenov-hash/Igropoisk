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
const stripNoise=v=>clean(v).replace(/^Discovered by existing verified corpus;\s*/i,'').replace(/^matched alias:\s*[^.;:]+[.;:]?\s*/i,'');
const junk=/\b(add source|review filters|widget-maker|creating an account|sign in|privacy policy|cookie|subscriber|purchase this game|all rights reserved|advertisement|newsletter|release date:|publisher:|developer:)\b/i;
const nonDefining=/\b(?:objectionable content|offensive creation|content moderation|submit.{0,80}delet|ban .{0,50}from (?:the |your )?game|filter out .{0,80}content|single[- ]player mmo|comparable to soloing|cooldown times|tutorial quests|reviewer|we think|we found)\b/i;
const normalize=v=>clean(v).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const wordSet=v=>new Set(normalize(v).split(/\s+/).filter(x=>x.length>=4));
const similarity=(a,b)=>{const A=wordSet(a),B=wordSet(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.min(A.size,B.size)};
const bound=(value,min,max)=>{const text=clean(value);if(text.length<=max)return text;const parts=text.match(/[^.!?…]+(?:[.!?…]+|$)/g)||[];let out='';for(const part of parts){const next=clean(`${out} ${part}`);if(next.length>max)break;out=next}return out.length>=min?out:text};
const splitSentences=value=>(clean(value).match(/[^.!?…]+(?:[.!?…]+|$)/g)||[]).map(clean).filter(Boolean);
const sentenceKey=v=>normalize(v);
function dedupeCrossBlocks(candidate){
  const seen=new Set();
  const dedupe=value=>{
    const kept=[];
    for(const sentence of splitSentences(value)){
      const key=sentenceKey(sentence);if(key.length>=45&&seen.has(key))continue;
      if(key.length>=45)seen.add(key);kept.push(sentence);
    }
    return clean(kept.join(' '));
  };
  return {...candidate,short_description:dedupe(candidate.short_description),integrated_description:dedupe(candidate.integrated_description),campaign:dedupe(candidate.campaign)};
}
const hasExactCrossBlockSentence=blocks=>{const seen=new Set();for(const block of blocks){for(const sentence of splitSentences(block)){const key=sentenceKey(sentence);if(key.length<45)continue;if(seen.has(key))return true;seen.add(key)}}return false};

const draft=read(`data/drafts/${slug}.json`),knowledge=read(`data/game-knowledge/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
if(knowledge?.status!=='green'||!Array.isArray(knowledge.defining_claims)||knowledge.defining_claims.length<4)throw new Error(`${slug}: green accumulated game knowledge is required before editorial writing`);

const claims=[];const seen=new Set();
for(const [index,item] of knowledge.defining_claims.entries()){
  const claim=stripNoise(item?.claim);const key=normalize(claim).slice(0,220);
  if(claim.length<35||junk.test(claim)||nonDefining.test(claim)||seen.has(key))continue;
  seen.add(key);claims.push({...item,claim,claim_id:String(item?.claim_id||`claim-${index+1}`)});
}
if(claims.length<4)throw new Error(`${slug}: only ${claims.length} defining source-grounded claims remain after evidence hygiene`);
knowledge.defining_claims=claims;knowledge.status='green';knowledge.evidence_hygiene={...(knowledge.evidence_hygiene||{}),writer_defining_claim_filter:true,secondary_moderation_and_review_comparisons_excluded:true};write(`data/game-knowledge/${slug}.json`,knowledge);
const facts=claims.slice(0,7).map(x=>({claim_id:x.claim_id,fact:x.claim}));

const basePrompt=`Игра: ${draft.identity.title}.
На основе ТОЛЬКО фактов ниже создай редакторский текст страницы игры. Ничего не добавляй из памяти. Английские факты перескажи естественным русским языком, не калькируй их и не меняй смысл терминов.

Верни только JSON:
{"short_description":"...","integrated_description":"...","campaign":"...","features":["..."],"grounding_claim_ids":["claim-..."]}

Требования:
- short_description: РОВНО 2 предложения, 100–240 символов; сразу объясни центральную идею игры и путь игрока;
- integrated_description: 450–850 символов, 5–7 предложений; конкретно расскажи, что делает игрок, как развивается игра, как меняется масштаб и какие инструменты создания важны;
- campaign: 180–450 символов, 3–5 предложений ТОЛЬКО о структуре прохождения/развития; не повторяй формулировки short/integrated;
- features: 5–7 разных конкретных особенностей по 35–140 символов;
- grounding_claim_ids: 4–7 реально использованных claim_id;
- центральные стадии, масштаб и механики важнее второстепенных деталей;
- если в факте сказано cell, переводи как «клетка»/«одноклеточный организм», НИКОГДА не как «молекула»; creature = «существо», tribe = «племя», civilization = «цивилизация», space = «космос»;
- не упоминай источники, ИИ, процесс сбора, оценки и сравнения с другими играми;
- никаких рекламных формул, канцелярита и списка жанров вместо сути;
- не копируй ни одного целого предложения между блоками.

Факты:
${JSON.stringify(facts,null,2)}`;

function normalizeCandidate(data={}){
  return dedupeCrossBlocks({
    short_description:bound(data.short_description,80,270),
    integrated_description:bound(data.integrated_description,330,900),
    campaign:bound(data.campaign,130,500),
    features:(Array.isArray(data.features)?data.features:[]).map(clean).filter(Boolean).slice(0,7),
    grounding_claim_ids:[...new Set((Array.isArray(data.grounding_claim_ids)?data.grounding_claim_ids:[]).map(String))].filter(id=>claims.some(c=>c.claim_id===id))
  });
}
function problemsFor(c){
  const problems=[];const texts=[c.short_description,c.integrated_description,c.campaign,...c.features];
  if(!texts.every(x=>cyrillicRatio(x)>=0.55))problems.push('все блоки должны быть естественным русским текстом');
  if(c.short_description.length<90)problems.push('short_description должен быть двумя содержательными предложениями минимум 90 символов');
  if(splitSentences(c.short_description).length<2)problems.push('short_description должен состоять из двух предложений');
  if(c.integrated_description.length<350)problems.push('integrated_description слишком короткий');
  if(c.campaign.length<130)problems.push('campaign слишком короткий после удаления повторов');
  if(c.features.length<5||c.features.some(x=>x.length<28))problems.push('нужно минимум 5 содержательных features');
  if(c.features.some((x,i)=>c.features.some((y,j)=>j>i&&similarity(x,y)>=0.74)))problems.push('features повторяют друг друга');
  if(hasExactCrossBlockSentence([c.short_description,c.integrated_description,c.campaign]))problems.push('между текстовыми блоками дословно повторяются предложения');
  if(texts.some(x=>/\b(?:ai|ии[- ]?систем|искусственн\w+ интеллект|создавательск\w*|конquest\w*|с野\w*|молекул\w*)\b/i.test(x)))problems.push('есть машинный мусор, мета-лексика или смысловая подмена терминов');
  if(c.grounding_claim_ids.length<4)problems.push('использовано меньше 4 подтверждённых фактов');
  return problems;
}

let generated=null,providerInfo={},previous=null,lastProblems=[];
for(let attempt=1;attempt<=2;attempt++){
  const repair=attempt===2&&previous?`\n\nИсправь ТОЛЬКО перечисленные недостатки предыдущего варианта, сохранив хорошие части и фактический смысл. Ошибки: ${lastProblems.join('; ')}.\nПредыдущий JSON:\n${JSON.stringify(previous,null,2)}`:'';
  const result=await generateGamePageEditorialJSON({
    system:'Ты сильный русскоязычный редактор игрового издания. Пиши живо, конкретно, грамотно и естественно. Только переданные проверенные факты. Не подменяй термины. Верни только валидный JSON.',
    prompt:basePrompt+repair,
    temperature:attempt===1?0.28:0.1,
    maxTokens:1000
  });
  const candidate=normalizeCandidate(result?.data||{});const problems=problemsFor(candidate);
  providerInfo={provider:result.provider,model:result.model};previous=candidate;lastProblems=problems;
  write(`data/parser-runs/page-editorial-candidate-${slug}.json`,{parser:'game-page-editorial-candidate-v2',game_slug:slug,attempt,checked_at:new Date().toISOString(),provider:result.provider,model:result.model,problems,candidate});
  if(!problems.length){generated=candidate;break}
}
if(!generated)throw new Error(`${slug}: automatic editorial failed bounded repair: ${lastProblems.join('; ')}`);

draft.editorial={...(draft.editorial||{}),...generated,language:'ru',editorial_mode:'source_grounded_editorial',knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||''};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'source_grounded_editorial_pending_qc'};draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-source-grounded-editorial-v7',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,provider:providerInfo.provider||'unknown',model:providerInfo.model||null,paid_api:false,knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',source_count:knowledge.source_count||0,defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids,rating_sources:(ratings.sources||[]).length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider:providerInfo.provider,model:providerInfo.model,max_model_calls:2,defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids},null,2));
