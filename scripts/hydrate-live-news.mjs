#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestUrl = process.env.NEWS_MANIFEST_URL || 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json';
const outputPath = process.env.NEWS_EVENTS_HYDRATED_PATH || 'tmp/live-news-events.json';
const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
if (!manifestResponse.ok) throw new Error(`News manifest HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
if (!manifest || manifest.schemaVersion !== 1 || manifest.channel !== 'news' || !manifest.files) throw new Error('Invalid live news manifest.');
const descriptor = manifest.files['data/news-events.json'];
if (!descriptor?.url) throw new Error('Live news manifest is missing data/news-events.json.');
const manifestOrigin = new URL(manifestUrl).origin;
const eventsUrl = new URL(descriptor.url);
if (eventsUrl.origin !== manifestOrigin) throw new Error('Live news events URL uses an unexpected origin.');
const eventsResponse = await fetch(eventsUrl, { cache: 'no-store' });
if (!eventsResponse.ok) throw new Error(`Live news events HTTP ${eventsResponse.status}`);
const payload = await eventsResponse.json();
if (!payload || !Array.isArray(payload.items)) throw new Error('Live news events payload is invalid.');
const target = path.join(root, outputPath);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ manifest_version: manifest.version || null, news_events: payload.items.length, output: outputPath }, null, 2));
