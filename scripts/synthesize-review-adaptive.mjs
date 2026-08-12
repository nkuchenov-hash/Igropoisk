#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=process.argv[2];
if(!slug)throw new Error('Usage: node scripts/synthesize-review-adaptive.mjs <slug>');
const configPath=path.join(root,'config/parsers/review-synthesis.json');
const reviewsPath=path.join(root,'data/reviews',`${slug}.json`);
const original=fs.readFileSync(configPath,'utf8');
const config=JSON.parse(original);
const reviews=JSON.parse(fs.readFileSync(reviewsPath,'utf8'));
const quality=JSON.parse(fs.readFileSync(path.join(root,'config/game-page-quality-v2.json'),'utf8'));
const minimum=Number(quality.review_corpus?.minimum_sources||10);
const maximum=Number(quality.review_corpus?.maximum_sources||20);
const available=Math.min(maximum,Array.isArray(reviews.reviews)?reviews.reviews.length:0);
if(available<minimum){
  console.log(JSON.stringify({slug,status:'needs_revision',reason:`professional review corpus ${available}/${minimum}`},null,2));
  process.exit(2);
}
const adaptiveRequired=Math.max(minimum,available);
config.publication_gate={...(config.publication_gate||{}),editorial_reviews_required:adaptiveRequired,independent_publications_required:adaptiveRequired,publish_below_gate:false};
fs.writeFileSync(configPath,`${JSON.stringify(config,null,2)}\n`);
let child;
try{
  child=spawnSync('node',['scripts/synthesize-review.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:24*1024*1024});
}finally{
  fs.writeFileSync(configPath,original);
}
for(const relative of [`data/articles/${slug}.json`,`data/article-drafts/${slug}.json`]){
  const target=path.join(root,relative);if(!fs.existsSync(target))continue;
  const article=JSON.parse(fs.readFileSync(target,'utf8'));
  if(String(article.publication_status||'').toLowerCase()==='blocked'){
    article.publication_status='needs_revision';
    article.quality_status='red-needs-revision';
    article.quality_comment='Материал автоматически возвращён на ревизию; красный статус не является терминальной остановкой.';
    fs.writeFileSync(target,`${JSON.stringify(article,null,2)}\n`);
  }
}
if(child?.status===0){console.log(JSON.stringify({slug,status:'completed',sources:adaptiveRequired},null,2));process.exit(0)}
console.log(JSON.stringify({slug,status:'needs_revision',sources:adaptiveRequired,reason:'synthesis requires another revision cycle'},null,2));
process.exit(2);
