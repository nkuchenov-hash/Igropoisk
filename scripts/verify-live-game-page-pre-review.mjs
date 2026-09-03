import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildReviewIdentityPolicy, normalizeReviewIdentity, reviewIdentityProblem, reviewRowFingerprint } from './lib/review-identity-policy.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug) throw new Error('Usage: node scripts/verify-live-game-page-pre-review.mjs <slug>');
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const config=read('config/game-page-quality-v2.json',{});
const draft=read(`data/drafts/${slug}.json`,{});
const expectedReviews=read(`data/reviews/${slug}.json`,{});
const expectedRatings=read(`data/ratings/${slug}.json`,{});
const policy=buildReviewIdentityPolicy(root,slug,draft);
const reviewMinimum=Number(config.review_corpus?.minimum_sources||10);
const ratingMinimum=Number(config.rating?.minimum_sources||5);
const ratingTarget=Number(config.rating?.target_sources||10);
const requiredRatingCount=ratingMinimum;
const base='https://nkuchenov-hash.github.io/Igropoisk';
const pageUrl=`${base}/game/${slug}/`;
const normalize=normalizeReviewIdentity;
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
const visibleScore=value=>{const text=String(value||'').trim();return Boolean(text&&text!=='—'&&text!=='-'&&/(?:\d|^[A-F](?:[+-])?$)/i.test(text))};
const fingerprints=rows=>(Array.isArray(rows)?rows:[]).map(reviewRowFingerprint).sort();
const sameRows=(left,right)=>JSON.stringify(fingerprints(left))===JSON.stringify(fingerprints(right));

