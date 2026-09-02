#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const manifestPath='config/game-page-module.manifest.json';
const reportPath='data/quality-control/game-page-module-integrity.json';
const abs=p=>path.join(root,p);
const exists=p=>fs.existsSync(abs(p))&&fs.statSync(abs(p)).isFile();
const read=p=>fs.readFileSync(abs(p),'utf8');
const errors=[];
const checked=[];
const fail=message=>errors.push(message);
const persist=value=>{const target=abs(reportPath);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};

if(!exists(manifestPath)){
  const result={module:'game-page-assembly',status:'red',errors:[`missing ${manifestPath}`]};persist(result);console.error(JSON.stringify(result,null,2));process.exit(1);
}
let manifest;
try{manifest=JSON.parse(read(manifestPath));}catch(error){
  const result={module:'game-page-assembly',status:'red',errors:[`invalid ${manifestPath}: ${error.message}`]};persist(result);console.error(JSON.stringify(result,null,2));process.exit(1);
}
if(manifest.schema_version!==1)fail('manifest schema_version must be 1');
if(manifest.module!=='game-page-assembly')fail('manifest module must be game-page-assembly');

for(const group of ['required_files','required_workflows','required_docs']){
  const values=manifest[group];
  if(!Array.isArray(values)||!values.length){fail(`${group} must be a non-empty array`);continue;}
  for(const file of values){
    if(!exists(file))fail(`required module file is missing: ${file}`);
    else checked.push(file);
  }
}

for(const [file,tokens] of Object.entries(manifest.contract_probes||{})){
  if(!exists(file))continue;
  const text=read(file);
  for(const token of tokens||[])if(!text.includes(token))fail(`${file} lost required contract token: ${JSON.stringify(token)}`);
}

const forbidden=manifest.forbidden_legacy_references||[];
const scanRoots=['scripts','.github/workflows','game/_shared'];
const scanFiles=[];
for(const rel of scanRoots){
  const start=abs(rel);if(!fs.existsSync(start))continue;
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&/\.(?:mjs|js|ya?ml)$/.test(entry.name))scanFiles.push(full)}};
  walk(start);
}
for(const full of scanFiles){
  const text=fs.readFileSync(full,'utf8'),rel=path.relative(root,full).replaceAll('\\','/');
  for(const token of forbidden)if(text.includes(token))fail(`${rel} contains forbidden legacy module reference: ${token}`);
}

const basic=exists('scripts/build-game-page-basic.mjs')?read('scripts/build-game-page-basic.mjs'):'';
const editorial=exists('scripts/build-game-page.mjs')?read('scripts/build-game-page.mjs'):'';
for(const [name,text] of [['scripts/build-game-page-basic.mjs',basic],['scripts/build-game-page.mjs',editorial]]){
  for(const token of ['data/catalog-visible.json','game/${slug}/index.html',"status:'published'",'status:"published"']){
    if(text.includes(token))fail(`${name} violates draft-only builder contract via ${JSON.stringify(token)}`);
  }
}
for(const token of ['OPENAI_API_KEY','api.openai.com','openai.com/v1'])if(editorial.includes(token))fail(`scripts/build-game-page.mjs must not require paid OpenAI: ${token}`);

const freeAi=exists('scripts/lib/free-editorial-ai.mjs')?read('scripts/lib/free-editorial-ai.mjs'):'';
for(const token of ['OLLAMA_BASE_URL','qwen2.5:3b','/api/chat'])if(!freeAi.includes(token))fail(`free editorial backend lost required token: ${token}`);
for(const token of ['OPENAI_API_KEY','api.openai.com'])if(freeAi.includes(token))fail(`free editorial backend contains paid API dependency: ${token}`);

const finalizer=exists('scripts/finalize-game-page-publication.mjs')?read('scripts/finalize-game-page-publication.mjs'):'';
for(const token of ['page QC is not green','content QC is not green','media QC is not green','source discovery is incomplete','canonical page editorial is not green','data/catalog-visible.json'])if(!finalizer.includes(token))fail(`publication finalizer lost fail-closed gate: ${token}`);

const stateGate=exists('scripts/validate-game-page-publication-state.mjs')?read('scripts/validate-game-page-publication-state.mjs'):'';
if(!stateGate.includes('public_ready'))fail('publication-state validator no longer checks public_ready');

const gameLoader=exists('game/_shared/game-page.js')?read('game/_shared/game-page.js'):'';
for(const token of ['game-page-source-corpus.js','game-page-integrity.js','game-media-sanitize.js'])if(!gameLoader.includes(token))fail(`game page runtime loader lost required module: ${token}`);

const stableDoc=exists('docs/GAME_PAGE_MODULE_STABLE.md')?read('docs/GAME_PAGE_MODULE_STABLE.md'):'';
for(const token of ['config/game-page-module.manifest.json','validate-game-page-module-integrity.mjs','Обзор игры не является частью модуля страницы игры','finalize-game-page-publication.mjs'])if(!stableDoc.includes(token))fail(`stable module documentation lost architecture token: ${token}`);

const result={schema_version:1,checked_at:new Date().toISOString(),module:manifest.module,module_version:manifest.module_version,status:errors.length?'red':'green',checked_files:[...new Set(checked)].length,required_files:(manifest.required_files||[]).length,required_workflows:(manifest.required_workflows||[]).length,required_docs:(manifest.required_docs||[]).length,contract:manifest.contract,errors};
persist(result);
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exit(1);
