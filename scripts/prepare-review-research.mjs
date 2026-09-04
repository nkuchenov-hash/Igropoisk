#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/prepare-review-research.mjs <game-slug>');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};
const sourcePath=`data/game-sources/${slug}.json`;
if(!fs.existsSync(path.join(root,sourcePath)))throw new Error(`Missing canonical source pack ${sourcePath}. Run the Game Page source pipeline; Review Module does not discover sources.`);
const pack=read(sourcePath);
const checkedAt=new Date().toISOString();
const editorial=(pack.sources||[]).filter(source=>source?.role==='professional_review'||source?.type==='professional_review').map((source,index)=>({...source,id:source.id||`source-${index+1}`}));
const scoreSources=editorial.filter(source=>(Number.isFinite(Number(source.score))&&Number.isFinite(Number(source.scale))&&Number(source.scale)>0)||String(source.grade||'').trim()).map(source=>({publication:source.publication||source.name||'',title:source.title||'',url:source.resolved_url||source.url||'',score:Number.isFinite(Number(source.score))?Number(source.score):null,scale:Number.isFinite(Number(source.scale))?Number(source.scale):null,grade:String(source.grade||''),source_kind:source.source_kind||'review'}));
const discoveryComplete=pack.source_scan_complete===true||pack.discovery?.complete===true;
const matrix={schema_version:10,game_slug:slug,generated_at:checkedAt,ownership:'game-page-source-pipeline',canonical_source_file:sourcePath,policy:{review_module_discovery:false,fixed_source_quota:null,use_all_available_verified_editorial_sources:true},accepted:editorial,rejected:pack.rejected||[],score_sources:scoreSources,coverage:{accepted_readable_articles:editorial.length,scored_sources:scoreSources.length,page_material_scan_complete:discoveryComplete}};
const reviews={schema_version:19,game_slug:slug,game_id:pack.game_id||null,updated_at:checkedAt,derived_from_game_source_discovery:true,canonical_source_file:sourcePath,publication_gate:{minimum:null,target:null,maximum:null,accepted:editorial.length,status:editorial.length?'available':'no-editorial-evidence',criterion:'use_available_canonical_corpus'},reviews:editorial,score_sources:scoreSources,rejected:pack.rejected||[]};
write(`data/research/${slug}-source-matrix.json`,matrix);
write(`data/reviews/${slug}.json`,reviews);
write(`data/parser-runs/review-research-${slug}.json`,{parser:'review-canonical-source-adapter-v1',status:editorial.length?'ready':'needs_revision',game_slug:slug,checked_at:checkedAt,accepted_readable_articles:editorial.length,scored_sources:scoreSources.length,canonical_source_file:sourcePath,review_module_discovery:false,fixed_source_quota:null});
console.log(JSON.stringify({slug,status:editorial.length?'ready':'needs_revision',canonical_source_file:sourcePath,editorial_sources:editorial.length,scored_sources:scoreSources.length,review_module_discovery:false},null,2));
if(!editorial.length)process.exitCode=2;
