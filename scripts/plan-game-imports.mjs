#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {GameRegistryApi, validateForPublication} from './lib/game-registry.mjs';
import {registerVerifiedGameImports} from './lib/verified-game-import.mjs';

const root=process.cwd();
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const requestPath='data/game-import-requests.json';
const payload=read(requestPath,{schema_version:1,imports:[]});
const imports=Array.isArray(payload.imports)?payload.imports:[];
const requests=imports.filter(item=>['queued','planned','needs_revision','retry'].includes(String(item.status||'queued')));
const resultBase={schema_version:2,generated_at:new Date().toISOString(),requested:requests.length,resolved:[],required_games:[],issues:[],page_tasks:[]};
if(!requests.length){write('tmp/game-import-plan.json',resultBase);console.log(JSON.stringify({requested:0,page_tasks:0},null,2));process.exit(0)}

const registryPath='data/game-registry/registry.transition.json';
const registry=read(registryPath);
if(!registry)throw new Error('Canonical Game Registry is missing before verified game import planning.');
const discovery=registerVerifiedGameImports(registry,requests);
write(registryPath,discovery.registry);
const api=new GameRegistryApi(discovery.registry);
const plan=read('data/content-pipeline/execution-plan.json',{schema_version:6,pages:[],reviews:[]});
plan.pages=Array.isArray(plan.pages)?plan.pages:[];
plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
const currentById=new Map(plan.pages.map(item=>[item.game_id,item]));
const tasks=[];
const required=[];
const resolvedByImport=new Map(discovery.resolved.map(item=>[item.import_id,item]));
const issuesByIndex=new Map(discovery.issues.map(issue=>[issue.index,issue]));

function seedNonSteamParser(item,request){
  if(item.steam_appid||!request?.parser_seed)return;
  const seed=structuredClone(request.parser_seed);
  seed.schema_version=Math.max(Number(seed.schema_version||1),2);
  seed.identity={...(seed.identity||{}),slug:item.slug,title:seed.identity?.title||item.title,steam_appid:null};
  seed.release=seed.release||{date_text:String(request.releases?.[0]?.date||'')};
  seed.companies=seed.companies||{developers:[],publishers:[]};
  seed.classification=seed.classification||{genres:[],categories:[],platforms:[]};
  seed.editorial=seed.editorial||{short_description:'',integrated_description:'',features:[]};
  seed.media=seed.media||{cover:'',hero:'',screenshots:[],videos:[],artwork:[]};
  seed.requirements=seed.requirements||{pc:{minimum:{raw:''},recommended:{raw:''}},platforms:seed.classification.platforms||[]};
  seed.links=seed.links||{};
  seed.source=seed.source||{name:'Verified editorial import',url:item.verification_sources?.[0]?.url||'',checked_at:new Date().toISOString()};
  write(`data/parser-output/${item.slug}.json`,seed);
}

for(const[index,request]of requests.entries()){
  const importId=request.import_id||request.slug;
  const item=resolvedByImport.get(importId);
  const sourceRecord=imports.find(candidate=>(candidate.import_id||candidate.slug)===importId);
  const issue=issuesByIndex.get(index);
  if(!item){if(sourceRecord&&issue)sourceRecord.status='needs_revision';continue}
  const entity=api.findById(item.game_id);
  if(!entity)continue;
  const slug=String(entity.identity?.slug?.value||item.slug),title=String(entity.identity?.canonicalTitle?.value||item.title),intent=String(item.publication_intent||request.publication_intent||'full_page');
  required.push({game_id:entity.id,slug,title,import_id:importId,publication_intent:intent});
  if(intent!=='full_page'){if(sourceRecord)sourceRecord.status='registry_only';continue}
  const pagePath=path.join(root,'game',slug,'index.html');
  const draft=read(`data/drafts/${slug}.json`,{});
  if(fs.existsSync(pagePath)&&draft?.publication?.public_ready===true){if(sourceRecord)sourceRecord.status='done';continue}
  seedNonSteamParser(item,request);
  const existing=currentById.get(entity.id),gate=validateForPublication(entity,{allowNoRelease:false});
  tasks.push({...(existing||{}),type:existing?.type||(gate.passed?'build_page':'enrich_game'),game_id:entity.id,slug,title,steam_appid:existing?.steam_appid||item.steam_appid||null,priority:Math.max(2500,Number(existing?.priority||0)),reason:existing?.reason||(gate.passed?'verified editorial import requires canonical game page':`verified editorial import requires enrichment: ${gate.errors.join(', ')}`),verified_import:true,import_id:importId});
  if(sourceRecord)sourceRecord.status='planned';
}

const taskIds=new Set(tasks.map(item=>item.game_id));
plan.pages=[...tasks,...plan.pages.filter(item=>!taskIds.has(item.game_id))].sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)||String(a.slug||'').localeCompare(String(b.slug||'')));
plan.verified_imports={requested:requests.length,resolved:discovery.resolved.length,created_in_registry:discovery.created,matched_in_registry:discovery.matched,identity_issues:discovery.issues,page_tasks:tasks.length};
write('data/content-pipeline/execution-plan.json',plan);
payload.updated_at=new Date().toISOString();
write(requestPath,payload);
write('tmp/game-import-plan.json',{...resultBase,generated_at:new Date().toISOString(),resolved:discovery.resolved,required_games:required,issues:discovery.issues,page_tasks:tasks.map(item=>({game_id:item.game_id,slug:item.slug,type:item.type,priority:item.priority,import_id:item.import_id}))});
console.log(JSON.stringify({requested:requests.length,resolved:discovery.resolved.length,created:discovery.created,matched:discovery.matched,issues:discovery.issues.length,page_tasks:tasks.length,total_page_tasks:plan.pages.length},null,2));
