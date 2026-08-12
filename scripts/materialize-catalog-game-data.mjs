#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};
const catalog=read('data/catalog-visible.json',[]);
const norm=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9а-яё]+/gi,' ').trim();
const arr=value=>Array.isArray(value)?value:[];
const unique=(items,key=item=>typeof item==='string'?item:item?.url||JSON.stringify(item))=>{const seen=new Set();return items.filter(item=>{const value=key(item);if(!value||seen.has(value))return false;seen.add(value);return true})};
const mergeObject=(parser={},draft={})=>({...parser,...draft});
const preferArray=(draft,parser)=>arr(draft).length?arr(draft):arr(parser);
const draftDir=path.join(root,'data/drafts');
const drafts=[];
if(fs.existsSync(draftDir))for(const file of fs.readdirSync(draftDir).filter(name=>name.endsWith('.json'))){const value=read(`data/drafts/${file}`);if(value)drafts.push({file,value})}
function findLegacy(game,parser){
  const direct=read(`data/drafts/${game.slug}.json`);if(direct)return direct;
  const gameId=String(game.game_id||'');const steam=Number(game.steam_appid||parser?.identity?.steam_appid||0);const title=norm(game.title);
  return drafts.find(({value})=>gameId&&String(value?.identity?.game_id||value?.game_id||'')===gameId)?.value
    ||drafts.find(({value})=>steam&&Number(value?.identity?.steam_appid||0)===steam)?.value
    ||drafts.find(({value})=>title&&norm(value?.identity?.title)===title)?.value
    ||null;
}
let written=0,requirementsRecovered=0,aliasesRecovered=0;
for(const game of catalog){
  const slug=String(game.slug||'');if(!slug)continue;
  const parser=read(`data/parser-output/${slug}.json`);
  const legacy=findLegacy(game,parser);if(!parser&&!legacy)continue;
  const alias=legacy?.identity?.slug&&legacy.identity.slug!==slug;if(alias)aliasesRecovered++;
  const parserRequirements=parser?.requirements||{};const legacyRequirements=legacy?.requirements||{};
  const requirements={...parserRequirements,...legacyRequirements,
    pc:{...(parserRequirements.pc||{}),...(legacyRequirements.pc||{}),
      minimum:{...(parserRequirements.pc?.minimum||{}),...(legacyRequirements.pc?.minimum||{})},
      recommended:{...(parserRequirements.pc?.recommended||{}),...(legacyRequirements.pc?.recommended||{})}},
    platforms:preferArray(legacyRequirements.platforms,parserRequirements.platforms||parser?.classification?.platforms)
  };
  if(parserRequirements.pc?.minimum?.raw||parserRequirements.pc?.recommended?.raw)requirementsRecovered++;
  const identity={...(parser?.identity||{}),...(legacy?.identity||{}),slug,title:legacy?.identity?.title||game.title||parser?.identity?.title||slug,game_id:game.game_id||legacy?.identity?.game_id||parser?.identity?.game_id||''};
  const classification={...(parser?.classification||{}),...(legacy?.classification||{}),genres:preferArray(legacy?.classification?.genres,parser?.classification?.genres),categories:preferArray(legacy?.classification?.categories,parser?.classification?.categories),platforms:preferArray(parser?.classification?.platforms,legacy?.classification?.platforms)};
  const media={...(parser?.media||{}),...(legacy?.media||{}),screenshots:unique([...arr(legacy?.media?.screenshots),...arr(parser?.media?.screenshots)]),videos:unique([...arr(legacy?.media?.videos),...arr(parser?.media?.videos)]),artwork:unique([...arr(legacy?.media?.artwork),...arr(parser?.media?.artwork)])};
  const sources=unique([...arr(legacy?.sources),...(parser?.source?.url?[{title:parser.source.name||'Источник данных игры',source_name:parser.source.name||'',url:parser.source.url,domain:(()=>{try{return new URL(parser.source.url).hostname}catch{return''}})(),checked_at:parser.source.checked_at||''}]:[])],item=>item?.url||'');
  const merged={...(parser||{}),...(legacy||{}),schema_version:Math.max(Number(parser?.schema_version||0),Number(legacy?.schema_version||0),3),identity,release:mergeObject(parser?.release,legacy?.release),companies:{...(parser?.companies||{}),...(legacy?.companies||{}),developers:preferArray(legacy?.companies?.developers,parser?.companies?.developers),publishers:preferArray(legacy?.companies?.publishers,parser?.companies?.publishers)},classification,editorial:mergeObject(parser?.editorial,legacy?.editorial),media,requirements,links:mergeObject(parser?.links,legacy?.links),materials:{reviews:preferArray(legacy?.materials?.reviews,parser?.materials?.reviews),news:preferArray(legacy?.materials?.news,parser?.materials?.news),guides:preferArray(legacy?.materials?.guides,parser?.materials?.guides)},sources};
  write(`data/drafts/${slug}.json`,merged);written++;
}
console.log(JSON.stringify({catalog_games:catalog.length,canonical_drafts_written:written,draft_aliases_recovered:aliasesRecovered,requirements_recovered:requirementsRecovered},null,2));