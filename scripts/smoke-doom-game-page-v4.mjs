import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const requestedBase=String(process.env.DOOM_SMOKE_BASE_URL||'').trim().replace(/\/+$/,'');
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
let server=null;let base=requestedBase;
if(!base){
  const safePath=raw=>{const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null};
  server=http.createServer((request,response)=>{const file=safePath(request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end('Not found');return}response.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');response.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(response)});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4180,'127.0.0.1',resolve)});base='http://127.0.0.1:4180';
}
const executablePath=browserPath();if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();await page.setViewport({width:1440,height:1100});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
  await page.goto(`${base}/game/doom/?acceptance=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim()==='DOOM',{timeout:15000});
  await page.waitForFunction(()=>document.querySelectorAll('#reviewGrid .quality-review-row').length>=10&&document.querySelectorAll('#similarGames [data-similarity-score]').length>=1,{timeout:15000});
  await new Promise(resolve=>setTimeout(resolve,1200));
  const state=await page.evaluate(()=>({
    title:document.querySelector('#gameTitle')?.textContent?.trim()||'',
    designSystem:document.documentElement.dataset.designSystem||'',
    tabs:[...document.querySelectorAll('.game-tabs [data-tab]')].map(node=>node.textContent.trim()),
    legacyShell:Boolean(document.querySelector('main.wrap,#gallery,section.hero')),
    rateControls:document.querySelectorAll('#rateGame,#rateInline,#ratingDialog').length,
    minimum:(document.querySelector('#minimumRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    recommended:(document.querySelector('#recommendedRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    platforms:(document.querySelector('#platformRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
    similar:document.querySelectorAll('#similarGames [data-similarity-score]').length,
    similarReasons:[...document.querySelectorAll('#similarGames [data-similarity-score]')].map(node=>node.getAttribute('data-similarity-reasons')).filter(Boolean),
    reviewRows:document.querySelectorAll('#reviewGrid .quality-review-row').length,
    reviewScores:[...document.querySelectorAll('#reviewGrid .quality-review-row strong')].map(node=>node.textContent.trim()).filter(Boolean),
    featuredScore:document.querySelector('#featuredReview .ig-review-feature__score')?.textContent?.trim()||'',
    guides:(document.querySelector('#featuredGuide h2 a')?1:0)+document.querySelectorAll('#guideGrid .guide-card').length,
    franchise:document.querySelectorAll('#franchisePanel .franchise-game').length,
    body:(document.body.textContent||'').replace(/\s+/g,' ')
  }));
  const errors=[];
  if(state.title!=='DOOM')errors.push(`Wrong title: ${state.title}`);
  if(state.designSystem!=='igropoisk-game-v3')errors.push(`New Game Page design system is not active: ${state.designSystem}`);
  for(const tab of ['Об игре','Обзоры','Медиа','Новости','Системные требования','Гайды','Источники'])if(!state.tabs.some(value=>value.includes(tab)))errors.push(`Missing new tab: ${tab}`);
  if(state.legacyShell)errors.push('Legacy DOOM shell is still present.');
  if(state.rateControls!==0)errors.push(`Rating controls remain: ${state.rateControls}`);
  if(!/i5-2400/i.test(state.minimum)||!/GTX 670/i.test(state.minimum))errors.push(`Minimum requirements are not hydrated: ${state.minimum}`);
  if(!/i7-3770/i.test(state.recommended)||!/GTX 970/i.test(state.recommended))errors.push(`Recommended requirements are not hydrated: ${state.recommended}`);
  if(!/Windows/i.test(state.platforms))errors.push(`Windows platform missing: ${state.platforms}`);
  if(state.similar<1||state.similarReasons.length!==state.similar)errors.push(`Similarity missing/reasons incomplete: ${state.similar}/${state.similarReasons.length}`);
  if(state.reviewRows<10||state.reviewScores.length<10)errors.push(`Scored professional reviews incomplete: ${state.reviewRows}/${state.reviewScores.length}`);
  if(state.featuredScore!=='8.7/10')errors.push(`Calculated DOOM rating is wrong: ${state.featuredScore}`);
  if(state.guides<6)errors.push(`DOOM guides incomplete: ${state.guides}`);
  if(state.franchise<2)errors.push(`DOOM franchise card incomplete: ${state.franchise}`);
  if(/Страница готовится/i.test(state.body))errors.push('Forbidden “page preparing” note is visible.');
  if(pageErrors.length)errors.push(`Browser errors: ${pageErrors.slice(0,3).join(' | ')}`);
  console.log(JSON.stringify({base,state,pageErrors,errors},null,2));
  if(errors.length)throw new Error(`DOOM Game Page v4 smoke failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve))}
