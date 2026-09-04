#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const input=path.join(root,'capability-artifacts');
const out=path.join(root,'capability-summary');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});

function walk(dir){
  const files=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) files.push(...walk(p));
    else if(ent.isFile()&&ent.name==='capability.json') files.push(p);
  }
  return files;
}

const rows=walk(input).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
if(!rows.length) throw new Error('No capability.json artifacts found');

const games=[...new Set(rows.map(r=>r.game_slug))].sort();
const models=[...new Set(rows.map(r=>r.label))].sort();
const byModel=[];
for(const label of models){
  const rs=rows.filter(r=>r.label===label);
  const passes=rs.filter(r=>r.capable);
  byModel.push({
    label,
    provider:rs[0]?.provider||'',
    model:rs[0]?.model||'',
    games_tested:rs.length,
    games_passed:passes.length,
    production_capable:passes.length===games.length&&rs.length===games.length,
    total_attempts:rs.reduce((a,r)=>a+Number(r.attempts_used||0),0),
    attempts_to_success:passes.reduce((a,r)=>a+Number(r.attempts_used||0),0),
    endpoint_failures:rs.reduce((a,r)=>a+Number(r.endpoint_failure_attempts||0),0),
    contract_failures:rs.reduce((a,r)=>a+Number(r.contract_failure_attempts||0),0),
    results:Object.fromEntries(rs.map(r=>[r.game_slug,{capable:r.capable,classification:r.classification,attempts_used:r.attempts_used,pack_sha256:r.pack_sha256,review_words:r.winning_result?.review_words||0,review_sections:r.winning_result?.review_sections||0}]))
  });
}
byModel.sort((a,b)=>Number(b.production_capable)-Number(a.production_capable)||b.games_passed-a.games_passed||a.total_attempts-b.total_attempts||a.label.localeCompare(b.label));

const packHashes={};
for(const game of games){
  const hashes=[...new Set(rows.filter(r=>r.game_slug===game).map(r=>r.pack_sha256))];
  packHashes[game]=hashes;
  if(hashes.length!==1) throw new Error(`Fairness violation: ${game} has ${hashes.length} different pack hashes`);
}

const summary={schema_version:1,generated_at:new Date().toISOString(),policy:{production_capable:'PASS on all five games within the same three-attempt retry policy',pass_contract:'status=ok + exact short-description contract + review length 1900-2850 words + 8-10 sections',endpoint_failures:'retried with same model, same prompt and same frozen pack; never substituted by another model'},games,pack_hashes:packHashes,models:byModel};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');

const header=`| Model | PASS | Production-capable | Attempts | Endpoint fails | Contract fails |\n|---|---:|:---:|---:|---:|---:|`;
const table=byModel.map(m=>`| ${m.label} | ${m.games_passed}/${games.length} | ${m.production_capable?'YES':'NO'} | ${m.total_attempts} | ${m.endpoint_failures} | ${m.contract_failures} |`).join('\n');
const detail=byModel.map(m=>`\n### ${m.label}\n${games.map(g=>{const r=m.results[g];return `- ${g}: ${r?.capable?'PASS':'FAIL'} (${r?.classification||'missing'}, attempts ${r?.attempts_used||0}, ${r?.review_words||0} words, ${r?.review_sections||0} sections)`}).join('\n')}`).join('\n');
fs.writeFileSync(path.join(out,'SUMMARY.md'),`# Five-game model capability benchmark\n\nBinary production rule: a model is production-capable only if it passes all five games under the same strict contract and retry policy.\n\n${header}\n${table}\n\n## Frozen-pack fairness\n${games.map(g=>`- ${g}: ${packHashes[g][0]}`).join('\n')}\n${detail}\n`);
console.log(table);
