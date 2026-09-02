#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const catalog=read('data/catalog-visible.json',[]),plan=read('data/content-pipeline/execution-plan.json',{schema_version:1,pages:[],reviews:[]});plan.pages=Array.isArray(plan.pages)?plan.pages:[];plan.reviews=Array.isArray(plan.reviews)?plan.reviews:[];
const norm=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim(),arr=value=>Array.isArray(value)?value:[],unique=(items,key=item=>typeof item==='string'?item:item?.url||JSON.stringify(item))=>{const seen=new Set();return items.filter(item=>{const value=key(item);if(!value||seen.has(value))return false;seen.add(value);return true})},mergeObject=(parser={},draft={})=>({...parser,...draft}),preferArray=(draft,parser)=>arr(draft).length?arr(draft):arr(parser),technicalTitle=(title,slug)=>{const raw=String(title||'').trim();return !raw||norm(raw)===norm(slug)&&(/[-_]/.test(raw)||raw===raw.toLowerCase())};
let written=0,protectedPublished=0,queuedRevisions=0;
for(const game of catalog){
  const slug=String(game.slug||'');if(!slug)continue;const parser=read(`data/parser-output/${slug}.json`),current=read(`data/drafts/${slug}.json`);if(!parser&&!current)continue;
  if(current?.publication?.status==='published'&&current?.publication?.public_ready===true){
    protectedPublished++;
    if(parser&&!plan.pages.some(item=>item.slug===slug)){plan.pages.push({type:'build_page',game_id:String(game.game_id||current.game_id||''),slug,title:game.title||current.identity?.title||slug,steam_appid:Number(game.steam_appid||parser?.identity?.steam_appid)||null,priority:900,reason:'catalog_enrichment_requires_canonical_page_revision'});queuedRevisions++}
    continue;
  }
  const legacy=current||{};const parserRequirements=parser?.requirements||{},legacyRequirements=legacy?.requirements||{};const requirements={...parserRequirements,...legacyRequirements,pc:{...(parserRequirements.pc||{}),...(legacyRequirements.pc||{}),minimum:{...(parserRequirements.pc?.minimum||{}),...(legacyRequirements.pc?.minimum||{})},recommended:{...(parserRequirements.pc?.recommended||{}),...(legacyRequirements.pc?.recommended||{})}},platforms:preferArray(legacyRequirements.platforms,parserRequirements.platforms||parser?.classification?.platforms)};
  const parserTitle=parser?.identity?.title,catalogTitle=game.title,legacyTitle=legacy?.identity?.title,richTitle=!technicalTitle(legacyTitle,slug)?legacyTitle:!technicalTitle(parserTitle,slug)?parserTitle:'',canonicalTitle=richTitle||catalogTitle||legacyTitle||parserTitle||slug;
  const identity={...(parser?.identity||{}),...(legacy?.identity||{}),slug,title:canonicalTitle,game_id:game.game_id||legacy?.identity?.game_id||legacy?.game_id||parser?.identity?.game_id||''};
  const classification={...(parser?.classification||{}),...(legacy?.classification||{}),genres:preferArray(legacy?.classification?.genres,parser?.classification?.genres),categories:preferArray(legacy?.classification?.categories,parser?.classification?.categories),platforms:preferArray(parser?.classification?.platforms,legacy?.classification?.platforms)};
  const media={...(parser?.media||{}),...(legacy?.media||{}),screenshots:unique([...arr(legacy?.media?.screenshots),...arr(parser?.media?.screenshots)]),videos:unique([...arr(legacy?.media?.videos),...arr(parser?.media?.videos)]),artwork:unique([...arr(legacy?.media?.artwork),...arr(parser?.media?.artwork)])};
  const sources=unique([...arr(legacy?.sources),...(parser?.source?.url?[{title:parser.source.name||'Источник данных игры',source_name:parser.source.name||'',url:parser.source.url,checked_at:parser.source.checked_at||''}]:[])],item=>item?.url||'');
  const merged={...(parser||{}),...(legacy||{}),schema_version:Math.max(Number(parser?.schema_version||0),Number(legacy?.schema_version||0),4),publication:{...(legacy?.publication||{}),status:'needs_revision',public_ready:false,gate_passed:false},identity,release:mergeObject(parser?.release,legacy?.release),companies:{...(parser?.companies||{}),...(legacy?.companies||{}),developers:preferArray(legacy?.companies?.developers,parser?.companies?.developers),publishers:preferArray(legacy?.companies?.publishers,parser?.companies?.publishers)},classification,editorial:mergeObject(parser?.editorial,legacy?.editorial),media,requirements,links:mergeObject(parser?.links,legacy?.links),sources};
  write(`data/drafts/${slug}.json`,merged);written++;
}
plan.updated_at=new Date().toISOString();write('data/content-pipeline/execution-plan.json',plan);
console.log(JSON.stringify({catalog_games:catalog.length,revision_drafts_written:written,published_packages_protected:protectedPublished,published_revisions_queued:queuedRevisions,public_state_mutations:0},null,2));
