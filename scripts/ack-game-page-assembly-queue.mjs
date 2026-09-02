#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createYandexObjectStorageClient} from './lib/yandex-object-storage.mjs';

const root = process.cwd();
const inboxPath = path.join(root, 'tmp/game-page-assembly-inbox.json');
const reportPath = path.join(root, 'tmp/game-page-assembly-queue-ack.json');
const productionRef = String(process.env.GAME_PAGE_ASSEMBLY_PRODUCTION_REF || 'origin/main').trim();
const inbox = fs.existsSync(inboxPath) ? JSON.parse(fs.readFileSync(inboxPath, 'utf8')) : {items: []};
const items = Array.isArray(inbox?.items) ? inbox.items : [];
const client = createYandexObjectStorageClient();
const acknowledged = [];
const retained = [];
const failed = [];

function existsAtProduction(relative) {
  const result = spawnSync('git', ['cat-file', '-e', `${productionRef}:${relative}`], {cwd: root, stdio: 'ignore'});
  return result.status === 0;
}

for (const item of items) {
  const slug = String(item?.slug || '').trim();
  const key = String(item?.object_key || '').trim();
  if (!slug || !key) {
    failed.push({slug: slug || null, key: key || null, reason: 'missing slug or object_key'});
    continue;
  }
  const productionReady = existsAtProduction(`game/${slug}/index.html`) && existsAtProduction(`data/drafts/${slug}.json`);
  if (!productionReady) {
    retained.push({game_id: item.game_id, slug, key, reason: 'production page not present yet'});
    continue;
  }
  try {
    await client.deleteObject(key);
    acknowledged.push({game_id: item.game_id, slug, key});
  } catch (error) {
    failed.push({game_id: item.game_id, slug, key, reason: error.message});
  }
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  production_ref: productionRef,
  acknowledged_count: acknowledged.length,
  retained_count: retained.length,
  failed_count: failed.length,
  acknowledged,
  retained,
  failed
};
fs.mkdirSync(path.dirname(reportPath), {recursive: true});
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (failed.length) process.exitCode = 2;
