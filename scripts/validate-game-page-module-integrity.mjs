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
const persist=value=>{if(process.env.GAME_PAGE_MODULE_INTEGRITY_WRITE!=='1')return;const target=abs(reportPath);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n')};

if(!exists(manifestPath)){const result={module:'game-page-assembly',status:'red',errors:[`missing ${manifestPath}`]};persist(result);console.error(JSON.stringify(result,null,2));process.exit(1)}
let manifest;try{manifest=JSON.parse(read(manifestPath))}catch(error){const result={module:'game-page-assembly',status:'red',errors:[`invalid ${manifestPath}: ${error.message}`]};persist(result);console.error(JSON.stringify(result,null,2));process.exit(1)}
if(manifest.schema_version!==1)fail('manifest schema_version must be 1');
if(manifest.module!=='game-page-assembly')fail('manifest module must be game-page-assembly');
if(manifest.contract?.publication_finalizer_only!==true)fail('publication_finalizer_only must remain true');
if(manifest.contract?.published_package_immutable!==true)fail('published_package_immutable must remain true');
if(manifest.contract?.review_article_is_separate!==true)fail('review_article_is_separate must remain true');
if(manifest.contract?.game_specific_presentation_hardcode_forbidden!==true)fail('game_specific_presentation_hardcode_forbidden must remain true');
if(manifest.contract?.runtime_monkey_patching_forbidden!==true)fail('runtime_monkey_patching_forbidden must remain true');

for(const group of ['required_files','required_workflows','required_docs']){
  const values=manifest[group];if(!Array.isArray(values)||!values.length){fail(`${group} must be a non-empty array`);continue}
  for(const file of values){if(!exists(file))fail(`required module file is missing: ${file}`);else checked.push(file)}
}
for(const [file,tokens] of Object.entries(manifest.contract_probes||{})){
  if(!exists(file))continue;const text=read(file);for(const token of tokens||[])if(!text.includes(token))fail(`${file} lost required contract token: ${JSON.stringify(token)}`)
}

const walkFiles=(relative,pattern)=>{const output=[],start=abs(relative);if(!fs.existsSync(start))return output;const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&pattern.test(entry.name))output.push(path.relative(root,full).replaceAll('\\','/'))}};walk(start);return output};
const scriptFiles=walkFiles('scripts',/\.(?:mjs|js)$/);
const runtimeFiles=walkFiles('game/_shared',/\.js$/);

const boundary=manifest.publication_boundary||{};
const soleWriter=String(boundary.sole_public_state_writer||'');
if(soleWriter!=='scripts/finalize-game-page-publication.mjs')fail('sole public state writer changed from canonical finalizer');
const queueOnly=new Set(boundary.queue_only_adapters||[]);
const copyOnly=new Set(boundary.copy_only_promoters||[]);
const delegates=new Set(boundary.finalizer_delegates||[]);
const revisionSafe=new Set(boundary.revision_safe_mutators||[]);
const rollbackOnly=new Set(boundary.rollback_orchestrators||[]);
const boundaryFiles=[...queueOnly,...copyOnly,...delegates,...revisionSafe,...rollbackOnly];
for(const file of boundaryFiles)if(!exists(file))fail(`publication-boundary file missing: ${file}`);

// Legacy-name enforcement is scoped to the Page Assembly contract. Unrelated historical or
// acceptance workflows are not part of this module unless explicitly registered in the manifest.
const legacyScope=new Set([...(manifest.required_files||[]),...(manifest.required_workflows||[]),...(manifest.required_docs||[]),...Object.keys(manifest.contract_probes||{}),...boundaryFiles]);
for(const file of legacyScope){if(!exists(file))continue;const text=read(file);for(const token of manifest.forbidden_legacy_references||[])if(text.includes(token))fail(`${file} contains forbidden legacy module reference: ${token}`)}

