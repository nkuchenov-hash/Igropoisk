function norm(value){return String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim()}
function host(value){try{return new URL(String(value||'')).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function publication(source){return String(source?.publication||source?.source||source?.name||'')}

export function isPrimaryReviewSource(source,{primaryId='igromania',primaryName='Игромания'}={}){
  const p=norm(publication(source));
  const h=host(source?.resolved_url||source?.url||source?.archive_of||'');
  return p===norm(primaryName)||p===norm(primaryId)||h==='igromania.ru'||h.endsWith('.igromania.ru');
}

export function independentReviewCount(corpus={}){
  const explicit=Number(corpus?.coverage?.independent_publications||0);
  const keys=new Set();
  for(const source of corpus?.sources||[]){
    if(source?.source_role&&source.source_role!=='professional_review')continue;
    const key=norm(publication(source))||host(source?.resolved_url||source?.url||'');
    if(key)keys.add(key);
  }
  return Math.max(explicit,keys.size);
}

export function classifyReviewImportance({corpus={},force=false,threshold=8,primaryId='igromania',primaryName='Игромания'}={}){
  const sources=Array.isArray(corpus?.sources)?corpus.sources:[];
  const primaryFound=sources.some(source=>isPrimaryReviewSource(source,{primaryId,primaryName}));
  const independent=independentReviewCount(corpus);
  const exhaustive=corpus?.coverage?.exhaustive_discovery===true;
  const minimum=Math.max(1,Number(threshold||8));
  if(force)return{status:'required',required:true,reason:'explicit_force_override',primaryFound,independent,exhaustive,threshold:minimum};
  if(primaryFound)return{status:'required',required:true,reason:'igromania_full_review_found',primaryFound,independent,exhaustive,threshold:minimum};
  if(independent>=minimum)return{status:'required',required:true,reason:`professional_review_volume_${independent}_gte_${minimum}`,primaryFound,independent,exhaustive,threshold:minimum};
  if(exhaustive)return{status:'not_required',required:false,reason:`exhaustive_discovery_below_${minimum}_and_no_igromania_review`,primaryFound,independent,exhaustive,threshold:minimum};
  return{status:'pending',required:false,reason:'importance_discovery_not_exhaustive',primaryFound,independent,exhaustive,threshold:minimum};
}
