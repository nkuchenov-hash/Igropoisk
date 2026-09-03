#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createYandexObjectStorageClient} from './lib/yandex-object-storage.mjs';
import {withStorageRetry} from './lib/storage-retry.mjs';
import {
  gamePageAssemblyObjectKey,
  mergeGamePageAssemblyRequests,
  normalizeGamePageAssemblyRequest
} from './lib/game-page-assembly-queue.mjs';

const root = process.cwd();
const inputPath = path.join(root, process.env.GAME_PAGE_ASSEMBLY_REQUESTS || 'tmp/news-game-page-requests.json');
const reportPath = path.join(root, 'tmp/game-page-assembly-queue-publish.json');
fs.mkdirSync(path.dirname(reportPath), {recursive: true});

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const requests = Array.isArray(source?.requests) ? source.requests : [];
const client = createYandexObjectStorageClient();
const queued = [];
const failed = [];

const retryOptions = (operation, key) => ({
  attempts: 3,
  baseDelayMs: 200,
  onRetry: ({attempt, nextAttempt, error}) => {
    console.warn(`[game-page-assembly-queue] ${operation} ${key} transient failure on attempt ${attempt}; retrying attempt ${nextAttempt}: ${error.message}`);
  }
});

for (const raw of requests) {
  let request;
  try {
    request = normalizeGamePageAssemblyRequest(raw);
  } catch (error) {
    failed.push({game_id: raw?.game_id ?? null, slug: raw?.slug ?? null, reason: error.message});
    continue;
  }
  const key = gamePageAssemblyObjectKey(request);
  let previous = null;
  try {
    const response = await withStorageRetry(
      () => client.getObject(key),
      retryOptions('read', key)
    );
    previous = JSON.parse(await response.text());
  } catch (error) {
    if (!/failed with 404\b/.test(String(error?.message || error))) {
      failed.push({game_id: request.game_id, slug: request.slug, reason: `read_existing: ${error.message}`});
      continue;
    }
  }
  const merged = mergeGamePageAssemblyRequests(previous, request);
  try {
    await withStorageRetry(
      () => client.putObject(key, `${JSON.stringify(merged, null, 2)}\n`, {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store'
      }),
      retryOptions('write', key)
    );
    queued.push({game_id: merged.game_id, slug: merged.slug, title: merged.title, key});
  } catch (error) {
    failed.push({game_id: merged.game_id, slug: merged.slug, reason: `write: ${error.message}`});
  }
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  input_count: requests.length,
  queued_count: queued.length,
  failed_count: failed.length,
  queued,
  failed
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (failed.length) process.exitCode = 2;
