import crypto from 'node:crypto';
import http from 'node:http';

export function snapshotPayload() {
  return { generatedAt: '2026-08-05T20:00:00.000Z', items: [{ id: 'remote-1', status: 'published', type: 'official', official: true,
    titleRu: 'Удалённая новость', titleEn: 'Remote news', summaryRu: 'Проверка', summaryEn: 'Check',
    publishedAt: '2026-08-05T19:00:00.000Z', primaryUrl: 'https://example.com/news/remote-1', primarySource: 'Example',
    sources: [{ name: 'Example', url: 'https://example.com/news/remote-1', official: true }] }] };
}

export function manifestFor(baseUrl, body, overrides = {}) {
  const version = overrides.version || '20260805T200000Z-test';
  const entry = { key: `news/snapshots/${version}/data/news-events.json`,
    url: `${baseUrl}/bucket/news/snapshots/${version}/data/news-events.json`,
    sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length, ...(overrides.entry || {}) };
  return { schemaVersion: 1, channel: 'news', version, publishedAt: '2026-08-05T20:00:00.000Z',
    sourceCommit: 'a'.repeat(40), sourceRunId: '123456789', files: { 'data/news-events.json': entry }, ...overrides.manifest };
}

export async function fixtureServer(mutator = value => value) {
  const snapshotBody = Buffer.from(JSON.stringify(snapshotPayload()));
  let server;
  await new Promise(resolve => {
    server = http.createServer((request, response) => {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const manifest = mutator(manifestFor(baseUrl, snapshotBody), request.url, snapshotBody);
      if (request.url === '/bucket/news/manifests/current.json') {
        const body = Buffer.from(JSON.stringify(manifest));
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
        return response.end(body);
      }
      if (request.url?.includes('/data/news-events.json')) {
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': snapshotBody.length });
        return response.end(snapshotBody);
      }
      response.writeHead(404).end();
    }).listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { manifestUrl: `${baseUrl}/bucket/news/manifests/current.json`, close: () => new Promise(resolve => server.close(resolve)) };
}
