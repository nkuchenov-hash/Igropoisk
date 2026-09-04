#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/build-editorial-benchmark-pack.mjs <slug>');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'benchmarks/editorial-five-games/games.json'),'utf8'));
const target=(manifest.games||[]).find(x=>x.slug===slug);
if(!target)throw new Error(`Unknown benchmark game: ${slug}`);
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const file=path.join(root,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(v,null,2)+'\n')};
const run=(script,args=[],{allowFailure=false}={})=>{
  const child=spawnSync(process.execPath,[script,...args],{cwd:root,env:process.env,encoding:'utf8',stdio:'pipe',maxBuffer:64*1024*1024});
  if(child.stdout)process.stdout.write(child.stdout);
  if(child.stderr)process.stderr.write(child.stderr);
  if(child.status!==0&&!allowFailure)throw new Error(`${script} exited ${child.status}`);
  return {status:child.status,stdout:child.stdout||'',stderr:child.stderr||''};
};
const now=new Date().toISOString();

// Benchmark-only identity seed. Everything editorial after this point must come from
// the normal source discovery / knowledge / audience pipeline, never model memory.
const existing=read(`data/drafts/${slug}.json`,{});
const parserBefore=read(`data/parser-output/${slug}.json`,{});
const seed={
  ...existing,
  schema_version:Math.max(Number(existing.schema_version||0),5),
  game_id:existing.game_id||`benchmark_${slug}`,
  identity:{
    ...(existing.identity||{}),
    slug,
    title:target.identity_title,
    aliases:target.aliases||[],
    excluded_versions:target.excluded_versions||[],
    steam_appid:target.steam_appid||null
  },
  release:{...(existing.release||{}),date:target.release_date,date_text:target.release_date,status:'released'},
  classification:{...(existing.classification||{})},
  companies:{...(existing.companies||{})},
  editorial:{...(existing.editorial||{})},
  media:{...(existing.media||{})},
  links:{
    ...(existing.links||{}),
    ...(target.steam_appid?{store:`https://store.steampowered.com/app/${target.steam_appid}/`}:{})
  },
  sources:Array.isArray(existing.sources)?existing.sources:[],
  benchmark_identity:{display_title:target.display_title,year:target.year,identity_locked:true,excluded_versions:target.excluded_versions||[]},
  updated_at:now
};
write(`data/drafts/${slug}.json`,seed);

// Reuse the production structured parser where the exact original has a Steam app.
if(target.steam_appid){
  run('scripts/parse-game-data.mjs',[slug,String(target.steam_appid),target.display_title],{allowFailure:true});
  const parser=read(`data/parser-output/${slug}.json`,parserBefore||{});
  const draft=read(`data/drafts/${slug}.json`,seed);
  draft.identity={...(draft.identity||{}),slug,title:target.identity_title,aliases:target.aliases||[],excluded_versions:target.excluded_versions||[],steam_appid:target.steam_appid};
  draft.release={...(draft.release||{}),date:target.release_date,date_text:target.release_date,status:'released'};
  draft.classification={
    ...(draft.classification||{}),
    genres:parser?.classification?.genres||draft.classification?.genres||[],
    categories:parser?.classification?.categories||draft.classification?.categories||[],
    platforms:parser?.classification?.platforms||draft.classification?.platforms||[],
    tags:parser?.classification?.tags||parser?.tags||draft.classification?.tags||[]
  };
  draft.companies={
    developers:parser?.companies?.developers||draft.companies?.developers||[],
    publishers:parser?.companies?.publishers||draft.companies?.publishers||[]
  };
  draft.links={...(draft.links||{}),store:`https://store.steampowered.com/app/${target.steam_appid}/`,official:parser?.links?.official||draft.links?.official||''};
  write(`data/drafts/${slug}.json`,draft);
}

// Same collection sequence used by the universal page acceptance path.
const discovery=run('scripts/prepare-review-research.mjs',[slug],{allowFailure:true});
run('scripts/recover-historical-review-scores.mjs',[slug],{allowFailure:true});
run('scripts/calculate-ratings-from-research.mjs',[slug],{allowFailure:true});
run('scripts/collect-game-sources.mjs',[slug],{allowFailure:false});
run('scripts/build-game-source-knowledge.mjs',[slug],{allowFailure:false});
run('scripts/collect-game-audience-evidence.mjs',[slug],{allowFailure:true});
run('scripts/build-game-audience-profile.mjs',[slug],{allowFailure:true});

