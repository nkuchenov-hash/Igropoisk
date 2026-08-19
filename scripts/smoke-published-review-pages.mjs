#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
if(!slugs.length)throw new Error('Usage: smoke-published-review-pages <slug...>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const repo=String(process.env.GITHUB_REPOSITORY||'nkuchenov-hash/Igropoisk');
const [owner,name]=repo.split('/');
const base=String(process.env.REVIEW_SMOKE_BASE_URL||`https://${owner}.github.io/${name}`).replace(/\/$/,'');
const attempts=Math.max(1,Number(process.env.REVIEW_SMOKE_ATTEMPTS||36));
const delayMs=Math.max(1000,Number(process.env.REVIEW_SMOKE_DELAY_MS||5000));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();

for(const slug of slugs){
  const article=read(`data/articles/${slug}.json`),validation=read(`data/parser-runs/review-commercial-v2-${slug}.json`);
  if(!article||article.publication_status!=='published'||validation?.passed!==true)throw new Error(`${slug}: full commercial review is not locally green/published before live smoke`);
  const expectedTitle=compact(article.title),expectedScore=String(article.score),minimumWords=Number(validation.metrics?.article_words||0),minimumShots=Number(validation.metrics?.article_screenshots||0),url=`${base}/article/${encodeURIComponent(slug)}/`;
  if(minimumWords<3000||minimumShots<15)throw new Error(`${slug}: commercial metrics too weak before live smoke: words=${minimumWords}, screenshots=${minimumShots}`);
  let last='';
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(`${url}?igropoisk_smoke=${Date.now()}`,{redirect:'follow',headers:{'cache-control':'no-cache','user-agent':'IgropoiskCommercialReviewSmoke/2.0'},signal:AbortSignal.timeout(15000)});
      const html=await response.text();
      const titleOk=html.includes(expectedTitle),scoreOk=html.includes(`${expectedScore} / 10`)||html.includes(`${expectedScore}/10`),articleOk=html.includes(`data-article="${slug}"`),carouselOk=(html.match(/data-shot-card/g)||[]).length>=4,sourceOk=html.includes('Материалы, использованные при написании');
      if(response.ok&&titleOk&&scoreOk&&articleOk&&carouselOk&&sourceOk){console.log(JSON.stringify({slug,status:'live-commercial-v2',url,response_status:response.status,title:expectedTitle,score:article.score,words:minimumWords,screenshots:minimumShots,attempt},null,2));last='';break}
      last=`HTTP ${response.status}; title=${titleOk}; score=${scoreOk}; article=${articleOk}; carousels=${carouselOk}; sources=${sourceOk}`;
    }catch(error){last=error?.message||String(error)}
    if(attempt<attempts)await sleep(delayMs);
  }
  if(last)throw new Error(`${slug}: production Pages commercial review smoke failed after ${attempts} attempts at ${url}: ${last}`);
}
