#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const exists=relative=>fs.existsSync(path.join(root,relative));
const catalog=read('data/catalog-visible.json',[]).filter(item=>item?.slug);
const controlSlugs=new Set(['baldurs-gate-3']);
const relationBatch=Math.max(1,Number(process.env.CATALOG_RELATION_BATCH||8));
const reviewBatch=Math.max(1,Number(process.env.CATALOG_REVIEW_BATCH||6));
const guideBatch=Math.max(1,Number(process.env.CATALOG_GUIDE_BATCH||8));
const aiAvailable=Boolean(process.env.OPENAI_API_KEY);
const now=new Date().toISOString();const results=[];
function run(label,args){const child=spawnSync('node',args,{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:32*1024*1024});results.push({label,status:child.status===0?'completed':'needs_revision',exit_code:child.status,stdout:(child.stdout||'').slice(-5000),stderr:(child.stderr||'').slice(-5000)});if(child.stdout)console.log(child.stdout);if(child.stderr)console.error(child.stderr);return child.status===0}
function priority(game,type){let value=0;if(controlSlugs.has(game.slug))value+=10000;const review=read(`data/reviews/${game.slug}.json`);if(review?.publication_gate?.status==='red-needs-revision')value+=1000;if(type==='review'&&!review)value+=500;return value}
function sortTasks(items,type){return [...items].sort((a,b)=>priority(b,type)-priority(a,type)||String(a.slug).localeCompare(String(b.slug)))}

run('canonical-materialization',['scripts/materialize-catalog-game-data.mjs']);
run('similarity-all-before-ai',['scripts/build-similarity-index.mjs']);

const queue={schema_version:2,updated_at:now,quality_policy:'missing/red -> research/rebuild/recheck; never terminal',games:{}};
const relationTasks=[],reviewTasks=[],guideTasks=[];
for(const game of catalog){
  const slug=game.slug;const draft=read(`data/drafts/${slug}.json`);const review=read(`data/reviews/${slug}.json`);const rating=read(`data/ratings/${slug}.json`);const guides=read(`data/guides/${slug}.json`);const similarity=read(`data/similarity/${slug}.json`);
  const relationGreen=Boolean(draft?.relations?.checked_at);const reviewGreen=review?.publication_gate?.status==='green'&&Number(review?.publication_gate?.accepted||review?.reviews?.length||0)>=10;const ratingGreen=rating?.status==='green'&&Number.isFinite(Number(rating?.calculation?.score_10));const guidesGreen=guides?.status==='green'&&Number(guides?.accepted||guides?.guides?.length||0)>=4;const similarityGreen=Array.isArray(similarity?.recommendations)&&similarity.recommendations.length>0;
  queue.games[slug]={game_id:game.game_id||'',title:game.title||slug,relations:relationGreen?'green':'needs_revision',reviews:reviewGreen&&ratingGreen?'green':'needs_revision',guides:guidesGreen?'green':'needs_revision',similarity:similarityGreen?'green':'needs_revision'};
  if(!relationGreen)relationTasks.push(game);if(!(reviewGreen&&ratingGreen))reviewTasks.push(game);if(!guidesGreen)guideTasks.push(game);
}

if(aiAvailable){
  for(const game of sortTasks(relationTasks,'relations').slice(0,relationBatch)){
    if(!exists(`data/drafts/${game.slug}.json`)){queue.games[game.slug].relations='needs_revision';continue}
    const ok=run(`relations:${game.slug}`,['scripts/enrich-game-relations.mjs',game.slug]);queue.games[game.slug].relations=ok&&read(`data/drafts/${game.slug}.json`)?.relations?.checked_at?'green':'needs_revision';
  }
  run('similarity-all-after-relations',['scripts/build-similarity-index.mjs']);
  for(const game of sortTasks(reviewTasks,'review').slice(0,reviewBatch)){
    if(!exists(`data/drafts/${game.slug}.json`)){queue.games[game.slug].reviews='needs_revision';continue}
    const ok=run(`review:${game.slug}`,['scripts/quality-control-loop.mjs','review',game.slug,String(game.game_id||'')]);const review=read(`data/reviews/${game.slug}.json`),rating=read(`data/ratings/${game.slug}.json`);queue.games[game.slug].reviews=ok&&review?.publication_gate?.status==='green'&&rating?.status==='green'?'green':'needs_revision';
  }
  for(const game of sortTasks(guideTasks,'guides').slice(0,guideBatch)){
    if(!exists(`data/drafts/${game.slug}.json`)){queue.games[game.slug].guides='needs_revision';continue}
    run(`guides:${game.slug}`,['scripts/prepare-guide-research.mjs',game.slug]);const guides=read(`data/guides/${game.slug}.json`);queue.games[game.slug].guides=guides?.status==='green'?'green':'needs_revision';
  }
}else results.push({label:'ai-enrichment',status:'needs_revision',reason:'OPENAI_API_KEY unavailable; deterministic canonicalization and similarity still completed'});

for(const game of catalog){const similarity=read(`data/similarity/${game.slug}.json`);queue.games[game.slug].similarity=Array.isArray(similarity?.recommendations)&&similarity.recommendations.length>0?'green':'needs_revision'}
queue.summary={catalog_games:catalog.length,relations_green:Object.values(queue.games).filter(item=>item.relations==='green').length,reviews_green:Object.values(queue.games).filter(item=>item.reviews==='green').length,guides_green:Object.values(queue.games).filter(item=>item.guides==='green').length,similarity_green:Object.values(queue.games).filter(item=>item.similarity==='green').length,relations_pending:Object.values(queue.games).filter(item=>item.relations!=='green').length,reviews_pending:Object.values(queue.games).filter(item=>item.reviews!=='green').length,guides_pending:Object.values(queue.games).filter(item=>item.guides!=='green').length,similarity_pending:Object.values(queue.games).filter(item=>item.similarity!=='green').length,ai_available:aiAvailable};
write('data/content-pipeline/catalog-enrichment-queue.json',queue);write('data/content-pipeline/catalog-enrichment-log.json',{schema_version:1,started_at:now,finished_at:new Date().toISOString(),results});
console.log(JSON.stringify(queue.summary,null,2));
