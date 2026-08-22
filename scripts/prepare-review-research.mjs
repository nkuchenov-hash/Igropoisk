import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/prepare-review-research.mjs <game-slug>');process.exit(1)}
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const exists=file=>fs.existsSync(path.join(root,file));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const reviewConfig=read('config/parsers/review-synthesis.json');
const quality=read('config/game-page-quality-v2.json');
const corpus=quality.review_corpus||{};
const minimum=Number(corpus.minimum_sources||10),target=Number(corpus.target_sources||20),maximum=Math.max(Number(corpus.maximum_sources||20),30),candidateTarget=Math.max(Number(corpus.candidate_target||36),40);
const draftPath=`data/drafts/${slug}.json`;
if(!exists(draftPath)){console.error(`Missing ${draftPath}`);process.exit(1)}
const game=read(draftPath);const checkedAt=new Date().toISOString();
const title=game.identity?.title||slug;const year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);const historical=year>0&&year<2010;
const configured=(reviewConfig.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial');
const discoveryExtras=[
  {name:'DTF',url:'https://dtf.ru/games'},
  {name:'Дзен',url:'https://dzen.ru/'},
  {name:'VGTimes',url:'https://vgtimes.ru/games/'},
  {name:'VK Play Media',url:'https://media.vkplay.ru/'},
  {name:'iXBT.games',url:'https://ixbt.games/'},
  {name:'GameMAG.ru',url:'https://gamemag.ru/'},
  {name:'Shazoo',url:'https://shazoo.ru/'}
];
const seedPath=`data/reviews/${slug}.json`;const seedFile=exists(seedPath)?read(seedPath):{};const seeds=seedFile.reviews||[];
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const forbiddenTerms=(corpus.forbidden_title_or_url_terms||[]).map(x=>String(x).toLowerCase()).filter(x=>!['opinion','мнение'].includes(x));
const forbiddenDomains=(corpus.forbidden_domains||[]).map(x=>String(x).toLowerCase());
const looksForbidden=raw=>{const hay=`${raw.title||''} ${raw.url||''}`.toLowerCase();if(forbiddenTerms.some(term=>hay.includes(term)))return'non-review content type';const h=host(raw.url);if(forbiddenDomains.some(domain=>h===domain||h.endsWith(`.${domain}`)))return`forbidden domain: ${h}`;return''};
const scorePresent=raw=>(Number.isFinite(Number(raw.score))&&Number.isFinite(Number(raw.scale))&&Number(raw.scale)>0)||Boolean(String(raw.grade||'').trim());
const directPath=url=>{try{const u=new URL(url);return u.pathname.split('/').filter(Boolean).length>=1}catch{return false}};
const timeout=Number(reviewConfig.research_policy?.url_timeout_ms||15000);
const fetchOk=async url=>{try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskResearchBot/3.0)'}});return{ok:r.ok,status:r.status,url:r.url||url}}catch(error){return{ok:false,status:0,url,error:error.message}}};
async function call(body){if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required to expand review discovery');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OpenAI API ${r.status}: ${await r.text()}`);const data=await r.json();const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}
const sourceSchema={type:'object',additionalProperties:false,required:['publication','title','url','source_kind','platform','version_context','published_at','author','score','scale','grade','identity_evidence'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},source_kind:{type:'string',enum:['review','retrospective_review','opinion','longread','port_review']},platform:{type:'string'},version_context:{type:'string'},published_at:{type:'string'},author:{type:'string'},score:{type:['number','null']},scale:{type:['number','null']},grade:{type:'string'},identity_evidence:{type:'string'}}};
const discoverySchema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:target,items:sourceSchema}}};
const validSeeds=seeds.filter(item=>item?.url&&!looksForbidden(item)&&directPath(item.url));
const prompt=`Найди максимально полный набор читаемых редакционных материалов о точной игре ${title} (${year||'год уточняется'}). Это сборщик ссылок на обзоры, а НЕ только рейтинговый агрегатор.\n\nНайди не менее ${candidateTarget} кандидатов, если они существуют.\n\nЧТО СЧИТАЕТСЯ ПОДХОДЯЩИМ:\n- review / обзор; retrospective / ретро-обзор; opinion / мнение; longread / большой разбор игры; профессиональный port review.\n- Оценка НЕ обязательна. Если у статьи есть собственная оценка издания — сохрани score/scale или grade. Если оценки нет — null/пусто.\n- Нужен прямой URL на конкретный читаемый материал, а не главную страницу, поиск или карточку игры.\n- Для старых игр активно ищи современные ретроспективы и русскоязычные материалы.\n- Ищи и внутри стартового реестра, и ВНЕ него по всему вебу. Особо проверь DTF, Дзен, VGTimes, VK Play Media, iXBT.games, GameMAG.ru, Shazoo, StopGame, PlayGround.ru, Игроманию.\n- Используй запросы вида: \"${title} обзор\", \"${title} ретро обзор\", \"${title} мнение\", \"${title} лонгрид\", \"${title} review\", \"${title} retrospective\", \"${title} opinion\" плюс site:домен для каждого источника.\n\nНЕ ПОДХОДИТ:\n- walkthrough, guide, wiki, tips, builds, news, preview, interview, how-to, магазин/Steam, пользовательский отзыв.\n- Metacritic/OpenCritic как ссылка на обзор: агрегаторы могут быть только отдельным источником оценки, но не заменяют читаемую статью.\n- другая игра, ремейк, ремастер, DLC или продолжение.\n\nСТАРТОВЫЕ ИЗДАНИЯ:\n${JSON.stringify([...configured.map(x=>({name:x.name,url:x.url})),...discoveryExtras],null,2)}\n\nУЖЕ ИЗВЕСТНЫЕ МАТЕРИАЛЫ:\n${JSON.stringify(validSeeds,null,2)}`;
const discovered=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_review_discovery',strict:true,schema:discoverySchema}}});
const merged=[...validSeeds,...(discovered.candidates||[])];const seenUrls=new Set(),accepted=[],rejected=[];
for(const raw of merged){
  const publication=String(raw.publication||raw.source||'').trim();const url=canonical(raw.url);const reasons=[];
  if(!publication||!url.startsWith('http'))reasons.push('missing publication or direct URL');
  if(seenUrls.has(url))reasons.push('duplicate URL');
  const forbidden=looksForbidden({...raw,url});if(forbidden)reasons.push(forbidden);if(!directPath(url))reasons.push('URL is not a direct article path');
  const h=host(url);if(['metacritic.com','opencritic.com'].some(d=>h===d||h.endsWith(`.${d}`)))reasons.push('aggregator is score evidence, not readable review article');
  const identityText=`${raw.title||''} ${raw.identity_evidence||''} ${raw.version_context||''}`.toLowerCase();for(const excluded of game.identity?.excluded_versions||game.identity?.excluded_titles||['definitive edition','remake','remaster'])if(identityText.includes(String(excluded).toLowerCase()))reasons.push(`excluded version: ${excluded}`);
  let resolved=url;if(!reasons.length){const live=await fetchOk(url);if(!live.ok)reasons.push(`unavailable URL: ${live.status||live.error||'network error'}`);else resolved=canonical(live.url)}
  if(reasons.length){rejected.push({publication,url,title:raw.title||'',reasons});continue}
  seenUrls.add(url);
  accepted.push({id:`source-${accepted.length+1}`,publication,title:String(raw.title||`Материал о ${title}`),url,resolved_url:resolved,source_kind:raw.source_kind||'review',platform:raw.platform||'',version_context:raw.version_context||'',published_at:raw.published_at||'',author:raw.author||'',score:Number.isFinite(Number(raw.score))?Number(raw.score):null,scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):null,grade:String(raw.grade||''),score_eligible:scorePresent(raw),identity_evidence:raw.identity_evidence||'',domain:host(resolved),validation:{status:'accepted-readable-article',checked_at:checkedAt,reasons:[]}});
  if(accepted.length>=maximum)break;
}
const scoreSources=[];const scoreSeen=new Set();for(const item of [...seeds,...accepted]){if(!scorePresent(item))continue;const key=`${String(item.publication||item.source||'').toLowerCase()}|${Number(item.score)||item.grade||''}`;if(scoreSeen.has(key))continue;scoreSeen.add(key);scoreSources.push({publication:item.publication||item.source||'',url:canonical(item.url),score:Number.isFinite(Number(item.score))?Number(item.score):null,scale:Number.isFinite(Number(item.scale))?Number(item.scale):null,grade:String(item.grade||''),source_kind:item.source_kind||'review'});}
const green=accepted.length>=minimum;
const matrix={schema_version:4,game_slug:slug,generated_at:checkedAt,policy:{minimum_readable_articles:minimum,target_readable_articles:target,maximum_readable_articles:maximum,historical,score_optional:true,broad_web_discovery:true},accepted,rejected,score_sources:scoreSources,coverage:{accepted_readable_articles:accepted.length,scored_sources:scoreSources.length,green,needs_more:Math.max(0,minimum-accepted.length)}};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,{schema_version:13,game_slug:slug,updated_at:checkedAt,publication_gate:{minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision',criterion:'readable_review_articles'},reviews:accepted,score_sources:scoreSources,rejected});
write(`data/parser-runs/review-research-${slug}.json`,{parser:'review-research-v3-broad-discovery',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,minimum,target,accepted_readable_articles:accepted.length,scored_sources:scoreSources.length,rejected:rejected.length,comments:green?[]:[`Нужно найти ещё ${Math.max(0,minimum-accepted.length)} читаемых редакционных материалов.`]});
console.log(JSON.stringify({slug,status:green?'green':'red-needs-revision',accepted_readable_articles:accepted.length,scored_sources:scoreSources.length,rejected:rejected.length,minimum,target},null,2));
