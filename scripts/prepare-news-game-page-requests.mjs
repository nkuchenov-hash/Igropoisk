#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { collectMissingGamePageRequests } from './lib/news-publication-gate.mjs';

const root = process.cwd();
const payload = JSON.parse(fs.readFileSync(path.join(root, 'data/news-events.json'), 'utf8'));
const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
const requests = collectMissingGamePageRequests(items);
const requestsB64 = Buffer.from(JSON.stringify(requests), 'utf8').toString('base64');
const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  count: requests.length,
  requests,
  requests_b64: requestsB64
};
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(root, 'tmp/news-game-page-requests.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ count: requests.length, output: 'tmp/news-game-page-requests.json' }));
