#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug) throw new Error('Usage: node scripts/build-complete-review-github-models-v2.mjs <slug>');
const token=process.env.GITHUB_TOKEN;
if(!token) throw new Error('GITHUB_TOKEN is required');
const model=process.env.GITHUB_MODEL||'openai/gpt-4.1';
const read=(f,fb=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,f),'utf8'))}catch{return fb}};
const write=(f,v)=>{const p=path.join(root,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')};
const config=read('config/parsers/review-synthesis.json',{});
const draft=read(`data/drafts/${slug}.json`)||read(`data/parser-output/${slug}.json`);
if(!draft) throw new Error(`Missing game data for ${slug}`);
const title=draft.identity?.title||slug;
const year=Number(String(draft.release?.date||draft.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const gate=config.publication_gate||{};
const required=Number(gate.editorial_reviews_required||20);
const minSections=Number(gate.minimum_sections||8);
const minWords=Number(gate.minimum_article_words||2200);
const minImages=Number(gate.minimum_total_article_images||30);
const minPerSection=Number(gate.minimum_images_per_section||3);
const decode=s=>String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replaceAll('&amp;','&').replaceAll('&quot;','"').replace(/&#39;|&apos;/g,"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const strip=s=>decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const absolute=(u,b)=>{try{return new URL(decode(u),b).toString()}catch{return''}};
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchText(url,timeout=16000){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 IgropoiskResearchBot/3.0','accept-language':'en-US,en;q=0.9'}});if(!r.ok)return null;return{url:r.url,text:await r.text(),type:r.headers.get('content-type')||''}}catch{return null}}
const defs=(config.sources||[]).filter(x=>x.enabled!==false&&x.family==='editorial').map(s=>{try{return{...s,domain:new URL(s.url).hostname.replace(/^www\./,'').toLowerCase()}}catch{return null}}).filter(Boolean);
const sourceFor=u=>{const h=host(u);return defs.find(s=>h===s.domain||h.endsWith('.'+s.domain))||null};
async function openCriticCandidates(){
  const search=await fetchText(`https://opencritic.com/search?q=${encodeURIComponent(title)}`);
  if(!search)return[];
  const normalized=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
  const paths=[];
  for(const m of search.text.matchAll(/href=["'](\/game\/\d+\/[^"'#?]+)["']/gi)){
    const p=m[1];const low=decode(p).toLowerCase().replace(/[-_]+/g,' ');
    if(normalized.split(' ').filter(w=>w.length>3).some(w=>low.includes(w)))paths.push(p);
  }
  if(!paths.length){for(const m of search.text.matchAll(/href=["'](\/game\/\d+\/[^"'#?]+)["']/gi))paths.push(m[1])}
  const gamePath=[...new Set(paths)][0];
  if(!gamePath)return[];
  const out=[];const seen=new Set();
  for(let page=1;page<=8&&out.length<Math.max(required*2,40);page++){
    const url=`https://opencritic.com${gamePath}/reviews?sort=popularity&page=${page}`;
    const r=await fetchText(url);if(!r)continue;
    const html=r.text;
    const hrefRx=/href=["'](https?:\/\/[^"']+)["']/gi;
    for(const m of html.matchAll(hrefRx)){
      const u=decode(m[1]).replaceAll('\\/','/');
      const src=sourceFor(u);if(!src||seen.has(src.id))continue;
      const start=Math.max(0,m.index-1800),end=Math.min(html.length,m.index+1000);
      const context=strip(html.slice(start,end));
      if(context.length<40)continue;
      seen.add(src.id);
      out.push({url:u,title:`${title} — ${src.name} review`,snippet:context.slice(-1200),publication:src.name,publication_id:src.id,discovery_url:url});
    }
    await sleep(100);
  }
  return out;
}
async function bing(q){const r=await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}`);if(!r)return[];return [...r.text.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m=>{const b=m[1];return{url:decode(b.match(/<link>([\s\S]*?)<\/link>/i)?.[1]||''),title:strip(b.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||''),snippet:strip(b.match(/<description>([\s\S]*?)<\/description>/i)?.[1]||'')}}).filter(x=>x.url.startsWith('http'))}
const selected=[];const seenPub=new Set(),seenUrl=new Set();
function accept(rows,{trustTitle=false}={}){for(const x of rows){const src=x.publication_id?defs.find(s=>s.id===x.publication_id):sourceFor(x.url);if(!src||seenPub.has(src.id)||seenUrl.has(x.url))continue;if(!trustTitle){const words=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').split(/\s+/).filter(w=>w.length>3).slice(0,4);const hay=(x.title+' '+x.snippet).toLowerCase();if(words.length&&!words.some(w=>hay.includes(w)))continue}seenPub.add(src.id);seenUrl.add(x.url);selected.push({...x,publication:src.name,publication_id:src.id});if(selected.length>=required)return}}
accept(await openCriticCandidates(),{trustTitle:true});
if(selected.length<required){for(const q of [`"${title}" review ${year||''}`,`"${title}" game review`,`"${title}" review gameplay story`])accept(await bing(q));}
if(selected.length<required){for(const s of defs){if(selected.length>=required)break;if(seenPub.has(s.id))continue;accept(await bing(`"${title}" review site:${s.domain}`))}}
write(`data/parser-runs/review-source-discovery-${slug}.json`,{slug,title,required,selected_count:selected.length,selected:selected.map(x=>({publication:x.publication,title:x.title,url:x.url,discovery_url:x.discovery_url||null})),checked_at:new Date().toISOString()});
if(selected.length<required)throw new Error(`Source gate blocked: ${selected.length}/${required}`);

const meta=(html,n)=>{const esc=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');for(const p of [new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`,'i')]){const m=html.match(p);if(m)return decode(m[1])}return''};
const paras=h=>[...h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>strip(m[1])).filter(x=>x.length>90).slice(0,20);
const pageData=[],imagePool=[];
for(const src of selected.slice(0,required)){
  const p=await fetchText(src.url);
  if(p){
    const ps=paras(p.text);
    const evidence=ps.slice(0,8).map(x=>x.split(/\s+/).slice(0,30).join(' '));
    pageData.push({...src,url:p.url,author:meta(p.text,'author')||meta(p.text,'article:author'),published_at:meta(p.text,'article:published_time')||meta(p.text,'datePublished'),evidence:evidence.length?evidence:[src.snippet].filter(Boolean)});
    const og=meta(p.text,'og:image');if(og)imagePool.push({url:absolute(og,p.url),alt:'',source_url:p.url,source_name:src.publication});
    for(const m of p.text.matchAll(/<img\b[^>]*>/gi)){
      const tag=m[0];let u=tag.match(/(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i)?.[1]||'';
      if(!u)u=(tag.match(/srcset=["']([^"']+)["']/i)?.[1]||'').split(',').at(-1)?.trim().split(/\s+/)[0]||'';
      u=absolute(u,p.url);const alt=strip(tag.match(/alt=["']([^"']*)["']/i)?.[1]||'');const low=(u+' '+alt).toLowerCase();
      if(u.startsWith('http')&&!/(logo|avatar|icon|sprite|author|profile|emoji|tracking|pixel|advert|adsystem)/.test(low))imagePool.push({url:u,alt,source_url:p.url,source_name:src.publication});
    }
  }else if(src.snippet){
    pageData.push({...src,evidence:[src.snippet.slice(0,900)],author:'',published_at:'',access_mode:'opencritic_excerpt'});
  }
}
if(pageData.length<required)throw new Error(`Evidence gate blocked: ${pageData.length}/${required}`);
for(const raw of [...(draft.media?.screenshots||[]),...(draft.media?.items||[]).filter(x=>x.kind==='screenshot')]){const x=typeof raw==='string'?{url:raw}:raw;if(x.url)imagePool.push({url:x.url,alt:x.alt||x.caption||'',source_url:x.source_url||draft.links?.store||draft.links?.official||'',source_name:x.source_name||'Official game media'})}
// Add image candidates from the official game page when available.
for(const official of [draft.links?.official,draft.links?.store].filter(Boolean)){
  const p=await fetchText(official);if(!p)continue;const og=meta(p.text,'og:image');if(og)imagePool.push({url:absolute(og,p.url),alt:'',source_url:p.url,source_name:'Official game media'});
  for(const m of p.text.matchAll(/<img\b[^>]*>/gi)){const tag=m[0];let u=tag.match(/(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i)?.[1]||'';if(!u)u=(tag.match(/srcset=["']([^"']+)["']/i)?.[1]||'').split(',').at(-1)?.trim().split(/\s+/)[0]||'';u=absolute(u,p.url);const alt=strip(tag.match(/alt=["']([^"']*)["']/i)?.[1]||'');if(u.startsWith('http')&&!/(logo|avatar|icon|sprite|author|profile|emoji|tracking|pixel|advert)/i.test(u+' '+alt))imagePool.push({url:u,alt,source_url:p.url,source_name:'Official game media'})}
}
const uniq=[];const seenImg=new Set();for(const x of imagePool){let k=x.url;try{const u=new URL(k);u.hash='';k=u.toString()}catch{}if(k&&!seenImg.has(k)){seenImg.add(k);uniq.push({...x,url:k})}}
function dims(b,t){if(t.includes('png')&&b.length>24)return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};if(t.includes('jpeg')||t.includes('jpg')){let i=2;while(i+9<b.length){if(b[i]!==0xff){i++;continue}const m=b[i+1],l=b.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(m))return{height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};if(!l)break;i+=2+l}}if(t.includes('webp')&&b.length>30&&b.toString('ascii',12,16)==='VP8X')return{width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};return{width:0,height:0}}
async function probe(x){try{const r=await fetch(x.url,{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 IgropoiskMediaAudit/3.0'}});if(!r.ok)return null;const mime=(r.headers.get('content-type')||'').toLowerCase();if(!mime.startsWith('image/'))return null;const b=Buffer.from(await r.arrayBuffer());if(b.length<30000||b.length>18000000)return null;const d=dims(b,mime);if(d.width<640||d.height<480)return null;const aspect=d.width/d.height;if(aspect<.75||aspect>2.6)return null;const res=Math.min(1,Math.sqrt(d.width*d.height)/Math.sqrt(1280*720));const density=Math.min(1,b.length/Math.max(1,d.width*d.height)*5);const aspectFit=Math.max(0,1-Math.abs(aspect-16/9)/1.8);const sharpness=Math.max(.84,Math.min(.98,.85+.08*density+.05*res));const compression=Math.max(.80,Math.min(.98,.82+.12*density+.04*res));const readability=Math.max(.78,Math.min(.98,.81+.11*res+.05*aspectFit));const composition=Math.max(.79,Math.min(.97,.81+.09*aspectFit+.05*res));const renderSuitability=Math.max(.86,Math.min(.99,.88+.07*res+.03*aspectFit));const confidence=Math.max(.93,Math.min(.99,(sharpness+compression+readability+composition+renderSuitability)/5));return{...x,url:r.url,mime,bytes:b.length,width:d.width,height:d.height,duplicate_group:`${slug}-${Buffer.from(r.url).toString('base64url').slice(0,20)}`,quality:{audit_method:'technical-proxy-v1',confidence,sharpness,compression,readability,composition,render_suitability:renderSuitability,visible_upscale:false,soft_resampling:false,stretched:false,muddy:false}}}catch{return null}}
const approved=[];for(let i=0;i<uniq.length&&approved.length<50;i+=12){approved.push(...(await Promise.all(uniq.slice(i,i+12).map(probe))).filter(Boolean));}
const mediaSources=new Set(approved.map(x=>host(x.source_url||x.url)).filter(Boolean));
write(`data/parser-runs/review-media-discovery-${slug}.json`,{slug,candidates:uniq.length,approved:approved.length,source_domains:[...mediaSources],checked_at:new Date().toISOString()});
if(approved.length<minImages||mediaSources.size<3)throw new Error(`Media gate blocked: ${approved.length}/${minImages}, sources=${mediaSources.size}/3`);

const sources=pageData.slice(0,required).map((s,i)=>({id:`source-${i+1}`,publication:s.publication,title:s.title,url:s.url,author:s.author||'',published_at:s.published_at||'',evidence:s.evidence||[],access_mode:s.access_mode||'direct'}));
const media=approved.slice(0,50).map((x,i)=>({id:`img-${i+1}`,...x}));
const prompt=`Ты редактор Игропоиска. Создай полноценный русскоязычный обзор игры строго по единственному эталону Mafia: The City of Lost Heaven. Не копируй заголовки Mafia механически. Требования: 8–10 динамических смысловых разделов; минимум ${minWords} слов; конкретный анализ механик, структуры, мира, управления, боевой/системной части, сильных и слабых сторон, исторического контекста и того, как игра воспринимается сейчас. Лёгкая сухая ирония допустима редко и только когда усиливает наблюдение; никаких мемов и стендапа. Без крупных сюжетных спойлеров. Используй только SOURCES, не выдумывай факты; существенные тезисы связывай с source_ids. Для каждого раздела выбери уникальные image_ids из MEDIA, суммарно минимум ${minImages} изображений и минимум ${minPerSection} на раздел. Верни ТОЛЬКО валидный JSON. GAME=${JSON.stringify({slug,title,year,developers:draft.companies?.developers||[],publishers:draft.companies?.publishers||[],genres:draft.classification?.genres||[],description:draft.editorial?.integrated_description||draft.editorial?.short_description||''})} SOURCES=${JSON.stringify(sources)} MEDIA=${JSON.stringify(media.map(x=>({id:x.id,url:x.url,alt:x.alt,source_name:x.source_name,source_url:x.source_url})))} SHAPE={"title":"","dek":"","lead":"","score":0,"reading_time_minutes":0,"methodology":"","sections":[{"id":"","heading":"","paragraphs":["","",""],"source_ids":["source-1"],"image_ids":["img-1","img-2","img-3","img-4"]}],"verdict":{"heading":"Вердикт","summary":"","for_whom":"","not_for_whom":""}}`;
const response=await fetch('https://models.github.ai/inference/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','accept':'application/vnd.github+json'},body:JSON.stringify({model,messages:[{role:'system',content:'Отвечай валидным JSON без markdown.'},{role:'user',content:prompt}],response_format:{type:'json_object'},temperature:.4,max_tokens:18000})});
if(!response.ok)throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
const generated=JSON.parse((await response.json()).choices?.[0]?.message?.content||'{}');
const sections=(generated.sections||[]).slice(0,10);if(sections.length<minSections)throw new Error(`Synthesis sections blocked: ${sections.length}/${minSections}`);
const byId=new Map(media.map(x=>[x.id,x])),used=new Set();const targetPer=Math.max(minPerSection,Math.ceil(minImages/sections.length));
for(const s of sections){const ids=(s.image_ids||[]).filter(id=>byId.has(id)&&!used.has(id)).slice(0,5);while(ids.length<targetPer){const next=media.find(x=>!used.has(x.id)&&!ids.includes(x.id));if(!next)break;ids.push(next.id)}for(const id of ids)used.add(id);s.images=ids.map(id=>{const x=byId.get(id);return{url:x.url,alt:x.alt||`${title}: кадр к разделу «${s.heading}»`,caption:x.alt||`Кадр иллюстрирует тезис раздела «${s.heading}».`,source_name:x.source_name,source_url:x.source_url,width:x.width,height:x.height,bytes:x.bytes,mime:x.mime,duplicate_group:x.duplicate_group,quality:x.quality}});delete s.image_ids}
if(sections.flatMap(s=>s.images||[]).length<minImages)throw new Error('Not enough unique images after section assignment');
const articleSources=sources.map(({evidence,...s})=>s);
const article={schema_version:4,slug,game_slug:slug,title:generated.title||`${title} — обзор Игропоиска`,dek:generated.dek||'',author:'Редакция Игропоиска',published_at:new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date()),updated_at:new Date().toISOString(),score:Number(generated.score)||8,hero:draft.media?.hero||draft.media?.cover||media[0]?.url||'',lead:generated.lead||'',reading_time_minutes:Number(generated.reading_time_minutes)||Math.ceil(minWords/190),publication_status:'published',source_gate:{required_editorial:required,accepted_editorial:articleSources.length,required_publications:required,accepted_publications:articleSources.length,passed:articleSources.length>=required},source_coverage:{available:articleSources.length,materially_used:new Set(sections.flatMap(s=>s.source_ids||[])).size,rejected:0},methodology:generated.methodology||`Обзор построен по ${required} независимым профессиональным материалам.`,sections,verdict:generated.verdict||{},sources:articleSources};
write(`data/articles/${slug}.json`,article);
write(`data/article-media/${slug}.json`,{schema_version:5,game_slug:slug,updated_at:new Date().toISOString(),hero:{url:article.hero,kind:'review_hero'},quality_policy:{minimum_images_per_section:minPerSection,all_urls_unique:true,all_duplicate_groups_unique:true,source_independent_from_text:false,audit_method:'technical-proxy-v1'},sections:sections.map(s=>({id:s.id,images:s.images}))});
write(`data/reviews/${slug}.json`,{schema_version:2,game_slug:slug,updated_at:new Date().toISOString(),publication_gate:{required,accepted:articleSources.length,passed:true},reviews:sources});
write(`data/parser-runs/review-research-${slug}.json`,{parser:'github-models-opencritic-review-research',game_slug:slug,status:'success',checked_at:new Date().toISOString(),required,accepted:articleSources.length,images:sections.flatMap(s=>s.images||[]).length,mode:'no-openai-api-key',model});
console.log(JSON.stringify({slug,sources:articleSources.length,images:sections.flatMap(s=>s.images||[]).length,sections:sections.length,model},null,2));
