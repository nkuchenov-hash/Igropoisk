#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: build-review-article-corpus <slug>');
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for professional review discovery and dossiers');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const contract=read('config/review-commercial-contract.json',{}).source_corpus||{};
const game=read(`data/drafts/${slug}.json`);if(!game?.identity?.title)throw new Error(`${slug}: canonical game draft missing`);
const scoreCorpus=read(`data/reviews/${slug}.json`,{});
const synthesis=read('config/parsers/review-synthesis.json',{sources:[]});
const hints=read(`data/review-source-hints/${slug}.json`,{sources:[]});
const minimum=Math.max(12,Number(contract.minimum_independent_full_reviews||15));
const target=Math.max(minimum,Number(contract.target_independent_full_reviews||20));
const candidateTarget=Math.max(target+8,Number(contract.candidate_target||32));
const minimumBodyWords=Math.max(350,Number(contract.minimum_source_body_words||450));
const minimumClaims=Math.max(4,Number(contract.minimum_dossier_claims_per_source||6));
const title=String(game.identity.title),year=String(game.release?.canonical_date_text||game.release?.date_text||game.release?.date||'').match(/(?:19|20)\d{2}/)?.[0]||'';
const aggregators=['metacritic.com','opencritic.com','gamerankings.com','gamefaqs.gamespot.com','mobygames.com','wikipedia.org','fandom.com'];
const forbiddenPath=/(?:walkthrough|guide|wiki|tips|cheats|news|preview|interview|how-to|forum|community|user[-_]?review)/i;
const norm=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-zа-яё0-9]+/gi,' ').replace(/\s+/g,' ').trim();
const words=value=>(String(value||'').match(/[A-Za-zА-Яа-яЁё0-9’'-]+/g)||[]).length;
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])u.searchParams.delete(key);return u.href}catch{return String(value||'').trim()}};
const pubKey=value=>norm(value).replace(/\s+/g,'');
const isAggregator=url=>aggregators.some(domain=>host(url)===domain||host(url).endsWith(`.${domain}`));
const titleTokens=norm(title).split(' ').filter(token=>token.length>1);
function identityMatch(text){const hay=norm(text);return titleTokens.length?titleTokens.every(token=>hay.includes(token)):false}
function decodeHtml(value){return String(value||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function cleanHtml(html){
  let value=String(html||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi,' ').replace(/<svg\b[\s\S]*?<\/svg>/gi,' ').replace(/<(?:nav|footer|header|aside)\b[\s\S]*?<\/(?:nav|footer|header|aside)>/gi,' ');
  const paragraphs=[...value.matchAll(/<(?:p|li|h1|h2|h3|h4|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|h1|h2|h3|h4|blockquote)>/gi)].map(m=>decodeHtml(m[1].replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()).filter(x=>words(x)>=3);
  if(words(paragraphs.join(' '))>=250)return paragraphs.join('\n');
  return decodeHtml(value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
async function fetchPage(url){
  try{const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; IgropoiskReviewResearch/3.0)','accept-language':'en-US,en;q=0.8,ru;q=0.7'},signal:AbortSignal.timeout(15000)});if(!r.ok)return null;const type=String(r.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return null;const text=cleanHtml(await r.text());return{text,url:r.url||url,body_words:words(text),archived:/web\.archive\.org/.test(r.url||url)}}catch{return null}
}
async function wayback(original){
  if(/web\.archive\.org/.test(original))return null;
  try{
    const cdx=`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(original)}&output=json&filter=statuscode:200&filter=mimetype:text/html&filter=collapse:digest&from=1997&to=2020&limit=8`;
    const r=await fetch(cdx,{headers:{'user-agent':'IgropoiskReviewResearch/3.0'},signal:AbortSignal.timeout(12000)});if(!r.ok)return null;const rows=await r.json();if(!Array.isArray(rows)||rows.length<2)return null;
    for(const row of rows.slice(1).reverse()){const timestamp=row?.[0],saved=row?.[1];if(!timestamp||!saved)continue;const page=await fetchPage(`https://web.archive.org/web/${timestamp}id_/${saved}`);if(page&&page.body_words>=minimumBodyWords)return{...page,archive_of:original}}
  }catch{}
  return null;
}
async function openai(body){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error(`OpenAI API ${r.status}: ${await r.text()}`);const data=await r.json();const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('OpenAI returned no output_text');return JSON.parse(text.replace(/^```json\s*|\s*```$/g,''))}
const configured=(synthesis.sources||[]).filter(s=>s.enabled!==false&&s.family==='editorial').map(s=>s.name);
const indexedPublications=(scoreCorpus.reviews||[]).map(s=>s.publication||s.source).filter(Boolean);
const seed=[];const seedKeys=new Set();
function addSeed(publication,url,titleHint=''){
  if(!publication||!url||isAggregator(url)||forbiddenPath.test(url))return;const key=`${pubKey(publication)}|${canonical(url)}`;if(seedKeys.has(key))return;seedKeys.add(key);seed.push({publication:String(publication),url:canonical(url),title:titleHint||`Review of ${title}`,source_kind:'review',origin:'seed'});
}
for(const item of hints.sources||[])addSeed(item.publication,item.url,item.title);
for(const item of scoreCorpus.reviews||[]){if(item?.validation?.status==='accepted'||item?.score_evidence?.direct_publisher===true)addSeed(item.publication||item.source,item.resolved_url||item.url,item.title)}
let discovered=[];
if(seed.length<candidateTarget){
  const schema={type:'object',additionalProperties:false,required:['candidates'],properties:{candidates:{type:'array',minItems:Math.min(target,12),items:{type:'object',additionalProperties:false,required:['publication','title','url','reason'],properties:{publication:{type:'string'},title:{type:'string'},url:{type:'string'},reason:{type:'string'}}}}}};
  const prompt=`Найди прямые страницы полноценных профессиональных рецензий игры ${title} (${year||'год неизвестен'}). Нужны именно длинные обзоры, которые можно прочитать целиком, включая архивные копии старых журналов/сайтов.\n\nВажно:\n- Metacritic/OpenCritic/GameRankings и другие агрегаторы не являются источником текста; их можно использовать только чтобы узнать название издания и потом найти оригинал.\n- User reviews, форумы, wiki, новости, превью, гайды запрещены.\n- Для умершего сайта ищи Web Archive или действующий официальный архив публикации.\n- Один источник = одно независимое профессиональное издание.\n- Ищи не менее ${candidateTarget} кандидатов, чтобы после HTTP/full-text проверки осталось ${target}.\n\nИздания, которые уже известны из score index: ${JSON.stringify([...new Set(indexedPublications)])}\n\nНаша база профессиональных сайтов: ${JSON.stringify(configured)}\n\nУже известные прямые/старые URL-подсказки: ${JSON.stringify(seed)}`;
  const result=await openai({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',input:prompt,text:{format:{type:'json_schema',name:'review_candidates',strict:true,schema}}});
  discovered=result.candidates||[];
}
const candidates=[];const candSeen=new Set();
for(const item of [...seed,...discovered.map(x=>({...x,source_kind:'review',origin:'web_search'}))]){const p=pubKey(item.publication),u=canonical(item.url);if(!p||!u.startsWith('http')||isAggregator(u)||forbiddenPath.test(u))continue;const key=`${p}|${u}`;if(candSeen.has(key))continue;candSeen.add(key);candidates.push({...item,url:u});if(candidates.length>=candidateTarget+20)break}
const acceptedRaw=[],rejected=[],pubSeen=new Set();
for(const candidate of candidates){
  const p=pubKey(candidate.publication);if(pubSeen.has(p))continue;
  let page=await fetchPage(candidate.url);if(!page||page.body_words<minimumBodyWords||!identityMatch(`${candidate.title} ${page.text.slice(0,25000)}`))page=await wayback(candidate.url);
  if(!page||page.body_words<minimumBodyWords){rejected.push({...candidate,reason:`full_review_body_below_${minimumBodyWords}_words_or_unavailable`});continue}
  if(!identityMatch(`${candidate.title} ${page.text.slice(0,30000)}`)){rejected.push({...candidate,reason:'game_identity_not_confirmed_in_body'});continue}
  pubSeen.add(p);acceptedRaw.push({...candidate,resolved_url:page.url,archived:page.archived,archive_of:page.archive_of||'',body_words:page.body_words,body:page.text});
  if(acceptedRaw.length>=target)break;
}
if(acceptedRaw.length<minimum){write(`data/parser-runs/review-article-corpus-${slug}.json`,{parser:'review-article-corpus-v1',status:'blocked',game_slug:slug,checked_at:new Date().toISOString(),minimum,target,candidates:candidates.length,full_reviews:acceptedRaw.length,rejected});throw new Error(`${slug}: article corpus blocked — ${acceptedRaw.length}/${minimum} readable independent professional reviews`)}
const dossierSchema={type:'object',additionalProperties:false,required:['sources'],properties:{sources:{type:'array',items:{type:'object',additionalProperties:false,required:['publication','summary','strengths','criticisms','systems','specific_examples','notable_claims','tone_and_context'],properties:{publication:{type:'string'},summary:{type:'string'},strengths:{type:'array',items:{type:'string'}},criticisms:{type:'array',items:{type:'string'}},systems:{type:'array',items:{type:'string'}},specific_examples:{type:'array',items:{type:'string'}},notable_claims:{type:'array',items:{type:'string'}},tone_and_context:{type:'string'}}}}}};
const dossiers=[];
for(let i=0;i<acceptedRaw.length;i+=4){
  const batch=acceptedRaw.slice(i,i+4);const input=batch.map(source=>({publication:source.publication,title:source.title,url:source.resolved_url,body_words:source.body_words,review_text:source.body.slice(0,18000)}));
  const result=await openai({model:process.env.OPENAI_RESEARCH_MODEL||process.env.OPENAI_MODEL||'gpt-5',input:`Ты исследователь игровой критики. Прочитай именно длинные тексты рецензий ниже и сделай подробные фактологические досье для последующего авторского обзора. Ничего не придумывай, не цитируй длинными фрагментами, формулируй по-русски своими словами. Для каждого источника нужны конкретные наблюдения о механиках, структуре игры, сюжете без крупных спойлеров, сильных и слабых сторонах, примерах и историческом контексте.\n\n${JSON.stringify(input)}`,text:{format:{type:'json_schema',name:'review_dossiers',strict:true,schema:dossierSchema}}});
  dossiers.push(...(result.sources||[]));
}
const dossierByPub=new Map(dossiers.map(d=>[pubKey(d.publication),d]));
const final=[];
for(const source of acceptedRaw){const dossier=dossierByPub.get(pubKey(source.publication));if(!dossier)continue;const claimCount=[...(dossier.strengths||[]),...(dossier.criticisms||[]),...(dossier.systems||[]),...(dossier.specific_examples||[]),...(dossier.notable_claims||[])].filter(Boolean).length;if(claimCount<minimumClaims)continue;final.push({id:`article-source-${final.length+1}`,publication:source.publication,title:source.title,url:source.url,resolved_url:source.resolved_url,archived:source.archived,archive_of:source.archive_of,body_words:source.body_words,origin:source.origin,dossier:{summary:dossier.summary,strengths:dossier.strengths||[],criticisms:dossier.criticisms||[],systems:dossier.systems||[],specific_examples:dossier.specific_examples||[],notable_claims:dossier.notable_claims||[],tone_and_context:dossier.tone_and_context}})}
if(final.length<minimum){write(`data/parser-runs/review-article-corpus-${slug}.json`,{parser:'review-article-corpus-v1',status:'blocked_after_dossier',game_slug:slug,checked_at:new Date().toISOString(),minimum,target,readable_reviews:acceptedRaw.length,dossier_reviews:final.length});throw new Error(`${slug}: article corpus dossier gate ${final.length}/${minimum}`)}
const corpus={schema_version:1,game_slug:slug,game_id:game.game_id||game.identity?.game_id||null,title,generated_at:new Date().toISOString(),policy:{minimum_full_reviews:minimum,target_full_reviews:target,minimum_source_body_words:minimumBodyWords,aggregator_index_only_for_discovery:true},coverage:{candidates:candidates.length,readable_full_reviews:acceptedRaw.length,accepted_dossiers:final.length,independent_publications:new Set(final.map(x=>pubKey(x.publication))).size,passed:true},sources:final.slice(0,target)};
write(`data/review-article-corpus/${slug}.json`,corpus);write(`data/parser-runs/review-article-corpus-${slug}.json`,{parser:'review-article-corpus-v1',status:'green',game_slug:slug,checked_at:new Date().toISOString(),minimum,target,candidates:candidates.length,readable_reviews:acceptedRaw.length,dossier_reviews:final.length,rejected:rejected.length});
console.log(JSON.stringify({slug,status:'green',full_reviews:final.length,candidates:candidates.length,minimum,target},null,2));
