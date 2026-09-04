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
const russianSentence=v=>{const s=clean(v);const cyr=(s.match(/[А-Яа-яЁё]/g)||[]).length;const latin=(s.match(/[A-Za-z]/g)||[]).length;return cyr>=12&&cyr>=latin*1.15};
const sanitizeRussianText=value=>clean(splitSentences(value).filter(russianSentence).join(' '));
const sanitizeRussianFeatures=items=>(Array.isArray(items)?items:[]).map(clean).filter(x=>x&&russianSentence(x));

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
На основе ТОЛЬКО фактов ниже создай редакторский текст страницы игры. Ничего не добавляй из памяти. Английские факты полностью перескажи естественным русским языком: НЕ копируй английские предложения и не оставляй англоязычные фрагменты, кроме названий и собственных имён.

Верни только JSON:
{"short_description":"...","integrated_description":"...","campaign":"...","features":["..."],"grounding_claim_ids":["claim-..."]}

Требования:
- short_description: 100–320 символов; сразу объясни центральную идею игры и путь игрока; количество предложений не фиксировано — используй столько коротких фраз, сколько нужно для лёгкого чтения; обычно 2–4, но не склеивай мысли ради формального числа;
- integrated_description: 450–850 символов, 5–7 русских предложений; конкретно расскажи, что делает игрок, как развивается игра, как меняется масштаб и какие инструменты создания важны;
- campaign: 180–450 символов, 3–5 русских предложений только о структуре прохождения/развития; не повторяй формулировки short/integrated;
- features: 5–7 разных конкретных особенностей по 35–140 символов, каждая по-русски;
- grounding_claim_ids: 4–7 реально использованных claim_id;
- центральные стадии, масштаб и механики важнее второстепенных деталей;
- сохраняй смысл переходов: биологический организм не должен «превращаться» в транспорт, здания или корабли; при росте масштаба отделяй эволюцию существа от развития общества и технологий;
- если в факте сказано cell, переводи как «клетка»/«одноклеточный организм», НИКОГДА не как «молекула»; creature = «существо», tribe = «племя», civilization = «цивилизация», space = «космос»;
- проверь падежи, согласование слов и естественность каждой фразы перед ответом;
- не упоминай источники, ИИ, процесс сбора, оценки и сравнения с другими играми;
- никаких рекламных формул, канцелярита и списка жанров вместо сути;
- не копируй ни одного целого предложения между блоками.

