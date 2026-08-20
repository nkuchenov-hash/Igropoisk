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
const countWords=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;

function fullCandidate(slug){
  const article=read(`data/articles/${slug}.json`),validation=read(`data/parser-runs/review-commercial-v2-${slug}.json`);
  if(!article||article.publication_status!=='published'||validation?.passed!==true)return null;
  const minimumWords=Number(validation.metrics?.article_words||article.generation?.words||0),minimumShots=Number(validation.metrics?.article_screenshots||0);
  if(minimumWords<3000||minimumShots<15)throw new Error(`${slug}: commercial metrics too weak before live smoke: words=${minimumWords}, screenshots=${minimumShots}`);
  return{mode:'full',article,expectedTitle:compact(article.title),expectedScore:String(article.score),words:minimumWords,screenshots:minimumShots,sectionHeading:'',sourceName:''};
}
function bootstrapCandidate(slug){
  const article=read(`data/review-bootstrap/${slug}.json`),review=read(`data/reviews/${slug}.json`,{}),score=Number(review?.review_score?.calculation?.score_10);
  if(!article||article.publication_status!=='published')throw new Error(`${slug}: publication_status!=='published' for grounded quick review before live smoke`);
  if(article?.generation?.grounding_audit?.passed!==true)throw new Error(`${slug}: grounding_audit?.passed!==true before live smoke`);
  if(article?.generation?.editorial_quality?.passed!==true)throw new Error(`${slug}: editorial_quality?.passed!==true before live smoke`);
  if(article?.generation?.provider!=='deterministic-evidence-v1')throw new Error(`${slug}: grounded quick review provider is not deterministic-evidence-v1`);
  if(review?.review_score?.status!=='green'||!Number.isFinite(score)||Number(article.score)!==score)throw new Error(`${slug}: grounded quick review does not match the canonical green score`);
  const sources=Array.isArray(article.sources)?article.sources:[],words=countWords([article.lead,...(article.sections||[]).flatMap(section=>section.paragraphs||[]),article.verdict?.summary].join(' '));
  if(sources.length<3||words<220)throw new Error(`${slug}: grounded quick review too weak before live smoke: words=${words}, sources=${sources.length}`);
  const sectionHeading=compact(article.sections?.[0]?.heading||''),sourceName=compact(sources?.[0]?.name||sources?.[0]?.publication||'');
  if(!sectionHeading||!sourceName)throw new Error(`${slug}: grounded quick review lacks section/source identity for live verification`);
  return{mode:'bootstrap',article,expectedTitle:compact(article.title),expectedScore:String(article.score),words,screenshots:0,sectionHeading,sourceName};
}

for(const slug of slugs){
  const candidate=fullCandidate(slug)||bootstrapCandidate(slug),{mode,article,expectedTitle,expectedScore,words,screenshots,sectionHeading,sourceName}=candidate,url=`${base}/article/${encodeURIComponent(slug)}/`;
  let last='';
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(`${url}?igropoisk_smoke=${Date.now()}`,{redirect:'follow',headers:{'cache-control':'no-cache','user-agent':'IgropoiskCommercialReviewSmoke/3.0'},signal:AbortSignal.timeout(15000)});
      const html=await response.text();
      const titleOk=html.includes(expectedTitle),scoreOk=html.includes(`${expectedScore} / 10`)||html.includes(`${expectedScore}/10`),articleOk=html.includes(`data-article="${slug}"`),sourceHeadingOk=html.includes('Материалы, использованные при написании');
      const modeSpecificOk=mode==='full'?(html.match(/data-shot-card/g)||[]).length>=4:Boolean(sectionHeading&&sourceName&&html.includes(sectionHeading)&&html.includes(sourceName));
      if(response.ok&&titleOk&&scoreOk&&articleOk&&sourceHeadingOk&&modeSpecificOk){console.log(JSON.stringify({slug,status:mode==='full'?'live-commercial-v2':'live-grounded-bootstrap',mode,url,response_status:response.status,title:expectedTitle,score:article.score,words,screenshots,grounding_audit:mode==='bootstrap'?true:null,editorial_quality:mode==='bootstrap'?true:null,attempt},null,2));last='';break}
      last=`HTTP ${response.status}; mode=${mode}; title=${titleOk}; score=${scoreOk}; article=${articleOk}; sources=${sourceHeadingOk}; mode_specific=${modeSpecificOk}`;
    }catch(error){last=error?.message||String(error)}
    if(attempt<attempts)await sleep(delayMs);
  }
  if(last)throw new Error(`${slug}: production Pages ${mode} review smoke failed after ${attempts} attempts at ${url}: ${last}`);
}
