#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: node scripts/build-game-source-knowledge.mjs <slug>');
const read=(p,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return f}};
const write=(p,v)=>{const t=path.join(root,p);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n')};
const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const canonical=v=>{try{const u=new URL(String(v||''));u.hash='';return`${u.origin}${u.pathname}${u.search}`}catch{return clean(v)}};
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const normalize=v=>clean(v).toLowerCase().replace(/[™®©]/g,'').replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const entityDecode=v=>String(v||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)||32));
const stripDiscoveryNoise=v=>clean(v).replace(/^Discovered by existing verified corpus;\s*/i,'').replace(/^matched alias:\s*[^.;:]+[.;:]?\s*/i,'');
const similarity=(a,b)=>{const A=new Set(normalize(a).split(/\s+/).filter(x=>x.length>=4)),B=new Set(normalize(b).split(/\s+/).filter(x=>x.length>=4));if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.min(A.size,B.size)};

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
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 IgropoiskSourceKnowledge/2.0','accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'}});
    const type=String(r.headers.get('content-type')||'');
    if(!r.ok)return {ok:false,status:r.status,text:'',resolved_url:r.url||url};
    const raw=await r.text();const text=/html|xml/i.test(type)||/<html|<body|<article/i.test(raw)?htmlText(raw):clean(raw);
    return {ok:text.length>=180,status:r.status,text:text.slice(0,14000),resolved_url:r.url||url};
  }catch(error){return {ok:false,status:0,text:'',error:error.message,resolved_url:url}}finally{clearTimeout(timer)}
}
function splitSentences(text){return clean(text).split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9])/u).map(stripDiscoveryNoise).filter(s=>s.length>=45&&s.length<=520)}

