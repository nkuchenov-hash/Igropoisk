#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const exists=relative=>fs.existsSync(path.join(root,relative));
const failures=[];
const checked=[];
for(const slug of slugs){
  const request=read(`data/game-enrichment-requests/${slug}.json`,{});
  const review=read(`data/reviews/${slug}.json`,{});
  const score=Number(review?.review_score?.calculation?.score_10);
  const ratingGreen=review?.review_score?.status==='green'&&Number.isFinite(score);
  if(request?.released===false||!ratingGreen){
    checked.push({slug,required:false,reason:request?.released===false?'unreleased':'canonical_rating_not_green'});
    continue;
  }
  const article=read(`data/review-bootstrap/${slug}.json`,{});
  const ready=article?.publication_status==='published'&&Number(article?.score)===score&&exists(`article/${slug}/index.html`);
  checked.push({slug,required:true,ready,score,quality_passed:article?.generation?.editorial_quality?.passed===true});
  if(!ready)failures.push(`${slug}: green-rated released game has no published bootstrap review at canonical score ${score}`);
  else if(article?.generation?.editorial_quality?.passed!==true)failures.push(`${slug}: published bootstrap review does not carry a passed editorial quality gate`);
}
console.log(JSON.stringify({checked,failures},null,2));
if(failures.length)process.exit(2);
