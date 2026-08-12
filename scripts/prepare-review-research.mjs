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
const minimum=Number(corpus.minimum_sources||10),target=Number(corpus.target_sources||20),maximum=Number(corpus.maximum_sources||20),candidateTarget=Math.max(Number(corpus.candidate_target||32),target+8);
const draftPath=`data/drafts/${slug}.json`;
if(!exists(draftPath)){console.error(`Missing ${draftPath}`);process.exit(1)}
const game=read(draftPath);const checkedAt=new Date().toISOString();
const title=game.identity?.title||slug;const year=Number(String(game.release?.date||game.release?.date_text||'').match(/(?:19|20)\d{2}/)?.[0]||0);const historical=year>0&&year<2010;
const configured=(reviewConfig.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial');
const seedPath=`data/reviews/${slug}.json`;const seeds=exists(seedPath)?read(seedPath).reviews||[]:[];
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const pubKey=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
const forbiddenTerms=(corpus.forbidden_title_or_url_terms||[]).map(x=>String(x).toLowerCase());const forbiddenDomains=(corpus.forbidden_domains||[]).map(x=>String(x).toLowerCase());
const looksForbidden=raw=>{const hay=`${raw.title||''} ${raw.url||''}`.toLowerCase();if(forbiddenTerms.some(term=>hay.includes(term)))return'non-review content type';const h=host(raw.url);if(forbiddenDomains.some(domain=>h===domain||h.endsWith(`.${domain}`)))return`forbidden domain: ${h}`;return''};
const scorePresent=raw=>(Number.isFinite(Number(raw.score))&&Number.isFinite(Number(raw.scale))&&Number(raw.scale)>0)||Boolean(String(raw.grade||'').trim());
const directPath=url=>{try{const u=new URL(url);return u.pathname.split('/').filter(Boolean).length>=2}catch{return false}};
const timeout=Number(reviewConfig.research_policy?.url_timeout_ms||15000);
const fetchOk=async url=>{try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'IgropoiskResearchBot/2.0'}});return{ok:r.ok,status:r.status,url:r.url||url}}catch(error){return{ok:false,status:0,url,error:error.message}}};
async function call(body){if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required to expand an incomplete professional-review corpus');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OpenAI API ${r.status}: ${await r.text()}`);const data=await r.json();const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}
const sourceSchema={type:'object',additionalProperties:false,required:['publication','title','url','source_kind','platform','version_context','published_at','author','score','scale','grade','identity_evidence'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},source_kind:{type:'string',enum:['review','retrospective_review','port_review']},platform:{type:'string'},version_context:{type:'string'},published_at:{type:'string'},author:{type:'string'},score:{type:['number','null']},scale:{type:['number','null']},grade:{type:'string'},identity_evidence:{type:'string'}}};
const discoverySchema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:target,items:sourceSchema}}};
const validSeeds=seeds.filter(item=>!looksForbidden(item)&&scorePresent(item)&&directPath(item.url));
let discovered={candidates:[]};
if(new Set(validSeeds.map(item=>pubKey(item.publication||item.source))).size<target){
  const prompt=`Собери профессиональные рецензии для точной игры ${title} (${year||'год уточняется'}). Нужен мировой набор независимых изданий с собственными оценками.\n\nЦель: ${target} подтверждённых источников, минимум ${minimum}; найди не менее ${candidateTarget} кандидатов, чтобы после проверки осталось достаточно.\n\nЖЁСТКИЕ ПРАВИЛА:\n- Только прямой URL на конкретную рецензию этой игры.\n- Обязательна собственная оценка издания: числовая шкала или буквенная grade. Не придумывай оценку.\n- Walkthrough, guide, wiki, tips, builds, news, preview, interview, how-to, Steam/store page, user review, Metacritic/OpenCritic и агрегатор без собственного обзора запрещены.\n- Один издатель/публикация считается один раз.\n- Не смешивай ремейк, ремастер, DLC, продолжение или другую версию без явного source_kind=port_review.\n- title — точный заголовок статьи. identity_evidence — почему это обзор именно ${title}.\n\nСТАРТОВЫЕ ИЗДАНИЯ:\n${JSON.stringify(configured.map(x=>({name:x.name,url:x.url})),null,2)}\n\nУЖЕ ИЗВЕСТНЫЕ КАНДИДАТЫ:\n${JSON.stringify(validSeeds,null,2)}`;
  discovered=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_review_corpus',strict:true,schema:discoverySchema}}});
}
const merged=[...validSeeds,...(discovered.candidates||[])];const seenUrls=new Set(),seenPubs=new Set(),accepted=[],rejected=[];
for(const raw of merged){
  const publication=String(raw.publication||raw.source||'').trim();const url=canonical(raw.url);const reasons=[];const pKey=pubKey(publication);
  if(!publication||!url.startsWith('http'))reasons.push('missing publication or direct URL');
  if(seenUrls.has(url))reasons.push('duplicate URL');if(seenPubs.has(pKey))reasons.push('duplicate publication');
  const forbidden=looksForbidden({...raw,url});if(forbidden)reasons.push(forbidden);if(!directPath(url))reasons.push('URL is not a direct article path');if(!scorePresent(raw))reasons.push('review has no own publication score');
  const identityText=`${raw.title||''} ${raw.identity_evidence||''} ${raw.version_context||''}`.toLowerCase();for(const excluded of game.identity?.excluded_versions||game.identity?.excluded_titles||['definitive edition','remake','remaster'])if(identityText.includes(String(excluded).toLowerCase()))reasons.push(`excluded version: ${excluded}`);
  let resolved=url;if(!reasons.length){const live=await fetchOk(url);if(!live.ok)reasons.push(`unavailable URL: ${live.status||live.error||'network error'}`);else resolved=canonical(live.url)}
  if(reasons.length){rejected.push({publication,url,title:raw.title||'',reasons});continue}
  seenUrls.add(url);seenPubs.add(pKey);
  accepted.push({id:`source-${accepted.length+1}`,publication,title:String(raw.title||`Обзор ${title}`),url,resolved_url:resolved,source_kind:raw.source_kind||'review',platform:raw.platform||'',version_context:raw.version_context||'',published_at:raw.published_at||'',author:raw.author||'',score:Number.isFinite(Number(raw.score))?Number(raw.score):null,scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):null,grade:String(raw.grade||''),identity_evidence:raw.identity_evidence||'',domain:host(resolved),validation:{status:'accepted',checked_at:checkedAt,reasons:[]}});
  if(accepted.length>=maximum)break;
}
const contemporary=accepted.filter(x=>x.source_kind==='review').length;const minContemporary=historical?Number(corpus.minimum_contemporary_historical||6):Number(corpus.minimum_contemporary_modern||8);const green=accepted.length>=minimum&&contemporary>=Math.min(minContemporary,accepted.length);
const matrix={schema_version:3,game_slug:slug,generated_at:checkedAt,policy:{minimum_sources:minimum,target_sources:target,maximum_sources:maximum,historical,min_contemporary:minContemporary},accepted,rejected,coverage:{accepted:accepted.length,contemporary,green,needs_more:Math.max(0,minimum-accepted.length)}};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,{schema_version:4,game_slug:slug,updated_at:checkedAt,publication_gate:{minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision'},reviews:accepted,rejected});
write(`data/parser-runs/review-research-${slug}.json`,{parser:'review-research',status:green?'green':'needs_revision',game_slug:slug,checked_at:checkedAt,minimum,target,accepted:accepted.length,rejected:rejected.length,comments:green?[]:[`Нужно найти ещё ${Math.max(0,minimum-accepted.length)} подтверждённых профессиональных рецензий с собственными оценками.`]});
console.log(JSON.stringify({slug,status:green?'green':'red-needs-revision',accepted:accepted.length,rejected:rejected.length,minimum,target},null,2));
