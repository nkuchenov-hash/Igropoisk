#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/smoke-game-page-slug.mjs <slug>');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const draft=read(`data/drafts/${slug}.json`);
const corpus=read(`data/game-sources/${slug}.json`);
const editorial=read(`data/page-editorial/${slug}.json`);
const contentQc=read(`data/quality-control/game-page-content-${slug}.json`);
const mediaQc=read(`data/quality-control/game-page-${slug}.json`);
if(draft.publication?.status!=='published'||draft.publication?.public_ready!==true)throw new Error(`${slug}: page is not finalized`);
if(!corpus.discovery?.complete)throw new Error(`${slug}: source corpus incomplete`);
if(editorial.quality_status!=='green'||contentQc.status!=='green'||mediaQc.status!=='green')throw new Error(`${slug}: canonical page gates are not green`);
const professional=(corpus.sources||[]).filter(x=>x.professional===true&&x.kind==='professional-review');
const canon=value=>{try{const u=new URL(String(value||''));u.hash='';for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(k);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').replace(/\/$/,'')}};
const expectedReviewLinks=[...new Set(professional.map(x=>canon(x.url)).filter(Boolean))];
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
const remote=String(process.env.GAME_PAGE_SMOKE_BASE_URL||'').trim().replace(/\/+$/,'');
let server=null,base=remote;
if(!base){
  const safe=raw=>{const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null};
  server=http.createServer((req,res)=>{const file=safe(req.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end('Not found');return}res.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(res)});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4184,'127.0.0.1',resolve)});base='http://127.0.0.1:4184';
}
const executablePath=browserPath();if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080});await page.setCacheEnabled(false);
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
  await page.goto(`${base}/game/${slug}/?moduleAcceptance=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(document.querySelector('#gameTitle')?.textContent?.trim()),{timeout:30000});
  await page.waitForFunction(()=>Boolean(document.querySelector('#description')?.textContent?.trim()),{timeout:30000});
  if(expectedReviewLinks.length)await page.waitForFunction(expected=>document.querySelectorAll('#reviewGrid .quality-review-row').length>=expected,{timeout:30000},expectedReviewLinks.length);
  const state=await page.evaluate(()=>({
    title:document.querySelector('#gameTitle')?.textContent?.trim()||'',
    meta:document.querySelector('#gameMeta')?.textContent?.trim()||'',
    pitch:document.querySelector('.hero-pitch')?.textContent?.trim()||'',
    description:document.querySelector('#description')?.textContent?.trim()||'',
    reviewLinks:[...document.querySelectorAll('#reviewGrid .quality-review-row')].map(n=>n.href),
    images:[...document.querySelectorAll('img')].map(n=>n.currentSrc||n.src).filter(Boolean),
    forbiddenBlue:[...document.querySelectorAll('img')].map(n=>n.currentSrc||n.src).filter(u=>/storepagebackground\/app\//i.test(u)),
    forbiddenBlueBackgrounds:[...document.querySelectorAll('*')].filter(n=>/storepagebackground\/app\//i.test(getComputedStyle(n).backgroundImage||'')).length,
    body:(document.body.textContent||'').replace(/\s+/g,' ').trim()
  }));
  const errors=[];
  const expectedTitle=String(draft.identity?.title||'').replace(/[™®©]/g,'').trim().toLowerCase();
  const actualTitle=state.title.replace(/[™®©]/g,'').trim().toLowerCase();
  if(!actualTitle||(!actualTitle.includes(expectedTitle)&&!expectedTitle.includes(actualTitle)))errors.push(`title mismatch: ${state.title} vs ${draft.identity?.title}`);
  if(state.pitch.length<60)errors.push(`hero pitch too short: ${state.pitch.length}`);
  if(state.description.length<250)errors.push(`description too short: ${state.description.length}`);
  if(!state.images.length)errors.push('no rendered images');
  if(state.forbiddenBlue.length||state.forbiddenBlueBackgrounds)errors.push('forbidden Steam blue/storepagebackground media is visible');
  if(/информация о которой собрана|данные о которой собраны|проверяемых каталогов/i.test(state.body))errors.push('generic technical placeholder text is visible');
  const actualLinks=new Set(state.reviewLinks.map(canon));const missing=expectedReviewLinks.filter(x=>!actualLinks.has(x));
  if(missing.length)errors.push(`canonical professional review links missing: ${missing.length}`);
  if(pageErrors.length)errors.push(`browser JS errors: ${pageErrors.slice(0,5).join(' | ')}`);
  const result={slug,base,title:state.title,professional_reviews:expectedReviewLinks.length,rendered_review_links:state.reviewLinks.length,images:state.images.length,pageErrors,errors};
  console.log(JSON.stringify(result,null,2));
  if(errors.length)throw new Error(`${slug} runtime acceptance failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
