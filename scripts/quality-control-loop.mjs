#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const mode=process.argv[2];const slug=process.argv[3];const gameId=process.argv[4]||process.env.GAME_REGISTRY_ID||'';
if(!['page','review'].includes(mode)||!slug)throw new Error('Usage: node scripts/quality-control-loop.mjs <page|review> <slug> [game_id]');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const exists=p=>fs.existsSync(path.join(root,p));
const history=[];
const canonical=v=>String(v||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const technicalTitle=v=>!String(v||'').trim()||canonical(v)===canonical(slug)||/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(String(v||'').trim());
function run(label,script,args=[]){
  const started=Date.now();const child=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,GAME_REGISTRY_ID:gameId},maxBuffer:32*1024*1024});
  history.push({label,script,status:child.status===0?'completed':'revision-required',exit_code:child.status,duration_ms:Date.now()-started,stdout:(child.stdout||'').slice(-8000),stderr:(child.stderr||'').slice(-8000)});
  return child;
}
function normalizeCanonicalTitle(){
  const p=`data/drafts/${slug}.json`;const draft=read(p);if(!draft)return null;
  const catalog=read('data/catalog-visible.json',[]);const catalogTitle=String(catalog.find(x=>x.slug===slug)?.title||'').trim();
  let pageTitle='';const page=path.join(root,'game',slug,'index.html');if(fs.existsSync(page)){const html=fs.readFileSync(page,'utf8');pageTitle=(html.match(/\bdata-title=["']([^"']+)["']/i)||[])[1]||''}
  const current=String(draft.identity?.title||'').trim();const desired=technicalTitle(current)?(pageTitle||catalogTitle||current):current;
  if(desired&&desired!==current){draft.identity={...(draft.identity||{}),title:desired};write(p,draft);history.push({label:'canonical-title-repair',status:'completed',from:current,to:desired})}
  return desired||current||catalogTitle||pageTitle||slug;
}
const currentSources=()=>read(`data/game-sources/${slug}.json`,{discovery:{complete:false},counts:{}});
const currentRating=()=>read(`data/ratings/${slug}.json`,{status:'red-needs-revision'});
const currentKnowledge=()=>read(`data/game-knowledge/${slug}.json`,{status:'needs_revision',defining_claims:[]});
const currentContent=()=>read(`data/quality-control/game-page-content-${slug}.json`,{status:'red-needs-revision',errors:['content quality report missing']});
const currentMedia=()=>read(`data/quality-control/game-page-${slug}.json`,{status:'red-needs-revision',comments:['media quality report missing']});
const currentReviews=()=>read(`data/reviews/${slug}.json`,{publication_gate:{status:'red-needs-revision'},reviews:[]});
const currentReviewOutput=()=>read(`data/parser-runs/review-output-${slug}.json`,null);
const canonicalTitle=normalizeCanonicalTitle();
let status='red-needs-revision',comments=[];

