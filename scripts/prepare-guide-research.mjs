#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/prepare-guide-research.mjs <game-slug>');process.exit(1)}
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const draft=read(`data/drafts/${slug}.json`);const checkedAt=new Date().toISOString();
const title=draft?.identity?.title||slug;const year=Number(String(draft?.release?.date||draft?.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const minimum=4,target=6,maximum=8;
const existing=read(`data/guides/${slug}.json`,{guides:[]});
const canonical=value=>{try{const url=new URL(value);url.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])url.searchParams.delete(key);return `${url.origin}${url.pathname.replace(/\/$/,'')}${url.search}`}catch{return String(value||'')}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const forbiddenDomains=['store.steampowered.com','metacritic.com','opencritic.com','youtube.com','youtu.be','reddit.com'];
const categories=['Начало игры','Механики','Билды','Квесты','Исследование','Боссы','Коллекционные предметы','Производительность'];
const itemSchema={type:'object',additionalProperties:false,required:['publication','title','url','category','description','identity_evidence'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},category:{type:'string'},description:{type:'string'},identity_evidence:{type:'string'}}};
const schema={type:'object',additionalProperties:false,required:['guides'],properties:{guides:{type:'array',minItems:target,items:itemSchema}}};
async function research(){
  if(!process.env.OPENAI_API_KEY)return{guides:[]};
  const prompt=`Найди полезные гайды для точной игры ${title} (${year||'год уточняется'}) для раздела «Гайды» Игропоиска. Используй web search.\n\nНужно ${target}–${maximum} прямых материалов из авторитетных игровых изданий/официальных баз знаний. Разнообразь темы: начало игры, механики, билды, квесты, исследование, боссы, коллекционные предметы, производительность — только если тема реально применима.\n\nПравила:\n- URL ведёт прямо на конкретный гайд по ${title}, а не на главную, поиск, магазин или агрегатор.\n- Материал должен быть именно по этой игре/версии; не смешивай с другой частью серии, DLC или ремейком.\n- Можно использовать walkthrough/guide/wiki/tips/builds здесь: это раздел гайдов, а не рейтинг.\n- Не использовать Steam Store, Metacritic, OpenCritic, Reddit, YouTube и пользовательские отзывы.\n- Не придумывай title, URL или содержание.\n- category выбери кратко; предпочтительно из: ${categories.join(', ')}.\n- identity_evidence объясняет, почему материал относится именно к ${title}.`;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_game_guides',strict:true,schema}}})});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No guide research output');return JSON.parse(text);
}
async function reachable(url){try{const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':'IgropoiskResearchBot/2.0'}});return response.ok}catch{return false}}
let discovered={guides:[]},error='';
try{discovered=await research()}catch(value){error=value.message||String(value)}
const merged=[...(existing.guides||[]),...(discovered.guides||[])];const seen=new Set(),accepted=[],rejected=[];
for(const raw of merged){
  const url=canonical(raw.url);const domain=host(url);const reasons=[];
  if(!raw.title||!url.startsWith('http'))reasons.push('missing title or direct URL');
  if(forbiddenDomains.some(item=>domain===item||domain.endsWith(`.${item}`)))reasons.push(`forbidden domain: ${domain}`);
  if(seen.has(url))reasons.push('duplicate URL');
  if(url.startsWith('http')&&new URL(url).pathname.split('/').filter(Boolean).length<2)reasons.push('URL is not a direct guide path');
  const evidence=`${raw.title||''} ${raw.identity_evidence||''}`.toLowerCase();const titleTokens=title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').split(/\s+/).filter(token=>token.length>2);if(titleTokens.length&&!titleTokens.some(token=>evidence.includes(token)))reasons.push('exact game identity is not evidenced');
  if(!reasons.length&&!(await reachable(url)))reasons.push('guide URL is unavailable');
  if(reasons.length){rejected.push({publication:raw.publication||'',title:raw.title||'',url,reasons});continue}
  seen.add(url);accepted.push({publication:String(raw.publication||domain),title:String(raw.title),url,category:String(raw.category||'Гайд'),description:String(raw.description||''),identity_evidence:String(raw.identity_evidence||''),domain,checked_at:checkedAt});if(accepted.length>=maximum)break;
}
const green=accepted.length>=minimum;const status=green?'green':'red-needs-revision';
write(`data/guides/${slug}.json`,{schema_version:1,game_slug:slug,game_id:draft?.identity?.game_id||'',checked_at:checkedAt,status,minimum,target,accepted:accepted.length,guides:accepted,rejected,comments:green?[]:[error||`Нужно найти ещё ${Math.max(0,minimum-accepted.length)} подтверждённых гайда.`]});
write(`data/parser-runs/guide-research-${slug}.json`,{parser:'guide-research',game_slug:slug,checked_at:checkedAt,status:green?'green':'needs_revision',accepted:accepted.length,minimum,target,comments:green?[]:[error||'Guide corpus needs another research pass.']});
console.log(JSON.stringify({slug,status,accepted:accepted.length,rejected:rejected.length,error:error||null},null,2));
