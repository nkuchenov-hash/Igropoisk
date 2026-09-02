import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const base=String(process.env.FALLOUT2_SMOKE_BASE_URL||process.env.DOOM_SMOKE_BASE_URL||'https://nkuchenov-hash.github.io/Igropoisk/').replace(/\/+$/,'');
const browserPath=()=>[process.env.CHROME_PATH,'/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
const executablePath=browserPath();
if(!executablePath)throw new Error('Chrome/Chromium executable was not found.');
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:1100});
  await page.setCacheEnabled(false);
  const url=`${base}/game/fallout-2/?media-smoke=${Date.now()}`;
  let ready=false,lastError='';
  for(let attempt=1;attempt<=3&&!ready;attempt++){
    try{
      await page.goto(`${url}&attempt=${attempt}`,{waitUntil:'domcontentloaded',timeout:45000});
      await page.waitForFunction(()=>document.querySelector('#gameTitle')?.textContent?.trim()==='Fallout 2',{timeout:45000});
      await page.waitForFunction(()=>document.querySelectorAll('#mediaArt img').length>=4,{timeout:45000});
      await page.waitForSelector('.game-tabs [data-tab="media"]',{timeout:45000});
      ready=true;
    }catch(error){lastError=String(error?.message||error);if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1500));}
  }
  if(!ready)throw new Error(`Fallout 2 runtime did not hydrate after retries: ${lastError}`);
  await page.evaluate(()=>document.querySelector('.game-tabs [data-tab="media"]')?.click());
  await page.waitForFunction(()=>document.querySelector('#media')?.classList.contains('active'),{timeout:15000});
  await new Promise(resolve=>setTimeout(resolve,800));
  const state=await page.evaluate(()=>{
    const grid=document.querySelector('#mediaArt');
    const imgs=[...(grid?.querySelectorAll('img')||[])].map(img=>img.currentSrc||img.src||'');
    const cards=grid?[...grid.children].filter(node=>node.nodeType===1).length:0;
    const count=Number(document.querySelector('#artCount')?.textContent?.trim()||0);
    return {imgs,cards,count,title:document.body.dataset.title||document.querySelector('#gameTitle')?.textContent?.trim()||document.title||'',mediaActive:document.querySelector('#media')?.classList.contains('active')||false};
  });
  const bad=state.imgs.filter(url=>/landing-pages\.gog-statics\.com\/assets\/images\/hero-image\.png|storepagebackground\/app\//i.test(url));
  const errors=[];
  if(!/Fallout 2/i.test(state.title))errors.push(`Wrong title: ${state.title}`);
  if(!state.mediaActive)errors.push('Media tab did not activate after hydrated click.');
  if(bad.length)errors.push(`Blocked blue/background assets remain in artwork: ${bad.join(', ')}`);
  if(state.cards<4)errors.push(`Artwork gallery unexpectedly small: ${state.cards}`);
  if(state.count!==state.cards)errors.push(`Artwork count mismatch: label=${state.count}, cards=${state.cards}`);
  console.log(JSON.stringify({base,state,bad,errors},null,2));
  if(errors.length)throw new Error(`Fallout 2 media smoke failed:\n- ${errors.join('\n- ')}`);
}finally{await browser.close();}
