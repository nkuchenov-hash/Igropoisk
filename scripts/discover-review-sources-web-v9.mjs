#!/usr/bin/env node
import { normalizeBingSearchHtml } from './lib/review-search-result-normalizer.mjs';

const nativeFetch = globalThis.fetch;
if (typeof nativeFetch !== 'function') throw new Error('Global fetch is required for review discovery.');

globalThis.fetch = async (input, init) => {
  const requestUrl = String(typeof input === 'string' || input instanceof URL ? input : input?.url || '');
  const response = await nativeFetch(input, init);
  if (!response.ok || !/^https:\/\/www\.bing\.com\/search\?/i.test(requestUrl)) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(normalizeBingSearchHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

try {
  await import('./discover-review-sources-web-v8.mjs');
} finally {
  globalThis.fetch = nativeFetch;
}
