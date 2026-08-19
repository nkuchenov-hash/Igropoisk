import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const contractPath=path.join(root,'config/review-commercial-contract.json');
const mediaPath=path.join(root,'config/parsers/review-media-policy.json');
const synthesisPath=path.join(root,'config/parsers/review-synthesis.json');
const qualityPath=path.join(root,'config/game-page-quality-v2.json');
const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
const media=JSON.parse(fs.readFileSync(mediaPath,'utf8'));
const synthesis=JSON.parse(fs.readFileSync(synthesisPath,'utf8'));
const quality=JSON.parse(fs.readFileSync(qualityPath,'utf8'));
const article=contract.article||{},gameMedia=contract.game_media||{},articleMedia=contract.article_media||{},corpus=contract.source_corpus||{};

media.schema_version=Math.max(Number(media.schema_version||1),14);
media.purpose='Поддерживать единый коммерческий стандарт обзора: длинный журнальный текст и 15–20 настоящих уникальных игровых скриншотов, распределённых по осмысленным каруселям. Artwork хранится отдельно и не считается скриншотом.';
media.article_balance={
  ...(media.article_balance||{}),
  minimum_words:Number(article.minimum_words||3000),
  target_words:Number(article.target_words||3400),
  maximum_words_without_editor_approval:Number(article.maximum_words_without_editor_approval||4500),
  minimum_words_per_section:Number(article.minimum_words_per_section||260),
  minimum_sections:Number(article.minimum_sections||8),
  target_sections:Number(article.target_sections||9),
  maximum_sections:Number(article.maximum_sections||10),
  minimum_candidate_screenshots:Number(gameMedia.minimum_unique_screenshots||15),
  target_candidate_screenshots:Number(gameMedia.target_unique_screenshots||20),
  minimum_approved_screenshots:Number(gameMedia.minimum_unique_screenshots||15),
  minimum_total_screenshots:Number(articleMedia.minimum_total_unique_screenshots||15),
  minimum_unique_screenshots:Number(articleMedia.minimum_total_unique_screenshots||15),
  screenshots_per_section:{minimum:0,target:0,maximum:Number(articleMedia.maximum_images_per_carousel||5)},
  carousel_policy:{
    minimum_carousels:Number(articleMedia.minimum_carousels||4),
    target_carousels:Number(articleMedia.target_carousels||5),
    maximum_carousels:Number(articleMedia.maximum_carousels||6),
    minimum_images_per_carousel:Number(articleMedia.minimum_images_per_carousel||3),
    target_images_per_carousel:Number(articleMedia.target_images_per_carousel||4),
    maximum_images_per_carousel:Number(articleMedia.maximum_images_per_carousel||5)
  }
};
media.source_policy={...(media.source_policy||{}),minimum_media_sources:1,prefer_official_game_specific_media:true};
media.publication_gate={...(media.publication_gate||{}),fail_closed:true,minimum_meaningful_carousels_required:Number(articleMedia.minimum_carousels||4),any_duplicate_is_failure:true};
media.publication_invariants=[
  'Публичный обзор обязан пройти config/review-commercial-contract.json; более слабый локальный порог запрещён.',
  `На странице игры должно быть не менее ${gameMedia.minimum_unique_screenshots||15} и целевым образом ${gameMedia.target_unique_screenshots||20} настоящих уникальных игровых скриншотов.`,
  'Artwork, cover art, key art, posters and wallpapers never enter the screenshot pool.',
  `Статья содержит не менее ${articleMedia.minimum_carousels||4} каруселей и не менее ${articleMedia.minimum_total_unique_screenshots||15} уникальных скриншотов суммарно.`,
  'Повтор URL, resized derivative, content-hash duplicate или повтор сцены блокирует публикацию.'
];

synthesis.schema_version=Math.max(Number(synthesis.schema_version||1),7);
synthesis.purpose='Создавать полноценные журнальные обзоры из прочитанных полнотекстовых профессиональных рецензий. Score-index и агрегаторы могут помогать найти оригинал, но не считаются текстовой базой статьи.';
synthesis.publication_gate={
  ...(synthesis.publication_gate||{}),
  editorial_reviews_required:Number(corpus.minimum_independent_full_reviews||15),
  independent_publications_required:Number(corpus.minimum_independent_full_reviews||15),
  minimum_sections:Number(article.minimum_sections||8),
  maximum_sections:Number(article.maximum_sections||10),
  minimum_article_words:Number(article.minimum_words||3000),
  target_article_words:Number(article.target_words||3400),
  maximum_article_words_without_editor_approval:Number(article.maximum_words_without_editor_approval||4500),
  verified_screenshots_required:Number(articleMedia.minimum_total_unique_screenshots||15),
  media_candidates_required:Number(gameMedia.target_unique_screenshots||20),
  media_candidates_quality_passed_required:Number(gameMedia.minimum_unique_screenshots||15),
  minimum_unique_article_images:Number(articleMedia.minimum_total_unique_screenshots||15),
  publish_below_gate:false
};
synthesis.method=synthesis.method||{};
synthesis.method.formula=`${corpus.minimum_independent_full_reviews||15}–${corpus.target_independent_full_reviews||20} прочитанных полнотекстовых профессиональных рецензий → source dossiers → обзор ${article.minimum_words||3000}+ слов → ${articleMedia.minimum_carousels||4}–${articleMedia.maximum_carousels||6} каруселей → минимум ${articleMedia.minimum_total_unique_screenshots||15} уникальных gameplay screenshots → аудит → публикация.`;
synthesis.method.normalization='Score corpus и article corpus разделены. Critic-index, агрегатор или одна строка-выдержка не закрывают article-source gate. Artwork и screenshots также являются разными медиапулами.';

quality.review_corpus={...(quality.review_corpus||{}),minimum_sources:Number(corpus.minimum_independent_full_reviews||15),target_sources:Number(corpus.target_independent_full_reviews||20),maximum_sources:Number(corpus.target_independent_full_reviews||20),candidate_target:Number(corpus.candidate_target||32)};
quality.images=quality.images||{};quality.images.screenshot={...(quality.images.screenshot||{}),minimum_count:Number(gameMedia.minimum_unique_screenshots||15)};

fs.writeFileSync(mediaPath,JSON.stringify(media,null,2)+'\n');
fs.writeFileSync(synthesisPath,JSON.stringify(synthesis,null,2)+'\n');
fs.writeFileSync(qualityPath,JSON.stringify(quality,null,2)+'\n');
console.log('Review/media policies synchronized from config/review-commercial-contract.json');