const executablePath=browserPath();
if(!executablePath) throw new Error('Chrome/Chromium executable was not found for live Game Page verification.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let lastProblems=['live verification did not run'];
try{
  const page=await browser.newPage();
  for(let attempt=1;attempt<=90;attempt+=1){
    const problems=[];
    const stamp=Date.now();
    let reviews=null,ratings=null;
    try{
      const [reviewsResponse,ratingsResponse]=await Promise.all([
        fetch(`${base}/data/reviews/${slug}.json?live=${stamp}`,{cache:'no-store',signal:AbortSignal.timeout(10000)}),
        fetch(`${base}/data/ratings/${slug}.json?live=${stamp}`,{cache:'no-store',signal:AbortSignal.timeout(10000)}),
      ]);
      if(!reviewsResponse.ok) problems.push(`live reviews HTTP ${reviewsResponse.status}`);
      if(!ratingsResponse.ok) problems.push(`live ratings HTTP ${ratingsResponse.status}`);
      if(reviewsResponse.ok) reviews=await reviewsResponse.json();
      if(ratingsResponse.ok) ratings=await ratingsResponse.json();
    }catch(error){problems.push(`live data fetch failed: ${error.message}`)}

    const reviewRows=Array.isArray(reviews?.reviews)?reviews.reviews:[];
    const publications=new Set(reviewRows.map(item=>normalize(item.publication||item.source)).filter(Boolean));
    const scoreRows=Array.isArray(ratings?.sources)?ratings.sources:[];
    const values=scoreRows.map(item=>Number(item.normalized_10)).filter(Number.isFinite);
    const mean=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
    const published=Number(ratings?.calculation?.score_10);
    const aggregateSourceCount=Number(ratings?.calculation?.source_count||0);
    if(reviewRows.length<reviewMinimum) problems.push(`live professional reviews ${reviewRows.length}/${reviewMinimum}`);
    if(publications.size<reviewMinimum) problems.push(`live independent publications ${publications.size}/${reviewMinimum}`);
    if(scoreRows.length<requiredRatingCount) problems.push(`live professional score sources ${scoreRows.length}/${requiredRatingCount}`);
    if(ratings?.status!=='green'||!Number.isFinite(published)||mean===null) problems.push('live aggregate professional rating is not green/calculated');
    if(ratings?.method?.use_all_discovered_scores!==true) problems.push('live aggregate does not use all discovered professional scores');
    if(ratings?.method?.identity_sanitized!==true) problems.push('live aggregate was not identity-sanitized');
    if(aggregateSourceCount!==scoreRows.length) problems.push('live rating source count does not match live score rows');
    if(mean!==null&&Number.isFinite(published)&&Math.abs(Number(mean.toFixed(1))-published)>0.001) problems.push(`live mean ${Number(mean.toFixed(1))} does not match published ${published}`);
    for(const item of reviewRows){const reason=reviewIdentityProblem(item,policy);if(reason){problems.push(`invalid live review identity/source: ${reason}: ${item.url||item.resolved_url||item.title||'missing'}`);break}}
    for(const item of scoreRows){const reason=reviewIdentityProblem(item,policy);if(reason){problems.push(`invalid live rating identity/source: ${reason}: ${item.url||item.title||'missing'}`);break}}
    if(!sameRows(reviewRows,expectedReviews?.reviews||[])) problems.push(`live review corpus does not exactly match production candidate (${reviewRows.length} vs ${(expectedReviews?.reviews||[]).length})`);
    if(!sameRows(scoreRows,expectedRatings?.sources||[])) problems.push(`live rating corpus does not exactly match production candidate (${scoreRows.length} vs ${(expectedRatings?.sources||[]).length})`);
    if(Number(expectedRatings?.calculation?.score_10)!==published) problems.push(`live aggregate ${published} does not match production candidate ${expectedRatings?.calculation?.score_10}`);

    const pageErrors=[];
    const onPageError=error=>pageErrors.push(String(error?.message||error));
    page.on('pageerror',onPageError);
    let dom=null;
    try{
      const response=await page.goto(`${pageUrl}?live=${stamp}`,{waitUntil:'domcontentloaded',timeout:20000});
      if(!response?.ok()) problems.push(`live page HTTP ${response?.status()||0}`);
      await page.waitForFunction(min=>document.querySelectorAll('#reviewGrid .quality-review-row').length>=min,{timeout:12000},reviewMinimum).catch(()=>{});
      dom=await page.evaluate(()=>({
        slug:document.querySelector('[data-slug]')?.getAttribute('data-slug')||'',
        reviews:document.querySelectorAll('#reviewGrid .quality-review-row').length,
        publications:[...document.querySelectorAll('#reviewGrid .quality-review-source')].map(node=>node.textContent.trim()).filter(Boolean),
        scoreDisplays:[...document.querySelectorAll('#reviewGrid .quality-review-row strong')].map(node=>node.textContent.trim()).filter(Boolean),
        aggregate:(document.querySelector('#featuredReview .ig-review-feature__score')?.textContent||'').trim(),
        aggregateMeta:(document.querySelector('#featuredReview .ig-review-feature__meta span')?.textContent||'').trim(),
        editorialLinks:document.querySelectorAll('#featuredReview .ig-review-link').length,
      }));
      dom.visibleScores=dom.scoreDisplays.filter(visibleScore);
    }catch(error){problems.push(`live DOM verification failed: ${error.message}`)}
    page.off('pageerror',onPageError);
    if(pageErrors.length) problems.push(`live browser errors: ${pageErrors.slice(0,3).join(' | ')}`);
    if(dom){
      if(dom.slug&&dom.slug!==slug) problems.push(`live DOM slug mismatch: ${dom.slug}`);
      if(dom.reviews!==reviewRows.length) problems.push(`visible review count ${dom.reviews} does not match live JSON ${reviewRows.length}`);
      const visiblePublications=new Set(dom.publications.map(normalize).filter(Boolean));
      if(visiblePublications.size!==publications.size) problems.push(`visible publication count ${visiblePublications.size} does not match live JSON ${publications.size}`);
      if(dom.visibleScores.length<aggregateSourceCount) problems.push(`only ${dom.visibleScores.length}/${aggregateSourceCount} aggregate source scores are visibly rendered`);
      if(Number(dom.aggregate)!==published) problems.push(`visible aggregate ${dom.aggregate||'missing'} does not match live calculated ${published}`);
      if(!new RegExp(`Среднее\\s+${aggregateSourceCount}\\s+независимых профессиональных оценок`,'i').test(dom.aggregateMeta)) problems.push(`visible aggregate provenance is missing or has wrong source count: ${dom.aggregateMeta||'missing'}`);
      if(dom.editorialLinks!==0) problems.push('editorial Игропоиск review link is visible before the separate review module publishes an article');
    }

    if(!problems.length){
      console.log(JSON.stringify({slug,page:pageUrl,live_reviews:reviewRows.length,live_publications:publications.size,live_score_sources:scoreRows.length,rating_minimum:ratingMinimum,rating_target:ratingTarget,required_rating_sources:requiredRatingCount,live_score_10:published,exact_candidate_parity:true,identity_sanitized:true,visible_reviews:dom.reviews,visible_publications:new Set(dom.publications.map(normalize)).size,visible_scores:dom.visibleScores.length},null,2));
      lastProblems=[];
      break;
    }
    lastProblems=problems;
    if(attempt<90) await new Promise(resolve=>setTimeout(resolve,2000));
  }
}finally{await browser.close()}
if(lastProblems.length){
  console.error(JSON.stringify({slug,page:pageUrl,status:'red-needs-revision',problems:lastProblems},null,2));
  process.exit(1);
}
