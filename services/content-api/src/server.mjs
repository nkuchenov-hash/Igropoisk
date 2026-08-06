import http from 'node:http';
import { getPool, closePool } from './database.mjs';
import { currentPublication, getPublishedNews, ledgerHealth, listPublishedNews } from './queries.mjs';

function allowedOriginsFromEnvironment() {
  return new Set(String(process.env.ALLOWED_ORIGINS || 'https://nkuchenov-hash.github.io')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean));
}

function json(response, status, payload, requestMethod = 'GET') {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', status === 200 ? 'public, max-age=30' : 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (requestMethod === 'HEAD') return response.end();
  response.end(body);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function createNewsServer({ pool = getPool(), allowedOrigins = allowedOriginsFromEnvironment() } = {}) {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      response.setHeader('Allow', 'GET, HEAD');
      return json(response, 405, { error: 'method_not_allowed' }, request.method);
    }

    const url = new URL(request.url || '/', 'http://localhost');
    try {
      if (url.pathname === '/health') {
        return json(response, 200, await ledgerHealth(pool), request.method);
      }

      if (url.pathname === '/v1/publications/current') {
        const publication = await currentPublication(pool, url.searchParams.get('channel') || 'news');
        return publication
          ? json(response, 200, publication, request.method)
          : json(response, 404, { error: 'publication_not_found' }, request.method);
      }

      if (url.pathname === '/v1/news') {
        const limit = boundedInteger(url.searchParams.get('limit'), 30, 1, 100);
        const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 100_000);
        const items = await listPublishedNews(pool, { limit, offset });
        return json(response, 200, { items, meta: { limit, offset, count: items.length } }, request.method);
      }

      const match = url.pathname.match(/^\/v1\/news\/([^/]+)$/);
      if (match) {
        const item = await getPublishedNews(pool, decodeURIComponent(match[1]));
        return item
          ? json(response, 200, item, request.method)
          : json(response, 404, { error: 'news_not_found' }, request.method);
      }

      return json(response, 404, { error: 'not_found' }, request.method);
    } catch (error) {
      console.error(error);
      return json(response, 503, { error: 'content_api_unavailable' }, request.method);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  const server = createNewsServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`News Content API listening on ${port}.`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
