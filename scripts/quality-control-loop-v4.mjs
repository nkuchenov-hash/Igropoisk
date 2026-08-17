#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),mode=process.argv[2],slug=process.argv[3],gameId=process.argv[4]||process.env.GAME_REGISTRY_ID||'',deterministicOnly=process.env.REVIEW_DETERMINISTIC_ONLY==='1';
if(!['page','review'].includes(mode)||!slug) throw new Error('Usage: quality-control-loop <page|review> <slug> [game_id]');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const quality=read('config/game-page-quality-v2.json',{}),attempts=Number(quality.quality_loop?.immediate_revision_attempts||4),history=[];
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const technical=value=>!String(value||'').trim()||canonical(value)===canonical(slug)||/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(String(value||'').trim());
function title(){const relative=`data/drafts/${slug}.json`,draft=read(relative);if(!draft)return null;const catalog=read('data/catalog-visible.json',[]),catalogTitle=String(catalog.find(x=>x.slug===slug)?.title||'').trim(),pagePath=path.join(root,'game',slug,'index.html');let pageTitle='';if(fs.existsSync(pagePath))pageTitle=(fs.readFileSync(pagePath,'utf8').match(/\bdata-title=["']([^"']+)["']/i)||[])[1]||'';const current=String(draft.identity?.title||'').trim(),next=technical(current)?(pageTitle||catalogTitle||current):current;if(next&&next!==current){draft.identity={...(draft.identity||{}),title:next};write(relative,draft)}return next||current||catalogTitle||pageTitle||slug}
function run(label,script,args=[],envOverrides={}){const result=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,...envOverrides,GAME_REGISTRY_ID:gameId},maxBuffer:32*1024*1024});history.push({label,script,status:result.status===0?'completed':'revision-required',exit_code:result.status,stdout:(result.stdout||'').slice(-10000),stderr:(result.stderr||'').slice(-10000)});if(result.stdout)console.log(result.stdout);if(result.stderr)console.error(result.stderr);return result}
const reviews=()=>read(`data/reviews/${slug}.json`,{publication_gate:{status:'red-needs-revision'},review_score:{status:'red-needs-revision'},reviews:[]});
const reviewOutput=()=>read(`data/parser-runs/review-output-${slug}.json`);
const page=()=>read(`data/quality-control/game-page-${slug}.json`,{status:'red-needs-revision'});
const sourceMatrix=()=>read(`data/research/${slug}-source-matrix.json`);
const fullRegistryMatrix=()=>sourceMatrix()?.policy?.audit_all===true;
const identityProblems=gameTitle=>{const article=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`));if(!article)return['Обзор ещё не создан.'];const problems=[];if(technical(article.title))problems.push('Технический заголовок обзора.');if(gameTitle&&!canonical(article.title).includes(canonical(gameTitle)))problems.push(`Нужно точное название игры: ${gameTitle}.`);const score=Number(reviews().review_score?.calculation?.score_10);if(!Number.isFinite(score))problems.push('Нет канонической review_score.');else if(Number(article.score)!==score)problems.push('Оценка статьи не совпадает с review.review_score.');return problems};
function tryModelChain(label,{openAiScript='',githubScript='',localScript='',localModel=''}){
  let result=null;
  if(process.env.OPENAI_API_KEY&&openAiScript&&fs.existsSync(path.join(root,openAiScript)))result=run(`${label}-openai`,openAiScript,[slug]);
  if((!result||result.status!==0)&&process.env.GITHUB_TOKEN&&githubScript&&fs.existsSync(path.join(root,githubScript)))result=run(`${label}-github-models`,githubScript,[slug]);
  if((!result||result.status!==0)&&localScript&&fs.existsSync(path.join(root,localScript)))result=run(`${label}-local`,localScript,[slug],localModel?{LOCAL_EDITORIAL_MODEL:localModel}:{});
  return result;
}
function publishArticle(){const relative=`data/articles/${slug}.json`,article=read(relative);if(!article)return false;article.publication_status='published';article.quality_status='green';article.updated_at=new Date().toISOString();write(relative,article);write(`data/article-drafts/${slug}.json`,article);return run('render-review','scripts/render-review-pages.mjs',[slug]).status===0}

let status='red-needs-revision',comments=[];
const canonicalTitle=title();
for(let attempt=1;attempt<=attempts;attempt++){
  if(mode==='page'){
    if(fs.existsSync(path.join(root,'scripts/enrich-game-relations.mjs')))run(`relations-${attempt}`,'scripts/enrich-game-relations.mjs',[slug]);
    run(`similarity-${attempt}`,'scripts/build-similarity-index.mjs',[slug]);run(`media-${attempt}`,'scripts/validate-game-media-quality.mjs',[slug]);
    const current=page();status=current.status;comments=current.comments||[];if(status==='green')break;if(process.env.OPENAI_API_KEY)run(`page-revision-${attempt}`,'scripts/build-game-page.mjs',[slug]);continue;
  }

  if(attempt===1&&fs.existsSync(path.join(root,'scripts/discover-review-sources-web.mjs'))){
    run('web-discovery-full-registry','scripts/discover-review-sources-web.mjs',[slug,'--all']);
    if(fullRegistryMatrix()&&fs.existsSync(path.join(root,'scripts/promote-review-source-audit.mjs')))run('promote-full-registry-audit','scripts/promote-review-source-audit.mjs',[slug]);
    if(fs.existsSync(path.join(root,'scripts/enrich-review-explicit-scores.mjs')))run('explicit-score-enrichment','scripts/enrich-review-explicit-scores.mjs',[slug]);
  }

  if(!fullRegistryMatrix()) run(`research-${attempt}`,'scripts/prepare-review-research.mjs',[slug]);
  run(`score-${attempt}`,'scripts/calculate-ratings-from-research.mjs',[slug]);
  const canonicalReview=reviews(),corpusGreen=canonicalReview.publication_gate?.status==='green',scoreGreen=canonicalReview.review_score?.status==='green',canonicalScore=Number(canonicalReview.review_score?.calculation?.score_10);
  if(!corpusGreen||!scoreGreen){comments=[`Корпус: ${canonicalReview.reviews?.length||0}/${canonicalReview.publication_gate?.minimum||5}`,`Оценённые издания: ${canonicalReview.review_score?.sources?.length||0}/${canonicalReview.review_score?.method?.minimum_sources||3}`];break}

  const existing=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`));
  let preserveExistingProse=false;
  if(existing?.sections?.length&&fs.existsSync(path.join(root,'scripts/rebind-existing-review.mjs'))){
    const rebound=run(`rebind-${attempt}`,'scripts/rebind-existing-review.mjs',[slug],{LOCAL_EDITORIAL_MODEL:process.env.LOCAL_TEXT_MODEL||'qwen3:1.7b'});
    if(rebound.status===0&&run(`render-rebound-${attempt}`,'scripts/render-review-pages.mjs',[slug]).status===0){status='green';comments=[];break}
    const reboundArticle=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`));
    preserveExistingProse=Boolean(reboundArticle?.sections?.length&&reboundArticle?.generation?.score_rebound_at&&Number(reboundArticle?.score)===canonicalScore);
  }

  if(deterministicOnly){
    comments=[existing?.sections?.length?'Existing article could not be deterministically rebound; queued for prose/media repair.':'No reusable existing article; queued for prose/media repair.'];
    break;
  }

  let ok=true;
  const mediaDiscovery=run(`media-discovery-${attempt}`,'scripts/discover-review-media.mjs',[slug]);
  if(mediaDiscovery.status!==0){ok=false;comments=[(mediaDiscovery.stderr||mediaDiscovery.stdout||'media discovery needs revision').slice(-5000)]}

  if(ok&&!preserveExistingProse){
    const synthesis=tryModelChain(`synthesis-${attempt}`,{
      openAiScript:'scripts/synthesize-review-adaptive-v2.mjs',
      githubScript:'scripts/synthesize-review-github-models.mjs',
      localScript:'scripts/synthesize-review-local.mjs',
      localModel:process.env.LOCAL_TEXT_MODEL||'qwen3:1.7b'
    });
    if(!synthesis||synthesis.status!==0){ok=false;comments=[(synthesis?.stderr||synthesis?.stdout||'No available review synthesis engine').slice(-5000)]}
  }

  if(ok){
    const media=tryModelChain(`media-enrichment-${attempt}`,{
      openAiScript:'scripts/enrich-review-media.mjs',
      githubScript:'scripts/enrich-review-media-github-models.mjs',
      localScript:'scripts/enrich-review-media-local.mjs',
      localModel:process.env.LOCAL_VISION_MODEL||'qwen3-vl:4b'
    });
    if(!media||media.status!==0){ok=false;comments=[(media?.stderr||media?.stdout||'No available visual audit engine').slice(-5000)]}
  }

  if(ok){
    const language=tryModelChain(`language-audit-${attempt}`,{
      openAiScript:'scripts/audit-review-language.mjs',
      localScript:'scripts/audit-review-language-local.mjs',
      localModel:process.env.LOCAL_TEXT_MODEL||'qwen3:1.7b'
    });
    if(!language||language.status!==0){ok=false;comments=[(language?.stderr||language?.stdout||'Editorial language audit failed').slice(-5000)]}
  }

  if(ok){const validation=run(`validation-${attempt}`,'scripts/validate-review-output.mjs',[slug]);if(validation.status!==0){ok=false;comments=[(validation.stderr||validation.stdout||'review validation needs revision').slice(-5000)]}}
  const output=reviewOutput(),identity=identityProblems(canonicalTitle);if(ok&&output?.passed===true&&!identity.length&&publishArticle()){status='green';comments=[];break}comments=[...(output?.errors||[]),...identity,...comments];
}

const report={schema_version:9,type:mode,game_slug:slug,game_id:gameId||null,canonical_title:canonicalTitle,checked_at:new Date().toISOString(),status,green:status==='green',comments,revision_history:history,policy:{keep_queued_until_green:true,deterministic_only:deterministicOnly,review_score_source:'data/reviews/{slug}.json#review_score',research_primary:'complete-registered-source-direct-publisher-scan',research_fallback:'registered-publisher-research-only-if-full-scan-missing',score_enrichment:'direct-publisher-structured-markup-preserve-verified',score_aggregation:'all-eligible-explicit-publisher-scores',article_reuse:'surgical-rebind-before-regeneration',targeted_hard_repair:'preserve_rebound_prose_and_repair_only_failing_media_or_language',synthesis_fallback:'github-models-then-local-text',visual_audit_fallback:'github-models-then-local-multimodal',language_audit_fallback:'local-lightweight-text',web_discovery_attempts_per_qc:1}};
write(`data/quality-control/${mode}-${slug}-control.json`,report);write(`data/parser-runs/quality-control-${mode}-${slug}.json`,{parser:'quality-control-loop-v4',game_slug:slug,status:report.green?'green':'needs_revision',checked_at:report.checked_at,comments,deterministic_only:deterministicOnly});
console.log(JSON.stringify({mode,slug,status,deterministic_only:deterministicOnly,comments:comments.slice(0,8)},null,2));
