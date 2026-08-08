import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/enrich-game-videos.mjs <slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(2)}
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const draftPath=`data/drafts/${slug}.json`;
const game=read(draftPath);
if(!game?.identity?.title){console.error(`Missing ${draftPath}`);process.exit(2)}
const checkedAt=new Date().toISOString();
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
async function call(body){const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);const data=await response.json();const text=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}
const videoSchema={type:'object',additionalProperties:false,required:['videos'],properties:{videos:{type:'array',minItems:3,maxItems:12,items:{type:'object',additionalProperties:false,required:['title','url','thumbnail','source_url','category','channel','official'],properties:{title:{type:'string'},url:{type:'string'},thumbnail:{type:'string'},source_url:{type:'string'},category:{type:'string',enum:['trailer','gameplay','review','interview','other']},channel:{type:'string'},official:{type:'boolean'}}}}}};
const identity={title:game.identity.title,year:game.release?.date||game.release?.date_text||'',developers:game.companies?.developers||[],publishers:game.companies?.publishers||[],excluded_versions:game.identity?.excluded_versions||game.identity?.excluded_titles||[]};
const found=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:`Найди видеоматериалы для вкладки «Медиа» страницы точной игры. Нужны прямые страницы видео и только материалы об этой версии игры.\n\nИГРА:\n${JSON.stringify(identity,null,2)}\n\nСобери по возможности несколько типов: официальные трейлеры, демонстрации геймплея, профессиональные видеообзоры и интервью/дневники разработчиков. Не смешивай ремейк, ремастер, DLC или продолжение. Для трейлеров и developer diary приоритет официальным каналам издателя/разработчика. Для review — узнаваемым профессиональным игровым изданиям. Для каждого материала верни category. thumbnail должен быть прямым URL изображения, когда он надёжно установлен; иначе пустая строка. source_url должен вести на страницу, подтверждающую происхождение материала. Не придумывай URL.`,text:{format:{type:'json_schema',name:'igropoisk_game_videos',strict:true,schema:videoSchema}}});
const existing=Array.isArray(game.media?.videos)?game.media.videos:[];
const merged=[];
for(const raw of [...existing,...(found.videos||[])]){
  const item=typeof raw==='string'?{title:'Видео',url:raw,thumbnail:'',source_url:raw,category:'other',channel:'',official:false}:raw;
  const url=canonical(item.url||item.source_url);
  if(!url.startsWith('http')||merged.some(other=>canonical(other.url||other.source_url)===url))continue;
  merged.push({title:item.title||'Видео',url:item.url||item.source_url,thumbnail:item.thumbnail||'',source_url:item.source_url||item.url,category:item.category||'other',channel:item.channel||'',official:Boolean(item.official)});
}
const order={trailer:0,gameplay:1,review:2,interview:3,other:4};
merged.sort((a,b)=>(order[a.category]??9)-(order[b.category]??9)||Number(b.official)-Number(a.official)||String(a.title).localeCompare(String(b.title),'ru'));
game.media=game.media||{};
game.media.videos=merged;
game.media.official_video_exists=merged.some(item=>item.official&&item.category==='trailer')||Boolean(game.media.official_video_exists);
game.updated_at=checkedAt;
write(draftPath,game);
const year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||new Date().getUTCFullYear());
const chunk=year<=2015?'2002-2015':year<=2017?'2016-2017':year<=2019?'2018-2019':year===2020?'2020':year<=2022?'2021-2022':'2023-2025';
const chunkPath=`data/game-content/${chunk}.json`;
const chunkData=read(chunkPath);
if(chunkData?.games?.[slug]){chunkData.games[slug].media=chunkData.games[slug].media||{};chunkData.games[slug].media.videos=merged;chunkData.games[slug].media.official_video_exists=game.media.official_video_exists;chunkData.games[slug].updated_at=checkedAt;write(chunkPath,chunkData)}
write(`data/parser-runs/game-videos-${slug}.json`,{parser:'game-video-enrichment',status:merged.length?'success':'blocked',game_slug:slug,checked_at:checkedAt,total:merged.length,categories:Object.fromEntries(['trailer','gameplay','review','interview','other'].map(category=>[category,merged.filter(item=>item.category===category).length])),output:draftPath});
console.log(JSON.stringify({slug,videos:merged.length,categories:Object.fromEntries(['trailer','gameplay','review','interview','other'].map(category=>[category,merged.filter(item=>item.category===category).length]))},null,2));
if(!merged.length)process.exitCode=2;
