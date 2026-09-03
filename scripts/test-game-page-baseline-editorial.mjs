#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'igropoisk-page-editorial-'));
const copy=(src,dst)=>{const from=path.join(root,src),to=path.join(temp,dst);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to)};
copy('scripts/build-game-page-baseline-editorial.mjs','scripts/build-game-page-baseline-editorial.mjs');
fs.mkdirSync(path.join(temp,'data/drafts'),{recursive:true});
fs.mkdirSync(path.join(temp,'data/game-sources'),{recursive:true});
fs.writeFileSync(path.join(temp,'data/drafts/test-game.json'),JSON.stringify({identity:{title:'Test Game'},release:{date_text:'2020'},companies:{developers:['Studio'],publishers:['Publisher']},classification:{genres:['Simulation','Strategy'],categories:['Single-player'],platforms:['windows']},editorial:{}},null,2));
fs.writeFileSync(path.join(temp,'data/game-sources/test-game.json'),JSON.stringify({discovery:{complete:true},counts:{total:10},sources:Array.from({length:10},(_,i)=>({publication:`P${i}`,url:`https://example.com/${i}`,roles:['review']}))},null,2));
const run=spawnSync(process.execPath,['scripts/build-game-page-baseline-editorial.mjs','test-game'],{cwd:temp,encoding:'utf8'});
if(run.status!==0) throw new Error(run.stderr||run.stdout||'structured editorial fallback failed');
const out=JSON.parse(fs.readFileSync(path.join(temp,'data/page-editorial/test-game.json'),'utf8'));
const cyr=v=>(String(v).match(/[А-Яа-яЁё]/g)||[]).length;
if(out.quality_status!=='green') throw new Error('quality_status is not green');
if(String(out.short_description||'').length<90||cyr(out.short_description)<30) throw new Error('short description contract failed');
if(String(out.integrated_description||'').length<280||cyr(out.integrated_description)<100) throw new Error('integrated description contract failed');
if(String(out.campaign||'').length<120||cyr(out.campaign)<50) throw new Error('campaign contract failed');
if(!Array.isArray(out.features)||out.features.length<4||out.features.some(v=>String(v).length<18)) throw new Error('features contract failed');
console.log('Structured Russian page-editorial fallback contract passed.');