Факты:
${JSON.stringify(facts,null,2)}`;

function normalizeCandidate(data={},previous=null){
  const merged=previous?{...previous,...data}:data;
  return dedupeCrossBlocks({
    short_description:bound(sanitizeRussianText(merged.short_description),80,340),
    integrated_description:bound(sanitizeRussianText(merged.integrated_description),330,900),
    campaign:bound(sanitizeRussianText(merged.campaign),130,500),
    features:sanitizeRussianFeatures(merged.features).slice(0,7),
    grounding_claim_ids:[...new Set((Array.isArray(merged.grounding_claim_ids)?merged.grounding_claim_ids:[]).map(String))].filter(id=>claims.some(c=>c.claim_id===id))
  });
}
function failedFields(c){
  const failed=new Set();
  const narrative=[['short_description',c.short_description],['integrated_description',c.integrated_description],['campaign',c.campaign]];
  for(const [field,value] of narrative)if(!value||cyrillicRatio(value)<0.55)failed.add(field);
  if(c.short_description.length<90||c.short_description.length>340)failed.add('short_description');
  if(c.integrated_description.length<350)failed.add('integrated_description');
  if(c.campaign.length<130)failed.add('campaign');
  if(c.features.length<5||c.features.some(x=>x.length<28||cyrillicRatio(x)<0.55)||c.features.some((x,i)=>c.features.some((y,j)=>j>i&&similarity(x,y)>=0.74)))failed.add('features');
  if(hasExactCrossBlockSentence([c.short_description,c.integrated_description,c.campaign])){failed.add('integrated_description');failed.add('campaign')}
  const texts=[c.short_description,c.integrated_description,c.campaign,...c.features];
  if(texts.some(x=>/\b(?:ai|ии[- ]?систем|искусственн\w+ интеллект|создавательск\w*|конquest\w*|с野\w*|молекул\w*)\b/i.test(x))){failed.add('short_description');failed.add('integrated_description');failed.add('campaign');failed.add('features')}
  if(c.grounding_claim_ids.length<4)failed.add('grounding_claim_ids');
  return [...failed];
}
function problemsFor(c){
  const failed=failedFields(c);const problems=[];
  if(failed.includes('short_description'))problems.push('short_description: компактный естественный русский текст 100–320 символов; количество предложений свободное, приоритет — короткие читаемые фразы');
  if(failed.includes('integrated_description'))problems.push('integrated_description: естественный русский текст без повторов, минимум 350 символов');
  if(failed.includes('campaign'))problems.push('campaign: естественный русский текст о структуре прохождения без повторов, минимум 130 символов');
  if(failed.includes('features'))problems.push('features: минимум 5 разных содержательных русских пунктов');
  if(failed.includes('grounding_claim_ids'))problems.push('grounding_claim_ids: минимум 4 реально использованных подтверждённых факта');
  return problems;
}
function repairPrompt(previous,fields,problems){
  const schema={};for(const field of fields){if(field==='features')schema.features=['...'];else if(field==='grounding_claim_ids')schema.grounding_claim_ids=['claim-...'];else schema[field]='...'}
  return `${basePrompt}\n\nПредыдущий вариант частично прошёл проверку. Перепиши ТОЛЬКО поля: ${fields.join(', ')}. Остальные поля не возвращай. Все возвращаемые тексты должны быть полностью на русском, кроме названий и собственных имён. Не копируй английские предложения из фактов. Исправь грамматику и согласование. Недостатки: ${problems.join('; ')}.\nПредыдущий JSON:\n${JSON.stringify(previous,null,2)}\nВерни только JSON такого вида:\n${JSON.stringify(schema)}`;
}

let generated=null,providerInfo={},previous=null,lastProblems=[];
for(let attempt=1;attempt<=2;attempt++){
  const fields=previous?failedFields(previous):[];
  const prompt=attempt===1?basePrompt:repairPrompt(previous,fields,lastProblems);
  const result=await generateGamePageEditorialJSON({
    system:'Ты сильный русскоязычный редактор игрового издания. Пиши живо, конкретно, грамотно и естественно. Только переданные проверенные факты. Английские источники всегда пересказывай по-русски, не копируй. Не подменяй смысл терминов. Верни только валидный JSON.',
    prompt,
    temperature:attempt===1?0.28:0.08,
    maxTokens:attempt===1?1000:650
  });
  const candidate=normalizeCandidate(result?.data||{},previous);const problems=problemsFor(candidate);
  providerInfo={provider:result.provider,model:result.model};previous=candidate;lastProblems=problems;
  write(`data/parser-runs/page-editorial-candidate-${slug}.json`,{parser:'game-page-editorial-candidate-v3',game_slug:slug,attempt,repair_fields:fields,checked_at:new Date().toISOString(),provider:result.provider,model:result.model,problems,candidate});
  if(!problems.length){generated=candidate;break}
}
if(!generated)throw new Error(`${slug}: automatic editorial failed bounded repair: ${lastProblems.join('; ')}`);

draft.editorial={...(draft.editorial||{}),...generated,language:'ru',editorial_mode:'source_grounded_editorial',knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||''};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'source_grounded_editorial_pending_qc'};draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-source-grounded-editorial-v8',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,provider:providerInfo.provider||'unknown',model:providerInfo.model||null,paid_api:false,max_model_calls:2,repair_strategy:'failed-fields-only',mixed_language_sentences_removed:true,knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',source_count:knowledge.source_count||0,defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids,rating_sources:(ratings.sources||[]).length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider:providerInfo.provider,model:providerInfo.model,max_model_calls:2,repair_strategy:'failed-fields-only',defining_claims:claims.length,grounding_claim_ids:generated.grounding_claim_ids},null,2));
