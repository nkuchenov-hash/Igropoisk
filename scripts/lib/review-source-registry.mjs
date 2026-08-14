import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();

export function loadReviewSourceRegistry(configPath='config/parsers/review-source-registry.json'){
  const registry=JSON.parse(fs.readFileSync(path.join(root,configPath),'utf8'));
  if(!Array.isArray(registry.sources))throw new Error(`Invalid review source registry: ${configPath}`);
  const {review:reviewDefaults={},...sourceDefaults}=registry.defaults||{};
  registry.sources=registry.sources.map(source=>({
    ...sourceDefaults,
    ...source,
    review:source.review&&Object.keys(source.review).length?{...reviewDefaults,...source.review,score:{...(reviewDefaults.score||{}),...(source.review.score||{})}}:null
  }));
  return registry;
}

const key=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const pathText=value=>{try{return decodeURIComponent(new URL(value).pathname).toLowerCase()}catch{return String(value||'').toLowerCase()}};
const normalizedText=value=>String(value||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const compile=patterns=>(patterns||[]).map(pattern=>{try{return new RegExp(pattern,'i')}catch{return null}}).filter(Boolean);

export function editorialSources(registry,{historical=true}={}){
  return (registry.sources||[]).filter(source=>{
    if(source.enabled===false||!source.review)return false;
    if(source.historical_only&&!historical)return false;
    return true;
  });
}

export function regionalEditorialSources(registry,region,{historical=false}={}){
  return editorialSources(registry,{historical:true}).filter(source=>{
    if(!(source.regions||[]).includes(region))return false;
    return source.modern===true||(historical&&source.historical_only===true);
  });
}

export function sourceDiscoveryDef(source){
  return {
    id:source.id,name:source.name,url:source.review?.discovery_url||'',type:source.review?.type||'review-search',
    enabled:source.enabled!==false,family:'editorial',language:source.language||'',regions:source.regions||[],
    modern:source.modern===true,historical_only:source.historical_only===true,trust:Number(source.trust||0),weight:Number(source.weight||0),
    score_policy:source.review?.score?.policy||'explicit_only',score_profile:source.review?.score?.extractor_profile||'generic-explicit',
    default_scale:source.review?.score?.default_scale??null
  };
}

export function findRegisteredSource(registry,raw={}){
  const sources=registry.sources||[],explicitId=String(raw.configured_source_id||raw.source_id||'').trim();
  if(explicitId){const exact=sources.find(source=>source.id===explicitId||(source.legacy_ids||[]).includes(explicitId));if(exact)return exact}
  const url=String(raw.resolved_url||raw.url||''),h=host(url),p=pathText(url);
  if(h){
    const exact=sources.find(source=>(source.domains||[]).some(domain=>h===domain||h.endsWith(`.${domain}`)));if(exact)return exact;
    if(h==='web.archive.org'){const archive=sources.find(source=>source.archive_match&&p.includes(String(source.archive_match).toLowerCase()));if(archive)return archive}
  }
  const publicationKey=key(raw.publication||raw.source||raw.name);
  if(publicationKey)return sources.find(source=>key(source.name)===publicationKey||(source.aliases||[]).some(alias=>key(alias)===publicationKey))||null;
  return null;
}

export function registeredEditorialSource(registry,raw={}){
  const source=findRegisteredSource(registry,raw);return source?.review?source:null;
}
export function configuredSourceId(registry,raw={}){return findRegisteredSource(registry,raw)?.id||''}

const genericBadPath=/(?:^|\/)(?:game|games|file|files|download|downloads|news|guide|guides|wiki|video|videos|screenshots?|gallery|forum|forums|cheats?|trainer|mods?)(?:\/|$)/i;
const genericReviewPath=/(?:review|reviews|opinion|recenzi|retsenzi|obzor|reviewed)/i;
const genericReviewText=/(?:\breview\b|\bverdict\b|\brecension\b|\brecenzj|\bобзор\b|\bрецензи)/i;
const genericReviewHubPath=/(?:^|\/)(?:reviews?|review-index|opinions?|opinion\/reviews?)\/?$/i;

export function classifyReviewPage(source,{url='',title='',bodyText=''}={}){
  if(!source?.review)return{accepted:false,reason:'source_not_editorial'};
  const pathname=pathText(url),rules=source.review.page_rules||{};
  const deny=compile(rules.url_deny);if(deny.some(rx=>rx.test(pathname)))return{accepted:false,reason:'publisher_url_deny'};
  const allow=compile(rules.url_allow),explicitAllow=allow.length&&allow.some(rx=>rx.test(pathname));
  if(allow.length&&!explicitAllow)return{accepted:false,reason:'publisher_url_not_allowed'};
  if(!explicitAllow&&genericReviewHubPath.test(pathname))return{accepted:false,reason:'review_hub_not_article'};
  const titleSignals=compile(rules.title_allow),explicitTitle=titleSignals.length&&titleSignals.some(rx=>rx.test(title));
  const requiredBody=compile(rules.body_allow);
  if(requiredBody.length&&!requiredBody.some(rx=>rx.test(bodyText)))return{accepted:false,reason:'publisher_editorial_marker_missing'};
  const forbiddenBody=compile(rules.body_deny);
  if(forbiddenBody.some(rx=>rx.test(bodyText)))return{accepted:false,reason:'publisher_body_deny'};
  const pathSignal=genericReviewPath.test(pathname),titleSignal=genericReviewText.test(title);
  if(!explicitAllow&&genericBadPath.test(pathname)&&!pathSignal)return{accepted:false,reason:'non_review_path'};
  if(!explicitAllow&&!explicitTitle&&!pathSignal&&!titleSignal)return{accepted:false,reason:'no_review_signal'};
  return{accepted:true,reason:explicitAllow||explicitTitle?'publisher_rule':pathSignal?'review_path':'review_title'};
}

const versionMarkers=[
  {id:'next_gen',rx:/\bnext[- ]?gen(?:eration)?\b/i},
  {id:'complete_edition',rx:/\bcomplete edition\b/i},
  {id:'definitive_edition',rx:/\bdefinitive edition\b/i},
  {id:'remaster',rx:/\bremaster(?:ed)?\b/i},
  {id:'remake',rx:/\bremake\b/i},
  {id:'enhanced_edition',rx:/\benhanced edition\b/i},
  {id:'goty_edition',rx:/\bgame of the year edition\b|\bgoty edition\b/i},
  {id:'switch_port',rx:/\bnintendo switch\b|\bswitch version\b|\bswitch port\b/i}
];

export function classifyCanonicalVersion({title='',url='',versionContext='',game={}}={}){
  const hay=normalizedText(`${title} ${url} ${versionContext}`),identity=game.identity||{},explicitExcluded=[...(identity.excluded_titles||[]),...(identity.excluded_versions||[])].map(normalizedText).filter(Boolean);
  for(const excluded of explicitExcluded)if(hay.includes(excluded))return{score_eligible:false,reason:`excluded_version:${excluded}`};
  const canonicalTitle=normalizedText(identity.title||'');
  for(const marker of versionMarkers){
    if(!marker.rx.test(hay))continue;
    if(canonicalTitle&&marker.rx.test(canonicalTitle))continue;
    return{score_eligible:false,reason:`variant_or_port:${marker.id}`};
  }
  return{score_eligible:true,reason:'canonical_version'};
}
