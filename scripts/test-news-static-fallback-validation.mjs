import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateNewsPipeline } from './validate-news-pipeline.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-static-fallback-'));
for (const directory of ['config', 'data', 'features/news']) fs.mkdirSync(path.join(root, directory), { recursive: true });

const config = {
  health: {
    output_file: 'data/news-pipeline-health.json',
    blocking_age_minutes: {
      'data/news.json': 360,
      'data/publisher-news.json': 360,
      'data/youtube-signals.json': 360,
      'data/news-events.json': 360,
      'data/news-home-ru.json': 360
    }
  },
  publication: {
    required_files: [
      'data/news.json', 'data/publisher-news.json', 'data/youtube-signals.json',
      'data/news-events.json', 'data/news-home-ru.json', 'data/news-pipeline-health.json'
    ],
    minimum_items: {
      'data/news.json': 1,
      'data/publisher-news.json': 1,
      'data/news-events.json': 1,
      'data/news-home-ru.json': 1
    },
    minimum_retained_fraction: 0,
    homepage_exact_items: 1
  }
};
fs.writeFileSync(path.join(root, 'config/news-pipeline.json'), JSON.stringify(config));
fs.writeFileSync(path.join(root, 'features/news/module.json'), JSON.stringify({
  content: [
    'data/news.json', 'data/publisher-news.json', 'data/youtube-signals.json',
    'data/news-events.json', 'data/news-home-ru.json', 'data/news-pipeline-health.json'
  ],
  contentApi: { global: 'IgropoiskNewsContent' },
  pipeline: { health: 'data/news-pipeline-health.json' }
}));

const generatedAt = '2026-08-20T00:00:00.000Z';
const makeItem = (id) => ({ id, titleRu: `Новость ${id}`, publishedAt: generatedAt, url: `https://example.com/${id}` });
const payloads = {
  'data/news.json': { generatedAt, items: [makeItem('news')] },
  'data/publisher-news.json': {
    generatedAt,
    sourceCount: 1,
    successfulSourceCount: 1,
    sourceReport: [{ id: 'official', status: 'ok', items: 1 }],
    items: [makeItem('official')]
  },
  'data/youtube-signals.json': { generatedAt, items: [] },
  'data/news-events.json': { generatedAt, items: [makeItem('event')] },
  'data/news-home-ru.json': { generatedAt, items: [makeItem('home')] }
};
for (const [file, payload] of Object.entries(payloads)) fs.writeFileSync(path.join(root, file), JSON.stringify(payload));

const staleAgeMinutes = 13_000;
fs.writeFileSync(path.join(root, 'data/news-pipeline-health.json'), JSON.stringify({
  schema_version: 1,
  pipeline: 'news',
  status: 'degraded',
  generated_at: generatedAt,
  last_successful_run_at: generatedAt,
  due_groups: ['global-media', 'official-sources'],
  data: {
    'data/news.json': { generated_at: generatedAt, age_minutes: staleAgeMinutes, count: 1, minimum: 1 },
    'data/publisher-news.json': { generated_at: generatedAt, age_minutes: staleAgeMinutes, count: 1, minimum: 1 },
    'data/youtube-signals.json': { generated_at: generatedAt, age_minutes: staleAgeMinutes, count: 0, minimum: 0 },
    'data/news-events.json': { generated_at: generatedAt, age_minutes: staleAgeMinutes, count: 1, minimum: 1 },
    'data/news-home-ru.json': { generated_at: generatedAt, age_minutes: staleAgeMinutes, count: 1, minimum: 1 }
  },
  sources: { total: 1, successful: 1, history: [], persistent_failures: [] },
  warnings: ['repository fallback is intentionally historical'],
  blocking_errors: []
}));

const strict = validateNewsPipeline({ root });
assert.equal(strict.ok, false, 'Runtime/publication validation must enforce the freshness SLA.');
assert.ok(strict.errors.some(error => error.includes('older than 360 minutes')));
assert.equal(strict.freshness_enforced, true);

const staticFallback = validateNewsPipeline({ root, allowStaleRepositoryFallback: true });
assert.equal(staticFallback.ok, true, staticFallback.errors.join('\n'));
assert.equal(staticFallback.freshness_enforced, false);

fs.rmSync(root, { recursive: true, force: true });
console.log('Static repository news fallback validation regression passed.');
