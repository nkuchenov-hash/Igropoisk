#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {generateFreeEditorialJSON,assertFreeEditorialAI} from './lib/free-editorial-ai.mjs';

const root=process.cwd();
const requested=String(process.argv[2]||process.env.EDITORIAL_AI_PROVIDER_ORDER||'').trim().toLowerCase();
if(!requested)throw new Error('Usage: node scripts/benchmark-spore-editorial-provider.mjs <provider>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

const slug='spore';
const draft=read(`data/drafts/${slug}.json`,{});
const parser=read(`data/parser-output/${slug}.json`,{});
const corpus=read(`data/game-sources/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error('Missing canonical Spore draft');
if(!Array.isArray(corpus?.sources)||!corpus.sources.length)throw new Error('Missing canonical Spore source corpus');

const sourceEvidence=corpus.sources.slice(0,40).map(source=>({
  publication:clean(source.publication||source.name||source.source_name),
  title:clean(source.title),
  kind:clean(source.kind),
  roles:Array.isArray(source.roles)?source.roles:[],
  score:source.score??source.original_score??null,
  excerpt:clean(source.excerpt||source.summary||source.snippet||source.description||source.text||source.content||'').slice(0,1800)
})).filter(item=>item.publication||item.title||item.excerpt);

const evidence={
  identity:{title:clean(draft.identity?.title),release_date:clean(draft.release?.date||draft.release?.date_text),developers:(draft.companies?.developers||[]).map(clean),publishers:(draft.companies?.publishers||[]).map(clean)},
  classification:{genres:(draft.classification?.genres||[]).map(clean),platforms:(draft.classification?.platforms||[]).map(clean),categories:(draft.classification?.categories||[]).map(clean)},
  official_store_text:{short_description:clean(parser?.editorial?.short_description),integrated_description:clean(parser?.editorial?.integrated_description),features:(parser?.editorial?.features||[]).map(clean).filter(Boolean)},
  professional_sources:sourceEvidence
};

const system='Ты профессиональный русскоязычный игровой редактор. Пиши естественным современным русским языком, как сильный редактор игрового издания. Не переводи дословно английские конструкции. Не используй канцелярит, тавтологии, машинные обороты или рекламный язык магазина. Не добавляй факты, которых нет в переданных данных. Возвращай только валидный JSON.';
const prompt=`На основе ТОЛЬКО переданных данных напиши редакционный блок страницы игры Spore для Игропоиска. Это НЕ длинный обзор и НЕ рекламный текст. Нужно ясно и живо объяснить, что это за игра, чем она отличается и как устроена её прогрессия.\n\nВерни JSON строго такого вида:\n{\n  "short_description": "100–180 символов",\n  "integrated_description": "цельный сильный абзац 500–800 символов",\n  "campaign": "180–320 символов о структуре развития/прохождения",\n  "features": ["4–6 конкретных особенностей игры"]\n}\n\nТребования:\n- только русский язык, кроме собственных имён;\n- без повторов вроде «приключенческого приключения», «развиваться до развития» и подобных конструкций;\n- не выдавай Steam-функции вроде Trading Cards/Family Sharing за особенности геймплея;\n- не называй игрока «Галактическим Богом», если это не подтверждено переданными данными;\n- не выдумывай существ, стадии, оружие, режимы или события;\n- features должны описывать именно игровой опыт и механику;\n- текст должен быть пригоден для публикации без ручного переписывания.\n\nДАННЫЕ:\n${JSON.stringify(evidence)}`;

const startedAt=new Date().toISOString();
let output={provider:requested,status:'error',started_at:startedAt,evidence_sources:sourceEvidence.length};
try{
  const configured=await assertFreeEditorialAI();
  if(configured.provider!==requested)throw new Error(`Requested ${requested}, configured ${configured.provider}`);
  const generated=await generateFreeEditorialJSON({system,prompt,temperature:0.35,maxTokens:1200,numCtx:16384});
  output={...output,status:'completed',finished_at:new Date().toISOString(),actual_provider:generated.provider,model:generated.model,data:generated.data};
  console.log(JSON.stringify(output,null,2));
}catch(error){
  output={...output,status:'error',finished_at:new Date().toISOString(),error:String(error?.message||error)};
  console.error(JSON.stringify(output,null,2));
  write(`data/benchmarks/spore-${requested}.json`,output);
  process.exit(1);
}
write(`data/benchmarks/spore-${requested}.json`,output);
