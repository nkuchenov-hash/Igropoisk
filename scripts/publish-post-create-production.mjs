#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';

const repo=process.env.GITHUB_REPOSITORY||'nkuchenov-hash/Igropoisk';
const trigger=process.env.POST_CREATE_TRIGGER_SHA||process.env.GITHUB_SHA||'';
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const phase=String(process.env.POST_CREATE_PRODUCTION_PHASE||'checkpoint').toLowerCase().replace(/[^a-z0-9-]+/g,'-')||'checkpoint';
const branch=`automation/post-create-production-${phase}-${runId}-${runAttempt}`;
const allowed=[
  /^data\/drafts\/[^/]+\.json$/,
  /^data\/franchises\/[^/]+\.json$/,
  /^data\/game-dna\/[^/]+\.json$/,
  /^data\/similarity\/[^/]+\.json$/,
  /^data\/reviews\/[^/]+\.json$/,
  /^data\/ratings\/[^/]+\.json$/,
  /^data\/articles\/[^/]+\.json$/,
  /^data\/article-media\/[^/]+\.json$/,
  /^article\/[^/]+\/index\.html$/
];
const automation=/^Merge pull request #\d+ from nkuchenov-hash\/automation\/post-create-enrichment-(?:dna|bootstrap|commercial-review|full-review)-/;
const missing='__missing__';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function git(args,{quiet=false}={}){return execFileSync('git',args,{encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:['ignore','pipe','inherit']}).trim()}
function cmd(name,args,input=''){return spawnSync(name,args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe']})}
function objectAt(ref,file){const result=cmd('git',['rev-parse',`${ref}:${file}`]);return result.status===0?String(result.stdout||'').trim():missing}
function isAllowed(file){return allowed.some(pattern=>pattern.test(file))}
function transient(text){return /HTTP\s+(?:502|503|504)|timeout|temporar|graphql/i.test(String(text||''))}
async function createPr(body){let last='';for(let attempt=1;attempt<=5;attempt++){const result=cmd('gh',['pr','create','--base','main','--head',branch,'--title',`Publish post-create ${phase} production ${runId}.${runAttempt}`,'--body',body]);if(result.status===0)return String(result.stdout||'').trim();last=String(result.stderr||result.stdout||'').trim();if(!transient(last)||attempt===5)break;await sleep(attempt*2500)}throw new Error(`Unable to create production PR: ${last}`)}

if(!trigger)throw new Error('POST_CREATE_TRIGGER_SHA or GITHUB_SHA is required');
git(['fetch','origin','main','staging']);
const subject=git(['show','-s','--format=%s',trigger],{quiet:true});
if(!automation.test(subject)){console.log(JSON.stringify({status:'ignored_non_post_create_merge',trigger,subject},null,2));process.exit(0)}
const parent=git(['rev-parse',`${trigger}^1`],{quiet:true});
const changed=git(['diff','--name-only',parent,trigger],{quiet:true}).split('\n').map(value=>value.trim()).filter(Boolean);
const files=changed.filter(isAllowed),rejected=changed.filter(file=>!isAllowed(file));
if(!files.length){console.log(JSON.stringify({status:'no_production_content',trigger,subject,rejected},null,2));process.exit(0)}

git(['config','user.name','igropoisk-production[bot]']);git(['config','user.email','igropoisk-production[bot]@users.noreply.github.com']);
const mainBefore=git(['rev-parse','origin/main'],{quiet:true});git(['checkout','-B',branch,'origin/main']);
for(const file of files){const desired=objectAt(trigger,file);if(desired===missing)fs.rmSync(file,{recursive:true,force:true});else git(['checkout',trigger,'--',file])}
git(['add','-A','--',...files]);const diff=cmd('git',['diff','--cached','--quiet']);if(diff.status===0){console.log(JSON.stringify({status:'already_in_production',trigger,main:mainBefore,files},null,2));process.exit(0)}
git(['diff','--cached','--check']);git(['commit','-m',`Publish post-create ${phase} enrichment from ${trigger.slice(0,12)}`]);git(['push','--force','origin',`HEAD:refs/heads/${branch}`]);
const body=`Production-only publication of files produced by the verified post-create automation merge ${trigger}. Only per-game draft/franchise/DNA/similarity/rating/review/article artifacts are included; research scratch data and unrelated staging changes are excluded.`;
const pr=await createPr(body);const merged=cmd('gh',['pr','merge',pr,'--merge','--delete-branch']);if(merged.status!==0)throw new Error(`Unable to merge production PR: ${String(merged.stderr||merged.stdout||'').trim()}`);
git(['fetch','origin','main']);const mainSha=git(['rev-parse','origin/main'],{quiet:true});const mismatches=[];for(const file of files){const desired=objectAt(trigger,file),actual=objectAt('origin/main',file);if(desired!==actual)mismatches.push({file,desired,actual})}if(mismatches.length)throw new Error(`Production parity failed: ${JSON.stringify(mismatches)}`);
const payload=JSON.stringify({event_type:'production-pages',client_payload:{target_branch:'main',mode:'production',production_sha:mainSha,sha:mainSha,source:'post-create-production',run_id:runId,run_attempt:runAttempt,phase,trigger_sha:trigger}});const dispatched=cmd('gh',['api','--method','POST',`repos/${repo}/dispatches`,'--input','-'],payload);if(dispatched.status!==0)throw new Error(`Unable to dispatch exact-SHA Pages deploy: ${String(dispatched.stderr||dispatched.stdout||'').trim()}`);
console.log(JSON.stringify({status:'published',phase,trigger,subject,production_pr:pr,main_sha:mainSha,files,rejected,pages_dispatch:'production-pages',production_sha:mainSha},null,2));
