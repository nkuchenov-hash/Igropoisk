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
const stripNoise=v=>clean(v).replace(/^Discovered by existing verified corpus;\s*matched alias:\s*[^ ]+\s*/i,'').replace(/^matched alias:\s*[^ ]+\s*/i,'');
const junk=/\b(add source|\d+[hm] ago|review filters|widget-maker|creating an account|sign in|privacy policy|cookie|subscriber|purchase this game|release date:|publisher:|developer:)\b/i;
const semantic=/\b(creator|create|creation|build|editor|evol|species|creature|cell|tribe|civilization|space|galaxy|planet|world|explor|combat|fight|manage|player|play|progress|stage|level|quest|mission|story|vehicle|building|starship|universe|god|созда|стро|редактор|эволюц|вид|существ|клет|плем|цивилизац|космос|галак|планет|мир|исслед|бой|сраж|управ|игрок|игров|развит|этап|уров|мисси|сюжет)\w*/i;

const draft=read(`data/drafts/${slug}.json`),knowledge=read(`data/game-knowledge/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
if(knowledge?.status!=='green'||!Array.isArray(knowledge.defining_claims)||knowledge.defining_claims.length<4)throw new Error(`${slug}: green accumulated game knowledge is required before editorial writing`);

const seen=new Set();
const cleanClaims=[];
for(const [index,item] of knowledge.defining_claims.entries()){
  const claim=stripNoise(item?.claim);const key=claim.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').slice(0,180);
  if(claim.length<35||junk.test(claim)||!semantic.test(claim)||seen.has(key))continue;
  seen.add(key);cleanClaims.push({...item,claim,claim_id:String(item?.claim_id||`claim-${index+1}`)});
}
if(cleanClaims.length<4)throw new Error(`${slug}: only ${cleanClaims.length} clean source-grounded claims remain after evidence hygiene`);
const pick=re=>cleanClaims.find(x=>re.test(x.claim))?.claim||'';
const progression=pick(/\b(evol|single cell|stage|progress|species|tribe|civilization|space|interstellar|развит|эволюц|клет|этап|плем|цивилизац|космос)\w*/i);
const role=pick(/\b(creator|architect|you |player|guide|control|созда|архитектор|игрок|управ|вед)\w*/i);
const loop=pick(/\b(create|editor|build|explor|combat|manage|creation tools|созда|редактор|стро|исслед|бой|управ)\w*/i);
const world=pick(/\b(universe|world|planet|galaxy|species become part|вселен|мир|планет|галак)\w*/i);
const essenceParts=[progression,role,loop,world,...cleanClaims.map(x=>x.claim)].filter(Boolean);
const essence=[...new Set(essenceParts)].slice(0,3).join(' ');
knowledge.defining_claims=cleanClaims;
knowledge.game_essence=essence;
knowledge.player_role=role||cleanClaims[0].claim;
knowledge.core_loop=loop||cleanClaims[1]?.claim||cleanClaims[0].claim;
knowledge.progression_structure=progression||cleanClaims[0].claim;
knowledge.world_structure=world||cleanClaims.find(x=>x.claim!==knowledge.progression_structure)?.claim||cleanClaims[0].claim;
knowledge.mechanics=[...new Set([loop,...cleanClaims.map(x=>x.claim)].filter(Boolean))].slice(0,8);
knowledge.distinctive_features=[...new Set(cleanClaims.map(x=>x.claim))].slice(0,8);
knowledge.evidence_hygiene={version:1,clean_claims:cleanClaims.length,removed_claims:(knowledge.defining_claims_original_count||0)||Math.max(0,(knowledge.defining_claims?.length||0)-cleanClaims.length),search_boilerplate_forbidden:true,semantic_relevance_required:true};
knowledge.status='green';
write(`data/game-knowledge/${slug}.json`,knowledge);

const facts=cleanClaims.slice(0,7).map(x=>({claim_id:x.claim_id,fact:x.claim}));
const factText=JSON.stringify(facts,null,2);
const providers=[];
async function makeText(kind,requirements,min,max,maxTokens){
  let last='';
  for(let attempt=1;attempt<=2;attempt++){
    const {data,provider,model}=await generateGamePageEditorialJSON({
      system:'Ты русскоязычный игровой редактор. Верни только JSON {"text":"..."}. Весь текст поля text обязан быть на естественном русском языке. Английские предложения из фактов нужно пересказать по-русски, а не копировать. Используй только переданные факты, ничего не добавляй из памяти.',
      temperature:attempt===1?0.25:0.1,maxTokens,
      prompt:`Игра: ${draft.identity.title}. Напиши ${kind}. ${requirements}\nДлина: ${min}-${max} символов. Не упоминай источники, claim_id, ИИ, оценки и процесс сбора. Не используй фразы «уникальный опыт» и «сочетает жанры» вместо конкретики.\nФакты:\n${factText}`
    });
    const text=clean(data?.text);last=text;providers.push({provider,model});
    if(text.length>=min&&text.length<=max+120&&cyrillicRatio(text)>=0.6)return text;
  }
  throw new Error(`${kind}: automatic Russian writer failed quality bounds (${last.length} chars, cyr=${cyrillicRatio(last).toFixed(2)})`);
}
async function makeFeatures(){
  let last=[];
  for(let attempt=1;attempt<=2;attempt++){
    const {data,provider,model}=await generateGamePageEditorialJSON({
      system:'Ты русскоязычный игровой редактор. Верни только JSON {"features":["...", "..."]}. Все пункты обязаны быть на естественном русском. Английские факты пересказывай по-русски. Используй только переданные факты.',
      temperature:attempt===1?0.25:0.1,maxTokens:520,
      prompt:`Игра: ${draft.identity.title}. Составь 5-7 конкретных особенностей игры. Каждый пункт 35-130 символов и описывает реальную механику, структуру развития, роль игрока или устройство мира. Никаких оценок, рекламы, источников и общих жанровых формул.\nФакты:\n${factText}`
    });
    last=Array.isArray(data?.features)?data.features.map(clean).filter(Boolean).slice(0,8):[];providers.push({provider,model});
    if(last.length>=4&&last.every(x=>x.length>=18&&cyrillicRatio(x)>=0.55))return last;
  }
  throw new Error(`features: automatic Russian writer failed quality bounds (${last.length} items)`);
}

const short_description=await makeText('краткое описание, которое с первой фразы объясняет главную идею игры','1-2 предложения: что делает игрок и какой путь проходит.',100,240,260);
const integrated_description=await makeText('основное описание страницы','5-7 связанных предложений: роль игрока, основной игровой цикл, развитие, масштаб и отличительные механики.',450,900,760);
const campaign=await makeText('раздел о структуре прохождения','3-5 предложений: как меняется положение игрока и игра по мере продвижения, какие этапы или масштабы следуют друг за другом.',180,500,430);
const features=await makeFeatures();
const grounding_claim_ids=cleanClaims.slice(0,Math.min(6,cleanClaims.length)).map(x=>x.claim_id);
const next={short_description,integrated_description,campaign,features};
if(cyrillicRatio(short_description)<0.55||cyrillicRatio(integrated_description)<0.55||cyrillicRatio(campaign)<0.55)throw new Error('Automatic page editorial did not pass Russian-language gate');

draft.editorial={...(draft.editorial||{}),...next,language:'ru',editorial_mode:'source_grounded_editorial',knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',grounding_claim_ids};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'source_grounded_editorial_pending_qc'};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
const usedProvider=providers.at(-1)||{};
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-source-grounded-editorial-v4',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,provider:usedProvider.provider||'ollama',model:usedProvider.model||null,paid_api:false,knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',source_count:knowledge.source_count||0,defining_claims:knowledge.defining_claims.length,grounding_claim_ids,rating_sources:(ratings.sources||[]).length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider:usedProvider.provider||'ollama',model:usedProvider.model||null,paid_api:false,knowledge_sources:knowledge.source_count,defining_claims:knowledge.defining_claims.length,grounding_claim_ids,editorial_mode:draft.editorial.editorial_mode,public_ready:false},null,2));
