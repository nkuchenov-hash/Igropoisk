import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug){console.error('Usage: node scripts/prepare-review-research.mjs <game-slug>');process.exit(1)}
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))}catch{return fallback}};
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const checkedAt=new Date().toISOString();
const corpusPath=`data/game-sources/${slug}.json`;
const corpus=read(corpusPath);
if(!corpus){
  console.error(`Missing canonical game source corpus: ${corpusPath}`);
  console.error('Review Module does not perform independent source discovery. Build/refresh the Game Page source corpus first.');
  process.exit(2);
}
const draft=read(`data/drafts/${slug}.json`,{});
const raw=Array.isArray(corpus.sources)?corpus.sources:[];
const canonical=value=>{try{const u=new URL(value);u.hash='';for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ysclid'])u.searchParams.delete(key);return `${u.origin}${u.pathname.replace(/\/$/,'')}${u.search}`}catch{return String(value||'').trim()}};
const sources=raw.map((source,index)=>({
  ...source,
  id:source.id||`source-${index+1}`,
  publication:source.publication||source.name||source.source||`Источник ${index+1}`,
  title:source.title||source.name||'',
  url:canonical(source.resolved_url||source.url||''),
  resolved_url:canonical(source.resolved_url||source.url||''),
  source_kind:source.source_kind||source.role||source.type||'editorial',
  canonical_owner:'game-page-module'
})).filter(source=>source.url||source.title||source.publication);
const scoreSources=sources.filter(source=>{
  const score=Number(source.score),scale=Number(source.scale);
  return (Number.isFinite(score)&&Number.isFinite(scale)&&scale>0)||String(source.grade||'').trim();
}).map(source=>({publication:source.publication,title:source.title,url:source.resolved_url,score:Number.isFinite(Number(source.score))?Number(source.score):null,scale:Number.isFinite(Number(source.scale))?Number(source.scale):null,grade:String(source.grade||''),source_kind:source.source_kind}));
const discoveryComplete=corpus.source_scan_complete!==false&&corpus.discovery?.complete!==false;
const gameId=corpus.game_id||draft.identity?.game_id||null;
const matrix={
  schema_version:10,
  game_slug:slug,
  game_id:gameId,
  generated_at:checkedAt,
  ownership:'game-page-canonical-corpus-adapter',
  canonical_source:corpusPath,
  policy:{independent_review_discovery:false,fixed_source_count_required:false,collect_all_available_from_canonical_corpus:true,exact_game_version_required:true},
  source_registry_scan:{registered_sources:null,settled_sources:sources.length,complete:discoveryComplete,checks:[]},
  external_search:{complete:discoveryComplete,provider:'game-page-module',queries:0},
  accepted:sources,
  rejected:[],
  score_sources:scoreSources,
  coverage:{accepted_readable_articles:sources.length,scored_sources:scoreSources.length,page_material_scan_complete:discoveryComplete}
};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,{
  schema_version:19,
  game_slug:slug,
  game_id:gameId,
  updated_at:checkedAt,
  derived_from_canonical_game_source_corpus:true,
  canonical_source:corpusPath,
  publication_gate:{fixed_count_required:false,minimum:0,target:null,maximum:null,accepted:sources.length,status:discoveryComplete?'green':'red-needs-revision',criterion:'canonical_game_source_corpus_available_and_discovery_not_explicitly_incomplete'},
  reviews:sources,
  score_sources:scoreSources,
  rejected:[]
});
write(`data/parser-runs/review-research-${slug}.json`,{
  parser:'review-source-corpus-adapter-v1',
  status:discoveryComplete?'green':'needs_revision',
  game_slug:slug,
  checked_at:checkedAt,
  accepted_sources:sources.length,
  scored_sources:scoreSources.length,
  independent_review_discovery:false,
  fixed_source_count_required:false,
  canonical_owner:'game-page-module',
  canonical_source:corpusPath
});
console.log(JSON.stringify({slug,status:discoveryComplete?'green':'red-needs-revision',accepted_sources:sources.length,scored_sources:scoreSources.length,independent_review_discovery:false,canonical_owner:'game-page-module'},null,2));
if(!discoveryComplete)process.exitCode=2;