if(mode==='page'){
  // 1. Expensive factual work is done at most once per QC run.
  let sources=currentSources();
  if(sources.discovery?.complete!==true){run('source-corpus-once','scripts/collect-game-sources.mjs',[slug]);sources=currentSources()}
  if(sources.discovery?.complete!==true){comments=[`Не завершён полный корпус источников: ${sources.counts?.professional_reviews||0} профессиональных материалов.`]}
  else{
    let rating=currentRating();
    if(rating.status!=='green'||!Number.isFinite(Number(rating.calculation?.score_10))){run('rating-once','scripts/calculate-ratings-from-research.mjs',[slug]);rating=currentRating();run('source-score-sync-once','scripts/collect-game-sources.mjs',[slug])}
    if(rating.status!=='green'||!Number.isFinite(Number(rating.calculation?.score_10)))comments=['Профессиональный рейтинг не прошёл проверку.'];
    else{
      // 2. Read/source synthesis once. Never repeat it just because prose needs editing.
      const knowledgeRun=run('source-knowledge-once','scripts/build-game-source-knowledge.mjs',[slug]);const knowledge=currentKnowledge();
      if(knowledgeRun.status!==0||knowledge.status!=='green'||(knowledge.defining_claims||[]).length<4){comments=[(knowledgeRun.stderr||knowledgeRun.stdout||'Не удалось построить знания из источников.').slice(-5000)]}
      else{
        // 3. Editorial retries are local: only prose is regenerated and revalidated.
        const editorialAttempts=Math.max(1,Math.min(2,Number(process.env.GAME_PAGE_EDITORIAL_ATTEMPTS||2)));
        let contentGreen=false;
        for(let attempt=1;attempt<=editorialAttempts;attempt++){
          let editorial=run(`editorial-${attempt}`,'scripts/build-game-page.mjs',[slug]);
          if(editorial.status!==0&&exists('scripts/build-game-page-baseline-editorial.mjs'))editorial=run(`editorial-fallback-${attempt}`,'scripts/build-game-page-baseline-editorial.mjs',[slug]);
          if(editorial.status!==0){comments=[(editorial.stderr||editorial.stdout||'Редактор не создал допустимый текст.').slice(-5000)];continue}
          normalizeCanonicalTitle();
          const materialized=run(`materialize-editorial-${attempt}`,'scripts/materialize-page-editorial.mjs',[slug]);
          if(materialized.status!==0){comments=[(materialized.stderr||materialized.stdout||'Текст не прошёл materialization.').slice(-5000)];continue}
          run(`content-validation-${attempt}`,'scripts/validate-game-page-content.mjs',[slug]);
          const content=currentContent();
          if(content.status==='green'){contentGreen=true;comments=[];break}
          comments=[...(content.errors||[])];
        }
        // 4. Relations/similarity are rebuilt once after accepted editorial, not per retry.
        if(contentGreen){
          if(exists('scripts/enrich-game-relations.mjs'))run('relations-once','scripts/enrich-game-relations.mjs',[slug]);
          if(exists('scripts/build-similarity-index.mjs'))run('similarity-once','scripts/build-similarity-index.mjs',[slug]);
          // 5. Media is reused when already green. Discovery happens only if media itself is bad/missing.
          let media=currentMedia();let mediaOk=media.status==='green';
          if(!mediaOk){const discovery=run('media-discovery-once','scripts/discover-review-media.mjs',[slug]);run('media-validation-once','scripts/validate-game-media-quality.mjs',[slug]);media=currentMedia();mediaOk=discovery.status===0&&media.status==='green'}
          if(contentGreen&&mediaOk){status='green';comments=[]}else{status='red-needs-revision';comments=[...comments,...(media.comments||[]),...(mediaOk?[]:['Медиакорпус не прошёл проверку.'])]}
        }
      }
    }
  }
}else{
  // Review is a separate subsystem. Keep its existing self-healing loop isolated from Game Page.
  const maxAttempts=Math.max(1,Math.min(4,Number(read('config/game-page-quality-v2.json',{}).quality_loop?.immediate_revision_attempts||4)));
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    run(`review-source-corpus-${attempt}`,'scripts/collect-game-sources.mjs',[slug]);
    if(exists('scripts/enrich-review-native-sources.mjs'))run(`review-native-sources-${attempt}`,'scripts/enrich-review-native-sources.mjs',[slug]);
    run(`review-rating-${attempt}`,'scripts/calculate-ratings-from-research.mjs',[slug]);
    const reviews=currentReviews(),rating=currentRating(),sources=currentSources();
    if(!(sources.discovery?.complete&&reviews.publication_gate?.status==='green'&&rating.status==='green')){comments=[`База источников игры: ${sources.counts?.total||0}.`,`Профессиональных материалов: ${sources.counts?.professional_reviews||reviews.reviews?.length||0}.`,`Оценок: ${rating.sources?.length||0}.`];continue}
    let ok=true;for(const [label,script] of [['media','scripts/discover-review-media.mjs'],['synthesis','scripts/synthesize-review-adaptive.mjs'],['media-enrichment','scripts/enrich-review-media.mjs'],['validation','scripts/validate-review-output.mjs']]){if(!exists(script)||run(`review-${label}-${attempt}`,script,[slug]).status!==0){ok=false;break}}
    const validation=currentReviewOutput();if(ok&&validation?.passed===true){status='green';comments=[];break}
    comments=[...(validation?.errors||[])];
  }
}

const report={schema_version:14,type:mode,game_slug:slug,game_id:gameId||null,canonical_title:canonicalTitle||null,checked_at:new Date().toISOString(),status,green:status==='green',comments,revision_history:history,policy:{page_qc_architecture:'single factual build + local failed-component retries',page_sources_rebuilt_per_editorial_retry:false,page_rating_rebuilt_per_editorial_retry:false,page_knowledge_rebuilt_per_editorial_retry:false,page_media_rebuilt_when_already_green:false,page_editorial_max_attempts:2,page_ready_requires_source_corpus:true,page_ready_requires_source_grounded_knowledge:true,page_ready_requires_content_validation:true,page_ready_requires_media_validation:true,page_ready_requires_review_article:false,review_subsystem_separate:true,page_editorial_ai_provider:'github-models-with-local-qwen-fallback'}};
write(`data/quality-control/${mode}-${slug}-control.json`,report);
write(`data/parser-runs/quality-control-${mode}-${slug}.json`,{parser:'quality-control-loop',game_slug:slug,status:report.green?'green':'needs_revision',checked_at:report.checked_at,comments:report.comments,steps:history.length,total_duration_ms:history.reduce((n,x)=>n+Number(x.duration_ms||0),0)});
console.log(JSON.stringify({mode,slug,status,steps:history.length,comments:comments.slice(0,8)},null,2));
