import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const requestedBase = String(process.env.GAME_RUNTIME_SMOKE_BASE_URL || '').trim().replace(/\/+$/, '');
const cacheBust = () => `smoke=${Date.now()}-${Math.random().toString(16).slice(2)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'],
]);

let server = null;
let baseUrl = requestedBase;
if (!baseUrl) {
  const safePath = raw => {
    const decoded = decodeURIComponent(String(raw || '/').split('?')[0]);
    const normalized = decoded.replace(/^\/Igropoisk(?=\/|$)/, '') || '/';
    const requested = normalized.endsWith('/') ? `${normalized}index.html` : normalized;
    const absolute = path.resolve(root, `.${requested}`);
    return absolute.startsWith(root) ? absolute : null;
  };
  server = http.createServer((request, response) => {
    const file = safePath(request.url);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4181, '127.0.0.1', resolve);
  });
  baseUrl = 'http://127.0.0.1:4181';
}
baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

async function fetchWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await fetch(url, options); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

const assetChecks = [
  { path: 'game/_shared/game-page-v3.js', type: /javascript/i, markers: ['function renderHero(', 'function renderReviews('] },
  { path: 'game/_shared/game-page-v3.css', type: /css/i, markers: ['.hero-media-shell', '.similar-row'] },
  { path: 'game/_shared/game-shell.js', type: /javascript/i, markers: ['game-page.css', 'game-page.js'] },
  { path: 'game/_shared/game-page.js', type: /javascript/i, markers: ['__IG_GAME_PAGE_MODULE_VERSION__', 'game-runtime-network-guard.js', 'game-page-v3-bootstrap.js'] },
  { path: 'game/_shared/game-runtime-network-guard.js', type: /javascript/i, markers: ['__IG_GAME_RUNTIME_NETWORK_GUARD__', 'timeoutMs=7000'] },
  { path: 'data/reviews/fallout-2.json', type: /json|text\/plain|octet-stream/i, markers: ['"reviews"'] },
];

const assetResults = [];
for (const check of assetChecks) {
  const url = new URL(check.path, baseUrl);
  url.search = cacheBust();
  const response = await fetchWithRetry(url, {
    cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' }, redirect: 'follow',
  });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const errors = [];
  if (!response.ok) errors.push(`HTTP ${response.status}`);
  if (!check.type.test(contentType)) errors.push(`unexpected content-type ${contentType || '(missing)'}`);
  if (/<!doctype html>|<html/i.test(body) && !/html/i.test(contentType)) errors.push('asset request returned HTML');
  for (const marker of check.markers) if (!body.includes(marker)) errors.push(`missing marker ${JSON.stringify(marker)}`);
  assetResults.push({ path: check.path, status: response.status, contentType, bytes: Buffer.byteLength(body), errors });
}

const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .filter(Boolean).find(fs.existsSync);
if (!executablePath) throw new Error('Chrome/Chromium executable was not found.');
const launchBrowser = () => puppeteer.launch({ executablePath, headless: true, protocolTimeout: 30000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const pageChecks = [
  ['spore', /spore/i],
  ['fallout-2', /fallout\s*2/i],
  ['the-witcher-3-wild-hunt', /witcher/i],
  ['elden-ring', /elden\s*ring/i],
  ['control', /^control$/i],
];
const browserResults = [];
try {
  for (const [slug, titlePattern] of pageChecks) {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      const started = Date.now();
      let navigationError = null;
      let hydrationError = null;
      try {
        await page.goto(`${baseUrl}game/${slug}/?${cacheBust()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => {
          const title = document.querySelector('#gameTitle')?.textContent?.trim();
          const failed = /Не удалось открыть страницу игры|Не удалось загрузить страницу игры/i.test(document.body?.textContent || '');
          return Boolean(title) || failed;
        }, { timeout: 15000 });
      } catch (error) { navigationError = String(error?.message || error); }
      if (!navigationError && slug === 'control') {
        try {
          await page.waitForFunction(() => {
            const grid = document.querySelector('#reviewGrid');
            return grid?.dataset.reviewSourcesReady === '1' && grid.querySelectorAll('.quality-review-row').length >= 20;
          }, { timeout: 10000 });
        } catch (error) {
          hydrationError = String(error?.message || error);
        }
      }
      const state = await page.evaluate(() => ({
        title: document.querySelector('#gameTitle')?.textContent?.trim() || '',
        designSystem: document.documentElement.dataset.designSystem || '',
        moduleVersion: window.__IG_GAME_PAGE_MODULE_VERSION__ || '',
        networkGuard: Boolean(window.__IG_GAME_RUNTIME_NETWORK_GUARD__),
        body: (document.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
        tabs: document.querySelectorAll('.game-tabs [data-tab]').length,
        reviewRows: document.querySelectorAll('#reviewGrid .quality-review-row').length,
        reviewSourcesReady: document.querySelector('#reviewGrid')?.dataset.reviewSourcesReady || '',
      }));
      const errors = [];
      if (navigationError) errors.push(`navigation: ${navigationError}`);
      if (hydrationError) errors.push(`review hydration: ${hydrationError}`);
      if (!state.title) errors.push('game title did not render');
      if (state.title && !titlePattern.test(state.title)) errors.push(`unexpected title ${JSON.stringify(state.title)}`);
      if (state.designSystem !== 'igropoisk-game-v3') errors.push(`design system not active: ${state.designSystem || '(empty)'}`);
      if (!state.moduleVersion) errors.push('approved module version marker missing');
      if (!state.networkGuard) errors.push('runtime network guard missing');
      if (state.tabs < 7) errors.push(`incomplete tab shell: ${state.tabs}`);
      if (slug === 'control' && state.reviewSourcesReady !== '1') errors.push('control review-source module did not signal readiness');
      if (slug === 'control' && state.reviewRows < 20) errors.push(`control review stress fixture incomplete: ${state.reviewRows}/20`);
      if (/Не удалось открыть страницу игры|Не удалось загрузить страницу игры/i.test(state.body)) errors.push('visible runtime failure');
      if (pageErrors.length) errors.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
      browserResults.push({ slug, elapsedMs: Date.now() - started, state, pageErrors, consoleErrors: consoleErrors.slice(0, 5), errors });
      await page.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}

const failures = [
  ...assetResults.filter(result => result.errors.length).map(result => `asset ${result.path}: ${result.errors.join('; ')}`),
  ...browserResults.filter(result => result.errors.length).map(result => `page ${result.slug}: ${result.errors.join('; ')}`),
];
console.log(JSON.stringify({ baseUrl, assets: assetResults, pages: browserResults }, null, 2));
if (failures.length) throw new Error(`Game runtime smoke failed:\n- ${failures.join('\n- ')}`);
