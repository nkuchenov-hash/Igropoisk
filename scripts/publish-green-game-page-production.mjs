#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const repo=process.env.GITHUB_REPOSITORY||'nkuchenov-hash/Igropoisk';
const slug=String(process.argv[2]||process.env.GAME_TARGET_SLUG||'').trim().toLowerCase();
const requestedStagingSha=String(process.argv[3]||process.env.STAGING_SHA||'').trim();
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const reportPath=path.resolve(process.env.GAME_PAGE_PRODUCTION_REPORT||path.join(os.tmpdir(),`igropoisk-game-page-production-${runId}-${runAttempt}.json`));
const branch=`automation/game-page-production-${runId}-${runAttempt}`;

if(!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Unsafe or missing game slug: ${slug||'(empty)'}`);

function command(name,args,{cwd=process.cwd(),input='',quiet=false,allowFailure=false}={}){
  const result=spawnSync(name,args,{cwd,encoding:'utf8',input,env:process.env,maxBuffer:32*1024*1024});
  const stdout=String(result.stdout||'');
  const stderr=String(result.stderr||'');
  if(!quiet&&stdout.trim()) process.stdout.write(stdout);
  if(!quiet&&stderr.trim()) process.stderr.write(stderr);
  if(result.status!==0&&!allowFailure) throw new Error(`${name} ${args.join(' ')} failed (${result.status}): ${(stderr||stdout).trim()}`);
  return {status:result.status,stdout,stderr};
}
const git=(args,options={})=>command('git',args,options);
const gh=(args,options={})=>command('gh',args,options);
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`)};
const copyIfExists=(sourceRoot,targetRoot,relative)=>{
  const source=path.join(sourceRoot,relative);
  if(!fs.existsSync(source)) return false;
  const target=path.join(targetRoot,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(source,target);
  return true;
};

const root=fs.mkdtempSync(path.join(os.tmpdir(),'igropoisk-green-page-production-'));
const sourceRoot=path.join(root,'staging');
const productionRoot=path.join(root,'main');
let sourceAdded=false;
let productionAdded=false;
try{
  git(['fetch','origin','main','staging']);
  const stagingSha=requestedStagingSha||git(['rev-parse','origin/staging'],{quiet:true}).stdout.trim();
  if(!/^[0-9a-f]{40}$/i.test(stagingSha)) throw new Error(`Invalid staging SHA: ${stagingSha}`);
  const ancestor=git(['merge-base','--is-ancestor',stagingSha,'origin/staging'],{quiet:true,allowFailure:true});
  if(ancestor.status!==0) throw new Error(`Requested staging SHA ${stagingSha} is not in current staging history`);

  git(['worktree','add','--detach',sourceRoot,stagingSha]);
  sourceAdded=true;
  git(['worktree','add','--detach',productionRoot,'origin/main']);
  productionAdded=true;
  git(['checkout','-b',branch],{cwd:productionRoot});

  const qcPath=path.join(sourceRoot,`data/quality-control/page-${slug}-control.json`);
  const mediaQcPath=path.join(sourceRoot,`data/quality-control/game-page-${slug}.json`);
  const shellPath=path.join(sourceRoot,`game/${slug}/index.html`);
  const draftPath=path.join(sourceRoot,`data/drafts/${slug}.json`);
  if(!fs.existsSync(qcPath)||readJson(qcPath)?.green!==true) throw new Error(`Target ${slug} is not green in staging ${stagingSha}`);
  const mediaQc=fs.existsSync(mediaQcPath)?readJson(mediaQcPath):null;
  if(mediaQc&&mediaQc.status!=='green'&&mediaQc.green!==true) throw new Error(`Target ${slug} media QC is not green in staging ${stagingSha}`);
  if(!fs.existsSync(shellPath)) throw new Error(`Green target has no public shell: game/${slug}/index.html`);
  if(!fs.existsSync(draftPath)) throw new Error(`Green target has no public draft: data/drafts/${slug}.json`);

  const sourceReport=path.join(sourceRoot,'tmp','green-game-page-production-source.json');
  const sourceOutput=path.join(sourceRoot,'tmp','green-game-page-production-materialized.json');
  writeJson(sourceReport,{ready_games:[{slug}]});
  command(process.execPath,[path.join(sourceRoot,'scripts/materialize-game-creator-pages.mjs'),'--target',productionRoot,'--report',sourceReport,'--output',sourceOutput],{cwd:sourceRoot});

  const optionalPublicArtifacts=[
    `data/reviews/${slug}.json`,
    `data/review-discovery-seeds/${slug}.json`,
    `data/ratings/${slug}.json`,
    `data/similarity/${slug}.json`
  ];
  const copiedOptional=optionalPublicArtifacts.filter(relative=>copyIfExists(sourceRoot,productionRoot,relative));

  command(process.execPath,[path.join(sourceRoot,'scripts/validate-game-shells.mjs'),slug],{cwd:productionRoot});
  command('python3',[path.join(productionRoot,'scripts/enforce_layout_contract.py'),'--check'],{cwd:productionRoot});
  git(['diff','--check'],{cwd:productionRoot});

  const stagePaths=[
    `game/${slug}/index.html`,
    `data/drafts/${slug}.json`,
    'data/catalog-visible.json',
    'data/game-content',
    ...copiedOptional
  ].filter(relative=>fs.existsSync(path.join(productionRoot,relative)));
  git(['add','-A','--',...stagePaths],{cwd:productionRoot});

  let productionSha=git(['rev-parse','origin/main'],{cwd:productionRoot,quiet:true}).stdout.trim();
  let productionPr='';
  const staged=git(['diff','--cached','--quiet'],{cwd:productionRoot,quiet:true,allowFailure:true});
  if(staged.status!==0){
    git(['config','user.name','igropoisk-content[bot]'],{cwd:productionRoot});
    git(['config','user.email','igropoisk-content[bot]@users.noreply.github.com'],{cwd:productionRoot});
    git(['commit','-m',`Publish green Game Page: ${slug}`],{cwd:productionRoot});
    git(['push','origin',branch],{cwd:productionRoot});
    productionPr=gh(['pr','create','--base','main','--head',branch,'--title',`Publish green Game Page: ${slug}`,'--body',`Production-only publication of the verified green Game Page \`${slug}\` from staging \`${stagingSha}\`. Includes only its public shell/draft, merged catalog and game-content entry, plus available public review/rating/similarity feeds. No unrelated staging UI or pipeline state is promoted.`],{cwd:productionRoot,quiet:true}).stdout.trim();
    if(!productionPr) throw new Error('Production PR URL was not returned');
    gh(['pr','merge',productionPr,'--merge','--delete-branch'],{cwd:productionRoot});
    git(['fetch','origin','main'],{cwd:productionRoot});
    productionSha=git(['rev-parse','origin/main'],{cwd:productionRoot,quiet:true}).stdout.trim();
  }

  for(const relative of [`game/${slug}/index.html`,`data/drafts/${slug}.json`]){
    const sourceObject=git(['rev-parse',`${stagingSha}:${relative}`],{quiet:true}).stdout.trim();
    const productionObject=git(['rev-parse',`origin/main:${relative}`],{cwd:productionRoot,quiet:true}).stdout.trim();
    if(!sourceObject||sourceObject!==productionObject) throw new Error(`Production parity failed for ${relative}`);
  }

  const report={
    status:'published',
    slug,
    staging_sha:stagingSha,
    production_sha:productionSha,
    production_pr:productionPr||null,
    public_page:`game/${slug}/index.html`,
    copied_optional:copiedOptional
  };
  writeJson(reportPath,report);
  console.log(JSON.stringify(report,null,2));
}finally{
  if(productionAdded) git(['worktree','remove','--force',productionRoot],{quiet:true,allowFailure:true});
  if(sourceAdded) git(['worktree','remove','--force',sourceRoot],{quiet:true,allowFailure:true});
  fs.rmSync(root,{recursive:true,force:true});
}
