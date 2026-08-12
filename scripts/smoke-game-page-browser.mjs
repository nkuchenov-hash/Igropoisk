import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp']]);
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
function safePath(raw){const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;const absolute=path.resolve(root,`.${requested}`);return absolute.startsWith(root)?absolute:null}
const server=http.createServer((request,response)=>{const file=safePath(request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end('Not found');return}response.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');response.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(response)});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4175,'127.0.0.1',resolve)});
const executablePath=browserPath();if(!executablePath){server.close();throw new Error('Chrome/Chromium executable was not found.')}
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];const assert=(condition,message)=>{if(!condition)errors.push(message)};
const games=[
  ['elden-ring',1245620],
  ['the-witcher-3-wild-hunt',292030],
  ['doom',379720],
  ['control',870780],
  ['hades',1145360]
];
try{
  for(const [slug,appid] of games){
    const page=await browser.newPage();await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
    await page.goto(`http://127.0.0.1:4175/game/${slug}/?smoke=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim()&&document.querySelectorAll('.hero-media__item').length>=6,{timeout:20000,polling:150});
    const state=await page.evaluate(()=>{
      const cover=document.querySelector('#gameCover img');
      const shots=[...document.querySelectorAll('.hero-media__item img')].map(img=>img.currentSrc||img.src).filter(Boolean);
      const fontSelectors=['.breadcrumbs','.hero-meta','.score-line b','.score-line small','.game-tabs button','.game-panel h2','.game-panel h3'];
      const fonts=fontSelectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>({selector,size:parseFloat(getComputedStyle(node).fontSize)})));
      const reviews=[...document.querySelectorAll('#reviewGrid .ig-external-review')];
      return {title:document.querySelector('#gameTitle')?.textContent?.trim()||'',cover:cover?.getAttribute('src')||'',heroShots:shots.length,uniqueHeroShots:new Set(shots.map(url=>url.split('?')[0])).size,minFont:fonts.length?Math.min(...fonts.map(item=>item.size)):0,smallFonts:fonts.filter(item=>item.size<16),reviewRows:reviews.length,reviewContainers:reviews.length?document.querySelectorAll('#reviewGrid.ig-external-review-grid').length:1,pageErrors:[]};
    });
    assert(state.cover.includes(`/apps/${appid}/library_600x900`),`${slug}: portrait cover missing (${state.cover})`);
    assert(state.heroShots>=6,`${slug}: hero screenshot gallery has ${state.heroShots}/6`);
    assert(state.uniqueHeroShots===state.heroShots,`${slug}: duplicate hero screenshots ${state.uniqueHeroShots}/${state.heroShots}`);
    assert(state.minFont>=16,`${slug}: game page text below 16px: ${JSON.stringify(state.smallFonts)}`);
    assert(state.reviewContainers===1,`${slug}: external reviews are not inside one list card`);
    assert(!pageErrors.length,`${slug}: browser errors: ${pageErrors.slice(0,3).join(' | ')}`);
    await page.close();

    const article=await browser.newPage();await article.setViewport({width:1440,height:1000,deviceScaleFactor:1});
    const articleErrors=[];article.on('pageerror',error=>articleErrors.push(String(error?.stack||error)));
    await article.goto(`http://127.0.0.1:4175/article/${slug}/?smoke=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
    await article.waitForFunction(()=>document.querySelector('.article-lead')&&document.querySelectorAll('.article-shot-card__caption').length>=7,{timeout:15000,polling:150});
    await new Promise(resolve=>setTimeout(resolve,250));
    const articleState=await article.evaluate(()=>{
      const images=[...document.querySelectorAll('.article-shot-card img')].map(img=>img.currentSrc||img.src).filter(Boolean);
      const captions=[...document.querySelectorAll('.article-shot-card__caption')];
      const paragraphs=[...document.querySelectorAll('.article-body p')];
      const captionSizes=captions.map(node=>parseFloat(getComputedStyle(node).fontSize));
      const paragraphSizes=paragraphs.map(node=>parseFloat(getComputedStyle(node).fontSize));
      const captionColors=new Set(captions.map(node=>getComputedStyle(node).color));
      const bodyColors=new Set(paragraphs.map(node=>getComputedStyle(node).color));
      return {images,uniqueImages:new Set(images.map(url=>url.split('?')[0])).size,captions:captions.map(node=>node.textContent.trim()),captionMin:captionSizes.length?Math.min(...captionSizes):0,paragraphMin:paragraphSizes.length?Math.min(...paragraphSizes):0,captionColors:[...captionColors],bodyColors:[...bodyColors],lead:document.querySelector('.article-lead')?.textContent?.trim()||'',title:document.querySelector('.article-hero h1')?.textContent?.trim()||''};
    });
    assert(articleState.images.length>=7,`${slug} article: only ${articleState.images.length} screenshots`);
    assert(articleState.uniqueImages===articleState.images.length,`${slug} article: duplicate screenshots ${articleState.uniqueImages}/${articleState.images.length}`);
    assert(articleState.images.every(url=>url.includes(`/apps/${appid}/`)),`${slug} article: screenshot from wrong Steam app`);
    assert(articleState.captionMin>=16,`${slug} article: caption font ${articleState.captionMin}px`);
    assert(articleState.paragraphMin>=16,`${slug} article: body font ${articleState.paragraphMin}px`);
    assert(!articleState.title.includes('&#x20;'),`${slug} article: malformed heading entity remains`);
    if(slug==='elden-ring'){
      assert(new Set(articleState.captions).size===articleState.captions.length,'elden-ring article: repeated screenshot captions remain');
      assert(articleState.captions.every(text=>!/^Официальный игровой скриншот Elden Ring из Steam\.?$/i.test(text)),'elden-ring article: generic repeated captions remain');
      assert(/кооператив|вторжен|онлайн|сетев/i.test(articleState.lead)||/кооператив|вторжен|онлайн|сетев/i.test(document.body?.textContent||''),'elden-ring article: network layer not explained');
    }
    assert(!articleErrors.length,`${slug} article: browser errors: ${articleErrors.slice(0,3).join(' | ')}`);
    await article.close();
  }

  const japan=await browser.newPage();await japan.setViewport({width:1440,height:1000});await japan.goto(`http://127.0.0.1:4175/game/3-japan-stigmatized-property/?smoke=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});await japan.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim(),{timeout:15000});
  const japanState=await japan.evaluate(()=>({title:document.querySelector('#gameTitle')?.textContent||'',details:document.querySelector('#details')?.textContent||''}));
  assert(japanState.title==='Japan Stigmatized Property 3',`Japan public title is wrong: ${japanState.title}`);
  assert(!/[\u3040-\u30ff\u3400-\u9fff]/.test(japanState.title+japanState.details),`Japan public page still exposes Japanese metadata: ${japanState.title} ${japanState.details}`);
  await japan.close();

  console.log(JSON.stringify({checked_games:games.map(([slug])=>slug),japan:japanState,errors},null,2));
  if(errors.length)throw new Error(`Game/article QA smoke failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
