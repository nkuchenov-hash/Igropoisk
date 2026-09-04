import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const mediaPath=path.join(root,'config/parsers/review-media-policy.json');
const editorialPath=path.join(root,'config/review-editorial-policy.json');
const synthesisPath=path.join(root,'config/parsers/review-synthesis.json');
const media=JSON.parse(fs.readFileSync(mediaPath,'utf8'));
const editorial=JSON.parse(fs.readFileSync(editorialPath,'utf8'));
const synthesis=JSON.parse(fs.readFileSync(synthesisPath,'utf8'));
const balance=media.article_balance||{};
const article=editorial.article||{};
const sourcePolicy=editorial.source_policy||{};

synthesis.schema_version=Math.max(Number(synthesis.schema_version||1),7);
synthesis.status='active-compatibility-config';
synthesis.editorial_policy_file='config/review-editorial-policy.json';
synthesis.purpose='Совместимый runtime-конфиг Review Module. Редакционные правила задаются Review Skill v1, а источники берутся только из канонического корпуса Game Page Module.';
synthesis.publication_gate={
  fixed_source_count_required:false,
  minimum_usable_evidence_sources:Number(sourcePolicy.minimum_usable_evidence_sources??1),
  minimum_sections:Number(article.minimum_sections||7),
  maximum_sections:Number(article.maximum_sections||10),
  minimum_article_words:Number(article.minimum_words||1800),
  target_article_words_min:Number(article.target_words_min||2000),
  target_article_words_max:Number(article.target_words_max||2600),
  maximum_article_words_without_editor_approval:Number(article.maximum_words_without_editor_approval||3200),
  verified_screenshots_required:Number(balance.minimum_total_screenshots||7),
  minimum_unique_article_images:Number(balance.minimum_unique_screenshots||7),
  minimum_images_per_section:Number(balance.screenshots_per_section?.minimum||1),
  target_images_per_section:Number(balance.screenshots_per_section?.target||1),
  maximum_images_per_section:Number(balance.screenshots_per_section?.maximum||2),
  publish_below_gate:false
};
synthesis.research_policy={
  canonical_corpus:'data/game-sources/{slug}.json',
  independent_review_source_discovery:false,
  collect_all_available_professional_reviews:true,
  fixed_source_count_required:false,
  exact_game_version_required:true,
  legacy_adapter:'scripts/prepare-review-research.mjs'
};
synthesis.media_quality_policy={...(synthesis.media_quality_policy||{}),policy_file:'config/parsers/review-media-policy.json'};
synthesis.method={
  formula:`канонический source corpus → evidence extraction → индивидуальная структура → обзор ${synthesis.publication_gate.target_article_words_min}–${synthesis.publication_gate.target_article_words_max} слов → evergreen/anti-generic audit той же моделью → визуальный аудит → публикация`,
  normalization:'Review Module не создаёт собственную базу источников и не требует фиксированного количества профессиональных рецензий. Он использует все пригодные материалы из канонического data/game-sources/<slug>.json.',
  steps:[
    'Получить точную каноническую игру и source corpus из Game Page Module.',
    'Извлечь evidence: механики, персонажей, структуру мира, HUD/интерфейс, обратную связь, характерные детали, сильные стороны и конкретные проблемы.',
    'Построить индивидуальную структуру из 7–10 смысловых разделов; не использовать обязательный шаблон про возраст игры.',
    'Написать естественный журнальный обзор нормальными абзацами; механики описывать в настоящем времени.',
    'Провести той же моделью evergreen/anti-generic audit и исправить найденные проблемы без добавления новых фактов.',
    'Подобрать и визуально проверить релевантный уникальный скриншот для каждого раздела.',
    'Связать существенные тезисы с реальными source_id и опубликовать только после content-QC.'
  ]
};
synthesis.sources=[];
synthesis.source_registry_owner='game-page-module';
fs.writeFileSync(synthesisPath,JSON.stringify(synthesis,null,2)+'\n');
console.log('Review synthesis compatibility policy synchronized with Review Skill v1 and review-media-policy.json');
