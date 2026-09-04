#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.env.BENCH_GAME||'').trim();
const id=String(process.env.BENCH_ID||'').trim();
const label=String(process.env.BENCH_LABEL||'').trim();
if(!slug||!id) throw new Error('BENCH_GAME and BENCH_ID required');

const maxAttempts=Math.max(1,Number(process.env.CAPABILITY_ATTEMPTS||3));
const packPath=path.join(root,'benchmark-packs',slug,'pack.json');
const packBytes=fs.readFileSync(packPath);
const packSha256=crypto.createHash('sha256').update(packBytes).digest('hex');
const outDir=path.join(root,'benchmark-capability');
const attemptsDir=path.join(outDir,'attempts');
fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(attemptsDir,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function strictPass(r){
  return r?.status==='ok'
    && r?.format_ok===true
    && r?.short_contract_ok===true
    && r?.review_length_ok===true
    && Number(r?.review_sections)>=8
    && Number(r?.review_sections)<=10;
}

const history=[];
let winning=null;
for(let attempt=1;attempt<=maxAttempts;attempt++){
  fs.rmSync(path.join(root,'benchmark-one'),{recursive:true,force:true});
  const started=Date.now();
  let childError=null;
  try{
    execFileSync(process.execPath,['scripts/run-editorial-benchmark-one-model.mjs'],{
      cwd:root,
      env:process.env,
      stdio:'inherit',
      timeout:11*60*1000,
      maxBuffer:64*1024*1024
    });
  }catch(e){
    childError=String(e?.message||e).slice(0,1500);
  }
  const resultPath=path.join(root,'benchmark-one','result.json');
  let result=null;
  if(fs.existsSync(resultPath)){
    result=JSON.parse(fs.readFileSync(resultPath,'utf8'));
    fs.copyFileSync(resultPath,path.join(attemptsDir,`attempt-${attempt}.json`));
    const outputPath=path.join(root,'benchmark-one','output.txt');
    if(fs.existsSync(outputPath)) fs.copyFileSync(outputPath,path.join(attemptsDir,`attempt-${attempt}.txt`));
  }
  const pass=strictPass(result);
  const failureClass=pass?null:
    !result?'runner_failure':
    ['error','unavailable'].includes(result.status)?'endpoint_failure':
    result.status!=='ok'||result.format_ok!==true?'format_failure':
    !result.short_contract_ok?'short_contract_failure':
    !result.review_length_ok?'review_length_failure':
    Number(result.review_sections)<8||Number(result.review_sections)>10?'section_contract_failure':'unknown_failure';
  history.push({
    attempt,
    pass,
    failure_class:failureClass,
    status:result?.status||'runner_error',
    short_chars:Number(result?.short_chars||0),
    short_sentences:Number(result?.short_sentences||0),
    review_words:Number(result?.review_words||0),
    review_sections:Number(result?.review_sections||0),
    error:result?.error||childError,
    elapsed_ms:Date.now()-started
  });
  if(pass){winning=result;break;}
  if(attempt<maxAttempts) await sleep([15000,30000,60000][Math.min(attempt-1,2)]);
}

const endpointAttempts=history.filter(x=>x.failure_class==='endpoint_failure').length;
const contractAttempts=history.filter(x=>x.failure_class&&x.failure_class!=='endpoint_failure'&&x.failure_class!=='runner_failure').length;
const final={
  schema_version:1,
  game_slug:slug,
  game_title:winning?.game_title||history[0]?.game_title||slug,
  id,
  label:winning?.label||label,
  provider:winning?.provider||String(process.env.BENCH_PROVIDER||''),
  model:winning?.model||String(process.env.BENCH_MODEL||''),
  pack_sha256:packSha256,
  capable:Boolean(winning),
  attempts_used:history.length,
  max_attempts:maxAttempts,
  endpoint_failure_attempts:endpointAttempts,
  contract_failure_attempts:contractAttempts,
  winning_result:winning,
  attempts:history,
  classification:winning?'PASS':endpointAttempts===history.length?'FAIL_ENDPOINT':'FAIL_CONTRACT'
};
fs.writeFileSync(path.join(outDir,'capability.json'),JSON.stringify(final,null,2)+'\n');
if(winning){
  fs.writeFileSync(path.join(outDir,'output.txt'),`PASS after ${history.length}/${maxAttempts} attempts\nPACK_SHA256: ${packSha256}\n\n=== SHORT DESCRIPTION ===\n${winning.short_description}\n\n=== REVIEW ===\n${winning.review}\n`);
}else{
  fs.writeFileSync(path.join(outDir,'output.txt'),`FAIL after ${history.length}/${maxAttempts} attempts\nCLASSIFICATION: ${final.classification}\nPACK_SHA256: ${packSha256}\n\n${history.map(x=>`attempt ${x.attempt}: ${x.failure_class}; status=${x.status}; words=${x.review_words}; sections=${x.review_sections}; error=${x.error||''}`).join('\n')}\n`);
}
console.log(JSON.stringify({game:slug,model:final.label,capable:final.capable,classification:final.classification,attempts_used:final.attempts_used,pack_sha256:packSha256,history},null,2));
