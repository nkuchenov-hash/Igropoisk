import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatedAtFromPayload, selectDueGroups, runPipeline } from './run-news-pipeline.mjs';
import { canonicalSourceUrl, validateNewsPipeline } from './validate-news-pipeline.mjs';

assert.equal(generatedAtFromPayload({ generatedAt: '2026-08-05T00:00:00.000Z' }), Date.parse('2026-08-05T00:00:00.000Z'));
assert.equal(generatedAtFromPayload({}), 0);
assert.notEqual(canonicalSourceUrl('https://youtube.com/watch?v=first'), canonicalSourceUrl('https://youtube.com/watch?v=second'));
assert.equal(
  canonicalSourceUrl('https://example.com/article?id=7&utm_source=test#fragment'),
  canonicalSourceUrl('https://example.com/article?id=7')
);

const schedule = {
  groups: [
    { id: 'hourly', interval_minutes: 60, freshness_file: 'hourly.json', commands: ['hourly'] },
    { id: 'daily', interval_minutes: 1440, freshness_file: 'daily.json', commands: ['daily'] }
  ],
  rebuild_commands: ['rebuild'],
  validation_commands: ['validate']
};
const now = Date.parse('2026-08-05T08:00:00.000Z');
const memory = {
  'hourly.json': { generatedAt: '2026-08-05T06:30:00.000Z' },
  'daily.json': { generatedAt: '2026-08-05T07:30:00.000Z' }
};
const due = selectDueGroups(schedule, { now, readJson: file => memory[file] });
assert.deepEqual(due.map(group => group.id), ['hourly']);
assert.deepEqual(selectDueGroups(schedule, { now, force: true, readJson: file => memory[file] }).map(group => group.id), ['hourly', 'daily']);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-news-pipeline-'));
const reportPath = path.join(temp, 'report.json');
const configPath = path.join(temp, 'schedule.json');
fs.writeFileSync(configPath, JSON.stringify(schedule));
const commands = [];
const pipelineResult = runPipeline({
  configPath,
  reportPath,
  now,
  readJson: file => file === configPath ? schedule : memory[file],
  commandRunner: command => { commands.push(command); return { status: 0, signal: null }; }
});
assert.equal(pipelineResult.status, 'success');
assert.deepEqual(commands, ['hourly', 'rebuild', 'validate']);
assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).status, 'success');

const root = path.join(temp, 'snapshot');
for (const directory of ['config', 'data', 'assets/news', 'assets/publisher-news', 'features/news']) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
}
const publicationConfig = {
  publication: {
    required_files: ['data/news.json', 'data/publisher-news.json', 'data/youtube-signals.json', 'data/news-events.json', 'data/news-home-ru.json'],
    minimum_items: { 'data/news.json': 12, 'data/publisher-news.json': 1, 'data/news-events.json': 12, 'data/news-home-ru.json': 12 },
    minimum_retained_fraction: 0.25,
    homepage_exact_items: 12,
    minimum_official_source_success_ratio: 0.15,
    image_roots: ['assets/news/', 'assets/publisher-news/']
  }
};
fs.writeFileSync(path.join(root, 'config/news-pipeline.json'), JSON.stringify(publicationConfig));
fs.writeFileSync(path.join(root, 'features/news/module.json'), JSON.stringify({
  content: ['data/news.json', 'data/publisher-news.json', 'data/youtube-signals.json', 'data/news-events.json', 'data/news-home-ru.json'],
  contentApi: { global: 'IgropoiskNewsContent' }
}));

const makeItem = (index, imageRoot = 'assets/news') => ({
  id: String(index),
  titleRu: `Новость ${index}`,
  titleEn: `News ${index}`,
  publishedAt: '2026-08-05T00:00:00.000Z',
  primaryUrl: `https://example.com/${imageRoot.replaceAll('/', '-')}/${index}`,
  image: `${imageRoot}/${String(index).padStart(16, '0')}.jpg`
});
const news = Array.from({ length: 12 }, (_, index) => makeItem(index + 1));
const official = [makeItem(101, 'assets/publisher-news')];
const events = Array.from({ length: 12 }, (_, index) => makeItem(index + 201));
const home = Array.from({ length: 12 }, (_, index) => makeItem(index + 301));
for (const item of [...news, ...official, ...events, ...home]) {
  const file = path.join(root, item.image);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'image');
}
fs.writeFileSync(path.join(root, 'data/news.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', items: news }));
fs.writeFileSync(path.join(root, 'data/publisher-news.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', sourceCount: 10, successfulSourceCount: 5, items: official }));
const youtubeSignals = [
  { id: 'first', title: 'Video one', publishedAt: '2026-08-05T00:00:00Z', url: 'https://youtube.com/watch?v=first' },
  { id: 'second', title: 'Video two', publishedAt: '2026-08-05T00:00:00Z', url: 'https://youtube.com/watch?v=second' }
];
fs.writeFileSync(path.join(root, 'data/youtube-signals.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', items: youtubeSignals }));
fs.writeFileSync(path.join(root, 'data/news-events.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', items: events }));
fs.writeFileSync(path.join(root, 'data/news-home-ru.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', items: home }));

const valid = validateNewsPipeline({ root });
assert.equal(valid.ok, true, valid.errors.join('\n'));

fs.writeFileSync(path.join(root, 'data/youtube-signals.json'), JSON.stringify({
  generatedAt: '2026-08-05T00:00:00Z',
  items: [youtubeSignals[0], { ...youtubeSignals[1], url: 'https://youtube.com/watch?v=first&utm_source=duplicate' }]
}));
const duplicate = validateNewsPipeline({ root });
assert.equal(duplicate.ok, false);
assert.ok(duplicate.errors.some(error => error.includes('duplicates a source URL')));

fs.writeFileSync(path.join(root, 'data/youtube-signals.json'), JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', items: youtubeSignals }));
fs.rmSync(path.join(root, home[0].image));
const invalid = validateNewsPipeline({ root });
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.some(error => error.includes('missing image')));

fs.rmSync(temp, { recursive: true, force: true });
console.log('Autonomous news pipeline self-test passed.');
