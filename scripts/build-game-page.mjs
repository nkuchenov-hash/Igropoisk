#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-game-page.mjs <slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for editorial repair');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const draft=read(`data/drafts/${slug}.json`),corpus=read(`data/game-sources/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
const sources=(corpus?.sources||[]).map(s=>({name:s.publication||s.name||s.source_name||'',title:s.title||'',url:s.resolved_url||s.url||'',kind:s.kind||'',roles:s.roles||[],score:s.score??s.original_score??null})).filter(s=>s.url);
if(!corpus?.discovery?.complete||!sources.length)throw new Error(`${slug}: complete canonical source corpus is required before editorial repair`);
const schema={type:'object',additionalProperties:false,required:['short_description','integrated_description','campaign','features'],properties:{short_description:{type:'string'},integrated_description:{type:'string'},campaign:{type:'string'},features:{type:'array',minItems:4,maxItems:8,items:{type:'string'}}}};
const input=`Ты редактор русскоязычной игровой энциклопедии Игропоиск. Напиши содержательный текст страницы игры ${draft.identity.title}. Используй веб-поиск только для проверки фактов и только источники, относящиеся к точной игре. Не смешивай ремейки, ремастеры, DLC, продолжения и одноимённые игры.\n\nПроверенный draft:\n${JSON.stringify({identity:draft.identity,release:draft.release,companies:draft.companies,classification:draft.classification,requirements:draft.requirements,links:draft.links},null,2)}\n\nCanonical source corpus:\n${JSON.stringify(sources,null,2)}\n\nРассчитанные оценки:\n${JSON.stringify(ratings?.sources||[],null,2)}\n\nТребования к тексту:\n- Только естественный русский язык, как у сильного живого игрового редактора.\n- short_description: 100–220 символов, сразу объясняет суть и отличительную черту игры; без технических фраз о сборе данных.\n- integrated_description: минимум 350 символов; конкретно объясняет игровой цикл, мир/структуру, ключевые механики и чем игра выделяется. Не пересказывай маркетинговый текст и не используй пустые формулы.\n- campaign: минимум 150 символов; конкретно описывает роль игрока и структуру прохождения/сюжета либо содержательно объясняет отсутствие кампании.\n- features: 4–8 конкретных особенностей, каждая полноценная осмысленная фраза не короче 18 символов.\n- Запрещены формулы «построена как», «основной режим рассчитан», «ключевые механики здесь выводятся», «официальное описание указывает», «описание не добавляет», «информация собрана из источников».\n- Не выдумывай факты, которых нельзя подтвердить источниками.`;
const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],input,text:{format:{type:'json_schema',name:'igropoisk_page_editorial',strict:true,schema}}})});
if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
const data=await response.json(),raw=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
if(!raw)throw new Error('No editorial output');
const editorial=JSON.parse(raw);
draft.editorial={...(draft.editorial||{}),short_description:String(editorial.short_description||'').trim(),integrated_description:String(editorial.integrated_description||'').trim(),campaign:String(editorial.campaign||'').trim(),features:(editorial.features||[]).map(x=>String(x||'').trim()).filter(Boolean)};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'editorial_generated_pending_qc'};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-editorial-builder',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,source_corpus:`data/game-sources/${slug}.json`,source_count:sources.length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',sources:sources.length,public_ready:false},null,2));