function variableExpressions(text){
  const vars=new Map();
  const re=/(?:^|[;\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  for(const match of text.matchAll(re))vars.set(match[1],match[2].trim());
  return vars;
}
function resolveExpression(expr,vars,seen=new Set(),depth=0){
  let value=String(expr||'').trim();if(depth>8)return value;
  const exact=value.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  if(exact&&vars.has(exact)&&!seen.has(exact)){const next=new Set(seen);next.add(exact);return resolveExpression(vars.get(exact),vars,next,depth+1)}
  const names=[...new Set(value.match(/[A-Za-z_$][\w$]*/g)||[])];
  for(const name of names){if(seen.has(name)||!vars.has(name))continue;const replacement=resolveExpression(vars.get(name),vars,new Set([...seen,name]),depth+1);value=value.replace(new RegExp(`\\b${name.replace(/[$]/g,'\\$&')}\\b`,'g'),`(${replacement})`)}
  return value;
}
function writeTargets(text){
  const vars=variableExpressions(text),targets=[];
  const writes=/(?:^|[^\w$])(?:fs\.)?(?:writeFileSync|writeJSON|writeJson|write|restoreFile)\s*\(\s*([^,\n]+)/gm;
  for(const match of text.matchAll(writes))targets.push({kind:'write',expr:match[1].trim()});
  const copies=/(?:^|[^\w$])(?:fs\.)?copyFileSync\s*\(\s*([^,\n]+)\s*,\s*([^,\n\)]+)/gm;
  for(const match of text.matchAll(copies))targets.push({kind:'copy',expr:match[2].trim()});
  return targets.map(target=>{
    const resolved=resolveExpression(target.expr,vars);
    const catalog=/catalog-visible\.json/i.test(resolved);
    const gameContent=/(?:data[\\/]|['"`]data\/)?game-content(?:[\\/]|['"`])/i.test(resolved);
    const gameShell=/(?:['"`]game['"`]|['"`]game\/|[\\/]game[\\/])/i.test(resolved)&&/index\.html/i.test(resolved);
    const draft=/(?:data[\\/]|['"`]data\/)?drafts(?:[\\/]|['"`])/i.test(resolved);
    return{...target,resolved,catalog,gameContent,gameShell,draft};
  });
}
function publicWriteSummary(text){const targets=writeTargets(text);return{targets,catalog:targets.some(x=>x.catalog),gameContent:targets.some(x=>x.gameContent),gameShell:targets.some(x=>x.gameShell),draft:targets.some(x=>x.draft)}}
function assignsPublishedPublication(text){
  const publicationObject=/\bpublication\s*:\s*\{[\s\S]{0,700}?\b(?:public_ready\s*:\s*true|status\s*:\s*['"]published['"])/m;
  const publicationAssignment=/\b[A-Za-z_$][\w$]*\.publication(?:\.public_ready)?\s*=\s*(?:true|\{[\s\S]{0,700}?\b(?:public_ready\s*:\s*true|status\s*:\s*['"]published['"]))/m;
  return publicationObject.test(text)||publicationAssignment.test(text);
}

const writerAudit=[];const unclassifiedPublicWriters=[];
for(const file of scriptFiles){
  const text=read(file),writes=publicWriteSummary(text),writesPublic=writes.catalog||writes.gameContent||writes.gameShell;
  const role=file===soleWriter?'sole-finalizer':copyOnly.has(file)?'copy-only':rollbackOnly.has(file)?'rollback-only':queueOnly.has(file)?'queue-only':delegates.has(file)?'finalizer-delegate':revisionSafe.has(file)?'revision-safe':'unclassified';
  if(writesPublic||writes.draft)writerAudit.push({file,role,catalog:writes.catalog,game_content:writes.gameContent,game_shell:writes.gameShell,draft:writes.draft,public_targets:writes.targets.filter(x=>x.catalog||x.gameContent||x.gameShell).map(x=>x.resolved)});
  if(file!==soleWriter&&writes.draft&&assignsPublishedPublication(text))fail(`${file} can synthesize published/public_ready draft state outside the sole finalizer`);
  if(writesPublic&&!copyOnly.has(file)&&!rollbackOnly.has(file)&&file!==soleWriter){unclassifiedPublicWriters.push(file);fail(`${file} writes Game Page public artifacts but is not the sole finalizer, copy-only promoter, or rollback-only orchestrator`)}
}
const finalizerWrites=publicWriteSummary(exists(soleWriter)?read(soleWriter):'');
for(const [label,value] of [['draft',finalizerWrites.draft],['catalog-visible',finalizerWrites.catalog],['game-content',finalizerWrites.gameContent],['game-shell',finalizerWrites.gameShell]])if(!value)fail(`sole finalizer writer audit cannot prove write ownership for ${label}`);

for(const file of queueOnly){if(!exists(file))continue;const text=read(file),writes=publicWriteSummary(text);if(writes.catalog||writes.gameContent||writes.gameShell)fail(`${file} queue-only adapter writes a public artifact`);if(assignsPublishedPublication(text)&&writes.draft)fail(`${file} queue-only adapter contains direct published/public_ready draft state`)}
for(const file of copyOnly){if(!exists(file))continue;const text=read(file);if(!text.includes('validate-game-page-publication-state.mjs'))fail(`${file} copy-only promoter lacks canonical publication-state validation`);if(!text.includes('copy-only')&&!text.includes('already-finalized Game Page package'))fail(`${file} is not explicitly marked copy-only`);if(assignsPublishedPublication(text)&&publicWriteSummary(text).draft)fail(`${file} copy-only promoter synthesizes published/public_ready state`);for(const builder of ['build-game-page-basic.mjs','build-game-page.mjs'])if(text.includes(builder))fail(`${file} copy-only promoter must not build a page via ${builder}`)}
for(const file of rollbackOnly){if(!exists(file))continue;const text=read(file);if(!text.includes('finalize-game-page-publication.mjs'))fail(`${file} rollback-only orchestrator no longer delegates successful publication to sole finalizer`);if(!text.includes('failed revision restored last published canonical page package'))fail(`${file} rollback-only orchestrator lost immutable snapshot restoration contract`);if(assignsPublishedPublication(text)&&publicWriteSummary(text).draft)fail(`${file} rollback-only orchestrator synthesizes published/public_ready state instead of restoring bytes`)}
for(const file of delegates){if(!exists(file))continue;const text=read(file),writes=publicWriteSummary(text);if(!text.includes('finalize-game-page-publication.mjs'))fail(`${file} finalizer delegate no longer delegates to sole finalizer`);if(writes.catalog||writes.gameContent||writes.gameShell)fail(`${file} finalizer delegate writes public artifacts itself`);if(assignsPublishedPublication(text)&&writes.draft)fail(`${file} finalizer delegate synthesizes published/public_ready state itself`)}
for(const file of revisionSafe){
  if(!exists(file))continue;const text=read(file),writes=publicWriteSummary(text);
  if(!/publication\?\.status\s*===?\s*['"]published['"]/.test(text))fail(`${file} does not protect a finalized package before mutation`);
  if(!/public_ready\s*===\s*true/.test(text))fail(`${file} does not check public_ready before mutation`);
  if(!text.includes('published_package_preserved'))fail(`${file} lacks immutable-package queue evidence`);
  if(!text.includes('needs_revision'))fail(`${file} does not force mutable work back into revision state`);
  if(writes.catalog||writes.gameContent||writes.gameShell)fail(`${file} revision-safe mutator writes public artifacts`);
  if(assignsPublishedPublication(text)&&writes.draft)fail(`${file} revision-safe mutator can publish directly`);
}

const basic=exists('scripts/build-game-page-basic.mjs')?read('scripts/build-game-page-basic.mjs'):'';const editorial=exists('scripts/build-game-page.mjs')?read('scripts/build-game-page.mjs'):'';
for(const [name,text] of [['scripts/build-game-page-basic.mjs',basic],['scripts/build-game-page.mjs',editorial]])for(const token of ['data/catalog-visible.json','game/${slug}/index.html',"status:'published'",'status:"published"'])if(text.includes(token))fail(`${name} violates draft-only builder contract via ${JSON.stringify(token)}`);
for(const token of ['OPENAI_API_KEY','api.openai.com','openai.com/v1'])if(editorial.includes(token))fail(`scripts/build-game-page.mjs must not require paid OpenAI: ${token}`);
const freeAi=exists('scripts/lib/free-editorial-ai.mjs')?read('scripts/lib/free-editorial-ai.mjs'):'';for(const token of ['OLLAMA_BASE_URL','qwen2.5:3b','/api/chat'])if(!freeAi.includes(token))fail(`free editorial backend lost required token: ${token}`);for(const token of ['OPENAI_API_KEY','api.openai.com'])if(freeAi.includes(token))fail(`free editorial backend contains paid API dependency: ${token}`);

const finalizer=exists(soleWriter)?read(soleWriter):'';for(const token of ['page QC is not green','content QC is not green','media QC is not green','source discovery is incomplete','canonical page editorial is not green','data/catalog-visible.json','public_ready:true'])if(!finalizer.includes(token))fail(`publication finalizer lost fail-closed/publication gate: ${token}`);
const stateGate=exists('scripts/validate-game-page-publication-state.mjs')?read('scripts/validate-game-page-publication-state.mjs'):'';for(const token of ['public_ready','canonical page editorial is missing/not green','page QC is not green','content QC is not green','media QC is not green','source discovery is incomplete'])if(!stateGate.includes(token))fail(`publication-state validator lost check: ${token}`);

for(const file of runtimeFiles){const text=read(file);for(const token of manifest.forbidden_runtime_tokens||[])if(text.includes(token))fail(`${file} contains forbidden runtime token: ${token}`);const literalSlugBranch=/(?:\bslug|\bpageSlug)\s*[!=]==?\s*['"][a-z0-9][a-z0-9-]{2,}['"]/i.exec(text);if(literalSlugBranch)fail(`${file} contains game-specific literal slug branching: ${literalSlugBranch[0]}`)}
const bootstrap=exists('game/_shared/game-page-v3-bootstrap.js')?read('game/_shared/game-page-v3-bootstrap.js'):'';if(/Function\s*\(/.test(bootstrap))fail('game-page-v3-bootstrap.js must not execute rewritten runtime source');if(/source\.replace|corrected\.replace/.test(bootstrap))fail('game-page-v3-bootstrap.js must not monkey-patch runtime source');
const runtime=exists('game/_shared/game-page-v3.js')?read('game/_shared/game-page-v3.js'):'';if(!runtime.includes('if(!dialog||!scale||!note||!dialogTitle||!rateGame||!rateInline||!close)return'))fail('game-page-v3.js rating binding is not null-safe');if(runtime.includes('applyPublicLocalization'))fail('game-page-v3.js contains game-specific localization path');
const integrity=exists('game/_shared/game-page-integrity.js')?read('game/_shared/game-page-integrity.js'):'';if(!integrity.includes('if(!own?.url)'))fail('game-page-integrity.js can fabricate an Игропоиск review without a published Review article');if(!integrity.includes('if(hydrated){clearInterval(timer)'))fail('game-page-integrity.js lost hydration-safe rating control removal');
const gameLoader=exists('game/_shared/game-page.js')?read('game/_shared/game-page.js'):'';for(const token of ['game-page-source-corpus.js','game-page-integrity.js','game-media-sanitize.js'])if(!gameLoader.includes(token))fail(`game page runtime loader lost required module: ${token}`);
const newsWorkflow=exists('.github/workflows/news-game-page-fast.yml')?read('.github/workflows/news-game-page-fast.yml'):'';if(newsWorkflow.includes('materialize-news-game-pages-fast.mjs'))fail('news game-page workflow still contains direct production materializer');if(!newsWorkflow.includes('News is forbidden from directly publishing a Game Page'))fail('news adapter boundary guard is missing');if(!newsWorkflow.includes('content-pipeline.yml'))fail('news page requests are not routed to canonical Page Assembly lifecycle');
const stableDoc=exists('docs/GAME_PAGE_MODULE_STABLE.md')?read('docs/GAME_PAGE_MODULE_STABLE.md'):'';for(const token of ['config/game-page-module.manifest.json','validate-game-page-module-integrity.mjs','Обзор игры не является частью модуля страницы игры','finalize-game-page-publication.mjs','published canonical package'])if(!stableDoc.includes(token))fail(`stable module documentation lost architecture token: ${token}`);

const result={schema_version:4,checked_at:new Date().toISOString(),module:manifest.module,module_version:manifest.module_version,status:errors.length?'red':'green',checked_files:[...new Set(checked)].length,required_files:(manifest.required_files||[]).length,required_workflows:(manifest.required_workflows||[]).length,required_docs:(manifest.required_docs||[]).length,boundary:{sole_public_state_writer:soleWriter,queue_only_adapters:queueOnly.size,copy_only_promoters:copyOnly.size,finalizer_delegates:delegates.size,revision_safe_mutators:revisionSafe.size,rollback_orchestrators:rollbackOnly.size,published_package_immutable:manifest.contract?.published_package_immutable===true,unclassified_public_writers:unclassifiedPublicWriters,writer_audit:writerAudit},contract:manifest.contract,errors};persist(result);console.log(JSON.stringify(result,null,2));if(errors.length)process.exit(1);
