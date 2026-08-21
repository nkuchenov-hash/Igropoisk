#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=new Set(process.argv.slice(2).map(x=>String(x||'').trim().toLowerCase()).filter(Boolean));
if(!slugs.size)throw new Error('Usage: finalize-commercial-post-create <slug...>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const exists=r=>fs.existsSync(path.join(root,r));
const dir=path.join(root,'data/game-enrichment-requests');
if(!fs.existsSync(dir))process.exit(0);
let complete=0;

for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
  const relative=`data/game-enrichment-requests/${file}`;
  const request=read(relative);
  const slug=String(request?.slug||'').toLowerCase();
  if(!slugs.has(slug))continue;

  const importance=String(request?.review_importance?.status||'');
  if(!['required','not_required'].includes(importance))throw new Error(`${slug}: cannot finalize before review importance is resolved`);

  const review=read(`data/reviews/${slug}.json`);
  const draft=read(`data/drafts/${slug}.json`);
  const dna=read(`data/game-dna/${slug}.json`);
  const score=Number(review?.review_score?.calculation?.score_10);
  const screens=(draft?.media?.screenshots||[]).length;
  const art=(draft?.media?.artwork||[]).length;
  const ratingReady=review?.review_score?.status==='green'&&Number.isFinite(score);
  const mediaReady=screens>=15;
  const dnaReady=dna?.ready_for_similarity===true;

  let reviewReady=false;
  let reviewStage='not_required';
  let reviewWords=0;
  let reviewSources=0;
  let reviewModule='not_required';

  if(importance==='required'){
    const validation=read(`data/parser-runs/review-commercial-v2-${slug}.json`);
    const article=read(`data/articles/${slug}.json`);
    reviewReady=validation?.passed===true&&article?.publication_status==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
    if(!reviewReady)throw new Error(`${slug}: editorially significant game cannot finalize before full commercial review passes`);
    reviewStage='full';
    reviewWords=Number(validation?.metrics?.article_words||article?.generation?.words||0);
    reviewSources=Number(validation?.metrics?.full_text_sources||0);
    reviewModule='ready';
  }else{
    const bootstrap=read(`data/review-bootstrap/${slug}.json`);
    reviewReady=bootstrap?.publication_status==='published'&&Number(bootstrap?.score)===score&&bootstrap?.generation?.editorial_quality?.passed===true&&bootstrap?.generation?.grounding_audit?.passed===true&&exists(`article/${slug}/index.html`);
    if(!reviewReady)throw new Error(`${slug}: non-full-review page cannot finalize before its grounded factual bootstrap passes`);
    reviewStage='quick_info';
    reviewWords=Number(bootstrap?.generation?.words||0);
    reviewSources=Number(bootstrap?.generation?.grounding_audit?.sources||bootstrap?.generation?.grounding_audit?.source_count||0);
  }

  if(!mediaReady||!ratingReady||!dnaReady)throw new Error(`${slug}: page modules are not all ready (media=${mediaReady}, rating=${ratingReady}, dna=${dnaReady})`);

  const next={
    ...request,
    last_run_at:new Date().toISOString(),
    run_attempts:Number(request.run_attempts||0)+1,
    review_attempts:Number(request.review_attempts||0)+(importance==='required'?1:0),
    state:'complete',
    modules:{
      ...(request.modules||{}),
      review:reviewModule,
      media:'ready',
      rating:'ready',
      dna:'ready',
      similarity:'ready'
    },
    observed:{
      ...(request.observed||{}),
      screenshots:screens,
      artwork:art,
      canonical_score:score,
      review_stage:reviewStage,
      review_words:reviewWords,
      review_sources:reviewSources
    },
    retry:{terminal:true,retryable:false,stage:'complete',last_error:null,updated_at:new Date().toISOString()}
  };
  write(relative,next);
  complete++;
}
console.log(JSON.stringify({status:'complete',games:complete,slugs:[...slugs]},null,2));
