import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();

export function loadOfficialSourceRegistry(configPath='config/parsers/official-source-registry.json'){
  const registry=JSON.parse(fs.readFileSync(path.join(root,configPath),'utf8'));
  if(!Array.isArray(registry.sources))throw new Error(`Invalid official source registry: ${configPath}`);
  const defaults=registry.defaults||{};
  registry.sources=registry.sources.map(source=>({
    ...defaults,
    ...source,
    capabilities:[...new Set([...(defaults.capabilities||[]),...(source.capabilities||[])])],
  }));
  return registry;
}

export function officialSource(registry,id){
  return (registry?.sources||[]).find(source=>source.id===id)||null;
}

const getPath=(object,dotted)=>{
  let value=object;
  for(const part of String(dotted||'').split('.').filter(Boolean)){
    if(value==null)return null;
    value=value[part];
  }
  return value;
};

const eventPlatforms=record=>[...new Set((record?.events||[]).flatMap(event=>event.platforms||[]).map(String).filter(Boolean))];

function urlHost(value){
  try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}
  catch{return''}
}

function sourceEvidence(record,source){
  const evidence=[];
  for(const claim of record?.sources||[]){
    if(claim.registry_source_id===source.id){evidence.push(claim);continue}
    const host=urlHost(claim.url);
    if(host&&(source.domains||[]).some(domain=>host===domain||host.endsWith(`.${domain}`)))evidence.push(claim);
    if(source.id==='steam'&&String(claim.id||'').startsWith('steam:'))evidence.push(claim);
  }
  return evidence;
}

function applicability(record,source){
  const rules=source.applicability||{},reasons=[];
  if(rules.when_external_id_present&&getPath(record,`external_ids.${rules.when_external_id_present}`)!=null)reasons.push(`external_id:${rules.when_external_id_present}`);
  if(source.url_field&&getPath(record,source.url_field))reasons.push(`url:${source.url_field}`);
  if(source.dynamic_url_field&&getPath(record,source.dynamic_url_field))reasons.push(`url:${source.dynamic_url_field}`);
  const platforms=eventPlatforms(record);
  for(const pattern of rules.platform_patterns||[]){
    if(platforms.some(platform=>platform.toLowerCase().includes(String(pattern).toLowerCase()))){reasons.push(`platform:${pattern}`);break}
  }
  return {applicable:reasons.length>0,reasons};
}

export function attachOfficialSourceChecks(records,registry,generatedAt=new Date().toISOString()){
  return (records||[]).map(record=>{
    const checks=(registry.sources||[]).map(source=>{
      const applies=applicability(record,source);
      const evidence=sourceEvidence(record,source);
      const checked=evidence.some(item=>['success','found','confirmed'].includes(String(item.status||'success').toLowerCase()));
      return {
        source_id:source.id,
        family:source.family,
        authority:Number(source.authority||0),
        applicable:applies.applicable,
        applicability_reasons:applies.reasons,
        checked:applies.applicable?checked:false,
        result:applies.applicable?(checked?'found':'pending'):'not_applicable',
        evidence_source_ids:[...new Set(evidence.map(item=>item.id).filter(Boolean))],
      };
    });
    const unresolvedFirstParty=[];
    if(record.developer&&!getPath(record,'official_urls.developer'))unresolvedFirstParty.push('developer-official');
    if(record.publisher&&!getPath(record,'official_urls.publisher'))unresolvedFirstParty.push('publisher-official');
    return {
      ...record,
      official_source_checks:{
        registry_id:registry.id,
        generated_at:generatedAt,
        checks,
        unresolved_first_party_urls:unresolvedFirstParty,
      },
    };
  });
}

export function summarizeOfficialSourceCoverage(records,registry){
  let applicable=0,completed=0;
  const missing=[],unresolved=[];
  for(const record of records||[]){
    const block=record.official_source_checks||{};
    for(const check of block.checks||[]){
      if(!check.applicable)continue;
      applicable++;
      if(check.checked)completed++;
      else missing.push({game_id:record.game_id||null,game_slug:record.slug||null,title:record.title||null,source_id:check.source_id});
    }
    for(const sourceId of block.unresolved_first_party_urls||[])unresolved.push({game_id:record.game_id||null,game_slug:record.slug||null,title:record.title||null,source_id:sourceId});
  }
  return {
    registry_id:registry?.id||null,
    registered_sources:(registry?.sources||[]).length,
    applicable_checks:applicable,
    completed_checks:completed,
    pending_checks:Math.max(0,applicable-completed),
    coverage_percent:applicable?Number((completed/applicable*100).toFixed(1)):100,
    missing_required_checks:missing,
    unresolved_first_party_urls:unresolved,
  };
}

export function validateOfficialSourceRegistryWiring({registry,records=[]}={}){
  const errors=[];
  const required=['steam','playstation-store','xbox-store','nintendo-store','gog','developer-official','publisher-official'];
  const ids=new Set((registry?.sources||[]).map(source=>source.id));
  for(const id of required)if(!ids.has(id))errors.push(`official registry missing required source: ${id}`);
  for(const source of registry?.sources||[]){
    for(const capability of ['game_identity','release_date','release_status']){
      if(!source.capabilities?.includes(capability))errors.push(`${source.id}: missing required capability ${capability}`);
    }
  }
  for(const record of records||[]){
    const block=record.official_source_checks;
    if(!block||block.registry_id!==registry?.id)errors.push(`${record.slug||record.id}: official source check plan missing or stale`);
  }
  return errors;
}
