import { loadReviewSourceRegistry } from './review-source-registry.mjs';

export function loadPublicationSourceRegistry(configPath='config/parsers/review-source-registry.json'){
  return loadReviewSourceRegistry(configPath);
}

export function publicationSources(registry,{releaseRole=null,includeHistorical=false}={}){
  return (registry?.sources||[]).filter(source=>{
    if(source.enabled===false)return false;
    if(source.historical_only&&!includeHistorical)return false;
    if(!releaseRole)return true;
    return (source.release?.roles||[]).includes(releaseRole);
  });
}

function releaseRegion(source){
  const regions=source.regions||[];
  if(regions.includes('cis')||regions.includes('ru'))return 'cis';
  return 'global';
}

export function releaseMediaPanelConfig(registry,policy={}){
  const sources=publicationSources(registry,{releaseRole:'coverage'}).map(source=>({
    id:source.id,
    name:source.name,
    publisher_family:source.publisher_family||source.id,
    region:releaseRegion(source),
    languages:[source.language||'en'],
    roles:[...(source.release?.roles||[])],
    aliases:[...(source.aliases||[])],
    domains:[...(source.domains||[])],
    calendar_urls:[...(source.release?.calendar_urls||[])],
    trust:Number(source.trust||0),
    weight:Number(source.weight||0),
  }));
  return {...policy,sources,source_registry_id:registry.id||'publication-source-registry'};
}

export function publicationRegistryStats(registry){
  const active=publicationSources(registry);
  const coverage=publicationSources(registry,{releaseRole:'coverage'});
  const calendars=publicationSources(registry,{releaseRole:'calendar_discovery'});
  const upcoming=publicationSources(registry,{releaseRole:'upcoming_editorial'});
  const audience=publicationSources(registry,{releaseRole:'audience_interest'});
  return {
    registry_id:registry.id||null,
    total_sources:active.length,
    release_coverage_sources:coverage.length,
    calendar_discovery_sources:calendars.length,
    upcoming_editorial_sources:upcoming.length,
    audience_interest_sources:audience.length,
    calendar_source_ids:calendars.map(source=>source.id),
  };
}
