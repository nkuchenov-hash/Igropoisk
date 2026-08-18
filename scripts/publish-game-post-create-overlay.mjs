#!/usr/bin/env node
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';

const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const publishPhase=String(process.env.POST_CREATE_PUBLISH_PHASE||'final').toLowerCase().replace(/[^a-z0-9-]+/g,'-')||'final';
const branch=`automation/post-create-enrichment-${publishPhase}-${runId}-${runAttempt}`;
const missing='__missing__';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const roots=[
  'data/game-enrichment-requests','data/game-registry','data/franchises','data/game-dna','data/similarity','data/research','data/reviews','data/ratings',
  'data/review-bootstrap','data/articles','data/article-drafts','data/article-media','data/media-candidates','data/parser-runs','data/quality-control',
  'data/drafts','data/catalog-visible.json','article'
];
function git(argv,{quiet=false}={}){return execFileSync('git',argv,{encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:['ignore','pipe','inherit']}).trim()}
function command(name,argv){return spawnSync(name,argv,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}
function succeeds(name,argv){return command(name,argv).status===0}
function objectAt(ref,file){const result=command('git',['rev-parse',`${ref}:${file}`]);return result.status===0?String(result.stdout||'').trim():missing}
function existingRoots(){return roots.filter(root=>fs.existsSync(root))}
function stageAllowed(){const existing=existingRoots();if(existing.length)git(['add','-A','--',...existing])}
function refreshStaging(){git(['fetch','origin','staging']);const fresh=git(['rev-parse','origin/staging'],{quiet:true});git(['checkout','-B','staging',fresh]);return fresh}
function transientGithubFailure(text){return /HTTP\s+(?:502|503|504)|server is currently available|graphql|timeout|temporar/i.test(String(text||''))}
async function createPrWithRetry(body){
  let last='';
  for(let attempt=1;attempt<=5;attempt++){
    const created=command('gh',['pr','create','--base','staging','--head',branch,'--title',`Post-create ${publishPhase} enrichment ${runId}.${runAttempt}`,'--body',body]);
    if(created.status===0)return String(created.stdout||'').trim();
    last=String(created.stderr||created.stdout||'').trim();
    if(!transientGithubFailure(last)||attempt===5)break;
    console.error(`Transient GitHub PR-create failure ${attempt}/5; retrying. ${last}`);
    await sleep(3000*attempt);
  }
  throw new Error(`Unable to create post-create ${publishPhase} enrichment PR after retries: ${last}`);
}

const base=git(['rev-parse','HEAD'],{quiet:true});stageAllowed();
if(succeeds('git',['diff','--cached','--quiet'])){console.log(JSON.stringify({phase:publishPhase,status:'no_changes',base},null,2));process.exit(0)}
git(['diff','--cached','--check']);
const files=git(['diff','--cached','--name-only','--',...roots],{quiet:true}).split('\n').map(x=>x.trim()).filter(Boolean);
git(['config','user.name','igropoisk-content[bot]']);git(['config','user.email','igropoisk-content[bot]@users.noreply.github.com']);
git(['commit','-m',`Enrich newly created canonical games (${publishPhase})`]);
const resultCommit=git(['rev-parse','HEAD'],{quiet:true});let prUrl='',lastMergeError='';
for(let publishAttempt=1;publishAttempt<=5;publishAttempt++){
  git(['fetch','origin','staging']);const fresh=git(['rev-parse','origin/staging'],{quiet:true});git(['checkout','-B',`post-create-overlay-work-${publishPhase}`,fresh]);
  let applied=0,already=0,skipped=0;const skippedFiles=[];
  for(const file of files){const baseObj=objectAt(base,file),freshObj=objectAt(fresh,file),resultObj=objectAt(resultCommit,file);if(freshObj===resultObj){already++;continue}if(freshObj!==baseObj){skipped++;skippedFiles.push(file);continue}if(resultObj===missing)fs.rmSync(file,{force:true,recursive:true});else git(['checkout',resultCommit,'--',file]);applied++}
  stageAllowed();
  if(succeeds('git',['diff','--cached','--quiet'])){const staging=refreshStaging();console.log(JSON.stringify({phase:publishPhase,status:'fresh_state_won',base,result_commit:resultCommit,staging,applied,already,skipped,skipped_files:skippedFiles},null,2));process.exit(0)}
  git(['diff','--cached','--check']);git(['commit','-m',`Publish post-create ${publishPhase} enrichment on fresh staging`]);git(['push','--force','origin',`HEAD:refs/heads/${branch}`]);
  if(!prUrl){const existing=command('gh',['pr','list','--base','staging','--head',branch,'--state','open','--json','url','--jq','.[0].url // empty']);prUrl=String(existing.stdout||'').trim();if(!prUrl){const body=`Conflict-safe post-create ${publishPhase} publication. Enrichment output is overlaid on the latest staging tip only for files unchanged since this phase began; newer parallel lifecycle updates win and skipped modules remain queued for the next pass. Source result commit: ${resultCommit}.`;prUrl=await createPrWithRetry(body)}}
  const merged=command('gh',['pr','merge',prUrl,'--merge','--delete-branch']);
  if(merged.status===0){const staging=refreshStaging();console.log(JSON.stringify({phase:publishPhase,status:'merged',base,result_commit:resultCommit,staging,publish_attempt:publishAttempt,applied,already,skipped,skipped_files:skippedFiles},null,2));process.exit(0)}
  lastMergeError=String(merged.stderr||merged.stdout||'').trim();console.error(`Post-create ${publishPhase} merge attempt ${publishAttempt} failed; rebuilding on newest staging. ${lastMergeError}`);if(publishAttempt<5)await sleep(2500)
}
throw new Error(`Unable to publish post-create ${publishPhase} enrichment after conflict-safe retries: ${lastMergeError}`);
