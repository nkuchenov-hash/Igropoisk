import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNewsPipelineHealth } from './build-news-pipeline-health.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-health-'));
for (const directory of ['config', 'data', 'assets/news', 'assets/publisher-news']) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
}

const now = Date.parse('2026-08-05T10:00:00.000Z');
const config = {
  groups: [],
  health: {
    output_file: 'data/news-pipeline-health.json',
    persistent_failure_threshold: 3,
    warning_age_minutes: {
      'data/news.json': 2160,
      'data/publisher-news.json': 120,
      'data/youtube-signals.json': 120,
      'data/news-events.json': 120,
      'data/news-home-ru.json': 120
    },
    blocking_age_minutes: {
      'data/news.json': 4320,
      'data/publisher-news.json': 360,
      'data/youtube-signals.json': 360,
      'data/news-events.json': 360,
      'data/news-home-ru.json': 360
    }
  },
  publication: {
    minimum_items: {
      'data/news.json': 1,
      'data/publisher-news.json': 1,
      'data/news-events.json': 1,
      'data/news-home-ru.json': 1
    },
    minimum_official_source_success_ratio: 0.15,
    image_roots: ['assets/news/', 'assets/publisher-news/'],
    storage: { media_prefix: 'news/media' }
  }
};
fs.writeFileSync(path.join(root, 'config/news-pipeline.json'), JSON.stringify(config));

const imageItem = (id, rootName = 'assets/news') => ({
  id,
  titleRu: `Новость ${id}`,
  publishedAt: '2026-08-05T09:30:00.000Z',
  url: `https://example.com/${id}`,
  image: `${rootName}/${id}.jpg`
});
const news = [imageItem('news')];
const publisher = [imageItem('publisher', 'assets/publisher-news')];
const events = [imageItem('event')];
const home = [imageItem('home')];
for (const item of [...news, ...publisher, ...events, ...home]) {
  fs.writeFileSync(path.join(root, item.image), 'image');
}

fs.writeFileSync(path.join(root, 'data/news.json'), JSON.stringify({ generatedAt: '2026-08-05T09:30:00.000Z', items: news }));
fs.writeFileSync(path.join(root, 'data/publisher-news.json'), JSON.stringify({
  generatedAt: '2026-08-05T09:30:00.000Z',
  sourceCount: 2,
  successfulSourceCount: 1,
  sourceReport: [
    { id: 'working', status: 'ok', items: 1 },
    { id: 'broken', status: 'error', error: '404 Not Found' }
  ],
  items: publisher
}));
fs.writeFileSync(path.join(root, 'data/youtube-signals.json'), JSON.stringify({ generatedAt: '2026-08-05T09:30:00.000Z', items: [] }));
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify({ generatedAt: '2026-08-05T09:30:00.000Z', items: events }));
fs.writeFileSync(path.join(root, 'data/news-home-ru.json'), JSON.stringify({ generatedAt: '2026-08-05T09:30:00.000Z', items: home }));
fs.writeFileSync(path.join(root, 'data/news-pipeline-health.json'), JSON.stringify({
  status: 'degraded',
  last_successful_run_at: '2026-08-05T08:00:00.000Z',
  sources: {
    history: [
      { id: 'broken', status: 'error', consecutive_failures: 2, last_failure_at: '2026-08-05T08:30:00.000Z' }
    ]
  }
}));

const health = buildNewsPipelineHealth({
  root,
  now,
  dueGroups: ['official-sources'],
  runStartedAt: '2026-08-05T09:29:00.000Z'
});
assert.equal(health.status, 'degraded');
assert.equal(health.data['data/news.json'].count, 1);
assert.equal(health.images.missing, 0);
assert.equal(health.sources.persistent_failures.length, 1);
assert.equal(health.sources.persistent_failures[0].consecutive_failures, 3);
assert.equal(health.last_successful_run_at, '2026-08-05T09:29:00.000Z');

const hydratedEvents = JSON.parse(fs.readFileSync(path.join(root, 'data/news-events.json'), 'utf8'));
hydratedEvents.items[0].image = 'https://storage.yandexcloud.net/igropoisk-content/news/media/abc123.jpg';
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify(hydratedEvents));
const hydratedHealth = buildNewsPipelineHealth({ root, now, dueGroups: ['global-media'] });
assert.equal(hydratedHealth.images.missing, 0, 'Published Object Storage history media must remain valid after hydration.');

const unsafeEvents = JSON.parse(fs.readFileSync(path.join(root, 'data/news-events.json'), 'utf8'));
unsafeEvents.items[0].image = 'https://example.com/news/media/abc123.jpg';
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify(unsafeEvents));
const unsafeRemote = buildNewsPipelineHealth({ root, now, dueGroups: ['global-media'] });
assert.equal(unsafeRemote.status, 'degraded');
assert.equal(unsafeRemote.images.missing, 1);
assert.equal(unsafeRemote.blocking_errors.length, 0, 'An unavailable image must never block news publication.');

unsafeEvents.items[0].image = events[0].image;
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify(unsafeEvents));
fs.rmSync(path.join(root, home[0].image));
const missingImage = buildNewsPipelineHealth({ root, now, dueGroups: ['global-media'] });
assert.equal(missingImage.status, 'degraded');
assert.equal(missingImage.images.missing, 1);
assert.equal(missingImage.blocking_errors.length, 0, 'A missing local image must degrade gracefully to the branded fallback.');

fs.writeFileSync(path.join(root, home[0].image), 'image');
const officialPayload = JSON.parse(fs.readFileSync(path.join(root, 'data/publisher-news.json'), 'utf8'));
officialPayload.sourceCount = 10;
officialPayload.successfulSourceCount = 1;
officialPayload.sourceReport = Array.from({ length: 10 }, (_, index) => index === 0
  ? { id: 'working', status: 'ok', items: 1 }
  : { id: `missing-${index}`, status: 'no-feed', items: 0 });
fs.writeFileSync(path.join(root, 'data/publisher-news.json'), JSON.stringify(officialPayload));
const belowFloor = buildNewsPipelineHealth({ root, now, dueGroups: ['official-sources'], runStartedAt: '2026-08-05T09:59:00.000Z' });
assert.equal(belowFloor.status, 'error', 'Official source success ratio below contractual floor must block publication.');
assert.ok(belowFloor.blocking_errors.some(message => message.includes('обязательном минимуме')));
assert.notEqual(belowFloor.last_successful_run_at, '2026-08-05T09:59:00.000Z', 'A blocked run must not advance last_successful_run_at.');

officialPayload.sourceCount = 2;
officialPayload.successfulSourceCount = 2;
officialPayload.sourceReport = [
  { id: 'working', status: 'ok', items: 1 },
  { id: 'broken', status: 'ok', items: 1 }
];
fs.writeFileSync(path.join(root, 'data/publisher-news.json'), JSON.stringify(officialPayload));
const recovered = buildNewsPipelineHealth({ root, now, dueGroups: ['official-sources'] });
assert.equal(recovered.sources.history.find(source => source.id === 'broken').consecutive_failures, 0);
assert.equal(recovered.sources.persistent_failures.length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log('News pipeline health self-test passed.');
