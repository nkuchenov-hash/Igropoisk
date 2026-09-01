#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCanonicalNewsCatalog } from './lib/news-game-registry-adapter.mjs';
import { collectPersonCandidateKeys, sanitizeNewsGameHint } from './lib/news-game-candidate-safety.mjs';

const root=process.cwd();
const eventsPath=path.join(root,'data/news-events.json');
const reportPath=path.join(root,'tmp/news-game-identity-verification.json');
const timeout=Math.max(3000,Number(process.env.NEWS_GAME_VERIFY_TIMEOUT_MS||10000));

const NON_GAME_TITLES=new Set(['twitch','dreamworks','aoc','steam','xbox','playstation','nintendo','epic games','valve','ubisoft','electronic arts','ea','activision','blizzard','bethesda','capcom','sega','konami','bandai namco','ign','pc gamer','eurogamer','gamespot','polygon','rock paper shotgun','playground']);
const NON_GAME_SUFFIX=/\b(?:studio|studios|software|interactive|entertainment|publisher|publishing|games|inc|llc|ltd)\b$/i;
const GENERIC_EDITION=/^(?:complete|deluxe|ultimate|gold|standard|legacy|collector'?s?)\s+edition$/i;
const HEADLINE_TITLE_SEQUENCE=/\b(?:[A-Z]{2,}|[A-Z][A-Za-z0-9:'’.-]*)(?:\s+(?:(?:of|the|and|for|to|in|on|with)|[A-Z]{2,}|[A-Z][A-Za-z0-9:'’.-]*|\d+)){1,7}\b/g;
const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}+/gu,'').replace(/[’‘]/gu,"'").replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim().toLowerCase();
const slugify=value=>normalize(value).replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
const stableTempId=title=>`news_game_${crypto.createHash('sha1').update(`verified-news-game:${normalize(title)}`).digest('hex').slice(0,16)}`;
const text=(item,keys)=>{for(const key of keys)if(String(item?.[key]||'').trim())return String(item[key]).trim();return''};
const titleLooksLikeGame=title=>{const value=String(title||'').trim(),key=normalize(value);return Boolean(key&&!NON_GAME_TITLES.has(key)&&!NON_GAME_SUFFIX.test(value)&&!GENERIC_EDITION.test(value)&&!/^\d+$/.test(key))};
const articleText=item=>normalize(`${text(item,['titleEn','titleRu','title'])} ${text(item,['summaryEn','summaryRu','summary'])}`);
const sourceUrl=item=>String(item.primaryUrl||item.url||'').trim();

const payload=JSON.parse(await fs.readFile(eventsPath,'utf8'));
const items=Array.isArray(payload)?payload:(Array.isArray(payload?.items)?payload.items:[]);
const knownPersonCandidates=collectPersonCandidateKeys(items);
const catalog=await loadCanonicalNewsCatalog({root});
const byId=new Map(catalog.games.map(game=>[String(game.gameId||''),game]));
const bySlug=new Map(catalog.games.map(game=>[String(game.slug||'').toLowerCase(),game]));
const byName=new Map();
for(const game of catalog.games){for(const value of [game.title,game.slug,...(game.aliases||[]),...(game.abbreviations||[])]){const key=normalize(value);if(!key)continue;const list=byName.get(key)||[];list.push(game);byName.set(key,list)}}
const uniqueName=value=>{const list=byName.get(normalize(value))||[];return list.length===1?list[0]:null};
const canonicalFor=hint=>byId.get(String(hint?.gameId||hint?.game_id||''))||bySlug.get(String(hint?.slug||'').toLowerCase())||uniqueName(hint?.title||'')||null;

