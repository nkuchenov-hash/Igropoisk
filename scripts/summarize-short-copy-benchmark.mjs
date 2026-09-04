#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),input=path.join(root,'short-copy-artifacts'),out=path.join(root,'short-copy-summary');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
function walk(dir){let a=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())a=a.concat(walk(p));else if(e.isFile()&&e.name==='result.json')a.push(p)}return a}
const rows=walk(input).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));if(!rows.length)throw new Error('No short-copy results');
const games=[...new Set(rows.map(r=>r.game_slug))].sort();const models=[...new Set(rows.map(r=>r.label))].sort();
const packHashes={};for(const g of games){const h=[...new Set(rows.filter(r=>r.game_slug===g).map(r=>r.pack_sha256))];packHashes[g]=h;if(h.length!==1)throw new Error(`Fairness violation: ${g} has ${h.length} pack hashes`)}
const byModel=models.map(label=>{const rs=rows.filter(r=>r.label===label);const pass=rs.filter(r=>r.capable);return{label,provider:rs[0]?.provider||'',model:rs[0]?.model||'',games_tested:rs.length,games_passed:pass.length,all_five:rs.length===games.length&&pass.length===games.length,total_attempts:rs.reduce((a,r)=>a+Number(r.attempts_used||0),0),endpoint_failures:rs.filter(r=>r.classification==='FAIL_ENDPOINT').length,contract_failures:rs.filter(r=>r.classification==='FAIL_CONTRACT').length,results:Object.fromEntries(rs.map(r=>[r.game_slug,{capable:r.capable,classification:r.classification,attempts_used:r.attempts_used,text:r.text,chars:r.chars,sentences:r.sentences,pack_sha256:r.pack_sha256}]))}}).sort((a,b)=>Number(b.all_five)-Number(a.all_five)||b.games_passed-a.games_passed||a.total_attempts-b.total_attempts||a.label.localeCompare(b.label));
const summary={schema_version:1,generated_at:new Date().toISOString(),policy:{task:'short_description only',contract:'exactly 2 Russian sentences, 100-240 characters including spaces, no meta text',retries:'same model + same prompt + same frozen pack, up to 3 attempts',fairness:'one frozen pack hash per game across all models'},games,pack_hashes:packHashes,models:byModel};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
let md='# Five-game short-copy benchmark\n\n| Model | PASS | All 5 | Attempts | Endpoint fails | Contract fails |\n|---|---:|:---:|---:|---:|---:|\n';
for(const m of byModel)md+=`| ${m.label} | ${m.games_passed}/${games.length} | ${m.all_five?'YES':'NO'} | ${m.total_attempts} | ${m.endpoint_failures} | ${m.contract_failures} |\n`;
for(const m of byModel){md+=`\n## ${m.label}\n`;for(const g of games){const r=m.results[g];md+=`- **${g}** — ${r?.capable?'PASS':'FAIL'} (${r?.classification||'missing'}, attempts ${r?.attempts_used||0})${r?.text?` — ${r.text}`:''}\n`}}
fs.writeFileSync(path.join(out,'SUMMARY.md'),md);console.log(md);
