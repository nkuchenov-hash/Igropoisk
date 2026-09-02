#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const sourceRoot=process.cwd();
const arg=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null};
const targetRoot=path.resolve(arg('--target')||'');
const reportPath=path.resolve(sourceRoot,arg('--report')||'tmp/game-creator-report.json');
const outputPath=path.resolve(sourceRoot,arg('--output')||'tmp/game-creator-production.json');
if(!targetRoot||!fs.existsSync(targetRoot))throw new Error('Use --target <target-worktree>.');
const read=(file,fallback=null)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}};
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`)};
const copy=relative=>{const source=path.join(sourceRoot,relative);if(!fs.existsSync(source))return false;const target=path.join(targetRoot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);return true};
const validate=(cwd,slugs)=>{const result=spawnSync(process.execPath,['scripts/validate-game-page-publication-state.mjs',...slugs],{cwd,encoding:'utf8',stdio:'pipe',env:process.env,maxBuffer:16*1024*1024});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.status!==0)throw new Error(`Game Page publication-state validation failed in ${cwd}`)};

const report=read(reportPath,{ready_games:[]});
const candidates=[...(Array.isArray(report.ready_games)?report.ready_games:[]),...(Array.isArray(report.games)?report.games:[])];
const slugs=[...new Set(candidates.map(game=>String(game.slug||'').trim().toLowerCase()).filter(Boolean))];
if(!slugs.length){console.log('[game-page-promotion] no finalized pages to promote');process.exit(0)}
for(const slug of slugs)if(!/^[a-z0-9][a-z0-9-]*$/.test(slug))throw new Error(`Unsafe game slug: ${slug}`);

// copy-only promotion adapter: never creates public state. It may only copy a package that has already
// been finalized by scripts/finalize-game-page-publication.mjs and passes the canonical gate.
validate(sourceRoot,slugs);
const sourceCatalog=read(path.join(sourceRoot,'data/catalog-visible.json'),[]),targetCatalogPath=path.join(targetRoot,'data/catalog-visible.json'),targetCatalog=read(targetCatalogPath,[]);
const sourceBySlug=new Map(sourceCatalog.map(item=>[String(item?.slug||''),item])),mergedCatalog=new Map(targetCatalog.map(item=>[String(item?.slug||''),item]));
const located=new Map(),copiedBySlug={};
for(const slug of slugs){
  const draft=read(path.join(sourceRoot,`data/drafts/${slug}.json`));
  if(draft?.publication?.status!=='published'||draft?.publication?.public_ready!==true)throw new Error(`${slug}: source draft is not finalized`);
  const required=[
    `game/${slug}/index.html`,
    `data/drafts/${slug}.json`,
    `data/page-editorial/${slug}.json`,
    `data/game-sources/${slug}.json`,
    `data/quality-control/page-${slug}-control.json`,
    `data/quality-control/game-page-content-${slug}.json`,
    `data/quality-control/game-page-${slug}.json`
  ];
  const optional=[`data/ratings/${slug}.json`,`data/similarity/${slug}.json`];
  for(const relative of required)if(!copy(relative))throw new Error(`Finalized package missing required artifact: ${relative}`);
  for(const relative of optional)copy(relative);
  const entry=sourceBySlug.get(slug);if(!entry)throw new Error(`Finalized catalog entry missing ${slug}`);mergedCatalog.set(slug,entry);
  copiedBySlug[slug]=[...required,...optional.filter(relative=>fs.existsSync(path.join(sourceRoot,relative)))];
}
write(targetCatalogPath,[...mergedCatalog.values()]);

const sourceContent=path.join(sourceRoot,'data/game-content');
const files=fs.existsSync(sourceContent)?fs.readdirSync(sourceContent).filter(name=>name.endsWith('.json')):[];
for(const name of files){const sourceChunk=read(path.join(sourceContent,name));if(!sourceChunk?.games)continue;const selected=slugs.filter(slug=>sourceChunk.games[slug]);if(!selected.length)continue;const targetFile=path.join(targetRoot,'data/game-content',name),targetChunk=read(targetFile,{schema_version:sourceChunk.schema_version||5,games:{}});targetChunk.schema_version=Math.max(Number(targetChunk.schema_version||1),Number(sourceChunk.schema_version||1));targetChunk.games=targetChunk.games||{};for(const slug of selected){targetChunk.games[slug]=sourceChunk.games[slug];located.set(slug,name)}write(targetFile,targetChunk)}
for(const slug of slugs)if(!located.has(slug))throw new Error(`Finalized game-content missing ${slug}`);
validate(targetRoot,slugs);
write(outputPath,{schema_version:2,generated_at:new Date().toISOString(),source_report:path.relative(sourceRoot,reportPath),publication_owner:'scripts/finalize-game-page-publication.mjs',promoter:'copy-only',games:slugs.map(slug=>({slug,game_content:located.get(slug),copied:copiedBySlug[slug]}))});
console.log(`[game-page-promotion] copied ${slugs.length} already-finalized Game Page package(s); no public state was synthesized by the promotion adapter.`);
