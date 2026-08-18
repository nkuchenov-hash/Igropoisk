#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slugs=process.argv.slice(2).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
if(!slugs.length)throw new Error('Usage: smoke-published-review-pages <slug...>');
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const repo=String(process.env.GITHUB_REPOSITORY||'nkuchenov-hash/Igropoisk');
const [owner,name]=repo.split('/');
const base=String(process.env.REVIEW_SMOKE_BASE_URL||`https://${owner}.github.io/${name}`).replace(/\/$/,'');
const attempts=Math.max(1,Number(process.env.REVIEW_SMOKE_ATTEMPTS||36));
const delayMs=Math.max(1000,Number(process.env.REVIEW_SMOKE_DELAY_MS||5000));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();

for(const slug of slugs){
  const article=read(`data/review-bootstrap/${slug}.json`);
  if(article.publication_status!=='published'||article.quality_status!=='green'||article.generation?.grounding_audit?.passed!==true)throw new Error(`${slug}: local publication artifact is not green/published before live smoke`);
  const expectedTitle=compact(article.title),expectedScore=String(article.score),url=`${base}/article/${encodeURIComponent(slug)}/`;
  let last='';
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(`${url}?igropoisk_smoke=${Date.now()}`,{redirect:'follow',headers:{'cache-control':'no-cache','user-agent':'IgropoiskCommercialReviewSmoke/1.0'},signal:AbortSignal.timeout(15000)});
      const html=await response.text();
      const titleOk=html.includes(expectedTitle),scoreOk=html.includes(`${expectedScore} / 10`)||html.includes(`${expectedScore}/10`),articleOk=html.includes(`data-article="${slug}"`);
      if(response.ok&&titleOk&&scoreOk&&articleOk){console.log(JSON.stringify({slug,status:'live',url,response_status:response.status,title:expectedTitle,score:article.score,attempt},null,2));last='';break}
      last=`HTTP ${response.status}; title=${titleOk}; score=${scoreOk}; article=${articleOk}`;
    }catch(error){last=error?.message||String(error)}
    if(attempt<attempts)await sleep(delayMs);
  }
  if(last)throw new Error(`${slug}: production Pages smoke failed after ${attempts} attempts at ${url}: ${last}`);
}
