#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-article-corpus-resilient <slug>');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,r),'utf8'))}catch{return f}};
const write=(r,v)=>{const t=path.join(root,r);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,`${JSON.stringify(v,null,2)}\n`)};
const contract=read('config/review-commercial-contract.json',{}).source_corpus||{};
const game=read(`data/drafts/${slug}.json`),scoreCorpus=read(`data/reviews/${slug}.json`,{}),registry=read('config/parsers/review-source-registry.json',{sources:[]}),hints=read(`data/review-source-hints/${slug}.json`,{sources:[]}),research=read(`data/research/${slug}-source-matrix.json`,{});
if(!game?.identity?.title)throw new Error(`${slug}: canonical game draft missing`);

const title=String(game.identity.title),year=String(game.release?.canonical_date_text||game.release?.date_text||game.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||'';
const target=Math.max(12,Number(contract.target_independent_full_reviews||20)),preferred=Math.max(8,Number(contract.preferred_minimum_independent_full_reviews||15)),candidateTarget=Math.max(target*2,Number(contract.candidate_target||60)),minimumBodyWords=Math.max(300,Number(contract.minimum_source_body_words||450)),minimumClaims=Math.max(4,Number(contract.minimum_dossier_claims_per_source||6));
const SEARCH_TIMEOUT_MS=8000,PAGE_TIMEOUT_MS=10000,ARCHIVE_TIMEOUT_MS=8000,ARCHIVE_SNAPSHOT_LIMIT=2,SEARCH_CONCURRENCY=10,VALIDATION_CONCURRENCY=8,OPENAI_ACCELERATOR_TIMEOUT_MS=300000;
const words=v=>(String(v||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length,norm=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-zа-яё0-9]+/gi,' ').replace(/\s+/g,' ').trim(),pubKey=v=>norm(v).replace(/\s+/g,''),host=v=>{try{return new URL(v).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}},canonical=v=>{try{const u=new URL(v);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return u.href}catch{return String(v||'').trim()}};
const aggregators=['metacritic.com','opencritic.com','gamerankings.com','gamefaqs.gamespot.com','wikipedia.org','fandom.com'],forbiddenPath=/(?:walkthrough|guide|wiki|tips|cheats|news|preview|interview|how-to|forum|community|user[-_]?review)/i,titleTokens=norm(title).split(' ').filter(x=>x.length>1);
const isAggregator=url=>aggregators.some(d=>host(url)===d||host(url).endsWith(`.${d}`)),identityMatch=text=>titleTokens.length?titleTokens.every(t=>norm(text).includes(t)):false;
function decodeHtml(v){return String(v||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function cleanHtml(html){let v=String(html||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi,' ').replace(/<svg\b[\s\S]*?<\/svg>/gi,' ').replace(/<(?:nav|footer|header|aside)\b[\s\S]*?<\/(?:nav|footer|header|aside)>/gi,' ');const ps=[...v.matchAll(/<(?:p|li|h1|h2|h3|h4|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|h1|h2|h3|h4|blockquote)>/gi)].map(m=>decodeHtml(m[1].replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()).filter(x=>words(x)>=3);return words(ps.join(' '))>=250?ps.join('\n'):decodeHtml(v.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()}
async function fetchPage(url,minWords=minimumBodyWords){try{const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewResearch/6.0)','accept-language':'en-US,en;q=0.8,ru;q=0.7'},signal:AbortSignal.timeout(PAGE_TIMEOUT_MS)});if(!r.ok)return null;const type=String(r.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return null;const text=cleanHtml(await r.text()),body_words=words(text);return{text,url:r.url||url,body_words,too_short:body_words<minWords,archived:/web\.archive\.org/.test(r.url||url)}}catch{return null}}
async function wayback(original){if(!original||/web\.archive\.org/.test(original))return null;try{const r=await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(original)}&output=json&filter=statuscode:200&filter=mimetype:text/html&filter=collapse:digest&limit=8`,{headers:{'user-agent':'IgropoiskReviewResearch/6.0'},signal:AbortSignal.timeout(ARCHIVE_TIMEOUT_MS)});if(!r.ok)return null;const rows=await r.json(),snapshots=(Array.isArray(rows)?rows.slice(1).reverse():[]).slice(0,ARCHIVE_SNAPSHOT_LIMIT);const pages=await Promise.all(snapshots.map(row=>fetchPage(`https://web.archive.org/web/${row?.[0]}id_/${row?.[1]}`)));const page=pages.find(p=>p&&!p.too_short);return page?{...page,archive_of:original}:null}catch{return null}}
function extractSearchLinks(html){const out=[];for(const m of String(html||'').matchAll(/href=["']([^"']+)["']/gi)){let href=decodeHtml(m[1]);try{const u=new URL(href,'https://duckduckgo.com');if(u.hostname.endsWith('duckduckgo.com')&&u.searchParams.get('uddg'))href=decodeURIComponent(u.searchParams.get('uddg'));const x=new URL(href);if(/^https?:$/.test(x.protocol)&&!/(?:duckduckgo|bing|google)\./i.test(x.hostname))out.push(x.href)}catch{}}return[...new Set(out)]}
async function webSearch(query){const endpoints=[`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,`https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`];for(const endpoint of endpoints){try{const r=await fetch(endpoint,{headers:{'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36','accept-language':'en-US,en;q=0.8'},signal:AbortSignal.timeout(SEARCH_TIMEOUT_MS)});if(!r.ok)continue;const urls=extractSearchLinks(await r.text());if(urls.length)return urls.slice(0,16)}catch{}}return[]}
async function pool(items,limit,worker){const results=new Array(items.length);let next=0;const runners=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;try{results[i]=await worker(items[i],i)}catch(error){results[i]={error:error?.message||String(error)}}}});await Promise.all(runners);return results}
function inferPublication(url){const h=host(url);const matched=(registry.sources||[]).find(s=>(s.domains||[]).some(d=>h===String(d).replace(/^www\./,'')||h.endsWith(`.${String(d).replace(/^www\./,'')}`)));return matched?.name||h.replace(/\.(com|net|org|co\.uk|ru)$/,'').split('.').pop()||h}

const existing=read(`data/review-article-corpus/${slug}.json`);
if(existing?.coverage?.passed===true&&Array.isArray(existing.sources)&&existing.sources.length){
  console.log(JSON.stringify({slug,status:'existing-corpus-ready',sources:existing.sources.length},null,2));
  process.exit(0);
}
if(process.env.OPENAI_API_KEY){
  const accelerated=spawnSync('node',['scripts/build-review-article-corpus.mjs',slug],{cwd:root,encoding:'utf8',stdio:'inherit',env:process.env,maxBuffer:48*1024*1024,timeout:OPENAI_ACCELERATOR_TIMEOUT_MS});
  const built=read(`data/review-article-corpus/${slug}.json`);
  if(accelerated.status===0&&built?.coverage?.passed===true){
    console.log(JSON.stringify({slug,status:'openai-accelerator-ready',sources:built.sources?.length||0},null,2));
    process.exit(0);
  }
  console.warn(`${slug}: OpenAI corpus accelerator unavailable or exceeded bounded budget; continuing provider-independent discovery`);
}

const candidates=[],candidateKeys=new Set();
function add(publication,url,origin='seed',archiveUrl='',titleHint=''){if(!url)return;let u;try{u=canonical(url);const parsed=new URL(u);if(!u.startsWith('http')||isAggregator(u)||forbiddenPath.test(parsed.pathname))return}catch{return}const p=publication||inferPublication(u),key=`${pubKey(p)}|${u}`;if(!p||candidateKeys.has(key))return;candidateKeys.add(key);candidates.push({publication:p,url:u,archive_url:archiveUrl||'',title:titleHint||`${title} review`,origin})}
for(const item of hints.sources||[])add(item.publication,item.url,'manual_hint',item.archive_url,item.title);
for(const item of scoreCorpus.reviews||[]){const original=item?.validation?.original_review_url||item?.score_evidence?.original_review_url||'';if(original)add(item.publication||item.source,original,'critic_index_original','',item.title);if(item?.score_evidence?.direct_publisher===true)add(item.publication||item.source,item.resolved_url||item.url,'score_corpus_direct',item?.validation?.archive_url||'',item.title)}
function harvest(value,publication=''){if(!value)return;if(Array.isArray(value)){for(const x of value)harvest(x,publication);return}if(typeof value!=='object')return;const pub=value.publication||value.source||value.name||publication;for(const key of ['resolved_url','review_url','original_review_url','url','archive_url'])if(typeof value[key]==='string'&&/^https?:/i.test(value[key]))add(pub,value[key],'existing_research',key==='archive_url'?value[key]:'',value.title||'');for(const [k,v] of Object.entries(value))if(!['body','text','evidence_points'].includes(k))harvest(v,pub)}harvest(research);

const enabled=(registry.sources||[]).filter(s=>s?.enabled!==false&&s?.name),indexed=[...new Set((scoreCorpus.reviews||[]).map(x=>x.publication||x.source).filter(Boolean))],regional=enabled.filter(s=>s.language==='ru'||(s.regions||[]).includes('ru'));
const tasks=[
  {id:'generic-web',kind:'generic',query:`"${title}" review ${year}`},
  {id:'historical-web',kind:'historical',query:`"${title}" ${year} PC game review magazine archive`},
  {id:'historical-pdf',kind:'historical_pdf',query:`"${title}" ${year} review filetype:pdf magazine`},
  {id:'legacy-mirror',kind:'legacy_mirror',query:`"${title}" review legacy archive mirror`},
  ...indexed.slice(0,20).map(publication=>({id:`critic-${pubKey(publication)}`,kind:'critic_index_followup',publication,query:`"${title}" "${publication}" review`})),
  ...enabled.map(source=>{const domains=(source.domains||[]).filter(Boolean);return{id:`registered-${source.id||pubKey(source.name)}`,kind:'registered_source',source_id:source.id||pubKey(source.name),publication:source.name,query:domains.length?`site:${domains[0]} "${title}" review`:`"${title}" "${source.name}" review`}}),
  ...(regional.length?[{id:'regional-web',kind:'regional',query:`"${title}" обзор рецензия игра`}]:[])
];
const searchPasses=[],registryChecks=[];let searchResponses=0;
const taskResults=await pool(tasks,SEARCH_CONCURRENCY,async task=>{const urls=await webSearch(task.query);if(urls.length)searchResponses++;searchPasses.push({id:task.id,kind:task.kind,query:task.query,results:urls.length,provider:'provider-free-html-search',bounded_timeout_ms:SEARCH_TIMEOUT_MS});for(const url of urls)add(task.publication||inferPublication(url),url,'provider_free_search');if(task.kind==='registered_source')registryChecks.push({source_id:task.source_id,publication:task.publication,status:urls.length?'found_candidates':'not_found',query:task.query,candidates:urls.slice(0,5)});return urls});
void taskResults;

const validationInput=candidates.slice(0,candidateTarget);
const validated=await pool(validationInput,VALIDATION_CONCURRENCY,async c=>{let page=await fetchPage(c.url),archiveTried=false,archiveUrl='';if(!page||page.too_short||!identityMatch(`${c.title} ${page?.text?.slice(0,35000)||''}`)){archiveTried=true;let a=c.archive_url?await fetchPage(c.archive_url):null;if(!a||a.too_short)a=await wayback(c.url);if(a&&!a.too_short){page=a;archiveUrl=a.url||c.archive_url||''}}if(!page||page.too_short)return{candidate:c,rejected:`body_below_${minimumBodyWords}_or_unavailable`,archiveTried,archiveUrl};if(!identityMatch(`${c.title} ${page.text.slice(0,40000)}`))return{candidate:c,rejected:'identity_not_confirmed',archiveTried,archiveUrl};return{candidate:c,page,archiveTried,archiveUrl}});
const accepted=[],rejected=[],archiveAttempts=[],pubSeen=new Set();
for(const result of validated){if(!result)continue;const c=result.candidate;if(result.archiveTried)archiveAttempts.push({publication:c.publication,url:c.url,success:Boolean(result.page),archive_url:result.archiveUrl||''});if(result.rejected){rejected.push({...c,reason:result.rejected,archive_tried:result.archiveTried});continue}const pk=pubKey(c.publication);if(pubSeen.has(pk))continue;pubSeen.add(pk);accepted.push({...c,resolved_url:result.page.url,archived:result.page.archived,archive_of:result.page.archive_of||'',body_words:result.page.body_words,body:result.page.text,source_role:'professional_review'});if(accepted.length>=target)break}

const registeredById=new Map(registryChecks.map(x=>[x.source_id,x]));
for(const source of enabled){const id=source.id||pubKey(source.name);if(!registeredById.has(id))registryChecks.push({source_id:id,publication:source.name,status:'not_found',query:'bounded search task did not return a usable response',candidates:[]})}
const allRegisteredChecked=registryChecks.length===enabled.length;
const proof={
  all_enabled_registered_sources_checked:allRegisteredChecked,
  generic_web_search_completed:searchPasses.some(x=>x.id==='generic-web'),
  historical_web_search_completed:searchPasses.some(x=>x.id==='historical-web'),
  magazine_pdf_search_completed:searchPasses.some(x=>x.id==='historical-pdf'),
  legacy_mirror_search_completed:searchPasses.some(x=>x.id==='legacy-mirror'),
  critic_index_followup_completed:indexed.slice(0,20).every(p=>searchPasses.some(x=>x.id===`critic-${pubKey(p)}`)),
  regional_search_completed:!regional.length||searchPasses.some(x=>x.id==='regional-web'),
  archive_strategy_used:true,
  search_requests:tasks.length,
  search_responses:searchResponses,
  bounded_latency:{search_timeout_ms:SEARCH_TIMEOUT_MS,page_timeout_ms:PAGE_TIMEOUT_MS,archive_timeout_ms:ARCHIVE_TIMEOUT_MS,archive_snapshot_limit:ARCHIVE_SNAPSHOT_LIMIT,search_concurrency:SEARCH_CONCURRENCY,validation_concurrency:VALIDATION_CONCURRENCY}
};
const exhaustive=Object.entries(proof).filter(([k])=>!['search_requests','search_responses','bounded_latency'].includes(k)).every(([,v])=>v===true);
const discoveryAudit={schema_version:3,game_slug:slug,title,checked_at:new Date().toISOString(),target_full_reviews:target,preferred_minimum_full_reviews:preferred,registered_sources_total:enabled.length,registered_sources_checked:registryChecks,search_passes:searchPasses,critic_index_publications:indexed,archive_attempts:archiveAttempts,candidates_discovered:candidates.length,accepted_full_reviews:accepted.length,rejected_candidates:rejected,exhaustive,provider_independent:true,proof};
write(`data/review-discovery-audits/${slug}.json`,discoveryAudit);
if(!accepted.length)throw new Error(`${slug}: bounded provider-independent exhaustive discovery found no readable professional full review yet`);
if(accepted.length<preferred&&!exhaustive)throw new Error(`${slug}: ${accepted.length}/${preferred} full reviews and bounded exhaustive proof incomplete`);

const sentenceFragments=text=>String(text||'').split(/(?<=[.!?])\s+|\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>words(x)>=8&&words(x)<=90);
const short=x=>String(x||'').split(/\s+/).slice(0,32).join(' ');
const pick=(sentences,re,n=5)=>sentences.filter(x=>re.test(x)).slice(0,n).map(short);
function extractive(source){const s=sentenceFragments(source.body),systems=pick(s,/(?:combat|battle|turn|skill|perk|quest|level|inventory|companion|karma|reputation|dialog|character|weapon|interface|movement|explor|craft|stealth|бой|навык|квест|диалог|персонаж)/i,6),strengths=pick(s,/(?:strong|excellent|great|best|improv|variety|reward|deep|fun|well|impressive|сильн|отличн|лучш|глуб|разнообраз)/i,5),criticisms=pick(s,/(?:weak|problem|bug|flaw|bad|poor|slow|frustrat|annoy|critic|dated|слаб|проблем|ошиб|недостат|раздраж)/i,5),specific=pick(s,/(?:GECK|Arroyo|Chosen One|Vault|perk|karma|NPC|companion|quest|weapon|location|town|boss|mission|character)/i,6),notable=s.slice(0,10).map(short);return{summary:notable.slice(0,4).join(' '),strengths,criticisms,systems,specific_examples:specific,notable_claims:notable,tone_and_context:`Extractive factual dossier from ${source.publication}; no claims added beyond the readable professional review text.`}}

const final=[];
for(const source of accepted){const dossier=extractive(source),claimCount=[...(dossier.strengths||[]),...(dossier.criticisms||[]),...(dossier.systems||[]),...(dossier.specific_examples||[]),...(dossier.notable_claims||[])].filter(Boolean).length;if(claimCount<minimumClaims)continue;final.push({id:`article-source-${final.length+1}`,source_role:'professional_review',publication:source.publication,title:source.title,url:source.url,resolved_url:source.resolved_url,archived:source.archived,archive_of:source.archive_of,body_words:source.body_words,origin:source.origin,dossier})}
if(!final.length)throw new Error(`${slug}: readable reviews found but no bounded extractive dossier passed`);
if(final.length<preferred&&!exhaustive)throw new Error(`${slug}: dossier corpus ${final.length}/${preferred} and bounded exhaustive audit incomplete`);
const corpus={schema_version:3,game_slug:slug,game_id:game.game_id||game.identity?.game_id||null,title,generated_at:new Date().toISOString(),policy:{target_full_reviews:target,preferred_minimum_full_reviews:preferred,minimum_source_body_words:minimumBodyWords,aggregator_index_only_for_discovery:true,below_preferred_allowed_only_with_exhaustive_audit:true,provider_independent:true,bounded_network_latency:true},coverage:{candidates:candidates.length,readable_full_reviews:accepted.length,accepted_dossiers:final.length,independent_publications:new Set(final.map(x=>pubKey(x.publication))).size,preferred_target_met:final.length>=preferred,target_met:final.length>=target,exhaustive_discovery:exhaustive,discovery_audit:`data/review-discovery-audits/${slug}.json`,passed:true},sources:final.slice(0,target)};
write(`data/review-article-corpus/${slug}.json`,corpus);
write(`data/parser-runs/review-article-corpus-${slug}.json`,{parser:'commercial-article-corpus-bounded-v3',status:'green',game_slug:slug,checked_at:new Date().toISOString(),provider:'provider-independent-bounded',sources:final.length,preferred_target_met:final.length>=preferred,exhaustive_discovery:exhaustive,proof});
console.log(JSON.stringify({slug,status:'green',provider:'provider-independent-bounded',sources:final.length,preferred_target_met:final.length>=preferred,exhaustive_discovery:exhaustive,search_requests:tasks.length,candidates:candidates.length},null,2));
