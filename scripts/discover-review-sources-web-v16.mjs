#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const slug=String(process.argv[2]||'').trim().toLowerCase();
if(!slug)throw new Error('Usage: discover-review-sources-web <slug>');
const read=(relative,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'))}catch{return fallback}};
const write=(relative,value)=>{const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`${JSON.stringify(value,null,2)}\n`)};

const result=spawnSync('node',['scripts/discover-review-sources-web-v15.mjs',slug,'--all'],{
  cwd:root,
  encoding:'utf8',
  stdio:'inherit',
  env:process.env,
  timeout:Math.max(180000,Number(process.env.REVIEW_EXHAUSTIVE_DISCOVERY_TIMEOUT_MS||600000)),
  maxBuffer:64*1024*1024
});
if(result.error)throw result.error;

const matrix=read(`data/research/${slug}-source-matrix.json`,{});
const previous=read(`data/reviews/${slug}.json`,{});
const accepted=Array.isArray(matrix.accepted)?matrix.accepted:[];
const checks=Array.isArray(matrix.source_checks)?matrix.source_checks:[];
const allChecked=checks.length>0&&checks.every(check=>['found','not_found','unavailable'].includes(String(check?.status||'')));
const green=matrix?.coverage?.passed===true;
const minimum=Number(matrix?.policy?.minimum_sources||previous?.publication_gate?.minimum||5);
const target=Number(matrix?.policy?.target_sources||previous?.publication_gate?.target||20);
const maximum=Number(matrix?.policy?.maximum_sources||previous?.publication_gate?.maximum||target);
const updatedAt=new Date().toISOString();

const review={
  ...previous,
  schema_version:Math.max(Number(previous?.schema_version||0),16),
  game_slug:slug,
  updated_at:updatedAt,
  source_registry:matrix?.source_registry||previous?.source_registry||'config/parsers/review-source-registry.json',
  publication_gate:{minimum,target,maximum,accepted:accepted.length,status:green?'green':'red-needs-revision'},
  regional_discovery:matrix?.regional_discovery||previous?.regional_discovery||{},
  reviews:accepted,
  rejected:Array.isArray(matrix.rejected)?matrix.rejected:previous?.rejected||[],
  discovery_contract:{
    mode:'exhaustive_registered_review_and_score_discovery_v16',
    audit_all:true,
    all_registered_sources_checked:allChecked,
    checked_sources:checks.length,
    accepted_sources:accepted.length,
    generated_at:updatedAt
  }
};
write(`data/reviews/${slug}.json`,review);

const run=read(`data/parser-runs/review-web-discovery-${slug}.json`,{});
write(`data/parser-runs/review-web-discovery-${slug}.json`,{
  ...run,
  parser:'review-professional-exhaustive-v16',
  checked_at:updatedAt,
  audit_all:true,
  all_registered_sources_checked:allChecked,
  checked_sources:checks.length,
  accepted:accepted.length,
  status:green&&allChecked?'green':'needs_revision'
});

console.log(JSON.stringify({slug,status:green&&allChecked?'green':'needs_revision',audit_all:true,all_registered_sources_checked:allChecked,checked_sources:checks.length,accepted:accepted.length,legacy_exit:result.status},null,2));
process.exitCode=green&&allChecked?0:2;
