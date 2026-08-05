import { createYandexObjectStorageClient } from './lib/yandex-object-storage.mjs';

const storage = createYandexObjectStorageClient();
const probeKey = `system/probes/github-actions-${process.env.GITHUB_RUN_ID || Date.now()}.json`;
const payload = JSON.stringify({
  status: 'ok',
  repository: process.env.GITHUB_REPOSITORY || '',
  runId: process.env.GITHUB_RUN_ID || '',
  checkedAt: new Date().toISOString()
});

await storage.putObject(probeKey, payload, {
  contentType: 'application/json; charset=utf-8',
  cacheControl: 'no-store'
});
const readBack = await storage.getObject(probeKey);
const stored = await readBack.json();
if (stored.status !== 'ok' || stored.runId !== (process.env.GITHUB_RUN_ID || '')) {
  throw new Error('Object Storage probe returned unexpected content.');
}
await storage.deleteObject(probeKey);

console.log(`Yandex Object Storage connection verified for bucket ${storage.bucket}.`);
