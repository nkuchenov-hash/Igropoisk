#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createYandexObjectStorageClient} from './lib/yandex-object-storage.mjs';
import {
  GAME_PAGE_ASSEMBLY_QUEUE_PREFIX,
  normalizeGamePageAssemblyRequest
} from './lib/game-page-assembly-queue.mjs';

const root = process.cwd();
const outputPath = path.join(root, 'tmp/game-page-assembly-inbox.json');
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
const client = createYandexObjectStorageClient();
const objects = await client.listObjects({prefix: GAME_PAGE_ASSEMBLY_QUEUE_PREFIX});
const byGame = new Map();
const invalid = [];

for (const object of objects) {
  try {
    const response = await client.getObject(object.key);
    const raw = JSON.parse(await response.text());
    if (raw?.state && raw.state !== 'pending') continue;
    const item = normalizeGamePageAssemblyRequest(raw, {now: raw.last_seen_at ?? new Date().toISOString()});
    byGame.set(item.game_id, {...item, object_key: object.key});
  } catch (error) {
    invalid.push({key: object.key, reason: error.message});
  }
}

const items = [...byGame.values()].sort((a, b) => String(a.first_seen_at).localeCompare(String(b.first_seen_at)) || a.slug.localeCompare(b.slug));
const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  prefix: GAME_PAGE_ASSEMBLY_QUEUE_PREFIX,
  count: items.length,
  items,
  invalid
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({count: items.length, invalid: invalid.length, output: 'tmp/game-page-assembly-inbox.json'}));