function mentioned(item,game,hint){
  const hay=articleText(item);if(!hay)return false;
  const candidates=[game?.title,game?.slug,...(game?.aliases||[]),...(game?.abbreviations||[]),hint?.title].map(normalize).filter(v=>v.length>=3);
  return candidates.some(value=>hay.includes(value));
}
function inferredHeadlineCandidates(item){
  const headline=text(item,['titleEn','titleRu','title']);
  const seen=new Set();const candidates=[];
  for(const match of headline.matchAll(HEADLINE_TITLE_SEQUENCE)){
    const candidate=String(match[0]||'').replace(/\s+(?:Studio|Studios|Developer|Developers|Publisher|Publishing)$/i,'').trim();
    const key=normalize(candidate);
    if(!key||seen.has(key)||!titleLooksLikeGame(candidate))continue;
    seen.add(key);candidates.push({title:candidate,index:Number(match.index||0)});
  }
  return candidates.sort((a,b)=>a.index-b.index||b.title.length-a.title.length).slice(0,6).map(row=>row.title);
}
async function fetchJson(url){try{const r=await fetch(url,{headers:{'user-agent':'IgropoiskIdentityBot/1.1'},signal:AbortSignal.timeout(timeout)});if(!r.ok)return null;return await r.json()}catch{return null}}
async function fetchText(url){try{const r=await fetch(url,{headers:{'user-agent':'IgropoiskIdentityBot/1.1'},signal:AbortSignal.timeout(timeout)});if(!r.ok)return'';return await r.text()}catch{return''}}
async function verifyWithWikidata(title){
  const wanted=normalize(title);if(!wanted)return null;
  const search=await fetchJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&type=item&limit=6&format=json&origin=*`);
  const rows=Array.isArray(search?.search)?search.search:[];
  const matches=rows.filter(row=>normalize(row?.label||row?.match?.text||'')===wanted||normalize(row?.match?.text||'')===wanted);
  for(const row of matches){
    const id=String(row?.id||'');if(!/^Q\d+$/.test(id))continue;
    const entityPayload=await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=claims&format=json&origin=*`);
    const entity=entityPayload?.entities?.[id];
    const instances=(entity?.claims?.P31||[]).map(claim=>claim?.mainsnak?.datavalue?.value?.id).filter(Boolean);
    if(instances.includes('Q7889'))return{type:'database',url:`https://www.wikidata.org/wiki/${id}`,matchedBy:'wikidata-video-game-exact',canonicalTitle:String(row?.label||title)};
  }
  return null;
}
async function verifyExternalTitle(title){
  const wanted=normalize(title);if(!titleLooksLikeGame(title)||!wanted)return null;
  const oc=await fetchJson(`https://opencritic.com/api/game/search?criteria=${encodeURIComponent(title)}`);
  const ocItems=Array.isArray(oc)?oc:(Array.isArray(oc?.results)?oc.results:[]);
  const ocMatch=ocItems.find(item=>normalize(item?.name||item?.title)===wanted);
  if(ocMatch){const id=Number(ocMatch.id||ocMatch.gameId||0);return{type:'database',url:id?`https://opencritic.com/game/${id}`:'https://opencritic.com/',matchedBy:'opencritic-exact',canonicalTitle:String(ocMatch.name||ocMatch.title||title)}}
  const wikidata=await verifyWithWikidata(title);if(wikidata)return wikidata;
  const steam=await fetchText(`https://store.steampowered.com/search/suggest?term=${encodeURIComponent(title)}&f=games&cc=US&l=english`);
  const rawNames=[...steam.matchAll(/<div class="match_name">([^<]+)<\/div>/gi)].map(match=>String(match[1]||'').trim());
  const exactName=rawNames.find(name=>normalize(name)===wanted);
  if(exactName){const app=steam.match(/data-ds-appid="(\d+)"|data-ds-appid='(\d+)'/i);const appid=app?.[1]||app?.[2]||'';return{type:'store',url:appid?`https://store.steampowered.com/app/${appid}/`:'https://store.steampowered.com/',matchedBy:'steam-exact',canonicalTitle:exactName}}
  return null;
}
function canonicalGame(game,hint,item){return{gameId:game.gameId,slug:game.slug,title:game.title,pageExists:Boolean(game.pageExists),pageUrl:game.pageExists?game.pageUrl:'',manual:false,matchedBy:'registry-context-verified',verifiedExternal:true,identityVerified:true,verificationSources:[{type:'registry',url:game.pageUrl||''},{type:'editorial',url:sourceUrl(item)}].filter(source=>/^https?:\/\//i.test(source.url)),resolutionConfidence:0.99}}
function externalGame(title,evidence,item){const canonicalTitle=String(evidence?.canonicalTitle||title).trim()||title;return{gameId:stableTempId(canonicalTitle),slug:slugify(canonicalTitle),title:canonicalTitle,pageExists:false,pageUrl:'',manual:false,matchedBy:`direct-evidence-${evidence.matchedBy}`,verifiedExternal:true,identityVerified:true,verificationSources:[evidence,{type:'editorial',url:sourceUrl(item)}].filter(source=>/^https?:\/\//i.test(source.url)),resolutionConfidence:0.95}}

let specificGameArticles=0,nonGameArticles=0,ambiguousArticles=0,canonicalMatches=0,verifiedNewGames=0,unsafeHintsRejected=0,headlineInferredGames=0;
const issues=[];const cache=new Map();
const normalizedItems=[];
for(const item of items){
  const id=String(item.id||'');
  const reasons=new Set((Array.isArray(item.gameReviewReasons)?item.gameReviewReasons:[]).filter(reason=>!['missing-game-page','unknown-explicit-game','ambiguous-explicit-name','ambiguous-alias','manual-game-not-found','unverified-primary-game','ambiguous-primary-game-verification','verified-no-primary-game'].includes(reason)));
  const rawHints=Array.isArray(item.games)?item.games:[];
  const hints=rawHints.map(hint=>sanitizeNewsGameHint(item,hint,{knownPersonCandidates})).filter(hint=>hint&&titleLooksLikeGame(hint.title||hint.slug||''));
  unsafeHintsRejected+=Math.max(0,rawHints.length-hints.length);
  const games=[];const seen=new Set();
  for(const hint of hints){
    const canonical=canonicalFor(hint);
    if(canonical&&mentioned(item,canonical,hint)){
      const game=canonicalGame(canonical,hint,item);if(!seen.has(game.gameId)){seen.add(game.gameId);games.push(game);canonicalMatches+=1}continue;
    }
    const candidate=String(hint.title||'').trim();
    if(!candidate||!mentioned(item,null,hint))continue;
    let evidence=cache.get(normalize(candidate));
    if(evidence===undefined){evidence=await verifyExternalTitle(candidate);cache.set(normalize(candidate),evidence||null)}
    if(evidence){const game=externalGame(candidate,evidence,item);if(!seen.has(game.gameId)){seen.add(game.gameId);games.push(game);verifiedNewGames+=1}}
  }
  if(!games.length&&!hints.length){
    for(const candidate of inferredHeadlineCandidates(item)){
      const canonical=uniqueName(candidate);
      if(canonical&&mentioned(item,canonical,{title:candidate})){
        const game=canonicalGame(canonical,{title:candidate},item);seen.add(game.gameId);games.push(game);canonicalMatches+=1;headlineInferredGames+=1;break;
      }
      let evidence=cache.get(normalize(candidate));
      if(evidence===undefined){evidence=await verifyExternalTitle(candidate);cache.set(normalize(candidate),evidence||null)}
      if(evidence){const game=externalGame(candidate,evidence,item);seen.add(game.gameId);games.push(game);verifiedNewGames+=1;headlineInferredGames+=1;break}
    }
  }
  if(games.length){specificGameArticles+=1;if(games.some(game=>!game.pageExists))reasons.add('missing-game-page');normalizedItems.push({...item,games,gameIds:games.map(game=>game.gameId),gameReviewReasons:[...reasons],gameIdentityVerifiedAt:new Date().toISOString()});continue}
  if(hints.length){ambiguousArticles+=1;reasons.add('ambiguous-primary-game-verification');issues.push({news_id:id,reason:'candidate lacked safe canonical context match or direct database/store evidence',candidates:hints.map(h=>h.title||h.slug)});normalizedItems.push({...item,games:[],gameIds:[],gameReviewReasons:[...reasons]});continue}
  nonGameArticles+=1;reasons.add('verified-no-primary-game');normalizedItems.push({...item,games:[],gameIds:[],gameReviewReasons:[...reasons],gameIdentityVerifiedAt:new Date().toISOString()});
}
const report={schema_version:6,generated_at:new Date().toISOString(),provider:'registry-plus-headline-inference-opencritic-wikidata-steam-with-history-safety-guards',paid_ai_required:false,articles:normalizedItems.length,specific_game_articles:specificGameArticles,non_game_articles:nonGameArticles,ambiguous_articles:ambiguousArticles,canonical_matches:canonicalMatches,verified_new_game_references:verifiedNewGames,headline_inferred_game_references:headlineInferredGames,unsafe_hints_rejected:unsafeHintsRejected,known_person_candidates:knownPersonCandidates.size,unique_games:new Set(normalizedItems.flatMap(item=>(item.games||[]).map(game=>game.gameId))).size,issues};
await fs.mkdir(path.dirname(reportPath),{recursive:true});
await fs.writeFile(eventsPath,`${JSON.stringify(Array.isArray(payload)?normalizedItems:{...payload,items:normalizedItems},null,2)}\n`,'utf8');
await fs.writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
console.log(`[news/game-verifier] ${report.articles} articles; game=${specificGameArticles}; non-game=${nonGameArticles}; ambiguous=${ambiguousArticles}; headline-inferred=${headlineInferredGames}; unsafe hints rejected=${unsafeHintsRejected}; known person candidates=${knownPersonCandidates.size}; unique games=${report.unique_games}; paid AI required=false.`);
