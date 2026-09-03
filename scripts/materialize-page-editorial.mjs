#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/materialize-page-editorial.mjs <game-slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const cyrillicRatio=v=>{const s=clean(v);const letters=(s.match(/[A-Za-zА-Яа-яЁё]/g)||[]).length;return letters?(s.match(/[А-Яа-яЁё]/g)||[]).length/letters:0};
const yearOf=v=>Number(String(v||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const draft=read(`data/drafts/${slug}.json`),knowledge=read(`data/game-knowledge/${slug}.json`,{}),sourceContent=read(`data/game-source-content/${slug}.json`,{});
if(!draft?.identity?.title)throw new Error(`Missing draft for ${slug}`);
if(knowledge?.status!=='green'||knowledge?.source_content_hash!==sourceContent?.content_hash)throw new Error(`${slug}: current green source-grounded knowledge is required before materialization`);
const editorial=draft.editorial||{};
if(!String(editorial.editorial_mode||'').startsWith('source_grounded_'))throw new Error(`${slug}: metadata-only/baseline editorial cannot be materialized`);
const short=clean(editorial.short_description),integrated=clean(editorial.integrated_description),campaign=clean(editorial.campaign);
const features=(editorial.features||[]).map(clean).filter(Boolean),genres=(draft.classification?.genres||[]).map(clean).filter(Boolean);
const developer=clean(draft.companies?.developers?.[0]),releaseYear=yearOf(draft.release?.date||draft.release?.date_text);
const errors=[];const require=(ok,msg)=>{if(!ok)errors.push(msg)};
require(short.length>=90,'short_description is too short');require(cyrillicRatio(short)>=0.55,'short_description is not natural Russian');
require(integrated.length>=350,'integrated_description is too short');require(cyrillicRatio(integrated)>=0.55,'integrated_description is not natural Russian');
require(campaign.length>=130,'campaign is too short');require(cyrillicRatio(campaign)>=0.55,'campaign is not natural Russian');
require(features.length>=4,'at least four features are required');require(features.every(x=>x.length>=18),'features are too generic');
require(Boolean(developer),'developer is required');require(Boolean(releaseYear),'release year is required');require(genres.length>0,'genres are required');
if(errors.length){console.error(JSON.stringify({slug,status:'needs_revision',errors},null,2));process.exit(2)}
const corpus=read(`data/game-sources/${slug}.json`,{});
const out={schema_version:2,game_slug:slug,title:clean(draft.identity.title),release_year:releaseYear,developer,genres,short_description:short,integrated_description:integrated,campaign,features,source_corpus:`data/game-sources/${slug}.json`,source_count:Number(corpus?.counts?.total||corpus?.sources?.length||0),knowledge_source:`data/game-knowledge/${slug}.json`,knowledge_hash:knowledge.source_content_hash,knowledge_claims:knowledge.defining_claims?.length||0,generation_mode:editorial.editorial_mode,generated_at:new Date().toISOString(),quality_status:'green'};
write(`data/page-editorial/${slug}.json`,out);
console.log(JSON.stringify({slug,status:'green',mode:out.generation_mode,knowledge_claims:out.knowledge_claims,output:`data/page-editorial/${slug}.json`},null,2));
