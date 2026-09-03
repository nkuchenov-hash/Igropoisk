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
const draft=read(`data/drafts/${slug}.json`),knowledge=read(`data/game-knowledge/${slug}.json`,{}),ratings=read(`data/ratings/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
if(knowledge?.status!=='green'||!Array.isArray(knowledge.defining_claims)||knowledge.defining_claims.length<4)throw new Error(`${slug}: green accumulated game knowledge is required before editorial writing`);
const grounded={game_essence:knowledge.game_essence,player_role:knowledge.player_role,core_loop:knowledge.core_loop,progression_structure:knowledge.progression_structure,world_structure:knowledge.world_structure,mechanics:(knowledge.mechanics||[]).slice(0,8),distinctive_features:(knowledge.distinctive_features||[]).slice(0,8),consensus_praise:(knowledge.consensus_praise||[]).slice(0,5),consensus_criticism:(knowledge.consensus_criticism||[]).slice(0,5),defining_claims:(knowledge.defining_claims||[]).slice(0,8)};
const {data:editorial,provider,model}=await generateGamePageEditorialJSON({
  system:'Ты сильный русскоязычный игровой редактор. Пиши живо и конкретно, используя только переданную source-grounded базу знаний. Не используй память модели. Возвращай только валидный JSON.',
  temperature:0.3,maxTokens:1100,
  prompt:`Напиши редакционный блок страницы игры ${draft.identity.title} для Игропоиска. Это НЕ обзор и не рекламный текст. Сразу объясни, что это за игра, что делает игрок, как устроено развитие и чем она отличается.\n\nИспользуй только факты из базы знаний ниже. Не перечисляй жанры вместо сути. Не упоминай источники, оценки, сбор данных или ИИ.\n\nВерни JSON: short_description, integrated_description, campaign, features.\n\nМетаданные:\n${JSON.stringify({identity:draft.identity,release:draft.release,companies:draft.companies},null,2)}\n\nБаза знаний:\n${JSON.stringify(grounded,null,2)}\n\nТребования:\n- short_description: 100–240 символов, первая фраза передаёт главную идею игры;\n- integrated_description: 450–900 символов, роль игрока + основной цикл + развитие/структура + уникальность;\n- campaign: 180–500 символов, путь игрока/этапы/структура прохождения;\n- features: 4–8 конкретных особенностей;\n- отрази минимум три defining_claims;\n- запрещены пустые формулы вроде «сочетает элементы жанров» и «уникальный опыт» без конкретики;\n- никаких фактов вне базы знаний.`
});
const features=Array.isArray(editorial?.features)?editorial.features.map(clean).filter(Boolean).slice(0,8):[];
const next={short_description:clean(editorial?.short_description),integrated_description:clean(editorial?.integrated_description),campaign:clean(editorial?.campaign),features};
if(next.short_description.length<90||next.integrated_description.length<350||next.campaign.length<130||features.length<4)throw new Error('Source-grounded editorial output is structurally incomplete; keeping page in revision state');
draft.editorial={...(draft.editorial||{}),...next,language:'ru',editorial_mode:'source_grounded_editorial',knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||''};
draft.publication={...(draft.publication||{}),status:'needs_revision',public_ready:false,quality_status:'source_grounded_editorial_pending_qc'};
draft.updated_at=new Date().toISOString();
write(`data/drafts/${slug}.json`,draft);
write(`data/parser-runs/page-editorial-generation-${slug}.json`,{parser:'game-page-source-grounded-editorial-v3',status:'completed_pending_qc',game_slug:slug,checked_at:draft.updated_at,provider,model,paid_api:false,knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash||'',source_count:knowledge.source_count||0,defining_claims:knowledge.defining_claims.length,rating_sources:(ratings.sources||[]).length,output:`data/drafts/${slug}.json`});
console.log(JSON.stringify({slug,status:'completed_pending_qc',provider,model,paid_api:false,knowledge_sources:knowledge.source_count,defining_claims:knowledge.defining_claims.length,editorial_mode:draft.editorial.editorial_mode,public_ready:false},null,2));
