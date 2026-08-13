#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/enrich-game-relations.mjs <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const draft=read(`data/drafts/${slug}.json`);
if(!draft?.identity?.title)throw new Error(`Missing data/drafts/${slug}.json`);
const title=draft.identity.title;
const currentYear=Number(String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const checkedAt=new Date().toISOString();
const stringArray={type:'array',items:{type:'string'}};
const schema={type:'object',additionalProperties:false,required:['franchise','similarity_profile'],properties:{
  franchise:{type:'object',additionalProperties:false,required:['name','games','evidence'],properties:{name:{type:'string'},games:{type:'array',items:{type:'object',additionalProperties:false,required:['title','slug','release_year','steam_appid','relation','source_url'],properties:{title:{type:'string'},slug:{type:'string'},release_year:{type:['integer','null']},steam_appid:{type:['integer','null']},relation:{type:'string'},source_url:{type:'string'}}}},evidence:stringArray}},
  similarity_profile:{type:'object',additionalProperties:false,required:['genres','subgenres','gameplay_type','combat','perspective','world_structure','party_mode','narrative','progression','setting','tone','multiplayer','mechanics','semantic_tokens'],properties:{genres:stringArray,subgenres:stringArray,gameplay_type:stringArray,combat:stringArray,perspective:stringArray,world_structure:stringArray,party_mode:stringArray,narrative:stringArray,progression:stringArray,setting:stringArray,tone:stringArray,multiplayer:stringArray,mechanics:stringArray,semantic_tokens:stringArray}}
}};
function revision(reason){
  write(`data/parser-runs/relations-${slug}.json`,{parser:'game-relations-research',status:'needs_revision',game_slug:slug,checked_at:checkedAt,comments:[reason]});
  console.log(JSON.stringify({slug,status:'needs_revision',preserved_existing:true,reason},null,2));
  process.exit(0);
}
if(!process.env.OPENAI_API_KEY)revision('OPENAI_API_KEY unavailable; preserve existing franchise data and retry research later.');
const prompt=`Исследуй точную игру ${title} (${currentYear||'год уточняется'}) для Игропоиска. Используй web search. Верни структурированные данные серии и профиль сходства.\n\nПравила:\n- franchise.games: только другие самостоятельные игры той же официальной серии/франшизы. Не включай DLC, дополнения, soundtrack, demo и текущую игру.\n- Для каждой игры серии дай каноническое название, безопасный slug, год, Steam App ID если подтверждён, relation и прямой источник.\n- Если официальной серии нет, franchise.name пустая строка и games пустой массив.\n- similarity_profile описывает игру по сути, не по году выхода: жанр, поджанр, тип геймплея, бой, перспектива, структура мира, партия/соло, нарратив, прогрессия, сеттинг, тон, мультиплеер, ключевые механики и смысловые токены.\n- Не придумывай данные.\n\nИмеющиеся данные:\n${JSON.stringify({identity:draft.identity,classification:draft.classification,editorial:draft.editorial,links:draft.links},null,2)}`;
let relations;
try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_game_relations',strict:true,schema}}})});
  if(!response.ok)revision(`Relation research unavailable: OpenAI API ${response.status}. Existing data was not replaced.`);
  const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
  if(!text)revision('Relation research returned no structured output. Existing data was not replaced.');
  relations=JSON.parse(text);
}catch(error){revision(`Relation research failed: ${error.message||error}. Existing data was not replaced.`)}
relations.franchise.games=(relations.franchise.games||[]).filter(game=>game?.title&&String(game.title).toLowerCase()!==String(title).toLowerCase());
draft.relations={...(draft.relations||{}),...relations,checked_at:checkedAt};
write(`data/drafts/${slug}.json`,draft);
write(`data/franchises/${slug}.json`,{schema_version:1,game_slug:slug,checked_at:checkedAt,...relations.franchise});
write(`data/parser-runs/relations-${slug}.json`,{parser:'game-relations-research',status:'green',game_slug:slug,checked_at:checkedAt,franchise:relations.franchise.name||null,franchise_games:relations.franchise.games?.length||0,comments:[]});
const queue=read('data/content-pipeline/franchise-queue.json',{schema_version:1,updated_at:checkedAt,items:[]});
const existing=new Map((queue.items||[]).map(item=>[item.slug,item]));
for(const game of relations.franchise.games||[]){
  if(!game.slug||game.slug===slug)continue;
  existing.set(game.slug,{...(existing.get(game.slug)||{}),source_game:slug,title:game.title,slug:game.slug,release_year:game.release_year||null,steam_appid:game.steam_appid||null,source_url:game.source_url||'',status:existing.get(game.slug)?.status||'queued',updated_at:checkedAt});
}
queue.updated_at=checkedAt;queue.items=[...existing.values()];write('data/content-pipeline/franchise-queue.json',queue);
console.log(JSON.stringify({slug,status:'green',franchise:relations.franchise.name||null,franchise_games:relations.franchise.games?.length||0,queued:queue.items.filter(item=>item.status==='queued').length},null,2));
