import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=process.argv[2];
if(!slug){console.error('Usage: node scripts/prepare-review-research.mjs <game-slug>');process.exit(1)}
if(!process.env.OPENAI_API_KEY){console.error('OPENAI_API_KEY is required');process.exit(1)}

const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const exists=file=>fs.existsSync(path.join(root,file));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const config=read('config/parsers/review-synthesis.json');
const draftPath=`data/drafts/${slug}.json`;
if(!exists(draftPath)){console.error(`Missing ${draftPath}. Run game-data parser first.`);process.exit(1)}
const game=read(draftPath);
const checkedAt=new Date().toISOString();
const policy=config.research_policy||{};
const required=Number(config.publication_gate?.editorial_reviews_required||20);
const target=Math.max(Number(policy.candidate_target||35),required+10);
const historical=Number(game.release?.year||String(game.release?.date_text||'').match(/\d{4}/)?.[0]||9999)<=Number(policy.historical_before_year||2010);
const seedPath=`data/reviews/${slug}.json`;
const seeds=exists(seedPath)?read(seedPath).reviews||[]:[];
const configured=(config.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial');

const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const timeout=Number(policy.url_timeout_ms||15000);
const fetchOk=async url=>{try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'user-agent':'IgropoiskResearchBot/1.0'}});return{ok:r.ok,status:r.status,url:r.url||url}}catch(error){return{ok:false,status:0,url,error:error.message}}};
const archive=async url=>{try{const r=await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,{signal:AbortSignal.timeout(timeout)});if(!r.ok)return null;const data=await r.json();return data.archived_snapshots?.closest?.available?data.archived_snapshots.closest.url:null}catch{return null}};
async function call(body){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OpenAI API ${r.status}: ${await r.text()}`);const data=await r.json();const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('No structured output');return JSON.parse(text)}

const sourceSchema={type:'object',additionalProperties:false,required:['publication','title','url','source_kind','platform','version_context','published_at','author','score','scale','identity_evidence','praise','criticism','evidence_points'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},source_kind:{type:'string',enum:['contemporary_review','retrospective','port_review']},platform:{type:'string'},version_context:{type:'string'},published_at:{type:'string'},author:{type:'string'},score:{type:['number','null']},scale:{type:['number','null']},identity_evidence:{type:'string'},praise:{type:'array',items:{type:'string'}},criticism:{type:'array',items:{type:'string'}},evidence_points:{type:'array',items:{type:'string'}}}};
const discoverySchema={type:'object',additionalProperties:false,required:['game_identity','candidates'],properties:{game_identity:{type:'object',additionalProperties:false,required:['title','release_year','developer','excluded_versions'],properties:{title:{type:'string'},release_year:{type:'integer'},developer:{type:'string'},excluded_versions:{type:'array',items:{type:'string'}}}},candidates:{type:'array',minItems:required,items:sourceSchema}}};
const identity={slug,title:game.identity?.title||slug,release:game.release,developer:game.companies?.developers?.[0]||'',steam_appid:game.identity?.steam_appid||null,official_urls:game.links||{}};
const prompt=`Build a verified professional-review corpus for the exact game below. Use web search extensively and return direct game-specific review URLs, not category hubs or aggregator snippets.\n\nGAME IDENTITY:\n${JSON.stringify(identity,null,2)}\n\nCONFIGURED PUBLICATION STARTING POINTS:\n${JSON.stringify(configured,null,2)}\n\nEXISTING SEEDS:\n${JSON.stringify(seeds,null,2)}\n\nRULES:\n- Find at least ${target} candidates so validation can retain ${required} independent publications.\n- The article is about the exact original game and release context. Explicitly reject remakes, remasters, sequels, DLC and reviews of a different platform version unless source_kind is port_review.\n- One publication counts once. Syndication, translated copies and duplicate URLs are one source.\n- ${historical?'This is a historical game. Prefer contemporary reviews; professional retrospectives and port reviews may fill only the archival allowance. Use direct archived primary-review URLs when the live page is gone.':'Prefer reviews contemporary with release; use retrospectives only as supplementary perspectives.'}\n- Metacritic/OpenCritic, stores, user reviews, forums, Reddit and videos do not count as professional editorial reviews.\n- Extract concrete praise, criticism and evidence. Do not invent a score when none is visible.\n- identity_evidence must explain why this URL concerns the requested release.\n- Search outside the configured list when necessary, but only use recognizable professional editorial publications.`;
const discovered=await call({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'igropoisk_review_source_discovery',strict:true,schema:discoverySchema}}});

const merged=[...seeds,...(discovered.candidates||[])];
const seenUrls=new Set(),seenPublications=new Set(),accepted=[],rejected=[];
for(const raw of merged){
  const publication=String(raw.publication||raw.source||'').trim();
  const url=canonical(raw.url);
  const publicationKey=publication.toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
  const reasons=[];
  if(!publication||!url.startsWith('http'))reasons.push('missing publication or direct URL');
  if(seenUrls.has(url))reasons.push('duplicate URL');
  if(seenPublications.has(publicationKey))reasons.push('duplicate publication');
  const identityText=`${raw.title||''} ${raw.identity_evidence||''} ${raw.version_context||''}`.toLowerCase();
  for(const excluded of game.identity?.excluded_titles||['definitive edition','remake'])if(identityText.includes(String(excluded).toLowerCase()))reasons.push(`excluded version: ${excluded}`);
  let live={ok:false,status:0,url};let resolved=url;let archived=false;
  if(!reasons.length){live=await fetchOk(url);if(live.ok)resolved=canonical(live.url);else{const snapshot=await archive(url);if(snapshot){resolved=snapshot;archived=true}else reasons.push(`unavailable URL: ${live.status||live.error||'network error'}`)}}
  if(reasons.length){rejected.push({publication,url,reasons});continue}
  seenUrls.add(url);seenPublications.add(publicationKey);
  accepted.push({id:`source-${accepted.length+1}`,publication,title:raw.title||`${identity.title} review`,url,resolved_url:resolved,archived,source_kind:raw.source_kind||'contemporary_review',platform:raw.platform||'PC',version_context:raw.version_context||'original release',published_at:raw.published_at||'',author:raw.author||'',score:Number.isFinite(Number(raw.score))?Number(raw.score):null,scale:Number.isFinite(Number(raw.scale))?Number(raw.scale):null,identity_evidence:raw.identity_evidence||'',praise:raw.praise||[],criticism:raw.criticism||[],evidence_points:raw.evidence_points||[],domain:host(resolved)});
}
const contemporary=accepted.filter(x=>x.source_kind==='contemporary_review').length;
const minContemporary=historical?Number(policy.historical_minimum_contemporary||12):Number(policy.modern_minimum_contemporary||16);
const selected=accepted.slice(0,required);
const passed=selected.length>=required&&new Set(selected.map(x=>x.publication.toLowerCase())).size>=required&&contemporary>=Math.min(minContemporary,required);
const matrix={schema_version:1,game_slug:slug,generated_at:checkedAt,game_identity:discovered.game_identity,policy:{required_sources:required,historical,min_contemporary:minContemporary,candidate_target:target},accepted:selected,rejected,coverage:{candidates:merged.length,accepted_total:accepted.length,selected:selected.length,contemporary,retrospectives:accepted.filter(x=>x.source_kind==='retrospective').length,port_reviews:accepted.filter(x=>x.source_kind==='port_review').length,passed}};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,{schema_version:2,game_slug:slug,updated_at:checkedAt,publication_gate:{required,accepted:selected.length,passed},reviews:selected});
write(`data/parser-runs/review-research-${slug}.json`,{parser:'review-research',game_slug:slug,status:passed?'success':'blocked',checked_at:checkedAt,required,accepted:selected.length,contemporary,output:`data/research/${slug}-source-matrix.json`,note:passed?'Source corpus passed identity, independence and URL checks.':'Source corpus is incomplete; article synthesis must remain blocked.'});
console.log(JSON.stringify({slug,passed,accepted:selected.length,rejected:rejected.length,contemporary},null,2));
if(!passed)process.exitCode=2;
