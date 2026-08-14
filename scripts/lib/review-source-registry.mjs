import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();

export function loadReviewSourceRegistry(configPath='config/parsers/review-source-registry.json'){
  const registry=JSON.parse(fs.readFileSync(path.join(root,configPath),'utf8'));
  if(!Array.isArray(registry.sources))throw new Error(`Invalid review source registry: ${configPath}`);
  const defaults=registry.defaults||{},reviewDefaults=defaults.review||{};
  registry.sources=registry.sources.map(source=>({
    ...defaults,
    ...source,
    review:source.review?{...reviewDefaults,...source.review,score:{...(reviewDefaults.score||{}),...(source.review.score||{})}}:null
  }));
  return registry;
}

const key=value=>String(value||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'');
const host=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
const pathText=value=>{try{return decodeURIComponent(new URL(value).pathname).toLowerCase()}catch{return String(value||'').toLowerCase()}};

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
