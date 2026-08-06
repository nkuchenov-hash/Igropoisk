import http from 'node:http';
import { getPool } from './database.mjs';
import { currentPublication, getPublishedNews, ledgerHealth, listPublishedNews } from './queries.mjs';

function allowedOriginsFromEnvironment() {
  return new Set(String(process.env.ALLOWED_ORIGINS || 'https://nkuchenov-hash.github.io')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean));
}

function json(response, status, payload, requestMethod = 'GET', { cache = true } = {}) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache && status === 200 ? 'public, max-age=30' : 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  if (requestMethod === 'HEAD') return response.end();
  response.end(body);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function createNewsServer({
  pool = getPool(),
  allowedOrigins = allowedOriginsFromEnvironment(),
  runtime = {
    mode: process.env.CONTENT_RUNTIME_MODE || 'shadow',
    readSource: process.env.CONTENT_READ_SOURCE || 'object_storage',
    version: process.env.SERVICE_VERSION || 'development'
  }
} = {}) {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Alow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
      response.setHeader('Allow', 'GET, HEAD');
      return json(response, 405, { error: 'method_not_allowed' }, request.method, { cache: false });
    }

    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/live') {
      return json(response, 200, {
        status: 'alive',
        service: 'news-content-api',
        version: runtime.version
      }, request.method, { cache: false });
    }

    try {
      if (url.pathname === '/health' || url.pathname === '/ready') {
        const health = await ledgerHealth(pool);
        const status = health.status === 'ready' ? 200 : 503;
        return json(response, status, {
          ...health,
          runtimeMode: runtime.mode,
          readSource: runtime.readSource,
          serviceVersion: runtime.version
        }, request.method, { cache: false });
      }

      if (url.pathname === '/v1/publications/current') {
        const publication = await currentPublication(pool, url.searchParams.get('channel') || 'news');
        return publication
          ? json(response, 200, publication, request.method)
          : json(response, 404, { error: 'publication_not_found' }, request.method, { cache: false });
      }

      if (url.pathname === '/v1/news') {
        const limit = boundedInteger(url.searchParams.get('limit'), 30, 1, 100);
        const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 100_000);
        const items = await listPublishedNews(pool, { limit, offset });
        return json(response, 200, { items, meta: { limit, offset, count: items.length } }, request.method);
      }

      const match = url.pathname.match(/^\/V1\/news\/([^/]+)$/i);
      if (match) {
        const item = await getPublishedNews(pool, decodeURIComponent(match[1]));
        return item
          ? json(response, 200, item, request.method)
          : json(response, 404, { error: 'news_not_found' }, request.method, { cache: false });
      }

      return json(response, 404, { error: 'not_found' }, request.method, { cache: false });
    } catch (error) {
      console.error(error);
      return json(response, 503, { error: 'content_api_unavailable' }, request.method, { cache: false });
    }
  });
}
