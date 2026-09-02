#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {generateFreeEditorialJSON,assertFreeEditorialAI} from './lib/free-editorial-ai.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`),corpus=read(`data/game-sources/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const sources=(corpus?.sources||[]).map(s=>({name:s.publication||s.name||s.source_name||'',title:s.title||'',url:s.resolved_url||s.url||'',kind:s.kind||'',roles:s.roles||[],score:s.score??s.original_score??null})).filter(s=>s.url);
if(!corpus?.discovery?.complete||!sources.length)throw new Error(`${slug}: complete canonical source corpus is required before editorial repair`);

const ai=await assertFreeEditorialAI();
const prompt=`Напиши редакционный блок страницы игры ${draft.identity.title} для Игропоиска. Используй ТОЛЬКО факты из переданных ниже проверенных данных и canonical source corpus. Не добавляй факты по памяти модели. Не смешивай ремейки, ремастеры, DLC, продолжения и одноимённые игры. Верни только JSON с полями short_description, integrated_description, campaign, features.\n\nПроверенный draft:\n${JSON.stringify({identity:draft.identity,release:draft.release,companies:draft.companies,classification:draft.classification,requirements:draft.requirements,links:draft.links},null,2)}\n\nCanonical source corpus:\n${JSON.stringify(sources,null,2)}\n\nРассчитанные оценки:\n${JSON.stringify(ratings?.sources||[],null,2)}\n\nТребования:\n- Только естественный русский язык, как у сильного живого игрового редактора.\n- short_description: 100–220 символов, сразу объясняет суть и отличительную черту игры.\n- integrated_description: минимум 350 символов; конкретно объясняет игровой цикл, мир или структуру, ключевые механики и чем игра выделяется.\n- campaign: минимум 150 символов; конкретно описывает роль игрока и структуру прохождения/сюжета либо содержательно объясняет отсутствие кампании.\n- features: массив из 4–8 конкретных особенностей; каждая полноценная фраза не короче 18 символов.\n- Никаких технических фраз о парсинге, источниках, сборе данных или работе модели.\n- Запрещены формулы «построена как», «основной режим рассчитан», «ключевые механики здесь выводятся», «официальное описание указывает», «описание не добавляет», «информация собрана из источников».\n- Если факт нельзя подтвердить переданными данными, не используй его.`;
const {data:editorial,provider,model}=await generateFreeEditorialJSON({
  system:'Ты русскоязычный игровой редактор. Пиши конкретно, естественно и фактологично. Возвращай только валидный JSON.',
  prompt,
  temperature:0.25
});
const features=Array.isArray(editorial?.features)?editorial.features.map(x=>String(x||'').trim()).filter(Boolean):[];
const next={
  short_description:String(editorial?.short_description||'').trim(),
  integrated_description:String(editorial?.integrated_description||'').trim(),
  campaign:String(editorial?.campaign||'').trim(),
  features
};
if(next.short_description.length<80||next.integrated_description.length<250||next.campaign.length<100||features.length<4)throw new Error('Free Qwen editorial output is structurally incomplete; keeping page in revision state');
draft.editorial={...(draft.editorial||{}),...next};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'editorial_generated_pending_qc'};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-editorial-builder',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,provider,model,paid_api:false,source_corpus:`data/game-sources/${slug}.json`,source_count:sources.length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider,model,paid_api:false,sources:sources.length,public_ready:false},null,2));
