#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {generateFreeEditorialJSON,assertFreeEditorialAI} from './lib/free-editorial-ai.mjs';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/enrich-game-relations.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const draft=read(`data/drafts/${slug}.json`);
const corpus=read(`data/game-sources/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing data/drafts/${slug}.json`);
const title=draft.identity.title;
const currentYear=Number(String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const checkedAt=new Date().toISOString();
function revision(reason){
  write(`data/parser-runs/relations-${slug}.json`,{parser:'game-relations-research',status:'needs_revision',game_slug:slug,checked_at:checkedAt,provider:'ollama',paid_api:false,comments:[reason]});
  console.log(JSON.stringify({slug,status:'needs_revision',preserved_existing:true,reason},null,2));
  process.exit(0);
}
let ai;
try{ai=await assertFreeEditorialAI()}catch(error){revision(`Free Qwen/Ollama unavailable: ${error.message||error}. Existing relation data was preserved.`)}
const sourceFacts=(corpus?.sources||[]).map(s=>({name:s.publication||s.name||s.source_name||'',title:s.title||'',url:s.resolved_url||s.url||'',kind:s.kind||'',roles:s.roles||[]})).filter(s=>s.url);
const prompt=`Для Игропоиска структурируй связи и профиль сходства точной игры ${title} (${currentYear||'год уточняется'}). Используй только переданные данные. Не добавляй сведения по памяти модели. Верни только JSON с объектами franchise и similarity_profile.\n\nДанные игры:\n${JSON.stringify({identity:draft.identity,release:draft.release,classification:draft.classification,editorial:draft.editorial,companies:draft.companies,links:draft.links,existing_relations:draft.relations||null},null,2)}\n\nПроверенный корпус источников:\n${JSON.stringify(sourceFacts,null,2)}\n\nПравила franchise:\n- franchise.name — название официальной серии только если оно подтверждается переданными данными; иначе пустая строка.\n- franchise.games — только другие самостоятельные игры той же серии, но только если их название/связь подтверждаются переданными данными. Не включай DLC, дополнения, soundtrack, demo и текущую игру.\n- Для игры серии: title, slug, release_year (число или null), steam_appid (число или null), relation, source_url. Не угадывай ID, год или URL.\n- franchise.evidence — массив URL из переданного корпуса, реально подтверждающих связь; иначе пустой массив.\n\nПравила similarity_profile:\nВерни массивы строк: genres, subgenres, gameplay_type, combat, perspective, world_structure, party_mode, narrative, progression, setting, tone, multiplayer, mechanics, semantic_tokens. Они должны описывать только свойства, которые следуют из переданных classification/editorial данных. Если данных нет — оставь массив пустым.`;
let relations;
try{
  const result=await generateFreeEditorialJSON({system:'Ты редактор игровой базы данных. Не выдумывай факты. Возвращай только валидный JSON.',prompt,temperature:0.1});
  relations=result.data;
}catch(error){revision(`Free relation research failed: ${error.message||error}. Existing data was preserved.`)}
const emptyProfile={genres:[],subgenres:[],gameplay_type:[],combat:[],perspective:[],world_structure:[],party_mode:[],narrative:[],progression:[],setting:[],tone:[],multiplayer:[],mechanics:[],semantic_tokens:[]};
relations.franchise=relations?.franchise&&typeof relations.franchise==='object'?relations.franchise:{name:'',games:[],evidence:[]};
relations.franchise.name=String(relations.franchise.name||'').trim();
relations.franchise.games=(Array.isArray(relations.franchise.games)?relations.franchise.games:[]).filter(game=>game?.title&&String(game.title).toLowerCase()!==String(title).toLowerCase()).map(game=>({title:String(game.title||'').trim(),slug:String(game.slug||'').trim(),release_year:Number.isFinite(Number(game.release_year))?Number(game.release_year):null,steam_appid:Number.isFinite(Number(game.steam_appid))?Number(game.steam_appid):null,relation:String(game.relation||'').trim(),source_url:String(game.source_url||'').trim()})).filter(game=>game.slug&&game.source_url);
relations.franchise.evidence=(Array.isArray(relations.franchise.evidence)?relations.franchise.evidence:[]).map(String).filter(url=>sourceFacts.some(source=>source.url===url));
relations.similarity_profile={...emptyProfile,...(relations?.similarity_profile||{})};
for(const key of Object.keys(emptyProfile))relations.similarity_profile[key]=(Array.isArray(relations.similarity_profile[key])?relations.similarity_profile[key]:[]).map(x=>String(x||'').trim()).filter(Boolean);
draft.relations={...(draft.relations||{}),...relations,checked_at:checkedAt,provider:ai.provider,model:ai.model,paid_api:false};
write(`data/drafts/${slug}.json`,draft);
write(`data/franchises/${slug}.json`,{schema_version:2,game_slug:slug,checked_at:checkedAt,status:relations.franchise.name&&relations.franchise.games.length?'green':'no-confirmed-franchise',provider:ai.provider,model:ai.model,paid_api:false,...relations.franchise});
write(`data/parser-runs/relations-${slug}.json`,{parser:'game-relations-research',status:'green',game_slug:slug,checked_at:checkedAt,provider:ai.provider,model:ai.model,paid_api:false,franchise:relations.franchise.name||null,franchise_games:relations.franchise.games.length,comments:[]});
const queue=read('data/content-pipeline/franchise-queue.json',{schema_version:1,updated_at:checkedAt,items:[]});
const existing=new Map((queue.items||[]).map(item=>[item.slug,item]));
for(const game of relations.franchise.games){
  if(!game.slug||game.slug===slug)continue;
  existing.set(game.slug,{...(existing.get(game.slug)||{}),source_game:slug,title:game.title,slug:game.slug,release_year:game.release_year||null,steam_appid:game.steam_appid||null,source_url:game.source_url||'',status:existing.get(game.slug)?.status||'queued',updated_at:checkedAt});
}
queue.updated_at=checkedAt;queue.items=[...existing.values()];write('data/content-pipeline/franchise-queue.json',queue);
console.log(JSON.stringify({slug,status:'green',provider:ai.provider,model:ai.model,paid_api:false,franchise:relations.franchise.name||null,franchise_games:relations.franchise.games.length,queued:queue.items.filter(item=>item.status==='queued').length},null,2));
