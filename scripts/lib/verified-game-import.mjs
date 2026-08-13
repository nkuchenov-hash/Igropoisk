import {GameRegistryApi} from './game-registry.mjs';

const strongSource=source=>['official_site','official_platform_store','official_press_release','structured_database','professional_publication'].includes(String(source?.type||''))&&/^https?:\/\//i.test(String(source?.url||''));
const primarySource=sources=>sources.find(source=>['official_site','official_platform_store','official_press_release'].includes(String(source?.type||'')))||sources.find(strongSource)||null;

export function registerVerifiedGameImports(registry={},requests=[]){
  const api=new GameRegistryApi(registry);const resolved=[],issues=[];let created=0,matched=0;
  for(const[index,request]of requests.entries()){
    const title=String(request?.title||'').trim(),slug=String(request?.slug||'').trim();
    const sources=(Array.isArray(request?.verification_sources)?request.verification_sources:[]).filter(strongSource),primary=primarySource(sources);
    if(!title||!slug){issues.push({index,status:'rejected',reason:'import_missing_identity'});continue}
    if(request.identity_verified!==true){issues.push({index,title,slug,status:'rejected',reason:'import_identity_not_verified'});continue}
    if(!primary||(!['official_site','official_platform_store','official_press_release'].includes(primary.type)&&sources.length<2)){issues.push({index,title,slug,status:'rejected',reason:'import_requires_primary_or_two_independent_verification_sources'});continue}
    const externalIds={...(request.external_ids||{})};if(request.steam_appid)externalIds.steamAppId=String(request.steam_appid);
    const candidate={title,slug,aliases:request.aliases||[],series:request.series||null,kind:request.kind||'game',externalIds,releases:request.releases||[],source:{type:primary.type,name:primary.name||'verified import',url:primary.url},sourceRecordId:request.import_id||slug,discoveryReason:'editor_verified_game_import',status:'identified',statusReason:'identity and release context verified for canonical lifecycle import',confidence:Number(request.confidence||0.99)};
    const registration=api.registerCandidate(candidate,{actor:'verified-game-import'});const entity=registration.entity||null,decision=registration.decision||'';
    if(!entity||['ambiguous','needs_review'].includes(decision)){issues.push({index,title,slug,status:decision||'unresolved',reason:'import_identity_needs_review'});continue}
    if(decision==='created')created+=1;else matched+=1;
    resolved.push({import_id:request.import_id||slug,game_id:entity.id,slug:String(entity.identity?.slug?.value||slug),title:String(entity.identity?.canonicalTitle?.value||title),steam_appid:entity.externalIds?.steamAppId?Number(entity.externalIds.steamAppId):null,verification_sources:sources,decision});
  }
  return{registry:api.registry,resolved,issues,created,matched};
}
