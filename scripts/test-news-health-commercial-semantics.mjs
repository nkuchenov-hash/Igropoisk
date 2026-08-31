import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNewsPipelineHealth } from './build-news-pipeline-health.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-health-commercial-'));
for (const directory of ['config', 'data', 'assets/news']) fs.mkdirSync(path.join(root, directory), { recursive: true });
const now = Date.parse('2026-08-31T09:00:00.000Z');
const generatedAt = '2026-08-31T08:59:00.000Z';
const item = index => ({ id: `n${index}`, titleRu: `Игровая новость номер ${index}`, publishedAt: generatedAt, url: `https://example.test/${index}` });

const config = {
  groups: [],
  health: {
    output_file: 'data/news-pipeline-health.json',
    persistent_failure_threshold: 3,
    warning_age_minutes: Object.fromEntries(['data/news.json','data/publisher-news.json','data/youtube-signals.json','data/news-events.json','data/news-home-ru.json'].map(file => [file, 120])),
    blocking_age_minutes: Object.fromEntries(['data/news.json','data/publisher-news.json','data/youtube-signals.json','data/news-events.json','data/news-home-ru.json'].map(file => [file, 360]))
  },
  publication: {
    homepage_exact_items: 12,
    minimum_items: {
      'data/news.json': 12,
      'data/publisher-news.json': 1,
      'data/news-events.json': 12,
      'data/news-home-ru.json': 12
    },
    minimum_official_source_success_ratio: 0.15,
    image_roots: ['assets/news/'],
    storage: { media_prefix: 'news/media' }
  }
};
fs.writeFileSync(path.join(root, 'config/news-pipeline.json'), JSON.stringify(config));
fs.writeFileSync(path.join(root, 'data/news.json'), JSON.stringify({ generatedAt, items: Array.from({ length: 20 }, (_, i) => item(i)) }));
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify({ generatedAt, items: Array.from({ length: 20 }, (_, i) => item(i)) }));
fs.writeFileSync(path.join(root, 'data/news-home-ru.json'), JSON.stringify({ generatedAt, items: Array.from({ length: 12 }, (_, i) => item(i)) }));
fs.writeFileSync(path.join(root, 'data/youtube-signals.json'), JSON.stringify({ generatedAt, items: [] }));
fs.writeFileSync(path.join(root, 'data/publisher-news.json'), JSON.stringify({
  generatedAt,
  sourceCount: 6,
  successfulSourceCount: 1,
  sourceReport: [
    { id: 'working', status: 'ok', items: 3 },
    { id: 'rockstar', status: 'no-feed', items: 0 },
    { id: 'ubisoft', status: 'no-feed', items: 0 },
    { id: 'other-a', status: 'no-feed', items: 0 },
    { id: 'other-b', status: 'no-feed', items: 0 },
    { id: 'other-c', status: 'no-feed', items: 0 }
  ],
  items: [item('publisher-1'), item('publisher-2'), item('publisher-3')]
}));
fs.writeFileSync(path.join(root, 'data/news-pipeline-health.json'), JSON.stringify({
  status: 'degraded',
  sources: { history: [
    { id: 'rockstar', status: 'error', consecutive_failures: 7, last_failure_at: '2026-08-30T08:00:00.000Z' },
    { id: 'ubisoft', status: 'error', consecutive_failures: 7, last_failure_at: '2026-08-30T08:00:00.000Z' }
  ] }
}));

const health = buildNewsPipelineHealth({ root, now, dueGroups: ['official-sources'], runStartedAt: generatedAt });
assert.equal(health.status, 'healthy', JSON.stringify(health.warnings));
assert.equal(health.warnings.some(message => message.includes('news-home-ru') && message.includes('12/12')), false);
for (const id of ['rockstar', 'ubisoft']) {
  const source = health.sources.history.find(entry => entry.id === id);
  assert.equal(source.status, 'no-feed');
  assert.equal(source.consecutive_failures, 0);
  assert.equal(source.persistent_failure, false);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('Commercial news health semantics passed.');
