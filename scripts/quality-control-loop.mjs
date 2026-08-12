#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();const mode=process.argv[2];const slug=process.argv[3];const gameId=process.argv[4]||process.env.GAME_REGISTRY_ID||'';
if(!['page','review'].includes(mode)||!slug)throw new Error('Usage: node scripts/quality-control-loop.mjs <page|review> <slug> [game_id]');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const quality=read('config/game-page-quality-v2.json',{});const attempts=Number(quality.quality_loop?.immediate_revision_attempts||4);const history=[];
const canonical=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const technicalTitle=value=>!String(value||'').trim()||canonical(value)===canonical(slug)||/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(String(value||'').trim());
function normalizeCanonicalTitle(){
  const relative=`data/drafts/${slug}.json`;const draft=read(relative);if(!draft)return null;
  const catalog=read('data/catalog-visible.json',[]);const catalogTitle=String(catalog.find(item=>item.slug===slug)?.title||'').trim();
  const pagePath=path.join(root,'game',slug,'index.html');let pageTitle='';if(fs.existsSync(pagePath)){const html=fs.readFileSync(pagePath,'utf8');pageTitle=(html.match(/\bdata-title=["']([^"']+)["']/i)||[])[1]||''}
  const current=String(draft.identity?.title||'').trim();const desired=technicalTitle(current)?(pageTitle||catalogTitle||current):current;
  if(desired&&desired!==current){draft.identity={...(draft.identity||{}),title:desired};write(relative,draft);history.push({label:'canonical-title-repair',status:'completed',from:current,to:desired})}
  return desired||current||catalogTitle||pageTitle||slug;
}
function run(label,script,args=[]){const child=spawnSync('node',[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,GAME_REGISTRY_ID:gameId},maxBuffer:24*1024*1024});history.push({attempt:history.length+1,label,script,status:child.status===0?'completed':'revision-required',exit_code:child.status,stdout:(child.stdout||'').slice(-8000),stderr:(child.stderr||'').slice(-8000)});return child}
const currentPage=()=>read(`data/quality-control/game-page-${slug}.json`,{status:'red-needs-revision',comments:['quality report missing']});
const currentRating=()=>read(`data/ratings/${slug}.json`,{status:'red-needs-revision'});
const currentReviews=()=>read(`data/reviews/${slug}.json`,{publication_gate:{status:'red-needs-revision'},reviews:[]});
const currentReviewOutput=()=>read(`data/parser-runs/review-output-${slug}.json`,null);
const reviewIdentityProblems=title=>{
  const article=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`,null));if(!article)return['Обзор ещё не создан.'];const problems=[];
  if(technicalTitle(article.title))problems.push('Заголовок обзора содержит техническое/slug-подобное имя.');
  if(title&&!canonical(article.title).includes(canonical(title)))problems.push(`Заголовок обзора должен использовать точное название игры: ${title}.`);
  if(Number.isFinite(Number(article.score))){const rating=currentRating();if(rating.status!=='green'||Number(article.score)!==Number(rating.calculation?.score_10))problems.push('Оценка обзора не совпадает с общей рассчитанной оценкой Игропоиска.')}
  return problems;
};
let status='red-needs-revision',comments=[];const canonicalTitle=normalizeCanonicalTitle();
for(let attempt=1;attempt<=attempts;attempt++){
  if(mode==='page'){
    if(fs.existsSync(path.join(root,'scripts/enrich-game-relations.mjs')))run(`relations-${attempt}`,'scripts/enrich-game-relations.mjs',[slug]);
    run(`similarity-${attempt}`,'scripts/build-similarity-index.mjs',[slug]);
    run(`media-validation-${attempt}`,'scripts/validate-game-media-quality.mjs',[slug]);
    const report=currentPage();status=report.status;comments=report.comments||[];if(status==='green')break;
    if(process.env.OPENAI_API_KEY){const child=run(`page-revision-${attempt}`,'scripts/build-game-page.mjs',[slug]);if(child.status!==0)comments=[...comments,(child.stderr||'').slice(-3000)];normalizeCanonicalTitle()}
  }else{
    run(`review-research-${attempt}`,'scripts/prepare-review-research.mjs',[slug]);
    run(`rating-${attempt}`,'scripts/calculate-ratings-from-research.mjs',[slug]);
    const reviews=currentReviews(),rating=currentRating();const corpusGreen=reviews.publication_gate?.status==='green';const ratingGreen=rating.status==='green';
    if(!corpusGreen||!ratingGreen){status='red-needs-revision';comments=[`Корпус рецензий: ${reviews.reviews?.length||0}/${reviews.publication_gate?.minimum||10}.`,`Рейтинг: ${rating.sources?.length||0}/${rating.method?.minimum_sources||10}.`];continue}
    const steps=[['media-discovery','scripts/discover-review-media.mjs'],['synthesis','scripts/synthesize-review-adaptive.mjs'],['media-enrichment','scripts/enrich-review-media.mjs'],['validation','scripts/validate-review-output.mjs']];
    let technicalOk=true;for(const [label,script] of steps){if(!fs.existsSync(path.join(root,script))){technicalOk=false;comments=[`Отсутствует ${script}`];break}const last=run(`${label}-${attempt}`,script,[slug]);if(last.status!==0){technicalOk=false;comments=[(last.stderr||last.stdout||`${label} needs revision`).slice(-5000)];break}}
    const validation=currentReviewOutput();const identityProblems=reviewIdentityProblems(canonicalTitle);if(technicalOk&&validation?.passed===true&&!identityProblems.length){status='green';comments=[];break}
    status='red-needs-revision';comments=[...(validation?.errors||[]),...identityProblems];
  }
}
const report={schema_version:2,type:mode,game_slug:slug,game_id:gameId||null,canonical_title:canonicalTitle||null,checked_at:new Date().toISOString(),status,green:status==='green',comments,revision_history:history,policy:{quality_never_terminally_blocks:true,red_means_revise_again:true,immediate_revision_attempts:attempts,keep_queued_until_green:true}};
write(`data/quality-control/${mode}-${slug}-control.json`,report);write(`data/parser-runs/quality-control-${mode}-${slug}.json`,{parser:'quality-control-loop',game_slug:slug,status:report.green?'green':'needs_revision',checked_at:report.checked_at,comments:report.comments,attempts:history.length});
console.log(JSON.stringify({mode,slug,status,attempts:history.length,comments:comments.slice(0,8)},null,2));process.exit(0);
