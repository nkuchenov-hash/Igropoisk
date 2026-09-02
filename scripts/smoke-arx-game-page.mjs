import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const remote=String(process.env.ARX_SMOKE_BASE_URL||'').trim().replace(/\/+$/,'');
const corpus=JSON.parse(fs.readFileSync('data/game-sources/arx-fatalis.json','utf8'));
const arr=v=>Array.isArray(v)?v:[];
const url=s=>String(s?.resolved_url||s?.url||s?.source_url||'');
const direct=s=>{const roles=arr(s?.roles).map(String);const u=url(s),t=String(s?.title||'');if(!roles.includes('review')&&s?.kind!=='professional-review')return false;if(!u)return false;if(/gamerankings\.com|\/games\/arx-fatalis\/?$|\/game\/arx_fatalis\/reviews\/?$|^https?:\/\/gamezone\.com\/?$/i.test(u))return false;if(/пользовательские отзывы/i.test(t))return false;return true};
const expectedReviews=new Set(arr(corpus.sources).filter(direct).map(s=>url(s).replace(/\/$/,''))).size;
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
let server=null,base=remote;
if(!base){const safe=raw=>{const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null};server=http.createServer((req,res)=>{const file=safe(req.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end('Not found');return}res.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(res)});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4182,'127.0.0.1',resolve)});base='http://127.0.0.1:4182'}
const executablePath=browserPath();if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));await page.setCacheEnabled(false);
 await page.goto(`${base}/game/arx-fatalis/?acceptance=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim()==='Arx Fatalis',{timeout:30000});
 await page.waitForFunction(expected=>document.querySelectorAll('#reviewGrid .quality-review-row').length===expected,{timeout:30000},expectedReviews);
 await page.waitForFunction(()=>Boolean(document.querySelector('#reviewSummaryCard img')),{timeout:30000});
 await page.evaluate(()=>document.querySelector('[data-tab="reviews"]')?.click());
 await new Promise(r=>setTimeout(r,800));
 const state=await page.evaluate(()=>{const rows=[...document.querySelectorAll('#reviewGrid .quality-review-row')];const titleXs=rows.map(r=>Math.round(r.querySelector('b')?.getBoundingClientRect().left||0));const card=document.querySelector('#reviewSummaryCard');return{
  title:document.querySelector('#gameTitle')?.textContent?.trim()||'',
  meta:document.querySelector('#gameMeta')?.textContent?.trim()||'',
  pitch:document.querySelector('.hero-pitch')?.textContent?.trim()||'',
  description:document.querySelector('#description')?.textContent?.trim()||'',
  reviewRows:rows.length,
  reviewNames:[...document.querySelectorAll('#reviewGrid .quality-review-source')].map(n=>n.textContent.trim()),
  reviewLinks:rows.map(n=>n.href),
  reviewTitleXs:titleXs,
  reviewCardVisible:Boolean(card)&&getComputedStyle(card).display!=='none'&&card.getBoundingClientRect().height>200,
  reviewCardImage:Boolean(card?.querySelector('img')),
  reviewCardText:(card?.textContent||'').replace(/\s+/g,' ').trim(),
  reviewEmpty:(document.querySelector('#reviewGrid')?.textContent||'').includes('Источники ещё собираются'),
  blue:[...document.querySelectorAll('img')].map(n=>n.currentSrc||n.src).filter(u=>/storepagebackground\/app\/1700/i.test(u)),
  blueBg:[...document.querySelectorAll('*')].filter(n=>/storepagebackground\/app\/1700/i.test(getComputedStyle(n).backgroundImage||'')).length,
  ratingNote:(document.querySelector('#reviews')?.textContent||'').match(/Среднее[^\n]*/i)?.[0]||'',
  official:[...document.querySelectorAll('#officialLinks a')].map(a=>a.href),
  minimumPairs:document.querySelectorAll('#minimumRequirements dt').length,
  recommendedPairs:document.querySelectorAll('#recommendedRequirements dt').length,
  minimum:(document.querySelector('#minimumRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
  recommended:(document.querySelector('#recommendedRequirements')?.textContent||'').replace(/\s+/g,' ').trim(),
  ownGuide:Boolean(document.querySelector('#featuredGuide:not([hidden])')),
  guideLinks:[...document.querySelectorAll('#guideGrid a[href]')].map(a=>a.href),
  body:(document.body.textContent||'').replace(/\s+/g,' ').trim()
 }});
 const errors=[];
 if(!/2002/.test(state.meta)||!/RPG/i.test(state.meta))errors.push(`Hero metadata incomplete: ${state.meta}`);
 if(state.pitch.length<80||!/Arkane/i.test(state.pitch))errors.push(`Hero pitch is weak/missing: ${state.pitch}`);
 if(state.description.length<350||!/руны|заклинан/i.test(state.description)||!/Arkane/i.test(state.description))errors.push(`Editorial description is weak: ${state.description}`);
 if(/Arx Fatalis построена как ролевая игра с видом от первого лица/i.test(state.body))errors.push('Forbidden generic Arx text is still visible.');
 if(state.reviewRows!==expectedReviews)errors.push(`Review corpus incomplete: ${state.reviewRows}/${expectedReviews}`);
 if(!state.reviewCardVisible)errors.push('Review summary card is missing.');
 if(!state.reviewCardImage)errors.push('Review summary card has no screenshot.');
 if(!/Обзор Arx Fatalis/i.test(state.reviewCardText)||state.reviewCardText.length<250)errors.push(`Review summary card is incomplete: ${state.reviewCardText}`);
 if(new Set(state.reviewTitleXs).size!==1||state.reviewTitleXs[0]<=0)errors.push(`Review title column is not aligned: ${state.reviewTitleXs.join(', ')}`);
 if(state.reviewEmpty)errors.push('Review section still says sources are being collected.');
 if(state.blue.length||state.blueBg)errors.push(`Forbidden blue store background visible: ${state.blue.length} img / ${state.blueBg} bg`);
 if(state.ratingNote)errors.push(`Forbidden rating explanation visible: ${state.ratingNote}`);
 if(state.official.some(h=>!/^https?:\/\//.test(h)||/undefined|null|#$/.test(h)))errors.push(`Invalid official link: ${state.official.join(', ')}`);
 if(state.minimumPairs<2)errors.push(`Minimum requirements are not structured: ${state.minimum}`);
 if(state.recommendedPairs<2)errors.push(`Recommended requirements are not structured: ${state.recommended}`);
 if(state.ownGuide)errors.push('Own/featured guide is still rendered.');
 if(state.guideLinks.some(h=>h.includes('/Igropoisk/article/')))errors.push('Guides contain an internal Игропоиск guide.');
 if(pageErrors.length)errors.push(`Browser errors: ${pageErrors.slice(0,4).join(' | ')}`);
 console.log(JSON.stringify({base,expectedReviews,state,pageErrors,errors},null,2));
 if(errors.length)throw new Error(`Arx Fatalis live page failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();if(server)await new Promise(r=>server.close(r))}
