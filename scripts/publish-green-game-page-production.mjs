#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const slug=String(process.argv[2]||process.env.GAME_TARGET_SLUG||'').trim().toLowerCase();
const requestedStagingSha=String(process.argv[3]||process.env.STAGING_SHA||'').trim();
const runId=process.env.GITHUB_RUN_ID||String(Date.now()),runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const reportPath=path.resolve(process.env.GAME_PAGE_PRODUCTION_REPORT||path.join(os.tmpdir(),`igropoisk-game-page-production-${runId}-${runAttempt}.json`));
const branch=`automation/game-page-production-${runId}-${runAttempt}`;
if(!/^[a-z0-9][a-z0-9-]*$/.test(slug))throw new Error(`Unsafe or missing game slug: ${slug||'(empty)'}`);
function command(name,args,{cwd=process.cwd(),quiet=false,allowFailure=false}={}){const result=spawnSync(name,args,{cwd,encoding:'utf8',env:process.env,maxBuffer:32*1024*1024});const stdout=String(result.stdout||''),stderr=String(result.stderr||'');if(!quiet&&stdout.trim())process.stdout.write(stdout);if(!quiet&&stderr.trim())process.stderr.write(stderr);if(result.status!==0&&!allowFailure)throw new Error(`${name} ${args.join(' ')} failed (${result.status}): ${(stderr||stdout).trim()}`);return{status:result.status,stdout,stderr}}
const git=(args,options={})=>command('git',args,options),gh=(args,options={})=>command('gh',args,options);
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`)};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'igropoisk-green-page-production-')),sourceRoot=path.join(root,'staging'),productionRoot=path.join(root,'main');let sourceAdded=false,productionAdded=false;
try{
  git(['fetch','origin','main','staging']);const stagingSha=requestedStagingSha||git(['rev-parse','origin/staging'],{quiet:true}).stdout.trim();if(!/^[0-9a-f]{40}$/i.test(stagingSha))throw new Error(`Invalid staging SHA: ${stagingSha}`);if(git(['merge-base','--is-ancestor',stagingSha,'origin/staging'],{quiet:true,allowFailure:true}).status!==0)throw new Error(`Requested staging SHA ${stagingSha} is not in current staging history`);
  git(['worktree','add','--detach',sourceRoot,stagingSha]);sourceAdded=true;git(['worktree','add','--detach',productionRoot,'origin/main']);productionAdded=true;git(['checkout','-b',branch],{cwd:productionRoot});
  command(process.execPath,['scripts/validate-game-page-module-integrity.mjs'],{cwd:sourceRoot});
  command(process.execPath,['scripts/validate-game-page-publication-state.mjs',slug],{cwd:sourceRoot});
  const sourceReport=path.join(sourceRoot,'tmp','green-game-page-production-source.json'),sourceOutput=path.join(sourceRoot,'tmp','green-game-page-production-materialized.json');writeJson(sourceReport,{ready_games:[{slug}]});
  command(process.execPath,[path.join(sourceRoot,'scripts/materialize-game-creator-pages.mjs'),'--target',productionRoot,'--report',sourceReport,'--output',sourceOutput],{cwd:sourceRoot});
  command(process.execPath,[path.join(sourceRoot,'scripts/validate-game-page-publication-state.mjs'),slug],{cwd:productionRoot});
  command('python3',[path.join(productionRoot,'scripts/enforce_layout_contract.py'),'--check'],{cwd:productionRoot});git(['diff','--check'],{cwd:productionRoot});

  const required=[`game/${slug}/index.html`,`data/drafts/${slug}.json`,`data/page-editorial/${slug}.json`,`data/game-sources/${slug}.json`,`data/quality-control/page-${slug}-control.json`,`data/quality-control/game-page-content-${slug}.json`,`data/quality-control/game-page-${slug}.json`];
  const optional=[`data/ratings/${slug}.json`,`data/similarity/${slug}.json`].filter(relative=>fs.existsSync(path.join(productionRoot,relative)));
  const stagePaths=[...required,...optional,'data/catalog-visible.json','data/game-content'].filter(relative=>fs.existsSync(path.join(productionRoot,relative)));git(['add','-A','--',...stagePaths],{cwd:productionRoot});
  let productionSha=git(['rev-parse','origin/main'],{cwd:productionRoot,quiet:true}).stdout.trim(),productionPr='';const staged=git(['diff','--cached','--quiet'],{cwd:productionRoot,quiet:true,allowFailure:true});
  if(staged.status!==0){git(['config','user.name','igropoisk-content[bot]'],{cwd:productionRoot});git(['config','user.email','igropoisk-content[bot]@users.noreply.github.com'],{cwd:productionRoot});git(['commit','-m',`Promote finalized Game Page: ${slug}`],{cwd:productionRoot});git(['push','origin',branch],{cwd:productionRoot});productionPr=gh(['pr','create','--base','main','--head',branch,'--title',`Promote finalized Game Page: ${slug}`,'--body',`Promotes the already-finalized canonical Game Page package for \`${slug}\` from staging \`${stagingSha}\`. This publisher cannot synthesize page state; source and target both pass the canonical publication-state validator. The Игропоиск Review subsystem is not required for this promotion.`],{cwd:productionRoot,quiet:true}).stdout.trim();if(!productionPr)throw new Error('Production PR URL was not returned');gh(['pr','merge',productionPr,'--merge','--delete-branch'],{cwd:productionRoot});git(['fetch','origin','main'],{cwd:productionRoot});productionSha=git(['rev-parse','origin/main'],{cwd:productionRoot,quiet:true}).stdout.trim()}
  for(const relative of required){const sourceObject=git(['rev-parse',`${stagingSha}:${relative}`],{quiet:true}).stdout.trim(),productionObject=git(['rev-parse',`origin/main:${relative}`],{cwd:productionRoot,quiet:true}).stdout.trim();if(!sourceObject||sourceObject!==productionObject)throw new Error(`Production parity failed for ${relative}`)}
  const report={status:'published',slug,staging_sha:stagingSha,production_sha:productionSha,production_pr:productionPr||null,publication_owner:'scripts/finalize-game-page-publication.mjs',promoter:'copy-only',required_parity:required,optional_copied:optional};writeJson(reportPath,report);console.log(JSON.stringify(report,null,2));
}finally{if(productionAdded)git(['worktree','remove','--force',productionRoot],{quiet:true,allowFailure:true});if(sourceAdded)git(['worktree','remove','--force',sourceRoot],{quiet:true,allowFailure:true});fs.rmSync(root,{recursive:true,force:true})}
