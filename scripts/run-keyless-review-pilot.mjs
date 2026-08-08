#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const token = process.env.GITHUB_TOKEN || '';
const model = process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini';
const currentYear = new Date().getUTCFullYear();
const target = Math.max(1, Math.min(20, Number((process.argv.find(x=>x.startsWith('--target='))||'--target=10').split('=')[1])));
const limit = Math.max(target, Math.min(20, Number((process.argv.find(x=>x.startsWith('--limit='))||'--limit=20').split('=')[1])));
const p = rel => path.join(root, rel);
const exists = rel => fs.existsSync(p(rel));
const readJson = rel => JSON.parse(fs.readFileSync(p(rel), 'utf8'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(p(rel)), { recursive: true }); fs.writeFileSync(p(rel), text); };
const writeJson = (rel, value) => write(rel, `${JSON.stringify(value, null, 2)}\n`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wordCount = value => (String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const clean = value => String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

const domains = [
  'ign.com','gamespot.com','pcgamer.com','eurogamer.net','polygon.com','gamesradar.com','rockpapershotgun.com','vg247.com',
  'theverge.com','arstechnica.com','destructoid.com','shacknews.com','digitaltrends.com','techradar.com','pushsquare.com',
  'nintendolife.com','gameinformer.com','hardcoregamer.com','cgmagonline.com','gamingtrend.com','gamingbolt.com','windowscentral.com',
  'inverse.com','slantmagazine.com','theguardian.com','kotaku.com','escapistmagazine.com','rpgsite.net','rpgfan.com','mmorpg.com'
];
const preferred = domains.slice(0,18);
const badTitle = /preview|trailer|announcement|release date|everything we know|hands[- ]on|interview|guide|tips|news|rumor|rumour/i;
const reviewTitle = /\breview\b|reviewed|critique|retrospective/i;

async function fetchText(url, { timeout=12000, accept='text/html,*/*' }={}) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  try {
    const response = await fetch(url, { redirect:'follow', signal:controller.signal, headers:{ 'User-Agent':'Mozilla/5.0 (compatible; IgropoiskResearchBot/1.0)', Accept:accept } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match=>{
    const b=match[1];
    const val=tag=>clean((b.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`,'i'))||[,''])[1]);
    return { title:val('title'), url:clean((b.match(/<link>([\s\S]*?)<\/link>/i)||[,''])[1]), description:val('description') };
  }).filter(x=>x.url);
}

async function search(query) {
  try {
    const xml=await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`,{accept:'application/rss+xml,application/xml,text/xml,*/*'});
    return parseRss(xml);
  } catch(error) {
    console.error(`search: ${query}: ${error.message}`);
    return [];
  }
}

function normalizeResult(result) {
  let u;
  try { u=new URL(result.url); } catch { return null; }
  const host=u.hostname.replace(/^www\./,'').toLowerCase();
  if (!domains.some(d=>host===d||host.endsWith(`.${d}`))) return null;
  const title=clean(result.title);
  if (!reviewTitle.test(title) || badTitle.test(title)) return null;
  u.hash=''; ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(k=>u.searchParams.delete(k));
  return { title, url:`${u.origin}${u.pathname}${u.search}`, domain:host, description:clean(result.description) };
}

async function discover(title) {
  const found=new Map();
  const add=results=>{
    for(const raw of results){
      const x=normalizeResult(raw); if(!x) continue;
      if(!found.has(x.url)) found.set(x.url,x);
    }
  };
  add(await search(`\"${title}\" game review`));
  add(await search(`\"${title}\" review score`));
  for(const domain of preferred){
    if(found.size>=10) break;
    add(await search(`site:${domain} \"${title}\" review`));
  }
  const candidates=[...found.values()].slice(0,12);
  const sources=[];
  for(const item of candidates){
    let excerpt=item.description;
    try{
      const html=await fetchText(item.url,{timeout:9000});
      const meta=(html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)||[,''])[1];
      const body=clean(html);
      excerpt=[clean(meta),item.description,body.slice(0,2600)].filter(Boolean).join(' — ').slice(0,3200);
    }catch{}
    if(excerpt.length<90) continue;
    sources.push({id:`source-${sources.length+1}`,name:item.title,url:item.url,domain:item.domain,excerpt});
    if(sources.length>=9) break;
  }
  return sources;
}

async function modelJson(item,sources, correction=''){
  const sourceText=sources.map(s=>`${s.id} | ${s.name} | ${s.domain}\n${s.excerpt}`).join('\n\n');
  const prompt=`Напиши профессиональный обзор Игропоиска на русском языке для игры ${item.title}${item.year?` (${item.year})`:''}. Используй только предоставленные профессиональные источники. Нельзя придумывать факты, продажи, онлайн, патчи, даты или техническое состояние. Если источники расходятся, обозначь это. Синтезируй оценки разных изданий, не копируй и не пересказывай один текст.\n\nНужно ровно 6 смысловых разделов. В каждом ровно 2 развёрнутых абзаца и 2–5 source_ids. Разбери игровой цикл, дизайн/контент, сильные стороны, слабые стороны, технические или сервисные особенности только если они подтверждены, и аудиторию игры. Общий объём минимум 950 русских слов. Дай редакционную оценку score 1–10 с одним знаком. Никакой рекламы.\n${correction?`Исправь ошибки предыдущей попытки: ${correction}\n`:''}\nВерни только JSON без markdown: {title,dek,lead,score,sections:[{heading,paragraphs:[...,...],source_ids:[...]}],verdict:{summary,best_for:[],not_for:[]},methodology}.\n\nИСТОЧНИКИ:\n${sourceText}`;
  let lastError='';
  for(let attempt=0;attempt<4;attempt++){
    const response=await fetch('https://models.github.ai/inference/chat/completions',{method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10'},body:JSON.stringify({model,messages:[{role:'system',content:'Ты редактор игрового издания. Анализируй источники строго и не выдумывай факты.'},{role:'user',content:prompt}],response_format:{type:'json_object'},max_tokens:3900,temperature:.3})});
    const raw=await response.text();
    if(response.ok){ const env=JSON.parse(raw); return JSON.parse(env?.choices?.[0]?.message?.content||'{}'); }
    lastError=`HTTP ${response.status}: ${raw.slice(0,500)}`;
    if(response.status!==429&&response.status<500) break;
    const retry=Number(response.headers.get('retry-after')||0); await sleep(Math.max(7000,retry*1000));
  }
  throw new Error(`GitHub Models ${lastError}`);
}

function validate(a,sources){
  const e=[]; const ids=new Set(sources.map(s=>s.id));
  if(!a?.title||!a?.dek||!a?.lead)e.push('missing title/dek/lead');
  const score=Number(a?.score); if(!Number.isFinite(score)||score<1||score>10)e.push('invalid score');
  if(!Array.isArray(a?.sections)||a.sections.length!==6)e.push(`sections ${a?.sections?.length||0}/6`);
  for(const [i,s] of (a?.sections||[]).entries()){
    if(!s.heading)e.push(`section ${i+1} heading`);
    if(!Array.isArray(s.paragraphs)||s.paragraphs.length!==2)e.push(`section ${i+1} paragraphs`);
    if(wordCount((s.paragraphs||[]).join(' '))<110)e.push(`section ${i+1} short`);
    if(!Array.isArray(s.source_ids)||s.source_ids.length<2||s.source_ids.some(id=>!ids.has(id)))e.push(`section ${i+1} sources`);
  }
  const words=wordCount([a?.lead,...(a?.sections||[]).flatMap(s=>s.paragraphs||[]),a?.verdict?.summary].join(' '));
  if(words<850)e.push(`article short ${words}`); if(!a?.verdict?.summary)e.push('verdict');
  return {errors:e,words};
}

function render(item,a,sources,words){
  const hero=item.image||''; const game=exists(`game/${item.slug}/index.html`)?`/Igropoisk/game/${encodeURIComponent(item.slug)}/`:'';
  const sections=a.sections.map((s,i)=>`<section class="pilot-section" id="section-${i+1}"><div class="pilot-section__num">${String(i+1).padStart(2,'0')}</div><h2>${esc(s.heading)}</h2>${s.paragraphs.map(x=>`<p>${esc(x)}</p>`).join('')}<div class="pilot-section__refs">${s.source_ids.map(id=>`<a href="#${esc(id)}">${esc(id)}</a>`).join(' ')}</div></section>`).join('');
  const src=sources.map((s,i)=>`<a class="pilot-source" id="${esc(s.id)}" href="${esc(s.url)}" target="_blank" rel="noopener"><span>${String(i+1).padStart(2,'0')}</span><div><b>${esc(s.name)}</b><small>${esc(s.domain)}</small></div><strong>↗</strong></a>`).join('');
  const lis=v=>(v||[]).map(x=>`<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="${esc(a.dek)}"><title>${esc(a.title)} — Игропоиск</title><link rel="stylesheet" href="/Igropoisk/article/_shared/pilot-review.css"></head><body><header class="pilot-nav"><a href="/Igropoisk/">ИГРОПОИСК</a><nav><a href="/Igropoisk/top-250/">Топ-250</a>${game?`<a href="${game}">К игре</a>`:''}</nav></header><section class="pilot-hero"${hero?` style="--hero:url(&quot;${esc(hero)}&quot;)"`:''}><div class="pilot-hero__inner"><div class="pilot-kicker">Обзор Игропоиска · пилот Top-250</div><h1>${esc(a.title)}</h1><p>${esc(a.dek)}</p><div class="pilot-meta"><strong>${Number(a.score).toFixed(1)} / 10</strong><span>${sources.length} профессиональных источников</span><span>${words} слов</span></div></div></section><main class="pilot-layout"><article><p class="pilot-lead">${esc(a.lead)}</p>${sections}<section class="pilot-verdict"><div class="pilot-kicker">Вердикт</div><h2>${Number(a.score).toFixed(1)} / 10</h2><p>${esc(a.verdict.summary)}</p><div class="pilot-verdict__grid"><div><h3>Подойдёт</h3><ul>${lis(a.verdict.best_for)}</ul></div><div><h3>Не подойдёт</h3><ul>${lis(a.verdict.not_for)}</ul></div></div></section><section class="pilot-method"><div class="pilot-kicker">Методика</div><p>${esc(a.methodology||'Синтез профессиональных рецензий с привязкой утверждений к источникам.')}</p></section><section class="pilot-sources"><div class="pilot-kicker">Источники</div><h2>Профессиональные материалы</h2>${src}</section></article></main></body></html>`;
}

const results=[]; let published=0;
function finish(){ const status={schema_version:2,generated_at:new Date().toISOString(),provider:'github-models+bing-rss',model,target,limit,published,passed:published>=target,results}; writeJson('data/top-250/keyless-review-pilot-status.json',status); console.log(JSON.stringify(status,null,2)); return status.passed; }
if(!token){results.push({status:'blocked',reason:'GITHUB_TOKEN_missing'});finish();process.exit(2)}
if(!exists('data/top-250/current.json')){results.push({status:'blocked',reason:'top250_missing'});finish();process.exit(2)}
const ranking=readJson('data/top-250/current.json').ranking||[];
for(const item of ranking.slice(0,limit)){
  if(published>=target)break;
  const dataPath=`data/pilot-reviews/${item.slug}.json`, pagePath=`article/${item.slug}/index.html`;
  if(exists(dataPath)&&exists(pagePath)){published++;results.push({rank:item.rank,slug:item.slug,status:'existing'});continue}
  if(Number(item.year||0)>currentYear){results.push({rank:item.rank,slug:item.slug,status:'hold',reason:'future_year'});continue}
  console.log(`\n=== ${item.rank}. ${item.title} ===`);
  const sources=await discover(item.title);
  console.log(`${item.slug}: ${sources.length} professional review sources`);
  if(sources.length<6){results.push({rank:item.rank,slug:item.slug,status:'hold',reason:`review_sources_${sources.length}/6`});continue}
  let generated,check;
  try{
    generated=await modelJson(item,sources); check=validate(generated,sources);
    if(check.errors.length){await sleep(7000);generated=await modelJson(item,sources,check.errors.join('; '));check=validate(generated,sources)}
    if(check.errors.length)throw new Error(check.errors.join('; '));
  }catch(error){results.push({rank:item.rank,slug:item.slug,status:'blocked',reason:String(error.message).slice(0,500)});continue}
  const publicSources=sources.map(({id,name,url,domain})=>({id,name,url,domain,purpose:'professional_review'}));
  const stored={schema_version:'pilot-2',slug:item.slug,game_slug:item.slug,game_id:item.game_id,game_title:item.title,release_year:item.year??null,title:generated.title,dek:generated.dek,lead:generated.lead,score:Number(Number(generated.score).toFixed(1)),hero:item.image||'',author:'Редакция Игропоиска',publication_status:'published',published_at:new Date().toISOString(),reading_time_minutes:Math.max(5,Math.round(check.words/180)),source_gate:{required_editorial:6,accepted_editorial:publicSources.length,passed:true},source_coverage:{available:publicSources.length,materially_used:new Set(generated.sections.flatMap(s=>s.source_ids)).size},methodology:generated.methodology,sections:generated.sections.map((s,i)=>({id:`section-${i+1}`,heading:s.heading,paragraphs:s.paragraphs,source_ids:s.source_ids})),verdict:generated.verdict,sources:publicSources,generation:{provider:'github-models',model,web_search:'bing-rss',generated_at:new Date().toISOString()}};
  writeJson(dataPath,stored);write(pagePath,render(item,stored,publicSources,check.words));published++;results.push({rank:item.rank,slug:item.slug,status:'published',sources:publicSources.length,words:check.words,score:stored.score});
  await sleep(7000);
}
if(!finish())process.exit(2);
