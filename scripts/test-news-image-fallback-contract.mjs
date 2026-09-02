import assert from 'node:assert/strict';
import fs from 'node:fs';

const globalFetcher = fs.readFileSync('scripts/fetch-news.mjs', 'utf8');
const officialFetcher = fs.readFileSync('scripts/fetch-publisher-news.mjs', 'utf8');
const validator = fs.readFileSync('scripts/validate-news-pipeline.mjs', 'utf8');
const health = fs.readFileSync('scripts/build-news-pipeline-health.mjs', 'utf8');
const publisher = fs.readFileSync('scripts/publish-news-storage.mjs', 'utf8');
const mediaGc = fs.readFileSync('scripts/prune-news-media-cache.mjs', 'utf8');

assert.match(globalFetcher, /continuing from feed data without cached image/, 'Global news must survive article/image retrieval failure.');
assert.match(globalFetcher, /imageCacheStatus\s*=\s*'fallback'/, 'Global news must expose fallback image state.');
assert.match(officialFetcher, /continuing without cached image/, 'Official news must survive article/image retrieval failure.');
assert.match(officialFetcher, /imageFallbackItemCount/, 'Official source diagnostics must count image fallbacks.');
assert.doesNotMatch(validator, /references a missing image|image outside approved roots/, 'Publication validation must not block on image availability.');
assert.match(health, /публикация продолжена с фирменной заглушкой/, 'Image problems must be observable as warnings.');
assert.doesNotMatch(health, /blocking\.push\(`Отсутствуют .*изображ/, 'Image problems must not become health blockers.');
assert.match(publisher, /fallback\.svg/, 'Publisher must provide a permanent first-party branded placeholder.');
assert.match(publisher, /return \[key, fallbackUrl\]/, 'Expired, missing, and third-party media must be rewritten to the first-party fallback.');
assert.match(publisher, /media_cache_control/, 'Publisher must use a dedicated short-lived browser cache policy for news media.');
assert.match(mediaGc, /protectedKeys\.add\(fallbackKey\)/, 'Media cleanup must never delete the permanent fallback asset.');

console.log('News image caching and first-party fallback contract tests passed.');
