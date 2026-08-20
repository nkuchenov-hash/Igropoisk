import fs from'node:fs';
import path from'node:path';
import{spawnSync}from'node:child_process';
const root=process.cwd(),dry=process.argv.includes('--dry-run'),requested=new Set(process.argv.slice(2).filter(x=>x!=='--dry-run').map(x=>String(x||'').trim().toLowerCase()).filter(Boolean));
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{if(dry)return;const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const catalog=read('data/catalog-visible.json',[]),out={schema_version:7,checked_at:new Date().toISOString(),scope:requested.size?'requested':'catalog',updated:[],cleared:[],bootstrap:[],valid:[],needs_revision:[]};
function bootstrapDesired(slug,feed){
  const bootstrap=read(`data/review-bootstrap/${slug}.json`),score=Number(feed?.review_score?.calculation?.score_10),articlePath=path.join(root,'article',slug,'index.html');
  if(!bootstrap||String(bootstrap.publication_status||'').toLowerCase()!=='published'||String(bootstrap.review_stage||'').toLowerCase()!=='bootstrap'||!fs.existsSync(articlePath))return null;
  if(feed?.review_score?.status!=='green'||!Number.isFinite(score)||Number(bootstrap.score)!==score)return null;
  if(!Array.isArray(bootstrap.sources)||bootstrap.sources.length<3)return null;
  if(bootstrap?.generation?.grounding_audit?.passed!==true||bootstrap?.generation?.editorial_quality?.passed!==true)return null;
  const words=countWords([bootstrap.lead,...(bootstrap.sections||[]).flatMap(section=>section.paragraphs||[]),bootstrap.verdict?.summary].join(' '));
  if(words<220)return null;
  return{url:`../../article/${slug}/`,title:String(bootstrap.title||`Обзор ${slug}`),description:String(bootstrap.dek||bootstrap.lead||`Обзор ${slug} от Игропоиска.`),score,score_source:`data/reviews/${slug}.json#review_score`,calculation_status:'green',commercial_review_status:'grounded-bootstrap-green',review_stage:'bootstrap',source_count:bootstrap.sources.length,word_count:words};
}
function reject(slug,feed,reason){
  const relative=`data/reviews/${slug}.json`,quick=bootstrapDesired(slug,feed);
  if(quick){
    const same=feed?.igropoisk_article?.review_stage==='bootstrap'&&feed.igropoisk_article.url===quick.url&&Number(feed.igropoisk_article.score)===quick.score&&Number(feed.igropoisk_article.source_count)===quick.source_count;
    if(!same){feed.schema_version=Math.max(Number(feed.schema_version||1),7);feed.game_slug=slug;feed.igropoisk_article=quick;feed.updated_at=new Date().toISOString();write(relative,feed)}
    out.bootstrap.push({slug,reason,source_count:quick.source_count,word_count:quick.word_count});out.needs_revision.push({slug,reason,bootstrap_published:true});return;
  }
  if(feed?.igropoisk_article){feed.igropoisk_article=null;feed.updated_at=new Date().toISOString();write(relative,feed);out.cleared.push({slug,reason})}
  out.needs_revision.push({slug,reason,bootstrap_published:false});
}
for(const game of catalog){
  const slug=String(game.slug||'').toLowerCase();if(!slug||requested.size&&!requested.has(slug))continue;
  const relative=`data/reviews/${slug}.json`,feed=read(relative,{schema_version:7,game_slug:slug,reviews:[]}),article=read(`data/articles/${slug}.json`),commercial=read(`data/parser-runs/review-commercial-v2-${slug}.json`);let reason='';
  if(!article||!fs.existsSync(path.join(root,'article',slug,'index.html')))reason='article_pair_missing';else if(String(article.game_slug||article.slug||'')!==slug)reason='article_slug_mismatch';else if(String(article.publication_status||'').toLowerCase()!=='published')reason='article_not_published';else if(commercial?.passed!==true)reason='commercial_review_v2_not_green';else if(String(feed.game_slug||slug)!==slug)reason='review_feed_slug_mismatch';else if(feed.review_score?.status!=='green')reason='review_score_not_green';
  const score=Number(feed.review_score?.calculation?.score_10);if(!reason&&(!Number.isFinite(score)||Number(article.score)!==score))reason='article_review_score_mismatch';if(reason){reject(slug,feed,reason);continue}
  const title=String(game.title||article.identity?.title||slug),desired={url:`../../article/${slug}/`,title:`Обзор ${title}`,description:String(article.dek||article.lead||`Полный обзор ${title} от Игропоиска.`),score,score_source:`data/reviews/${slug}.json#review_score`,calculation_status:'green',commercial_review_status:'green',review_stage:'full',source_count:Number(article.source_coverage?.materially_used||article.sources?.length||0),word_count:Number(article.generation?.words||commercial?.metrics?.article_words||0)};
  const same=feed.igropoisk_article&&feed.igropoisk_article.url===desired.url&&Number(feed.igropoisk_article.score)===score&&feed.igropoisk_article.score_source===desired.score_source&&feed.igropoisk_article.review_stage==='full'&&feed.igropoisk_article.commercial_review_status==='green';if(same){out.valid.push(slug);continue}
  feed.schema_version=Math.max(Number(feed.schema_version||1),7);feed.game_slug=slug;feed.game_id=String(game.game_id||feed.game_id||'')||undefined;feed.updated_at=new Date().toISOString();feed.igropoisk_article=desired;write(relative,feed);out.updated.push(slug);
}
fs.mkdirSync(path.join(root,'data/audits'),{recursive:true});fs.writeFileSync(path.join(root,'data/audits/review-feed-materialization.json'),JSON.stringify(out,null,2)+'\n');
let top250=null;if(!dry&&fs.existsSync(path.join(root,'scripts/build-top-250.mjs'))){const built=spawnSync('node',['scripts/build-top-250.mjs'],{cwd:root,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:24*1024*1024});if(built.status!==0)throw new Error(`Could not rebuild canonical Top-250: ${built.stderr||built.stdout}`);top250=read('data/top-250/current.json',{count:0})}
if(!dry&&process.env.GITHUB_ACTIONS){const paths=[];if(fs.existsSync(path.join(root,'data/game-dna')))paths.push('data/game-dna');if(fs.existsSync(path.join(root,'data/top-250')))paths.push('data/top-250');if(paths.length){const staged=spawnSync('git',['add','-A','--',...paths],{cwd:root,encoding:'utf8'});if(staged.status!==0)throw new Error(`Could not stage derived review data: ${staged.stderr||staged.stdout}`)}}
console.log(JSON.stringify({dry_run:dry,scope:out.scope,updated:out.updated.length,bootstrap:out.bootstrap.length,cleared:out.cleared.length,valid:out.valid.length,needs_revision:out.needs_revision.length,bootstrap_publication:true,top_250_count:top250?.count??null},null,2));
