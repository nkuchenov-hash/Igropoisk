import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const mediaPath=path.join(root,'config/parsers/review-media-policy.json');
const synthesisPath=path.join(root,'config/parsers/review-synthesis.json');
const media=JSON.parse(fs.readFileSync(mediaPath,'utf8'));
const synthesis=JSON.parse(fs.readFileSync(synthesisPath,'utf8'));
const balance=media.article_balance||{};
const sources=synthesis.publication_gate?.editorial_reviews_required||20;
synthesis.schema_version=Math.max(Number(synthesis.schema_version||1),6);
synthesis.purpose='Создавать полноценные журнальные обзоры с подробным содержанием, широкими разделами и большим набором качественных уникальных скриншотов.';
synthesis.publication_gate={
  ...(synthesis.publication_gate||{}),
  editorial_reviews_required:sources,
  independent_publications_required:sources,
  minimum_sections:Number(balance.minimum_sections||8),
  maximum_sections:Number(balance.maximum_sections||12),
  minimum_article_words:Number(balance.minimum_words||2200),
  target_article_words:Number(balance.target_words||2800),
  verified_screenshots_required:Number(balance.minimum_total_screenshots||30),
  media_candidates_required:Number(balance.minimum_candidate_screenshots||80),
  media_candidates_quality_passed_required:Number(balance.minimum_approved_screenshots||40),
  minimum_unique_article_images:Number(balance.minimum_unique_screenshots||30),
  minimum_images_per_section:Number(balance.screenshots_per_section?.minimum||3),
  target_images_per_section:Number(balance.screenshots_per_section?.target||4),
  maximum_images_per_section:Number(balance.screenshots_per_section?.maximum||6),
  publish_below_gate:false
};
synthesis.media_quality_policy={...(synthesis.media_quality_policy||{}),policy_file:'config/parsers/review-media-policy.json'};
synthesis.method=synthesis.method||{};
synthesis.method.formula=`${sources} источников критики + ${synthesis.publication_gate.media_candidates_required}+ медиакандидатов → полный обзор ${synthesis.publication_gate.minimum_article_words}+ слов → ${synthesis.publication_gate.minimum_images_per_section}–${synthesis.publication_gate.maximum_images_per_section} уникальных кадров в карточке → аудит → статическая публикация.`;
fs.writeFileSync(synthesisPath,JSON.stringify(synthesis,null,2)+'\n');
console.log('Review synthesis policy synchronized with review-media-policy.json');
