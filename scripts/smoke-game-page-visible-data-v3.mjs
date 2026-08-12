import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.jpg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
function safePath(raw){const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null}
const server=http.createServer((request,response)=>{const file=safePath(request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end('Not found');return}response.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');response.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(response)});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4178,'127.0.0.1',resolve)});
const executablePath=browserPath();if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
  await page.goto(`http://127.0.0.1:4178/game/baldurs-gate-3/?visible=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim()==='Baldur’s Gate 3',{timeout:15000});await new Promise(resolve=>setTimeout(resolve,3200));
  const state=await page.evaluate(()=>({
    rateControls:document.querySelectorAll('#rateGame,#rateInline,#ratingDialog').length,
    minimum:(document.querySelector('#minimumRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    recommended:(document.querySelector('#recommendedRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    platforms:(document.querySelector('#platformRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    similar:document.querySelectorAll('#similarGames [data-similarity-score]').length,
    similarReasons:[...document.querySelectorAll('#similarGames [data-similarity-score]')].map(node=>node.getAttribute('data-similarity-reasons')).filter(Boolean),
    franchiseCards:document.querySelectorAll('#franchisePanel .franchise-game').length,
    franchiseText:(document.querySelector('#franchisePanel')?.textContent||'').replace(/\s+/g,' ').trim(),
    franchiseBrokenLinks:[...document.querySelectorAll('#franchisePanel a.franchise-game')].filter(node=>node.getAttribute('href')).length,
    guideLinks:document.querySelectorAll('#guides a[href^="http"]').length,
    externalReviews:document.querySelectorAll('#reviewGrid .quality-review-row').length,
    externalReviewSources:[...document.querySelectorAll('#reviewGrid .quality-review-source')].map(node=>node.textContent.trim()),
    calculatedScore:(document.querySelector('#featuredReview .ig-review-feature__score')?.textContent||'').trim(),
    articleLinks:document.querySelectorAll('#featuredReview .ig-review-link').length
  }));
  const errors=[];
  if(state.rateControls!==0)errors.push(`Rating controls remain visible: ${state.rateControls}`);
  if(state.minimum.length<40||/Точные значения доступны только после парсинга|Точные характеристики пока не получены/i.test(state.minimum))errors.push(`Minimum requirements are not hydrated: ${state.minimum}`);
  if(state.recommended.length<40||/Точные значения доступны только после парсинга|Точные характеристики пока не получены/i.test(state.recommended))errors.push(`Recommended requirements are not hydrated: ${state.recommended}`);
  if(!/Windows/i.test(state.platforms))errors.push(`Parsed Windows platform is missing: ${state.platforms}`);
  if(state.similar<1)errors.push('No similar games were materialized for BG3 control page.');
  if(state.similarReasons.length!==state.similar)errors.push('Similarity reasons are missing from one or more visible cards.');
  if(state.franchiseCards<2||!/Baldur's Gate: Enhanced Edition/i.test(state.franchiseText)||!/Baldur's Gate II: Enhanced Edition/i.test(state.franchiseText))errors.push(`Franchise cards are incomplete: ${state.franchiseText}`);
  if(state.franchiseBrokenLinks!==0)errors.push(`Queued franchise pages must not expose broken links: ${state.franchiseBrokenLinks}`);
  if(state.guideLinks<6)errors.push(`Verified guide corpus is not visible: ${state.guideLinks}`);
  if(state.externalReviews<10)errors.push(`Professional review corpus is not visible: ${state.externalReviews}`);
  if(new Set(state.externalReviewSources).size<10)errors.push(`Professional review publications are not independent: ${state.externalReviewSources.join(', ')}`);
  if(state.calculatedScore!=='9.9/10')errors.push(`Calculated BG3 rating is wrong or missing: ${state.calculatedScore}`);
  if(state.articleLinks!==0)errors.push(`Needs-revision Игропоиск article must remain unlinked: ${state.articleLinks}`);
  if(pageErrors.length)errors.push(`Browser errors: ${pageErrors.slice(0,3).join(' | ')}`);
  console.log(JSON.stringify({state,pageErrors,errors},null,2));if(errors.length)throw new Error(`Visible Game Page data smoke failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
