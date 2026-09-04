#!/usr/bin/env node
import fs from 'node:fs';

const file='scripts/build-editorial-benchmark-pack.mjs';
let text=fs.readFileSync(file,'utf8');
const needle="sources:Array.isArray(existing.sources)?existing.sources:[],benchmark_identity:";
const replacement="sources:[...(Array.isArray(existing.sources)?existing.sources:[]),...(Array.isArray(target.source_seeds)?target.source_seeds.map((item,index)=>({id:item.id||`benchmark-fact-seed-${index+1}`,name:item.name||item.publication||'',publication:item.publication||item.name||'',title:item.title||target.display_title,url:item.url||'',role:'structured_fact_source',type:'structured_fact_source',benchmark_seed_candidate:true})):[])],benchmark_identity:";
if(!text.includes(needle)) throw new Error('Expected source seed insertion point not found');
text=text.replace(needle,replacement);
fs.writeFileSync(file,text);
console.log(JSON.stringify({file,source_seed_support:'enabled'},null,2));
