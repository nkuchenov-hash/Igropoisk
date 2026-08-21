#!/usr/bin/env node
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {instructionLeakReasons,paragraphQualityReasons,sanitizePersistedState,nearDuplicate} from './lib/review-fragment-quality.mjs';
import {isSingleParagraphSchema,completeParagraphPrefix,cleanInstructionLeakSentences} from './lib/local-editorial-model.mjs';

const workflow=fs.readFileSync('.github/workflows/game-post-create-enrichment.yml','utf8');
const continuation=fs.readFileSync('.github/workflows/game-post-create-continuation.yml','utf8');
const orchestratorPath='scripts/run-commercial-review-contract.mjs';
const resolverPath='scripts/resolve-post-create-event-targets.mjs';
const wrapperPath='scripts/synthesize-commercial-review-resilient-wrapper.mjs';
const qualityPath='scripts/lib/review-fragment-quality.mjs';
const localModelPath='scripts/lib/local-editorial-model.mjs';
const validatorPath='scripts/validate-commercial-review-v2.mjs';
const orchestrator=fs.readFileSync(orchestratorPath,'utf8');
const resolver=fs.readFileSync(resolverPath,'utf8');
const wrapper=fs.readFileSync(wrapperPath,'utf8');
const quality=fs.readFileSync(qualityPath,'utf8');
const localModel=fs.readFileSync(localModelPath,'utf8');
const validator=fs.readFileSync(validatorPath,'utf8');
const fail=message=>{throw new Error(message)};

for(const file of [orchestratorPath,resolverPath,wrapperPath,qualityPath,localModelPath,validatorPath]){
  try{execFileSync(process.execPath,['--check',file],{stdio:'pipe'})}
  catch(error){fail(`${file} syntax is invalid: ${String(error?.stderr||error?.message||error)}`)}
}

const leaked='Новый абзац должен быть строго посвящён конкретному аспекту из NEW EVIDENCE без повторения уже существующего текста. Важно использовать только русский язык, латиница запрещена, не добавлять неподтверждённые данные и сохранять объём от 60 до 95 слов для одного абзаца.';
const good='Система характеристик заставляет заранее выбирать сильные стороны героя: высокий интеллект открывает больше вариантов разговора, а неудачное распределение очков заметно меняет способы решения заданий и темп развития персонажа.';
if(!instructionLeakReasons(leaked).length)fail('Shared fragment gate does not reject the known persisted instruction leak');
if(paragraphQualityReasons(good,{minWords:15,maxWords:80}).length)fail('Shared fragment gate rejects valid Russian review prose');
if(!nearDuplicate(good,good))fail('Shared fragment gate no longer recognizes an exact duplicate');
if(!paragraphQualityReasons(good,{existing:[good],minWords:15,maxWords:80}).some(reason=>reason.startsWith('near-duplicate:')))fail('Shared pre-save paragraph gate does not reject duplicate prose');
const cleaned=sanitizePersistedState({sections:{sample:{paragraphs:[good,leaked]}},meta:null,verdict:null});
if(!cleaned.changed||cleaned.state.sections.sample.paragraphs.length!==1||cleaned.state.sections.sample.paragraphs[0]!==good)fail('Persisted-state cleaner does not remove leaked instructions while preserving valid prose');
const paragraphSchema={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:{type:'string'}}};
if(!isSingleParagraphSchema(paragraphSchema))fail('Single-paragraph schema no longer routes to plain text transport');
if(isSingleParagraphSchema({type:'object',required:['paragraph','source'],properties:{paragraph:{type:'string'},source:{type:'string'}}}))fail('Multi-field JSON schema is incorrectly routed as plain paragraph text');
const overrun='Развитие героя заметно меняет способы прохождения заданий, потому что характеристики влияют и на разговоры, и на доступные решения. Высокий интеллект открывает дополнительные варианты диалога, а слабые параметры заставляют искать обходные пути и иначе распределять ресурсы. Этот законченный фрагмент уже образует связный редакционный абзац и может быть сохранён без следующего незавершённого хвоста. Незавершённый хвост модели который оборвался на лимите и не должен попасть в материал';
const salvaged=completeParagraphPrefix(overrun,{minWords:18,maxWords:80});
if(!salvaged||salvaged.includes('Незавершённый хвост')||!/[.!?…]$/.test(salvaged))fail('Output-limit recovery does not preserve only a complete bounded paragraph prefix');
if(completeParagraphPrefix('Незавершённый хвост без финальной точки',{minWords:3,maxWords:30}))fail('Output-limit recovery accepts an incomplete fragment');
const mixed=`${good} Новая инструкция требует использовать только NEW EVIDENCE и не повторять существующий текст. Высокая харизма позволяет чаще решать конфликты разговором, поэтому два героя с разными характеристиками проходят одинаковые ситуации заметно по-разному.`;
const cleanMixed=cleanInstructionLeakSentences(mixed);
if(!cleanMixed.includes('Система характеристик')||!cleanMixed.includes('Высокая харизма')||/NEW EVIDENCE|инструкц/i.test(cleanMixed))fail('Mixed model output cannot discard leaked meta sentences while preserving completed review prose');

