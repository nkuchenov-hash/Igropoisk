#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const manifestPath='config/game-page-module.manifest.json';
const errors=[];
const read=relative=>{try{return fs.readFileSync(path.join(root,relative),'utf8')}catch{return''}};
const exists=relative=>Boolean(read(relative));

let manifest=null;
try{manifest=JSON.parse(read(manifestPath))}catch(error){errors.push(`invalid or missing ${manifestPath}: ${error.message}`)}
if(manifest){
  if(manifest.schema_version!==1)errors.push('manifest schema_version must be 1');
  if(manifest.module!=='game-page-assembly')errors.push('manifest module must remain game-page-assembly');
  if(manifest.status!=='stable')errors.push('manifest status must remain stable');
  const expected={
    universal_module:true,
    per_game_code_forbidden:true,
    review_subsystem_separate:true,
    all_discovered_verified_scores_used:true,
    rating_count_quota_blocks_publication:false,
    additional_source_coverage_can_continue_after_publication:true,
    audience_profile_internal_only:true,
    audience_profile_fail_open:true,
    audience_profile_blocks_publication:false,
    audience_profile_ai_required:false,
    demographic_stereotyping_forbidden:true,
    editorial_model_is_replaceable:true,
    specific_model_quality_is_module_gate:false,
    spore_is_structural_fixture_only:true,
    published_green_package_is_canonical:true
  };
  for(const [key,value] of Object.entries(expected))if(manifest.contract?.[key]!==value)errors.push(`contract drift: ${key} must be ${value}`);
  for(const file of manifest.required_files||[])if(!exists(file))errors.push(`required module file missing: ${file}`);
  for(const [file,tokens] of Object.entries(manifest.protected_tokens||{})){
    const text=read(file);
    if(!text){errors.push(`protected file missing: ${file}`);continue}
    for(const token of tokens||[])if(!text.includes(token))errors.push(`${file} lost protected token: ${JSON.stringify(token)}`);
  }
  const contractScope=[manifest.acceptance_document,manifest.canonical_document,'.github/workflows/game-page-module-contract-check.yml'].filter(Boolean);
  for(const file of contractScope){const text=read(file);if(!text)continue;for(const token of manifest.forbidden_contract_text||[])if(text.includes(token))errors.push(`${file} reintroduced forbidden contract text: ${JSON.stringify(token)}`)}
}

const audience=spawnSync(process.execPath,['scripts/validate-game-audience-profile-integrity.mjs'],{cwd:root,encoding:'utf8',stdio:'pipe'});
if(audience.status!==0)errors.push(`Audience Profile contract failed: ${(audience.stderr||audience.stdout||'').slice(-2500)}`);

const acceptance=read('docs/game-page-module-acceptance.md');
if(!acceptance.includes('Review subsystem remains separate'))errors.push('Review subsystem separation is not documented');
if(!acceptance.includes('specific AI model/provider')&&!acceptance.includes('AI model/provider is a replaceable'))errors.push('model/provider independence is not documented');

const result={schema_version:1,module:'game-page-assembly',status:errors.length?'red':'green',checked_at:new Date().toISOString(),contract_version:manifest?.module_version||null,structural_fixture:'spore',model_quality_gate:false,audience_profile_gate:false,rating_count_quota_gate:false,errors,audience_check:(audience.stdout||'').trim().slice(-3500)};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exit(1);
