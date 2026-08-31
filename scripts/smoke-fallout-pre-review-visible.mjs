import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.jpg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
function safePath(raw){const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null}
const server=http.createServer((request,response)=>{const file=safePath(request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end('Not found');return}response.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');response.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(response)});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4179,'127.0.0.1',resolve)});
const executablePath=browserPath();if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
  await page.goto(`http://127.0.0.1:4179/game/fallout/?preReview=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#reviewGrid .quality-review-row').length>=10,{timeout:20000});
  await page.waitForFunction(()=>{const text=(document.querySelector('#featuredReview .ig-review-feature__score')?.textContent||'').trim();return /^\d+(?:\.\d+)?$/.test(text)},{timeout:20000});
  const state=await page.evaluate(()=>({
    reviews:document.querySelectorAll('#reviewGrid .quality-review-row').length,
    publications:[...document.querySelectorAll('#reviewGrid .quality-review-source')].map(n=>n.textContent.trim()).filter(Boolean),
    scoreDisplays:[...document.querySelectorAll('#reviewGrid .quality-review-row strong')].map(n=>n.textContent.trim()).filter(Boolean),
    aggregate:(document.querySelector('#featuredReview .ig-review-feature__score')?.textContent||'').trim(),
    aggregateMeta:(document.querySelector('#featuredReview .ig-review-feature__meta span')?.textContent||'').trim(),
    editorialLinks:document.querySelectorAll('#featuredReview .ig-review-link').length
  }));
  state.visibleScores=state.scoreDisplays.filter(value=>value&&value!=='—'&&value!=='-'&&/(?:\d|^[A-F](?:[+-])?$)/i.test(value));
  const ratings=JSON.parse(fs.readFileSync(path.join(root,'data/ratings/fallout.json'),'utf8'));
  const expected=Number(ratings.calculation?.score_10);
  const ratingMinimum=Number(ratings.method?.minimum_sources_for_confident_rating||5);
  const aggregateSourceCount=Number(ratings.calculation?.source_count||0);
  const errors=[];
  if(state.reviews<10)errors.push(`Visible professional reviews ${state.reviews}/10`);
  if(new Set(state.publications.map(v=>v.toLowerCase())).size<10)errors.push(`Visible independent publications ${new Set(state.publications).size}/10`);
  if(state.visibleScores.length<ratingMinimum)errors.push(`Visible source scores ${state.visibleScores.length}/${ratingMinimum} minimum`);
  if(state.visibleScores.length<aggregateSourceCount)errors.push(`Only ${state.visibleScores.length}/${aggregateSourceCount} aggregate source scores are visibly rendered`);
  if(Number(state.aggregate)!==expected)errors.push(`Visible aggregate ${state.aggregate} does not match calculated ${expected}`);
  if(!new RegExp(`Среднее\\s+${aggregateSourceCount}\\s+независимых профессиональных оценок`,'i').test(state.aggregateMeta))errors.push(`Aggregate provenance is missing or has wrong source count: ${state.aggregateMeta}`);
  if(state.editorialLinks!==0)errors.push('Editorial review link must remain absent before the separate review module publishes an article');
  if(pageErrors.length)errors.push(`Browser errors: ${pageErrors.slice(0,3).join(' | ')}`);
  console.log(JSON.stringify({state,expected,ratingMinimum,aggregateSourceCount,pageErrors,errors},null,2));
  if(errors.length)throw new Error(`Fallout pre-review visible-data smoke failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
