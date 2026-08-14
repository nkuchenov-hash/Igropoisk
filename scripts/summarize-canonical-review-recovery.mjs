#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=process.argv.slice(2).filter(Boolean).length?process.argv.slice(2).filter(Boolean):[
  'elden-ring',
  'the-witcher-3-wild-hunt',
  'red-dead-redemption-2',
  'god-of-war',
  'hades',
  'cyberpunk-2077'
];
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const exists=relative=>fs.existsSync(path.join(root,relative));
const scoreCount=review=>Array.isArray(review?.review_score?.sources)?review.review_score.sources.length:0;
const acceptedCount=(review,research)=>Number(review?.publication_gate?.accepted??research?.coverage?.accepted??research?.accepted?.length??review?.reviews?.length??0);
const minimumSources=review=>Number(review?.publication_gate?.minimum||5);
const minimumScores=review=>Number(review?.review_score?.method?.minimum_sources||3);

const games=slugs.map(slug=>{
  const qc=read(`data/quality-control/review-${slug}-control.json`,{});
  const review=read(`data/reviews/${slug}.json`,{});
  const research=read(`data/research/${slug}-source-matrix.json`,{});
  const explicit=read(`data/parser-runs/review-explicit-scores-${slug}.json`,{});
  const language=read(`data/parser-runs/review-language-${slug}.json`,{});
  const output=read(`data/parser-runs/review-output-${slug}.json`,{});
  const media=read(`data/parser-runs/review-media-${slug}.json`,{});
  const article=read(`data/articles/${slug}.json`,read(`data/article-drafts/${slug}.json`,{}));
  const accepted=acceptedCount(review,research),minCorpus=minimumSources(review),scored=Math.max(scoreCount(review),Number(explicit?.scored||0),Number(research?.coverage?.scored||0)),minScore=minimumScores(review),canonicalScore=Number(review?.review_score?.calculation?.score_10),rendered=exists(`article/${slug}/index.html`),articlePublished=String(article?.publication_status||'').toLowerCase()==='published';
  const topEligible=review?.publication_gate?.status==='green'&&review?.review_score?.status==='green'&&Number.isFinite(canonicalScore)&&articlePublished&&Number(article?.score)===canonicalScore&&language?.passed===true&&output?.passed===true&&rendered;
  const blockers=[];
  if(review?.publication_gate?.status!=='green')blockers.push(`corpus:${accepted}/${minCorpus}`);
  if(review?.review_score?.status!=='green')blockers.push(`scores:${scored}/${minScore}`);
  if(!Number.isFinite(canonicalScore))blockers.push('canonical_score_missing');
  if(!articlePublished)blockers.push(`article_status:${article?.publication_status||'missing'}`);
  if(Number.isFinite(canonicalScore)&&Number(article?.score)!==canonicalScore)blockers.push(`article_score:${article?.score??'missing'}!=${canonicalScore}`);
  if(language?.passed!==true)blockers.push(`language:${language?.passed===false?'failed':'missing'}`);
  if(output?.passed!==true)blockers.push(`output:${output?.passed===false?'failed':'missing'}`);
  if(!rendered)blockers.push('article_html_missing');
  if(qc?.green!==true)blockers.push(`qc:${qc?.status||'missing'}`);
  return {
    slug,
    top250_eligible:topEligible,
    blockers:[...new Set(blockers)],
    corpus:{status:review?.publication_gate?.status||'missing',accepted,minimum:minCorpus,regional_complete:review?.regional_discovery?.complete===true},
    scores:{status:review?.review_score?.status||'missing',count:scored,minimum:minScore,value:Number.isFinite(canonicalScore)?canonicalScore:null,explicit_updates:Array.isArray(explicit?.updates)?explicit.updates.length:0},
    qc:{status:qc?.status||'missing',green:qc?.green===true,comments:Array.isArray(qc?.comments)?qc.comments.slice(0,12):[]},
    article:{status:article?.publication_status||'missing',score:Number.isFinite(Number(article?.score))?Number(article.score):null,rendered},
    language:{passed:language?.passed===true,provider:language?.provider||null,model:language?.model||null,scores:language?.scores||null},
    media:{status:media?.status||'missing',model:media?.model||null,gate:media?.gate||null},
    output:{passed:output?.passed===true,errors:Array.isArray(output?.errors)?output.errors.slice(0,12):[]}
  };
});
const top=read('data/top-250/current.json',{count:0,ranking:[]});
const summary={
  schema_version:1,
  generated_at:new Date().toISOString(),
  requested_games:games.length,
  top250_eligible_games:games.filter(game=>game.top250_eligible).length,
  top250_count:Number(top?.count||0),
  top250_slugs:(top?.ranking||[]).map(item=>item.slug),
  games
};
const target=path.join(root,'tmp/canonical-review-recovery-summary.json');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,`${JSON.stringify(summary,null,2)}\n`);
console.log(JSON.stringify(summary,null,2));