const draft=read(`data/drafts/${slug}.json`,{});
const reviews=read(`data/reviews/${slug}.json`,{});
const matrix=read(`data/research/${slug}-source-matrix.json`,{});
const sources=read(`data/game-sources/${slug}.json`,{});
const sourceContent=read(`data/game-source-content/${slug}.json`,{});
const knowledge=read(`data/game-knowledge/${slug}.json`,{});
const audienceEvidence=read(`data/research/${slug}-audience-evidence.json`,{});
const audienceProfile=read(`data/audience-profiles/${slug}.json`,read(`data/game-audience-profile/${slug}.json`,read(`data/research/${slug}-audience-profile.json`,{})));
const ratings=read(`data/ratings/${slug}.json`,{});
if(sources?.discovery?.complete!==true)throw new Error(`${slug}: normal source assembly did not reach complete discovery`);
if(knowledge?.status!=='green'||!Array.isArray(knowledge.defining_claims)||knowledge.defining_claims.length<4)throw new Error(`${slug}: game knowledge is not green after normal assembly`);

const readable=(sourceContent.sources||[]).filter(s=>s.readable).map(s=>({
  id:s.id,name:s.name,title:s.title,url:s.url,resolved_url:s.resolved_url,kind:s.kind,professional:Boolean(s.professional),roles:s.roles||[],
  evidence:s.evidence||[],
  text:String(s.text||'').slice(0,6500)
}));
const accepted=(matrix.accepted||reviews.reviews||[]).map(s=>({
  id:s.id,publication:s.publication,title:s.title,url:s.resolved_url||s.url,source_kind:s.source_kind,score:s.score,scale:s.scale,grade:s.grade,
  matched_identity_alias:s.matched_identity_alias,identity_evidence:s.identity_evidence,validation:s.validation
}));
const frozen={
  schema_version:2,
  benchmark:'igropoisk-five-games-production-realistic-editorial',
  frozen_at:new Date().toISOString(),
  assembly_mode:'normal_game_page_source_pipeline_before_editorial_model',
  game:{slug,display_title:target.display_title,identity_title:target.identity_title,year:target.year,excluded_versions:target.excluded_versions||[]},
  page_contract:{short_description:{sentences:2,min_chars:100,max_chars:240,language:'ru'},model_memory_forbidden:true},
  review_contract:{language:'ru',target_words:'2000-2600',sections:'8-10',source_grounded_only:true,no_numeric_igropoisk_score:true},
  assembly:{
    discovery_exit_code:discovery.status,
    source_scan_complete:sources?.discovery?.complete===true,
    total_sources:Number(sources?.counts?.total||0),
    professional_reviews:Number(sources?.counts?.professional_reviews||accepted.length||0),
    independent_publications:Number(sources?.counts?.independent_publications||0),
    scored_sources:Number(sources?.counts?.scored||0),
    readable_sources:Number(sourceContent?.readable_sources||readable.length||0),
    defining_claims:Number(knowledge?.defining_claims?.length||0),
    audience_confidence:audienceProfile?.confidence||'low',
    rating_10:ratings?.calculation?.score_10??null
  },
  identity:{identity:draft.identity,release:draft.release,companies:draft.companies,classification:draft.classification,links:draft.links},
  game_knowledge:{essence:knowledge.essence||'',defining_claims:knowledge.defining_claims||[],mechanic_claims:knowledge.mechanic_claims||[],source_count:knowledge.source_count||0},
  audience_profile:audienceProfile||{},
  audience_evidence:{descriptors:audienceEvidence?.descriptors||{},review_signals:audienceEvidence?.review_signals||[],explicit_age_rating:audienceEvidence?.explicit_age_rating||null,content_descriptors:audienceEvidence?.content_descriptors||[]},
  professional_review_corpus:accepted,
  readable_source_material:readable,
  ratings:{status:ratings?.status||null,calculation:ratings?.calculation||null,sources:ratings?.sources||[]}
};
const outDir=`benchmark-packs/${slug}`;
write(`${outDir}/pack.json`,frozen);
write(`${outDir}/assembly-summary.json`,{game:frozen.game,assembly:frozen.assembly,knowledge_status:knowledge.status,audience_profile_path:audienceProfile?.game_slug? 'resolved':'missing_or_fail_open'});
console.log(JSON.stringify({slug,display_title:target.display_title,assembly:frozen.assembly,pack:`${outDir}/pack.json`},null,2));
