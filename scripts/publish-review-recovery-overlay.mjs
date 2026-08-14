#!/usr/bin/env node
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';

const args=process.argv.slice(2);
const phase=args.includes('--final')?'final':'checkpoint';
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const branch=`automation/recover-canonical-reviews-${phase}-${runId}-${runAttempt}`;
const missing='__missing__';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function git(argv,{quiet=false}={}){
  return execFileSync('git',argv,{encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:['ignore','pipe','inherit']}).trim();
}
function command(commandName,argv){
  return spawnSync(commandName,argv,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
function succeeds(commandName,argv){return command(commandName,argv).status===0}
function objectAt(ref,file){
  const result=command('git',['rev-parse',`${ref}:${file}`]);
  return result.status===0?String(result.stdout||'').trim():missing;
}
function refreshStaging(){
  git(['fetch','origin','staging']);
  const fresh=git(['rev-parse','origin/staging'],{quiet:true});
  git(['checkout','-B','staging',fresh]);
  return fresh;
}

const base=git(['rev-parse','HEAD'],{quiet:true});
git(['add','-A','--','data','article']);
if(succeeds('git',['diff','--cached','--quiet'])){
  console.log(JSON.stringify({phase,status:'no_changes',base},null,2));
  process.exit(0);
}
git(['diff','--check']);
const files=git(['diff','--cached','--name-only','--','data','article'],{quiet:true}).split('\n').map(x=>x.trim()).filter(Boolean);
git(['config','user.name','igropoisk-content[bot]']);
git(['config','user.email','igropoisk-content[bot]@users.noreply.github.com']);
git(['commit','-m',phase==='checkpoint'?'Checkpoint deterministic canonical review recovery':'Recover canonical review backlog']);
const resultCommit=git(['rev-parse','HEAD'],{quiet:true});
let prUrl='';
let lastMergeError='';

for(let publishAttempt=1;publishAttempt<=4;publishAttempt++){
  git(['fetch','origin','staging']);
  const fresh=git(['rev-parse','origin/staging'],{quiet:true});
  git(['checkout','-B','recovery-overlay-work',fresh]);
  let applied=0,skipped=0,already=0;
  const skippedFiles=[];
  for(const file of files){
    const baseObj=objectAt(base,file),freshObj=objectAt(fresh,file),resultObj=objectAt(resultCommit,file);
    if(freshObj===resultObj){already++;continue}
    if(freshObj!==baseObj){skipped++;skippedFiles.push(file);continue}
    if(resultObj===missing){fs.rmSync(file,{force:true,recursive:false})}
    else git(['checkout',resultCommit,'--',file]);
    applied++;
  }
  git(['add','-A','--','data','article']);
  if(succeeds('git',['diff','--cached','--quiet'])){
    refreshStaging();
    console.log(JSON.stringify({phase,status:'fresh_state_won',base,result_commit:resultCommit,fresh,applied,already,skipped,skipped_files:skippedFiles},null,2));
    process.exit(0);
  }
  git(['diff','--check']);
  git(['commit','-m',`${phase==='checkpoint'?'Checkpoint':'Publish'} canonical review recovery on fresh staging`]);
  git(['push','--force','origin',`HEAD:refs/heads/${branch}`]);
  if(!prUrl){
    const title=phase==='checkpoint'?`Checkpoint canonical review recovery ${runId}.${runAttempt}`:`Recover canonical reviews ${runId}.${runAttempt}`;
    const body=`Conflict-safe ${phase} publication. Recovery output is overlaid on the latest staging tip only for paths unchanged since this run began; newer parallel lifecycle updates are preserved. Source result commit: ${resultCommit}.`;
    const created=command('gh',['pr','create','--base','staging','--head',branch,'--title',title,'--body',body]);
    if(created.status!==0)throw new Error(`Unable to create recovery PR: ${created.stderr||created.stdout}`);
    prUrl=String(created.stdout||'').trim();
  }
  const merged=command('gh',['pr','merge',prUrl,'--merge','--delete-branch']);
  if(merged.status===0){
    const mergedStaging=refreshStaging();
    console.log(JSON.stringify({phase,status:'merged',base,result_commit:resultCommit,staging:mergedStaging,publish_attempt:publishAttempt,applied,already,skipped,skipped_files:skippedFiles},null,2));
    process.exit(0);
  }
  lastMergeError=String(merged.stderr||merged.stdout||'').trim();
  console.error(`Recovery ${phase} merge attempt ${publishAttempt} failed; rebuilding on the newest staging tip. ${lastMergeError}`);
  if(publishAttempt<4)await sleep(2500);
}
throw new Error(`Unable to publish ${phase} recovery after conflict-safe retries: ${lastMergeError}`);
