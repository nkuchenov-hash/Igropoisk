import assert from 'node:assert/strict';
import fs from 'node:fs';

const globalFetcher = fs.readFileSync('scripts/fetch-news.mjs', 'utf8');
const officialFetcher = fs.readFileSync('scripts/fetch-publisher-news.mjs', 'utf8');
const validator = fs.readFileSync('scripts/validate-news-pipeline.mjs', 'utf8');
const health = fs.readFileSync('scripts/build-news-pipeline-health.mjs', 'utf8');
const fallback = fs.readFileSync('features/news/shared/image-fallback.js', 'utf8');
const module = JSON.parse(fs.readFileSync('features/news/module.json', 'utf8'));

assert.match(globalFetcher, /continuing from feed data without cached image/, 'Global news must survive article/image retrieval failure.');
assert.match(globalFetcher, /imageCacheStatus:\s*'fallback'/, 'Global news must expose fallback image state.');
assert.match(officialFetcher, /continuing without cached image/, 'Official news must survive article/image retrieval failure.');
assert.match(officialFetcher, /imageFallbackItemCount/, 'Official source diagnostics must count image fallbacks.');
assert.doesNotMatch(validator, /references a missing image|image outside approved roots/, 'Publication validation must not block on image availability.');
assert.match(health, /публикация продолжена с фирменной заглушкой/, 'Image problems must be observable as warnings.');
assert.doesNotMatch(health, /blocking\.push\(`Отсутствуют .*изображ/, 'Image problems must not become health blockers.');
assert.match(fallback, /addEventListener\('error'/, 'Client must replace broken cached media without a broken-image icon.');
assert.ok(module.runtime.includes('features/news/shared/image-fallback.js'), 'Fallback runtime must load on public news surfaces.');

console.log('News image caching and fallback contract tests passed.');