const boilerplate=/\b(?:create an account|sign in|log in|subscribe|subscriber|newsletter|privacy policy|cookie|advertis(?:e|ing|ement)|latest reviews|latest news|follow .*twitter|how our ratings work|view all \d+|cheats|walkthrough|site map|disable this ad|bank holiday|purchase this game)\b/i;
const subjective=/\b(?:pros?:|cons?:|outstanding|our review|we think|we found|worth throwing|appeal|score|rating)\b/i;
const action=/\b(?:player|players|you|your|gameplay|play|control|create|build|craft|explor|combat|fight|manage|custom|editor|design|collect|choose|move|attack|charm|survive|игрок|игров|управ|созда|стро|исслед|бой|сраж|редактор|собира|выбира|атак|выжив)\w*/i;
const progression=/\b(?:object of the game|goal|objective|start(?:s|ing)? with|from .+ to|progress|stage|phase|level|evol|advance|develop|cell|creature|tribe|civilization|spacefar|interstellar|начина|цель|развит|этап|фаз|уров|эволюц|клет|существ|плем|цивилизац|космос|межзв)\w*/i;
const world=/\b(?:world|universe|planet|galaxy|species|city|base|starship|мир|вселен|планет|галак|вид|город|баз|корабл)\w*/i;
const mechanics=/\b(?:editor|create|build|custom|body part|vehicle|building|creature|combat|attack|charm|collect|resource|редактор|созда|стро|част.*тел|транспорт|здан|существ|бой|атак|собира|ресурс)\w*/i;
function sentenceScore(sentence,titleTokens){
  if(boilerplate.test(sentence))return -100;
  let score=0;const lower=normalize(sentence);
  if(progression.test(sentence))score+=8;
  if(/\b(?:object of the game|goal|objective|start(?:s|ing)? with|from .+ to|цель|начина)\b/i.test(sentence))score+=6;
  if(mechanics.test(sentence))score+=6;
  if(action.test(sentence))score+=4;
  if(world.test(sentence))score+=3;
  if(titleTokens.some(t=>lower.includes(t)))score+=2;
  if(sentence.length>=80&&sentence.length<=340)score+=2;
  if(subjective.test(sentence))score-=5;
  if(/\b(?:account|subscribe|download|website|internet connection|registration|аккаунт|подпис|сайт|регистрац)\b/i.test(sentence))score-=6;
  return score;
}
function evidencePack(text,titleTokens){
  const seen=new Set();
  return splitSentences(text).map((sentence,index)=>({sentence,score:sentenceScore(sentence,titleTokens),index}))
    .filter(x=>x.score>=5)
    .sort((a,b)=>b.score-a.score||a.index-b.index)
    .filter(x=>{const key=normalize(x.sentence).slice(0,190);if(seen.has(key))return false;seen.add(key);return true})
    .slice(0,8);
}
function identityHits(text,tokens){const n=normalize(text);return tokens.reduce((sum,t)=>sum+(n.match(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g'))||[]).length,0)}

const corpus=read(`data/game-sources/${slug}.json`,{});
if(corpus?.discovery?.complete!==true)throw new Error(`${slug}: complete canonical source corpus required before knowledge extraction`);
const draft=read(`data/drafts/${slug}.json`),parser=read(`data/parser-output/${slug}.json`,{}),matrix=read(`data/research/${slug}-source-matrix.json`,{});
if(!draft?.identity?.title)throw new Error(`${slug}: draft missing`);
const stop=new Set(['the','game','edition','remastered','remaster','complete','ultimate','deluxe','standard']);
const titleTokens=[...new Set([slug,...normalize(draft.identity.title).split(/\s+/),...(draft.identity.aliases||[]).flatMap(x=>normalize(x).split(/\s+/))].filter(x=>x.length>=4&&!stop.has(x)))];

const byUrl=new Map();
const add=(raw={})=>{
  const url=canonical(raw.resolved_url||raw.url||raw.source_url||'');if(!url)return;
  const old=byUrl.get(url)||{};
  const semantic=[raw.description,raw.snippet,raw.summary,raw.excerpt,raw.identity_evidence,...(Array.isArray(raw.evidence_points)?raw.evidence_points:[])].map(stripDiscoveryNoise).filter(x=>x&&!boilerplate.test(x));
  byUrl.set(url,{...old,id:old.id||raw.id||`source-${byUrl.size+1}`,name:clean(raw.name||raw.publication||raw.source_name||old.name),title:clean(raw.title||old.title),url,kind:raw.kind||raw.source_kind||old.kind||'source',professional:Boolean(raw.professional??old.professional),roles:[...new Set([...(old.roles||[]),...(raw.roles||[])])],semantic:[...new Set([...(old.semantic||[]),...semantic])]});
};
for(const s of corpus.sources||[])add(s);
for(const s of matrix.accepted||[])add({...s,professional:true,kind:'professional-review'});
if(draft.links?.official)add({name:'Official site',url:draft.links.official,roles:['facts','description','dna']});
if(draft.links?.store)add({name:'Store',url:draft.links.store,roles:['facts','description','dna']});
const candidates=[...byUrl.values()].filter(s=>s.professional||s.roles?.some(r=>['facts','description','dna','review'].includes(r)));
const parserEditorial=[parser?.editorial?.short_description,parser?.editorial?.integrated_description,parser?.editorial?.campaign,...(parser?.editorial?.features||[])].map(clean).filter(Boolean).join(' ');
const registryHash=hash({version:3,title:normalize(draft.identity.title),sources:candidates.map(s=>[s.id,s.url,s.semantic]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]))),parserEditorial});

let sourceContent=read(`data/game-source-content/${slug}.json`,null);
let cacheHit=Boolean(sourceContent?.schema_version>=3&&sourceContent.source_registry_hash===registryHash&&sourceContent.source_scan_complete===true&&Number(sourceContent.readable_sources)>=3);
if(!cacheHit){
  const fetched=[];
  for(let i=0;i<candidates.length;i+=6){
    const batch=candidates.slice(i,i+6);const results=await Promise.all(batch.map(async s=>({s,r:await fetchText(s.url)})));
    for(const {s,r} of results){
      const rawBody=clean(r.text);const urlNorm=normalize(s.url);const urlMatch=titleTokens.some(t=>urlNorm.includes(t));const bodyHits=identityHits(rawBody,titleTokens);
      const authoritative=s.roles?.some(role=>['facts','description','dna'].includes(role));
      const relevant=authoritative||urlMatch||bodyHits>=2;
      const embedded=clean((s.semantic||[]).join(' '));const text=relevant?clean([embedded,rawBody].filter(Boolean).join(' ')):'';
      const evidence=relevant?evidencePack(text,titleTokens):[];
      const readable=Boolean(relevant&&text.length>=180&&evidence.length);
      fetched.push({id:s.id,name:s.name,title:s.title,url:s.url,resolved_url:r.resolved_url,kind:s.kind,professional:s.professional,roles:s.roles,http_status:r.status,readable,relevance:relevant?'matched':'identity_mismatch',identity_hits:bodyHits,text:readable?text.slice(0,14000):'',text_chars:readable?text.length:0,evidence:evidence.map(x=>x.sentence),evidence_scores:evidence.map(x=>x.score)});
    }
  }
  if(parserEditorial.length>=60){const ev=evidencePack(parserEditorial,titleTokens);fetched.push({id:'structured-parser-description',name:parser?.source?.name||'Structured parser source',title:`${draft.identity.title} structured description`,url:parser?.source?.url||draft.links?.store||'',resolved_url:parser?.source?.url||draft.links?.store||'',kind:'structured-description',professional:false,roles:['facts','description','dna'],http_status:200,readable:true,relevance:'authoritative-structured',identity_hits:1,text:parserEditorial.slice(0,10000),text_chars:parserEditorial.length,evidence:ev.map(x=>x.sentence),evidence_scores:ev.map(x=>x.score)});}
  const readable=fetched.filter(s=>s.readable);
  sourceContent={schema_version:3,game_slug:slug,game_id:draft.game_id||corpus.game_id||null,title:draft.identity.title,generated_at:new Date().toISOString(),source_scan_complete:true,source_registry_hash:registryHash,total_candidates:fetched.length,readable_sources:readable.length,rejected_identity_mismatch:fetched.filter(x=>x.relevance==='identity_mismatch').length,sources:fetched};
  sourceContent.content_hash=hash(readable.map(s=>[s.id,s.url,s.text]));
  write(`data/game-source-content/${slug}.json`,sourceContent);
}

const readable=(sourceContent.sources||[]).filter(s=>s.readable);
if(readable.length<3)throw new Error(`${slug}: only ${readable.length} relevant readable semantic sources; at least 3 required`);
const ranked=[];
for(const source of readable){for(let i=0;i<(source.evidence||[]).length;i++){const claim=stripDiscoveryNoise(source.evidence[i]);const score=Number(source.evidence_scores?.[i]??sentenceScore(claim,titleTokens))+(source.professional?1:2);if(claim.length>=45&&!boilerplate.test(claim))ranked.push({claim,score,source_id:String(source.id)})}}
ranked.sort((a,b)=>b.score-a.score||a.claim.length-b.claim.length);
const selected=[];const perSource=new Map();
for(const item of ranked){if(selected.length>=8)break;if(selected.some(x=>similarity(x.claim,item.claim)>=0.78))continue;const count=perSource.get(item.source_id)||0;if(count>=4)continue;selected.push(item);perSource.set(item.source_id,count+1)}
if(selected.length<4)throw new Error(`${slug}: only ${selected.length} strong defining claims survived relevance ranking`);
const claims=selected.map((x,i)=>({claim:x.claim,source_ids:[x.source_id],claim_id:`claim-${i+1}`,importance_score:x.score}));
const pick=re=>claims.find(x=>re.test(x.claim))?.claim||'';
const progressionClaim=pick(progression)||claims[0].claim;
const roleClaim=pick(action)||claims.find(x=>x.claim!==progressionClaim)?.claim||claims[0].claim;
const coreClaim=pick(mechanics)||claims.find(x=>!new Set([progressionClaim,roleClaim]).has(x.claim))?.claim||claims[0].claim;
const worldClaim=pick(world)||claims.find(x=>!new Set([progressionClaim,roleClaim,coreClaim]).has(x.claim))?.claim||claims[0].claim;
const essence=[progressionClaim,roleClaim,coreClaim,worldClaim].filter((x,i,a)=>x&&a.indexOf(x)===i).slice(0,3).join(' ');
const mechanicClaims=claims.filter(x=>mechanics.test(x.claim)).map(x=>x.claim);
const knowledge={
  schema_version:3,game_slug:slug,game_id:draft.game_id||corpus.game_id||null,title:draft.identity.title,generated_at:new Date().toISOString(),status:'green',provider:'deterministic-source-evidence-v2',model:'none',source_content:`data/game-source-content/${slug}.json`,source_content_hash:sourceContent.content_hash,source_registry_hash:registryHash,source_content_cache_hit:cacheHit,source_count:readable.length,professional_source_count:readable.filter(x=>x.professional).length,evidence_source_count:new Set(claims.flatMap(x=>x.source_ids)).size,game_essence:essence,player_role:roleClaim,core_loop:coreClaim,progression_structure:progressionClaim,world_structure:worldClaim,mechanics:(mechanicClaims.length?mechanicClaims:claims.map(x=>x.claim)).slice(0,8),distinctive_features:claims.map(x=>x.claim).slice(0,8),consensus_praise:[],consensus_criticism:[],defining_claims:claims,evidence_hygiene:{version:3,identity_relevance_required:true,boilerplate_forbidden:true,global_importance_ranking:true,maximum_claims_per_source:4,ai_synthesis_required:false}
};
write(`data/game-knowledge/${slug}.json`,knowledge);
write(`data/parser-runs/game-source-knowledge-${slug}.json`,{parser:'game-source-knowledge-v4',game_slug:slug,status:'green',checked_at:knowledge.generated_at,provider:knowledge.provider,cache_hit:cacheHit,readable_sources:readable.length,rejected_identity_mismatch:sourceContent.rejected_identity_mismatch||0,defining_claims:claims.length,source_registry_hash:registryHash,output:`data/game-knowledge/${slug}.json`});
console.log(JSON.stringify({slug,status:'green',cache_hit:cacheHit,readable_sources:readable.length,rejected_identity_mismatch:sourceContent.rejected_identity_mismatch||0,defining_claims:claims.length,game_essence:knowledge.game_essence},null,2));
