import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/build-game-page.mjs <slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(2)}
const readJSON=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const writeJSON=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const config=readJSON('config/content-pipeline.json',{});
const gate=config.page_gate||{};
const parser=readJSON(`data/parser-output/${slug}.json`,null);
const existingDraft=readJSON(`data/drafts/${slug}.json`,null);
const seed=existingDraft||parser;
if(!seed?.identity?.title){console.error(`No parser output or draft for ${slug}`);process.exit(2)}
const checkedAt=new Date().toISOString();
const canonical=value=>{try{const url=new URL(value);url.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])url.searchParams.delete(key);return `${url.origin}${url.pathname.replace(/\/$/,'')}${url.search}`}catch{return String(value||'').trim()}};
const uniqueByUrl=items=>items.filter((item,index,list)=>item?.url&&list.findIndex(other=>canonical(other.url)===canonical(item.url))===index);
async function call(body){const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}
const stringArray={type:'array',items:{type:'string'}};
const schema={type:'object',additionalProperties:false,required:['identity','release','companies','classification','editorial','media','requirements','links','sources'],properties:{identity:{type:'object',additionalProperties:false,required:['slug','title','steam_appid','aliases','excluded_versions'],properties:{slug:{type:'string'},title:{type:'string'},steam_appid:{type:['integer','null']},aliases:stringArray,excluded_versions:stringArray}},release:{type:'object',additionalProperties:false,required:['date','date_text','status'],properties:{date:{type:'string'},date_text:{type:'string'},status:{type:'string'}}},companies:{type:'object',additionalProperties:false,required:['developers','publishers'],properties:{developers:stringArray,publishers:stringArray}},classification:{type:'object',additionalProperties:false,required:['genres','platforms','categories'],properties:{genres:stringArray,platforms:stringArray,categories:stringArray}},editorial:{type:'object',additionalProperties:false,required:['short_description','integrated_description','campaign','features'],properties:{short_description:{type:'string'},integrated_description:{type:'string'},campaign:{type:'string'},features:{type:'array',minItems:4,items:{type:'string'}}}},media:{type:'object',additionalProperties:false,required:['hero','cover','screenshots','videos','artwork','official_video_exists'],properties:{hero:{type:'string'},cover:{type:'string'},screenshots:{type:'array',minItems:6,items:{type:'object',additionalProperties:false,required:['url','caption','source_url'],properties:{url:{type:'string'},caption:{type:'string'},source_url:{type:'string'}}}},videos:{type:'array',items:{type:'object',additionalProperties:false,required:['title','url','thumbnail','source_url'],properties:{title:{type:'string'},url:{type:'string'},thumbnail:{type:'string'},source_url:{type:'string'}}}},artwork:{type:'array',items:{type:'object',additionalProperties:false,required:['url','caption','source_url'],properties:{url:{type:'string'},caption:{type:'string'},source_url:{type:'string'}}}},official_video_exists:{type:'boolean'}}},requirements:{type:'object',additionalProperties:false,required:['pc','platforms'],properties:{pc:{type:'object',additionalProperties:false,required:['minimum','recommended'],properties:{minimum:{type:'object',additionalProperties:false,required:['raw'],properties:{raw:{type:'string'}}},recommended:{type:'object',additionalProperties:false,required:['raw'],properties:{raw:{type:'string'}}}}},platforms:stringArray}},links:{type:'object',additionalProperties:false,required:['official','store','developer','publisher'],properties:{official:{type:'string'},store:{type:'string'},developer:{type:'string'},publisher:{type:'string'}}},sources:{type:'array',minItems:10,items:{type:'object',additionalProperties:false,required:['name','url','type','published_at','checked_at','trust','evidence'],properties:{name:{type:'string'},url:{type:'string'},type:{type:'string',enum:['official','store','database','editorial']},published_at:{type:'string'},checked_at:{type:'string'},trust:{type:'number'},evidence:{type:'array',minItems:1,items:{type:'string'}}}}}}};
const prompt=`Собери полностью проверенную карточку игры для публичной страницы Игропоиска. Используй активный веб-поиск. Речь должна идти только о точной игре и точной версии, указанной ниже. Не смешивай ремейк, ремастер, продолжение, DLC или другую игру с похожим названием.\n\nИСХОДНЫЕ ДАННЫЕ ИЗ STEAM/ЧЕРНОВИКА:\n${JSON.stringify(seed,null,2)}\n\nОБЯЗАТЕЛЬНО:\n- Подтверди идентичность минимум официальным источником и крупной базой/магазином либо двумя независимыми базами.\n- Собери не менее ${Number(gate.minimum_sources||10)} реально открываемых прямых источников. Каталоги-разделы и поисковые выдачи не подходят.\n- Для дат, компаний, платформ и системных требований приоритет у официальных страниц и магазинов.\n- title — точное каноническое пользовательское название игры. Никогда не используй slug, техническое имя или имя файла как title.\n- Напиши оригинальное краткое описание и интегрированный текст о том, как устроена игра, без копирования чужих формулировок.\n- campaign объясняет сюжетную кампанию или прямо и содержательно объясняет её отсутствие.\n- Нужны минимум ${Number(gate.minimum_features||4)} конкретные особенности.\n- hero — только качественный официальный key art / promotional artwork игры, НЕ gameplay screenshot. cover — отдельная вертикальная официальная обложка. Скриншоты идут отдельно после арта.\n- Нужны hero, cover и минимум ${Number(gate.minimum_screenshots||6)} полноразмерных реальных кадров именно этой игры. Не используй логотипы, миниатюры, фан-арт, растянутые/размытые/пережатые картинки и кадры другой версии.\n- artwork должен содержать официальный арт с прямым source_url; не подменяй artwork скриншотом.\n- Если существует официальный трейлер или видео, обязательно добавь его и поставь official_video_exists=true.\n- Каждому изображению и видео укажи source_url.\n- steam_appid сохраняй из исходных данных; не угадывай другой ID.\n- checked_at для всех источников: ${checkedAt}.\n- slug должен быть ${slug}.`;
const result=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_game_page',strict:true,schema}}});
result.identity.slug=slug;
result.identity.steam_appid=Number(seed.identity?.steam_appid)||result.identity.steam_appid||null;
result.sources=uniqueByUrl(result.sources||[]);
const steamScreens=(seed.media?.screenshots||[]).map(item=>typeof item==='string'?{url:item,caption:'Официальный скриншот Steam',source_url:seed.links?.store||seed.source?.url||''}:item).filter(item=>item?.url);
result.media.screenshots=uniqueByUrl([...(result.media?.screenshots||[]),...steamScreens]);
result.media.hero=result.media.hero||seed.media?.hero||'';
result.media.cover=result.media.cover||seed.media?.cover||'';
result.media.videos=(result.media.videos||[]).filter(item=>item?.url||item?.thumbnail);
result.media.artwork=result.media.artwork||[];
result.links.store=result.links.store||seed.links?.store||'';
const missing=[];
const required=(value,key)=>{if(!value||(Array.isArray(value)&&!value.length))missing.push(key)};
required(result.identity.title,'identity.title');required(result.release.date_text||result.release.date||result.release.status,'release');required(result.companies.developers,'companies.developers');required(result.companies.publishers,'companies.publishers');required(result.classification.genres,'classification.genres');required(result.classification.platforms,'classification.platforms');required(result.editorial.short_description,'editorial.short_description');required(result.editorial.integrated_description,'editorial.integrated_description');required(result.editorial.campaign,'editorial.campaign');required(result.media.hero,'media.hero');required(result.media.cover,'media.cover');required(result.media.artwork,'media.artwork');
if((result.editorial.features||[]).length<Number(gate.minimum_features||4))missing.push(`features:${result.editorial.features?.length||0}`);
if(result.media.screenshots.length<Number(gate.minimum_screenshots||6))missing.push(`screenshots:${result.media.screenshots.length}`);
if(result.sources.length<Number(gate.minimum_sources||10))missing.push(`sources:${result.sources.length}`);
const identitySources=result.sources.filter(item=>['official','store','database'].includes(item.type));
if(identitySources.length<Number(gate.minimum_identity_sources||2))missing.push(`identity_sources:${identitySources.length}`);
if(result.media.official_video_exists&&!result.media.videos.length)missing.push('official_video');
const passed=missing.length===0;
const publication={status:passed?'published':'needs_revision',gate_passed:passed,updated_at:checkedAt,gate:{minimum_sources:Number(gate.minimum_sources||10),accepted_sources:result.sources.length,minimum_screenshots:Number(gate.minimum_screenshots||6),accepted_screenshots:result.media.screenshots.length,identity_sources:identitySources.length,missing,passed}};
const registryId=String(process.env.GAME_REGISTRY_ID||seed.game_id||'').trim();
const game={schema_version:4,publication,...result,updated_at:checkedAt};if(registryId)game.game_id=registryId;if(existingDraft?.relations)game.relations=existingDraft.relations;
writeJSON(`data/drafts/${slug}.json`,game);
writeJSON(`data/parser-runs/game-page-${slug}.json`,{parser:'game-page-builder',status:passed?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,gate:publication.gate,output:passed?'data/game-content':`data/drafts/${slug}.json`,comments:passed?[]:missing.map(item=>`Нужно доработать: ${item}`)});
if(!passed){console.log(JSON.stringify({slug,status:'needs_revision',missing},null,2));process.exit(0)}
const year=Number(String(result.release.date||result.release.date_text).match(/(?:19|20)\d{2}/)?.[0]||new Date().getUTCFullYear());
const chunk=year<=2015?'2002-2015':year<=2017?'2016-2017':year<=2019?'2018-2019':year===2020?'2020':year<=2022?'2021-2022':'2023-2025';
const chunkPath=`data/game-content/${chunk}.json`;
const chunkData=readJSON(chunkPath,{schema_version:2,games:{}});
chunkData.schema_version=Math.max(Number(chunkData.schema_version||1),4);
chunkData.games=chunkData.games||{};
chunkData.games[slug]=game;
writeJSON(chunkPath,chunkData);
const catalog=readJSON('data/catalog-visible.json',[]);
const entry={title:result.identity.title,year,slug};if(registryId)entry.game_id=registryId;const index=catalog.findIndex(item=>item.slug===slug);
if(index>=0)catalog[index]={...catalog[index],...entry};else catalog.push(entry);
catalog.sort((a,b)=>Number(a.year)-Number(b.year)||String(a.title).localeCompare(String(b.title),'ru'));
writeJSON('data/catalog-visible.json',catalog);
const safeTitle=String(result.identity.title).replace(/[&<>"']/g,'');
const gameIdAttr=registryId?` data-game-id="${registryId}"`:'';
const html=`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css"></head><body data-title="${safeTitle}" data-year="${year}" data-slug="${slug}" data-draft="${slug}"${gameIdAttr}><script src="../_shared/game-shell.js"></script></body></html>`;
const pagePath=path.join(root,'game',slug,'index.html');fs.mkdirSync(path.dirname(pagePath),{recursive:true});fs.writeFileSync(pagePath,html+'\n');
console.log(JSON.stringify({slug,status:'green',year,chunk,sources:result.sources.length,screenshots:result.media.screenshots.length},null,2));
