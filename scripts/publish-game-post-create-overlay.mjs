#!/usr/bin/env node
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';

const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const branch=`automation/post-create-enrichment-${runId}-${runAttempt}`;
const missing='__missing__';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const roots=[
  'data/game-enrichment-requests',
  'data/game-registry',
  'data/franchises',
  'data/research',
  'data/reviews',
  'data/ratings',
  'data/articles',
  'data/article-drafts',
  'data/article-media',
  'data/media-candidates',
  'data/parser-runs',
  'data/quality-control',
  'data/drafts',
  'data/catalog-visible.json',
  'article'
];

function git(argv,{quiet=false}={}){
  return execFileSync('git',argv,{encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:['ignore','pipe','inherit']}).trim();
}
function command(name,argv){return spawnSync(name,argv,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}
function succeeds(name,argv){return command(name,argv).status===0}
function objectAt(ref,file){
  const result=command('git',['rev-parse',`${ref}:${file}`]);
  return result.status===0?String(result.stdout||'').trim():missing;
}
function existingRoots(){return roots.filter(root=>fs.existsSync(root))}
function stageAllowed(){
  const existing=existingRoots();
  if(existing.length)git(['add','-A','--',...existing]);
}
function refreshStaging(){
  git(['fetch','origin','staging']);
  const fresh=git(['rev-parse','origin/staging'],{quiet:true});
  git(['checkout','-B','staging',fresh]);
  return fresh;
}

const base=git(['rev-parse','HEAD'],{quiet:true});
stageAllowed();
if(succeeds('git',['diff','--cached','--quiet'])){
  console.log(JSON.stringify({status:'no_changes',base},null,2));
  process.exit(0);
}
git(['diff','--cached','--check']);
const files=git(['diff','--cached','--name-only','--',...roots],{quiet:true}).split('\n').map(x=>x.trim()).filter(Boolean);
git(['config','user.name','igropoisk-content[bot]']);
git(['config','user.email','igropoisk-content[bot]@users.noreply.github.com']);
git(['commit','-m','Enrich newly created canonical games']);
const resultCommit=git(['rev-parse','HEAD'],{quiet:true});
let prUrl='';
let lastMergeError='';

for(let publishAttempt=1;publishAttempt<=5;publishAttempt++){
  git(['fetch','origin','staging']);
  const fresh=git(['rev-parse','origin/staging'],{quiet:true});
  git(['checkout','-B','post-create-overlay-work',fresh]);
  let applied=0,already=0,skipped=0;
  const skippedFiles=[];

  for(const file of files){
    const baseObj=objectAt(base,file),freshObj=objectAt(fresh,file),resultObj=objectAt(resultCommit,file);
    if(freshObj===resultObj){already++;continue}
    if(freshObj!==baseObj){skipped++;skippedFiles.push(file);continue}
    if(resultObj===missing)fs.rmSync(file,{force:true,recursive:true});
    else git(['checkout',resultCommit,'--',file]);
    applied++;
  }

  stageAllowed();
  if(succeeds('git',['diff','--cached','--quiet'])){
    const staging=refreshStaging();
    console.log(JSON.stringify({status:'fresh_state_won',base,result_commit:resultCommit,staging,applied,already,skipped,skipped_files:skippedFiles},null,2));
    process.exit(0);
  }

  git(['diff','--cached','--check']);
  git(['commit','-m','Publish post-create enrichment on fresh staging']);
  git(['push','--force','origin',`HEAD:refs/heads/${branch}`]);

  if(!prUrl){
    const existing=command('gh',['pr','list','--base','staging','--head',branch,'--state','open','--json','url','--jq','.[0].url // empty']);
    prUrl=String(existing.stdout||'').trim();
    if(!prUrl){
      const body=`Conflict-safe post-create publication. Enrichment output is overlaid on the latest staging tip only for files unchanged since this run began; newer parallel lifecycle updates win and skipped modules remain queued for the next pass. Source result commit: ${resultCommit}.`;
      const created=command('gh',['pr','create','--base','staging','--head',branch,'--title',`Post-create game enrichment ${runId}.${runAttempt}`,'--body',body]);
      if(created.status!==0)throw new Error(`Unable to create post-create enrichment PR: ${created.stderr||created.stdout}`);
      prUrl=String(created.stdout||'').trim();
    }
  }

  const merged=command('gh',['pr','merge',prUrl,'--merge','--delete-branch']);
  if(merged.status===0){
    const staging=refreshStaging();
    console.log(JSON.stringify({status:'merged',base,result_commit:resultCommit,staging,publish_attempt:publishAttempt,applied,already,skipped,skipped_files:skippedFiles},null,2));
    process.exit(0);
  }

  lastMergeError=String(merged.stderr||merged.stdout||'').trim();
  console.error(`Post-create merge attempt ${publishAttempt} failed; rebuilding on newest staging. ${lastMergeError}`);
  if(publishAttempt<5)await sleep(2500);
}

throw new Error(`Unable to publish post-create enrichment after conflict-safe retries: ${lastMergeError}`);
