import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/prepare-review-research.mjs <game-slug>');process.exit(1)}
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const exists=file=>fs.existsSync(path.join(root,file));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const reviewConfig=read('config/parsers/review-synthesis.json');
const ruConfig=read('config/parsers/review-sources-ru.json');
const quality=read('config/game-page-quality-v2.json');
const corpus=quality.review_corpus||{};
const minimum=Number(corpus.minimum_sources||5),target=Number(corpus.target_sources||20),maximum=Number(corpus.maximum_sources||20),candidateTarget=Math.max(Number(corpus.candidate_target||36),target+8);
const draftPath=`data/drafts/${slug}.json`;
if(!exists(draftPath)){console.error(`Missing ${draftPath}`);process.exit(1)}
const game=read(draftPath);const checkedAt=new Date().toISOString();
const title=game.identity?.title||slug;const year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);const historical=year>0&&year<2010;
const globalConfigured=(reviewConfig.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial'&&!String(s.id||'').includes('absolute-games'));
const ruSources=(ruConfig.sources||[]).filter(s=>s.modern||historical);
const seedPath=`data/reviews/${slug}.json`;const previous=exists(seedPath)?read(seedPath):{};const seeds=previous.reviews||[];
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const pubKey=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
const forbiddenTerms=(corpus.forbidden_title_or_url_terms||[]).map(x=>String(x).toLowerCase());const forbiddenDomains=(corpus.forbidden_domains||[]).map(x=>String(x).toLowerCase());
const looksForbidden=raw=>{const hay=`${raw.title||''} ${raw.url||''}`.toLowerCase();if(forbiddenTerms.some(term=>hay.includes(term)))return'non-review content type';const h=host(raw.url);if(forbiddenDomains.some(domain=>h===domain||h.endsWith(`.${domain}`)))return`forbidden domain: ${h}`;return''};
const scorePresent=raw=>(Number.isFinite(Number(raw.score))&&Number.isFinite(Number(raw.scale))&&Number(raw.scale)>0)||Boolean(String(raw.grade||'').trim());
const directPath=url=>{try{const u=new URL(url);return u.pathname.split('/').filter(Boolean).length>=2}catch{return false}};
const timeout=Number(reviewConfig.research_policy?.url_timeout_ms||15000);
const fetchOk=async url=>{try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'IgropoiskResearchBot/3.0','accept-language':'ru,en;q=0.8'}});return{ok:r.ok,status:r.status,url:r.url||url}}catch(error){return{ok:false,status:0,url,error:error.message}}};
async function call(body){if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required to expand an incomplete professional-review corpus');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OpenAI API ${r.status}: ${await r.text()}`);const data=await r.json();const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}
const stringList={type:'array',items:{type:'string'}};
const sourceSchema={type:'object',additionalProperties:false,required:['configured_source_id','publication','title','url','source_kind','platform','version_context','published_at','author','score','scale','grade','language','identity_evidence','evidence_points','praise','criticism','mechanics'],properties:{configured_source_id:{type:'string'},publication:{type:'string'},title:{type:'string'},url:{type:'string'},source_kind:{type:'string',enum:['review','retrospective_review','port_review']},platform:{type:'string'},version_context:{type:'string'},published_at:{type:'string'},author:{type:'string'},score:{type:['number','null']},scale:{type:['number','null']},grade:{type:'string'},language:{type:'string'},identity_evidence:{type:'string'},evidence_points:stringList,praise:stringList,criticism:stringList,mechanics:stringList}};
const checkSchema={type:'object',additionalProperties:false,required:['source_id','status','notes'],properties:{source_id:{type:'string'},status:{type:'string',enum:['found','not_found','unavailable']},notes:{type:'string'}}};
const regionalSchema={type:'object',additionalProperties:false,required:['checks','candidates'],properties:{checks:{type:'array',minItems:ruSources.length,maxItems:ruSources.length,items:checkSchema},candidates:{type:'array',items:sourceSchema}}};
const discoverySchema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',items:sourceSchema}}};
const validSeeds=seeds.filter(item=>!looksForbidden(item)&&directPath(item.url||item.resolved_url));
let regional={checks:[],candidates:[]};
const requiredRu=ruSources.filter(source=>source.modern||historical);
if(process.env.OPENAI_API_KEY&&requiredRu.length){
  const prompt=`Для игры ${title} (${year||'год уточняется'}) ОБЯЗАТЕЛЬНО отдельно проверь каждый указанный русскоязычный профессиональный источник. Для каждого source_id верни ровно один статус found/not_found/unavailable. Если есть профессиональная рецензия именно этой игры — добавь её в candidates.\n\nИСТОЧНИКИ:\n${JSON.stringify(requiredRu,null,2)}\n\nПРАВИЛА:\n- Нужен прямой URL конкретного обзора, не поиск, не тег, не новость, не гайд и не пользовательский пост.\n- Рецензия БЕЗ числовой оценки всё равно полезна для текста и должна быть возвращена.\n- score/scale или grade заполняй только если издание само явно поставило эту оценку. Никогда не превращай словесный вердикт в число.\n- Для текста дай короткие ПЕРЕСКАЗАННЫЕ evidence_points, praise, criticism и mechanics из тела обзора. Не копируй меню, newsletter, affiliate-блоки, cookie-текст или агрегатор чужих оценок.\n- Не смешивай ремейк, ремастер, DLC или другую игру.\n- language=ru. configured_source_id обязан совпадать с source_id из списка.`;
  regional=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_ru_review_discovery',strict:true,schema:regionalSchema}}});
}
let discovered={candidates:[]};
const seedPublications=new Set([...validSeeds,...(regional.candidates||[])].map(item=>pubKey(item.publication||item.source)));
if(process.env.OPENAI_API_KEY&&seedPublications.size<target){
  const prompt=`Расширь профессиональный корпус рецензий для точной игры ${title} (${year||'год уточняется'}). Цель — до ${target} независимых изданий, минимум ${minimum}; найди до ${candidateTarget} качественных кандидатов.\n\nПРАВИЛА:\n- Только прямой URL конкретной профессиональной рецензии.\n- Рецензии без числовой оценки разрешены и важны для текста. score/scale/grade заполняй только при собственной явной оценке издания; ничего не придумывай.\n- Metacritic, OpenCritic, магазины, пользовательские отзывы, walkthrough/guide/wiki/news/preview/interview запрещены.\n- Один издатель считается один раз.\n- Не смешивай версии игры.\n- evidence_points/praise/criticism/mechanics — краткий пересказ реального тела рецензии без page chrome, рекламы, newsletter и affiliate boilerplate.\n- configured_source_id используй, если издание есть в стартовом списке; иначе пустая строка.\n\nСТАРТОВЫЕ ИЗДАНИЯ:\n${JSON.stringify(globalConfigured.map(x=>({id:x.id,name:x.name,url:x.url})),null,2)}\n\nУЖЕ НАЙДЕНО:\n${JSON.stringify([...validSeeds,...(regional.candidates||[])].map(x=>({publication:x.publication,title:x.title,url:x.url||x.resolved_url})),null,2)}`;
  discovered=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_review_corpus',strict:true,schema:discoverySchema}}});
}
const merged=[...(regional.candidates||[]),...validSeeds,...(discovered.candidates||[])];const seenUrls=new Set(),seenPubs=new Set(),accepted=[],rejected=[];
for(const raw of merged){
  const publication=String(raw.publication||raw.source||'').trim();const url=canonical(raw.resolved_url||raw.url);const reasons=[];const pKey=pubKey(publication);
  if(!publication||!url.startsWith('http'))reasons.push('missing publication or direct URL');
  if(seenUrls.has(url))reasons.push('duplicate URL');if(seenPubs.has(pKey))reasons.push('duplicate publication');
  const forbidden=looksForbidden({...raw,url});if(forbidden)reasons.push(forbidden);if(!directPath(url))reasons.push('URL is not a direct article path');
  const identityText=`${raw.title||''} ${raw.identity_evidence||''} ${raw.version_context||''}`.toLowerCase();for(const excluded of game.identity?.excluded_versions||game.identity?.excluded_titles||['definitive edition','remake','remaster'])if(identityText.includes(String(excluded).toLowerCase()))reasons.push(`excluded version: ${excluded}`);
  let resolved=url;if(!reasons.length){const live=await fetchOk(url);if(!live.ok)reasons.push(`unavailable URL: ${live.status||live.error||'network error'}`);else resolved=canonical(live.url)}
  if(reasons.length){rejected.push({publication,url,title:raw.title||'',reasons});continue}
  seenUrls.add(url);seenPubs.add(pKey);
  accepted.push({id:`source-${accepted.length+1}`,configured_source_id:String(raw.configured_source_id||''),publication,title:String(raw.title||`Обзор ${title}`),url,resolved_url:resolved,source_kind:raw.source_kind||'review',platform:raw.platform||'',version_context:raw.version_context||'',published_at:raw.published_at||'',author:raw.author||'',language:String(raw.language||''),score:Number.isFinite(Number(raw.score))?Number(raw.score):null,scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):null,grade:String(raw.grade||''),score_eligible:scorePresent(raw),identity_evidence:raw.identity_evidence||'',evidence_points:(raw.evidence_points||raw.evidence||[]).slice(0,12),praise:(raw.praise||[]).slice(0,8),criticism:(raw.criticism||[]).slice(0,8),mechanics:(raw.mechanics||[]).slice(0,12),domain:host(resolved),validation:{status:'accepted',checked_at:checkedAt,reasons:[]}});
  if(accepted.length>=maximum)break;
}
const acceptedConfigured=new Set(accepted.map(item=>item.configured_source_id).filter(Boolean));
const previousChecks=previous.regional_discovery?.checks||[];const checkInput=regional.checks?.length?regional.checks:previousChecks;
const checks=requiredRu.map(source=>{const found=checkInput.find(item=>item.source_id===source.id);const inferred=acceptedConfigured.has(source.id)?'found':null;return{source_id:source.id,name:source.name,status:inferred||found?.status||'unavailable',notes:found?.notes||(!process.env.OPENAI_API_KEY?'regional discovery requires AI/web research':'')}});
const foundButMissing=checks.filter(item=>item.status==='found'&&!acceptedConfigured.has(item.source_id)).map(item=>item.source_id);
const regionalComplete=checks.length===requiredRu.length&&checks.every(item=>['found','not_found','unavailable'].includes(item.status))&&!foundButMissing.length;
const contemporary=accepted.filter(x=>x.source_kind==='review').length;const minContemporary=historical?Number(corpus.minimum_contemporary_historical||4):Number(corpus.minimum_contemporary_modern||5);const green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length)&&regionalComplete;
const matrix={schema_version:4,game_slug:slug,generated_at:checkedAt,policy:{minimum_sources:minimum,target_sources:target,maximum_sources:maximum,historical,min_contemporary:minContemporary,regional_discovery_required:true},accepted,rejected,regional_discovery:{region:'ru',checks,complete:regionalComplete,found_but_not_accepted:foundButMissing},coverage:{accepted:accepted.length,scored:accepted.filter(item=>item.score_eligible).length,contemporary,green,needs_more:Math.max(0,minimum-accepted.length)}};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,{schema_version:5,game_slug:slug,game_id:game.game_id||previous.game_id||null,updated_at:checkedAt,publication_gate:{minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision'},regional_discovery:matrix.regional_discovery,reviews:accepted,rejected,...(previous.igropoisk_article?{igropoisk_article:previous.igropoisk_article}:{})});
const comments=[];if(accepted.length<minimum)comments.push(`Нужно найти ещё ${minimum-accepted.length} профессиональных рецензий.`);if(!regionalComplete)comments.push('Не завершена обязательная проверка русскоязычных изданий.');
write(`data/parser-runs/review-research-${slug}.json`,{parser:'review-research',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,minimum,target,accepted:accepted.length,scored:accepted.filter(item=>item.score_eligible).length,rejected:rejected.length,regional_checks:checks,comments});
console.log(JSON.stringify({slug,status:green?'green':'red-needs-revision',accepted:accepted.length,scored:accepted.filter(item=>item.score_eligible).length,rejected:rejected.length,regional_complete:regionalComplete,minimum,target},null,2));
