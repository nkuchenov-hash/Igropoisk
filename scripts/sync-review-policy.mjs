#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const mediaPath=path.join(root,'config/parsers/review-media-policy.json');
const synthesisPath=path.join(root,'config/parsers/review-synthesis.json');
const media=JSON.parse(fs.readFileSync(mediaPath,'utf8'));
const synthesis=JSON.parse(fs.readFileSync(synthesisPath,'utf8'));
const balance=media.article_balance||{};

synthesis.schema_version=Math.max(Number(synthesis.schema_version||1),8);
synthesis.canonical_source_contract={...(synthesis.canonical_source_contract||{}),path:'data/game-sources/{slug}.json',owner:'game-page-source-pipeline',review_module_discovers_sources:false,source_count_policy:'use_all_available_verified_sources',fixed_editorial_source_quota:null,sources_define_evidence_not_structure:true};
synthesis.model_policy={...(synthesis.model_policy||{}),owner:'single_model_per_review_task',same_model_attempts:Number(synthesis.model_policy?.same_model_attempts||3),cross_model_fallback:false,technical_failure_policy:'retry_same_assigned_model'};
synthesis.publication_gate={
  ...(synthesis.publication_gate||{}),
  minimum_sections:Number(balance.minimum_sections||7),
  maximum_sections:Number(balance.maximum_sections||9),
  minimum_article_words:Number(balance.minimum_words||1600),
  target_article_words:Number(balance.target_words||2200),
  maximum_article_words_without_editor_approval:Number(balance.maximum_words_without_editor_approval||3200),
  minimum_words_per_section:Number(balance.minimum_words_per_section||170),
  publish_below_editorial_qc:false
};
delete synthesis.publication_gate.editorial_reviews_required;
delete synthesis.publication_gate.independent_publications_required;
delete synthesis.publication_gate.publish_below_gate;
synthesis.media_quality_policy={...(synthesis.media_quality_policy||{}),policy_file:'config/parsers/review-media-policy.json'};
fs.writeFileSync(synthesisPath,JSON.stringify(synthesis,null,2)+'\n');
console.log('Review Skill v1 policy synchronized without source-count quotas, source-type narrowing or cross-model fallback');