if(/OPENAI_API_KEY:\s*\$\{\{/.test(workflow))fail('Game-page workflow still exposes an OpenAI API key');
if(workflow.includes('Run accelerated full commercial review upgrade'))fail('Game-page workflow still contains a paid accelerated review stage');
if(workflow.includes("COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR: 'true'"))fail('Game-page workflow can still enable paid OpenAI synthesis');
for(const marker of ['LOCAL_TEXT_MODEL: qwen3:4b','LOCAL_EDITORIAL_MODEL: qwen3:4b','LOCAL_WRITER_MODEL: qwen3:0.6b'])if(!workflow.includes(marker))fail(`Required local model declaration missing: ${marker}`);

const quick=workflow.indexOf('Verify published quick reviews on production Pages');
const cache=workflow.indexOf('Restore local full-review model cache');
const service=workflow.indexOf('Start local full-review model service');
const models=workflow.indexOf('Ensure required local review models');
const cacheSave=workflow.indexOf('Save local full-review model cache before generation');
const local=workflow.indexOf('Run required local full commercial review upgrade');
const persist=workflow.indexOf('Persist incomplete full-review state for automatic continuation');
const verify=workflow.indexOf('Verify required full review completed locally');
const publish=workflow.indexOf('Publish full commercial review checkpoint');
const smoke=workflow.indexOf('Verify full commercial reviews on production Pages');
if([quick,cache,service,models,cacheSave,local,persist,verify,publish,smoke].some(x=>x<0))fail('Local persistent full-review workflow stages are incomplete');
if(!(quick<cache&&cache<service&&service<models&&models<cacheSave&&cacheSave<local&&local<persist&&persist<verify&&verify<publish&&publish<smoke))fail('Required order is quick-live -> local cache/service/models -> local full review -> persist/verify -> publish -> live smoke');
if(!workflow.includes('actions/cache/restore@v4')||!workflow.includes('actions/cache/save@v4'))fail('Local models are not persisted before long generation');
if(!workflow.includes('Record automatic continuation requirement'))fail('Incomplete required review is not explicitly handed to automatic continuation');
if(workflow.includes('Fail required full review if both providers failed'))fail('A single worker cycle can still terminate the released-game lifecycle');

for(const marker of ["OPENAI_API_KEY:''","COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'","provider_policy:'local_only'","commercial-review-contract-v6-local-only-persistent"])if(!orchestrator.includes(marker))fail(`Local-only orchestrator guard missing: ${marker}`);
if(orchestrator.includes('useOpenAIAccelerator='))fail('Commercial orchestrator still has a paid-provider routing mode');
if(!orchestrator.includes("stages.push(['meta-preflight','scripts/prepare-sectioned-review-meta.mjs'"))fail('Local deterministic preflight is not mandatory before synthesis');
if(!orchestrator.includes("stages.push(['long-review','scripts/synthesize-commercial-review-resilient-wrapper.mjs'"))fail('Canonical local resilient wrapper is not mandatory');

if(!resolver.includes("request?.released===true&&String(request?.modules?.review||'').toLowerCase()!=='ready'"))fail('Released games with incomplete reviews are not automatically treated as required');
if(!resolver.includes('Number(required(b))-Number(required(a))'))fail('Required incomplete games do not have retry priority');

for(const marker of ['workflow_run:',"workflows: ['Enrich newly created Игропоиск games']",'actions: write','Detect incomplete required released game','Dispatch next worker cycle','gh workflow run game-post-create-enrichment.yml --ref staging'])if(!continuation.includes(marker))fail(`Automatic continuation workflow missing: ${marker}`);
if(!continuation.includes("String(r.state||'')!=='complete'&&required(r)"))fail('Continuation workflow can stop while a required released game is incomplete');

if(!wrapper.includes("spawnSync('node',['scripts/synthesize-commercial-review-resilient.mjs',slug]"))fail('Repair wrapper does not delegate to canonical resilient synthesis');
if(!wrapper.includes("OPENAI_API_KEY:''")||!wrapper.includes("COMMERCIAL_REVIEW_USE_OPENAI_ACCELERATOR:'false'"))fail('Repair wrapper does not independently suppress paid API access');
for(const marker of ['function evidenceForRepair','sourceList.flatMap(source=>sourceAtoms(source))','const novel=ranked.filter(atom=>atom.overlap<0.72)','repairPrompt','section.repair_cursor=Number(section.repair_cursor||0)+1','repair_attempts_total','repair_rejections_total','while(canRepair(section))','MAX_REPAIR_ATTEMPTS_PER_SECTION_PER_RUN','markContinuation(true','full-review-incomplete','provider_policy:\'local_only\'','sanitizePersistedState','shared-pre-save-v1'])if(!wrapper.includes(marker))fail(`Persistent repair contract missing: ${marker}`);
if(wrapper.includes('MAX_TOTAL_REPAIR_ATTEMPTS'))fail('Review repair still has a terminal global attempt budget');
if(wrapper.includes('MAX_4B_REPAIR_PARAGRAPHS=14'))fail('Full article repair is still capped by the obsolete global 14-call budget');
if(!wrapper.includes('if(!includeEmpty&&!paragraphs.length)continue'))fail('Repair wrapper still spends editorial calls on untouched empty sections before the base writer runs');
for(const forbidden of ['NEW EVIDENCE','ПРЕДЫДУЩАЯ ПОПЫТКА','ПРЕДЫДУЩИЙ ВАРИАНТ','source-grounded'])if(wrapper.includes(forbidden))fail(`Repair prompt still contains copyable technical marker: ${forbidden}`);
if(wrapper.includes('ПОСЛЕДНИЙ АБЗАЦ:'))fail('Repair wrapper still primes the model with the paragraph it must not paraphrase');
if(!quality.includes('return tokenOverlap(a,b)>=threshold'))fail('Shared near-duplicate threshold implementation is missing');
for(const marker of ['generatedReviewInstructionLeaks','instructionLeakReasons','output rejected before persistence','isSingleParagraphSchema','chatSingleParagraph','normalizePlainParagraph','completeParagraphPrefix','cleanInstructionLeakSentences','effectiveNumPredict','stop:[\'\\n\\n\']','hit the output limit without a complete usable prefix'])if(!localModel.includes(marker))fail(`Local model shared paragraph transport/gate missing: ${marker}`);
if(localModel.includes('Math.max(512,Number(numPredict'))fail('Single-paragraph transport still overrides bounded caller token budgets with a 512-token minimum');
if(!localModel.includes('if(isSingleParagraphSchema(format))')||!localModel.includes('return{paragraph};'))fail('Single paragraph requests can still enter fragile structured JSON generation');
for(const marker of ['articleInstructionLeakReasons(article)','nearDuplicate(paras[i],paras[j])','shared-fragment-and-final-v1'])if(!validator.includes(marker))fail(`Final provider-independent quality gate missing: ${marker}`);
if(!wrapper.includes('try{')||!wrapper.includes('}catch(error){'))fail('Repair wrapper can abort the full-review job on one local paragraph timeout');
for(const marker of ['review-commercial-v2-${slug}.json','full review is below 3000 words','final editorial audit is not green'])if(!workflow.includes(marker))fail(`Required full-review proof missing: ${marker}`);

console.log('Full-review quality contract passed: game-page creation is local-only, paid OpenAI API access is suppressed at workflow/orchestrator/wrapper boundaries, released incomplete reviews are mandatory, progress and repair cursors persist, worker-cycle safeguards are non-terminal, local model cache is saved before generation, and a continuation workflow re-dispatches work until complete.');
