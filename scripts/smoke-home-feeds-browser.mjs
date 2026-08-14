import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.cwd();
const remoteBase=String(process.env.HOME_FEEDS_SMOKE_BASE_URL||'').trim();
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp']]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);

function safePath(raw){
  const decoded=decodeURIComponent(String(raw||'/').split('?')[0]);
  const normalized=decoded.replace(/^\/Igropoisk(?=\/|$)/,'')||'/';
  const requested=normalized.endsWith('/')?`${normalized}index.html`:normalized;
  const absolute=path.resolve(root,`.${requested}`);
  return absolute.startsWith(root)?absolute:null;
}
function localServer(){return http.createServer((request,response)=>{const file=safePath(request.url);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end('Not found');return}response.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');response.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(response)})}

let server=null;
let baseUrl=remoteBase;
if(!baseUrl){server=localServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4174,'127.0.0.1',resolve)});baseUrl='http://127.0.0.1:4174/'}
if(!baseUrl.endsWith('/'))baseUrl+='/';
const executablePath=browserPath();
if(!executablePath){if(server)server.close();throw new Error('Chrome/Chromium executable was not found.')}
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];
const assert=(condition,message)=>{if(!condition)errors.push(message)};

try{
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error?.stack||error)));
  await page.setCacheEnabled(false);
  await page.goto(new URL(`?smoke=${Date.now()}`,baseUrl).href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>{
    const popular=document.querySelector('#popular');
    const popularSettled=['ready','error'].includes(popular?.dataset?.popularState||'');
    return popularSettled&&document.querySelectorAll('#reviewsOfDayRail .review-day-mini').length>=6;
  },{timeout:30000,polling:200});
  await page.waitForFunction(()=>document.querySelectorAll('[data-home-hero-rating]').length===1&&document.querySelectorAll('[data-home-hero-rating] .home-hero-rating__row').length>4,{timeout:10000,polling:100});
  await sleep(500);

  const state=await page.evaluate(()=>{
    const style=node=>node?getComputedStyle(node):null;
    const heroPanels=[...document.querySelectorAll('[data-home-hero-rating]')];
    const heroPanel=heroPanels[0]||null;
    const heroList=heroPanel?.querySelector('.home-hero-rating__list')||null;
    const heroCopy=document.querySelector('.hero-copy');
    const reviews=document.querySelector('.reviews-of-day');
    const releases=document.querySelector('.home-releases');
    const popular=document.querySelector('#popular');
    const popularTitles=[...document.querySelectorAll('#popular .popular-card h3')];
    const popularMeta=[...document.querySelectorAll('#popular .popular-meta span')];
    const reviewText=[...document.querySelectorAll('.review-day-card__dek,.review-day-mini span')];
    const calendar=document.querySelector('.home-showcase-heading--split a[href="calendar/"]');
    const next=document.querySelector('[data-controls-for="popular"] [data-direction="next"]');
    if(popular){popular.scrollLeft=Math.max(0,popular.scrollWidth-popular.clientWidth);popular.dispatchEvent(new Event('scroll'))}
    return {
      popularRuntimeState:popular?.dataset?.popularState||'',
      popularCards:document.querySelectorAll('#popular .popular-card').length,
      popularImages:document.querySelectorAll('#popular .popular-card img').length,
      popularUniqueTitles:new Set(popularTitles.map(node=>node.textContent.trim())).size,
      popularTitleMin:popularTitles.length?Math.min(...popularTitles.map(node=>parseFloat(style(node).fontSize))):0,
      popularMetaMin:popularMeta.length?Math.min(...popularMeta.map(node=>parseFloat(style(node).fontSize))):0,
      popularCardWidth:document.querySelector('#popular .popular-card')?.getBoundingClientRect().width||0,
      heroPanels:heroPanels.length,
      heroRows:document.querySelectorAll('[data-home-hero-rating] .home-hero-rating__row').length,
      heroCovers:document.querySelectorAll('[data-home-hero-rating] .home-hero-rating__cover img').length,
      heroHeading:heroPanel?.querySelector('.top250-home-title')?.textContent?.trim()||'',
      heroKicker:heroPanel?.querySelector('.top250-home-kicker')?.textContent?.trim()||'',
      heroListOverflowY:style(heroList)?.overflowY||'',
      heroListClientHeight:heroList?.clientHeight||0,
      heroListScrollHeight:heroList?.scrollHeight||0,
      heroPanelLeft:heroPanel?.getBoundingClientRect().left||0,
      heroCopyRight:heroCopy?.getBoundingClientRect().right||0,
      heroBackdrop:style(heroPanel)?.backdropFilter||style(heroPanel)?.webkitBackdropFilter||'none',
      glyphs:document.querySelectorAll('.home-showcase-heading__icon').length,
      reviewMinis:document.querySelectorAll('#reviewsOfDayRail .review-day-mini').length,
      reviewMain:Boolean(document.querySelector('#reviewsOfDayMain .review-day-card')),
      reviewTextMin:reviewText.length?Math.min(...reviewText.map(node=>parseFloat(style(node).fontSize))):0,
      reviewsHeight:reviews?.getBoundingClientRect().height||0,
      releasesHeight:releases?.getBoundingClientRect().height||0,
      releaseCards:document.querySelectorAll('#releaseHomeGrid .home-release-card').length,
      releaseImages:document.querySelectorAll('#releaseHomeGrid .home-release-card img').length,
      calendarClass:calendar?.classList.contains('ig-button')||false,
      calendarFont:parseFloat(style(calendar)?.fontSize||'0'),
      nextDisabledBeforeFrame:Boolean(next?.disabled)
    };
  });
  await sleep(100);
  const nextDisabled=await page.evaluate(()=>Boolean(document.querySelector('[data-controls-for="popular"] [data-direction="next"]')?.disabled));

  assert(state.popularRuntimeState==='ready',`Popular runtime state: ${state.popularRuntimeState||'missing'}`);
  assert(state.popularCards===20,`Popular cards: ${state.popularCards}/20`);
  assert(state.popularUniqueTitles===20,`Popular unique titles: ${state.popularUniqueTitles}/20`);
  assert(state.popularImages===20,`Popular images: ${state.popularImages}/20`);
  assert(state.popularTitleMin>=18,`Popular title font too small: ${state.popularTitleMin}px`);
  assert(state.popularMetaMin>=16,`Popular meta font too small: ${state.popularMetaMin}px`);
  assert(state.popularCardWidth>=200,`Popular cards too narrow: ${state.popularCardWidth}px`);
  assert(nextDisabled,'Popular next control must disable at the end instead of snapping/bouncing');
  assert(state.heroPanels===1,`Homepage must contain exactly one Top-250 widget, found ${state.heroPanels}`);
  assert(state.heroRows>4,`Top-250 widget must expose the ranking as a scrollable list, rows: ${state.heroRows}`);
  assert(state.heroCovers>=4,`Top-250 widget covers: ${state.heroCovers}`);
  assert(state.heroHeading==='Топ-250',`Top-250 widget heading mismatch: ${state.heroHeading}`);
  assert(state.heroKicker==='Рейтинг Игропоиска',`Top-250 widget kicker mismatch: ${state.heroKicker}`);
  assert(['auto','scroll'].includes(state.heroListOverflowY),`Top-250 list is not vertically scrollable: ${state.heroListOverflowY}`);
  assert(state.heroListScrollHeight>state.heroListClientHeight,`Top-250 list does not overflow inside the widget: ${state.heroListScrollHeight}/${state.heroListClientHeight}`);
  assert(state.heroPanelLeft>=state.heroCopyRight-2,`Hero rating is not positioned to the right (${state.heroPanelLeft} < ${state.heroCopyRight})`);
  assert(state.heroBackdrop&&state.heroBackdrop!=='none',`Hero rating must be translucent/blurred: ${state.heroBackdrop}`);
  assert(state.glyphs===0,`Decorative heading glyphs remain: ${state.glyphs}`);
  assert(state.reviewMinis>=6,`Reviews of day minis: ${state.reviewMinis}/6`);
  assert(state.reviewMain,'Reviews of day main card is missing');
  assert(state.reviewTextMin>=16,`Reviews of day font too small: ${state.reviewTextMin}px`);
  assert(Math.abs(state.reviewsHeight-state.releasesHeight)<=2,`Reviews/releases height mismatch: ${state.reviewsHeight}px vs ${state.releasesHeight}px`);
  assert(state.releaseCards>=1,'Expected at least one globally corroborated release card');
  assert(state.releaseImages===state.releaseCards,`Release images: ${state.releaseImages}/${state.releaseCards}`);
  assert(state.calendarClass,'Calendar action is not an ig-button');
  assert(state.calendarFont>=16,`Calendar action font too small: ${state.calendarFont}px`);

  await page.goto(new URL(`#search`,baseUrl).href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#search')?.classList.contains('active'),{timeout:10000});
  const route=await page.evaluate(()=>({search:document.querySelector('#search')?.classList.contains('active'),home:document.querySelector('#home')?.classList.contains('active'),hash:location.hash}));
  assert(route.search===true&&route.home===false,`First #search navigation failed: ${JSON.stringify(route)}`);
  assert(!pageErrors.length,`Browser errors: ${pageErrors.slice(0,4).join(' | ')}`);

  console.log(JSON.stringify({baseUrl,...state,nextDisabled,searchRoute:route,errors},null,2));
  if(errors.length)throw new Error(`Homepage QA smoke failed:\n- ${errors.join('\n- ')}`);
}finally{
  await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
}
