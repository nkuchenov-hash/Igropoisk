#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {generateGamePageEditorialJSON} from './lib/game-page-editorial-ai.mjs';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: node scripts/build-game-source-knowledge.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const canonical=v=>{try{const u=new URL(String(v||''));u.hash='';return`${u.origin}${u.pathname}${u.search}`}catch{return clean(v)}};
const entityDecode=v=>String(v||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)||32));
function htmlText(html){
  let s=String(html||'');
  const primary=(s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)||s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||s.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)||[])[1];
  if(primary)s=primary;
  s=s.replace(/<(script|style|svg|noscript|template|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<!--([\s\S]*?)-->/g,' ')
    .replace(/<br\s*\/?\s*>|<\/p>|<\/li>|<\/h[1-6]>/gi,'\n')
    .replace(/<[^>]+>/g,' ');
  return clean(entityDecode(s));
}
async function fetchText(url){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 IgropoiskSourceKnowledge/1.0','accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'}});
    const type=String(r.headers.get('content-type')||'');
    if(!r.ok)return {ok:false,status:r.status,text:'',resolved_url:r.url||url};
    const raw=await r.text();
    const text=/html|xml/i.test(type)||/<html|<body|<article/i.test(raw)?htmlText(raw):clean(raw);
    return {ok:text.length>=180,status:r.status,text:text.slice(0,10000),resolved_url:r.url||url};
  }catch(error){return {ok:false,status:0,text:'',error:error.message,resolved_url:url}}finally{clearTimeout(timer)}
}
const corpus=read(`data/game-sources/${slug}.json`,{});
if(corpus?.discovery?.complete!==true)throw new Error(`${slug}: complete canonical source corpus required before knowledge extraction`);
const draft=read(`data/drafts/${slug}.json`),parser=read(`data/parser-output/${slug}.json`,{}),matrix=read(`data/research/${slug}-source-matrix.json`,{});
if(!draft?.identity?.title)throw new Error(`${slug}: draft missing`);
const byUrl=new Map();
const add=(raw={})=>{
  const url=canonical(raw.resolved_url||raw.url||raw.source_url||'');if(!url)return;
  const old=byUrl.get(url)||{};
  const semantic=[raw.description,raw.snippet,raw.summary,raw.excerpt,raw.identity_evidence,...(Array.isArray(raw.evidence_points)?raw.evidence_points:[]),...(Array.isArray(raw.praise)?raw.praise:[]),...(Array.isArray(raw.criticism)?raw.criticism:[])].map(clean).filter(Boolean);
  byUrl.set(url,{...old,id:old.id||raw.id||`source-${byUrl.size+1}`,name:clean(raw.name||raw.publication||raw.source_name||old.name),title:clean(raw.title||old.title),url,kind:raw.kind||raw.source_kind||old.kind||'source',professional:Boolean(raw.professional??old.professional),roles:[...new Set([...(old.roles||[]),...(raw.roles||[])])],semantic:[...new Set([...(old.semantic||[]),...semantic])]});
};
for(const s of corpus.sources||[])add(s);
for(const s of matrix.accepted||[])add({...s,professional:true,kind:'professional-review'});
if(draft.links?.official)add({name:'Official site',url:draft.links.official,roles:['facts','description','dna']});
if(draft.links?.store)add({name:'Store',url:draft.links.store,roles:['facts','description','dna']});
const candidates=[...byUrl.values()].filter(s=>s.professional||s.roles?.some(r=>['facts','description','dna','review'].includes(r)));
const fetched=[];
for(let i=0;i<candidates.length;i+=5){
  const batch=candidates.slice(i,i+5);const results=await Promise.all(batch.map(async s=>({s,r:await fetchText(s.url)})));
  for(const {s,r} of results){
    const embedded=clean((s.semantic||[]).join(' '));
    const text=clean([embedded,r.text].filter(Boolean).join('\n'));
    fetched.push({id:s.id,name:s.name,title:s.title,url:s.url,resolved_url:r.resolved_url,kind:s.kind,professional:s.professional,roles:s.roles,http_status:r.status,readable:text.length>=180,text:text.slice(0,10000),text_chars:text.length});
  }
}
const parserEditorial=[parser?.editorial?.short_description,parser?.editorial?.integrated_description,parser?.editorial?.campaign,...(parser?.editorial?.features||[])].map(clean).filter(Boolean).join(' ');
if(parserEditorial.length>=60){fetched.push({id:'structured-parser-description',name:parser?.source?.name||'Structured parser source',title:`${draft.identity.title} structured description`,url:parser?.source?.url||draft.links?.store||'',resolved_url:parser?.source?.url||draft.links?.store||'',kind:'structured-description',professional:false,roles:['facts','description','dna'],http_status:200,readable:true,text:parserEditorial.slice(0,10000),text_chars:parserEditorial.length})}
const readable=fetched.filter(s=>s.readable);
const sourceContent={schema_version:1,game_slug:slug,game_id:draft.game_id||corpus.game_id||null,title:draft.identity.title,generated_at:new Date().toISOString(),source_scan_complete:true,total_candidates:fetched.length,readable_sources:readable.length,sources:fetched};
sourceContent.content_hash=crypto.createHash('sha256').update(JSON.stringify(readable.map(s=>[s.id,s.url,s.text]))).digest('hex');
write(`data/game-source-content/${slug}.json`,sourceContent);
if(readable.length<3)throw new Error(`${slug}: only ${readable.length} readable semantic sources; at least 3 required`);
const compact=readable.map(s=>({id:s.id,publication:s.name,title:s.title,url:s.url,professional:s.professional,text:s.text.slice(0,7500)}));
const {data,provider,model}=await generateGamePageEditorialJSON({
  system:'Ты аналитик базы знаний об играх. Извлекай только факты, прямо подтверждённые переданными источниками. Не используй память модели. Возвращай только JSON.',
  temperature:0.1,maxTokens:7000,
  prompt:`Собери структурированное понимание игры ${draft.identity.title} из содержимого источников. Не пиши обзор и не оценивай игру от себя. Объедини повторяющиеся наблюдения, выдели главное и привяжи каждое определяющее утверждение к source_ids. Никаких фактов, которых нет в тексте источников.\n\nВерни JSON строго с полями:\ngame_essence (строка), player_role (строка), core_loop (строка), progression_structure (строка), world_structure (строка), mechanics (массив строк), distinctive_features (массив строк), consensus_praise (массив строк), consensus_criticism (массив строк), defining_claims (массив объектов {claim,source_ids}).\nТребования: defining_claims 4–8; каждый claim конкретный и определяющий игру; source_ids содержит минимум один реально переданный id; game_essence должен объяснять игру содержательно, а не перечислять жанры.\n\nФактические метаданные:\n${JSON.stringify({identity:draft.identity,release:draft.release,companies:draft.companies,classification:draft.classification},null,2)}\n\nПрочитанные источники:\n${JSON.stringify(compact,null,2)}`
});
const validIds=new Set(readable.map(s=>String(s.id)));
const claims=(Array.isArray(data?.defining_claims)?data.defining_claims:[]).map(x=>({claim:clean(x?.claim),source_ids:[...new Set((x?.source_ids||[]).map(String).filter(id=>validIds.has(id)))]})).filter(x=>x.claim.length>=25&&x.source_ids.length);
const arr=k=>Array.isArray(data?.[k])?data[k].map(clean).filter(Boolean).slice(0,12):[];
const knowledge={schema_version:1,game_slug:slug,game_id:draft.game_id||corpus.game_id||null,title:draft.identity.title,generated_at:new Date().toISOString(),status:claims.length>=4?'green':'needs_revision',provider,model,source_content:`data/game-source-content/${slug}.json`,source_content_hash:sourceContent.content_hash,source_count:readable.length,professional_source_count:readable.filter(x=>x.professional).length,game_essence:clean(data?.game_essence),player_role:clean(data?.player_role),core_loop:clean(data?.core_loop),progression_structure:clean(data?.progression_structure),world_structure:clean(data?.world_structure),mechanics:arr('mechanics'),distinctive_features:arr('distinctive_features'),consensus_praise:arr('consensus_praise'),consensus_criticism:arr('consensus_criticism'),defining_claims:claims};
if(knowledge.game_essence.length<80||claims.length<4)knowledge.status='needs_revision';
write(`data/game-knowledge/${slug}.json`,knowledge);
write(`data/parser-runs/game-source-knowledge-${slug}.json`,{parser:'game-source-knowledge-v1',game_slug:slug,status:knowledge.status,checked_at:knowledge.generated_at,provider,model,readable_sources:readable.length,professional_sources:knowledge.professional_source_count,defining_claims:claims.length,output:`data/game-knowledge/${slug}.json`});
console.log(JSON.stringify({slug,status:knowledge.status,provider,model,readable_sources:readable.length,professional_sources:knowledge.professional_source_count,defining_claims:claims.length,game_essence:knowledge.game_essence},null,2));
if(knowledge.status!=='green')process.exitCode=2;
