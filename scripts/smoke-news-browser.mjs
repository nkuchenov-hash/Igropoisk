import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const remoteBase = String(process.env.NEWS_SMOKE_BASE_URL || '').trim();
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif']
]);

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const absolute = path.resolve(root, `.${requested}`);
  return absolute.startsWith(root) ? absolute : null;
}

function localServer() {
  return http.createServer((request, response) => {
    const file = safePath(request.url || '/');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(response);
  });
}

let server = null;
let baseUrl = remoteBase;
if (!baseUrl) {
  server = localServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  baseUrl = 'http://127.0.0.1:4173/';
}
if (!baseUrl.endsWith('/')) baseUrl += '/';

async function fetchJson(relative) {
  const response = await fetch(new URL(relative, baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`${relative} returned HTTP ${response.status}.`);
  return response.json();
}

async function verifyStaticHealth() {
  const health = await fetchJson('data/news-pipeline-health.json');
  const errors = [];
  if (health?.pipeline !== 'news') errors.push('Health snapshot has an invalid pipeline id.');
  if (!['pending', 'healthy', 'degraded'].includes(health?.status)) errors.push(`Health snapshot status: ${health?.status || 'missing'}.`);
  if (health?.status !== 'pending' && !health?.last_successful_run_at) errors.push('Health snapshot has no successful run timestamp.');
  if (Number(health?.images?.missing || 0) > 0) errors.push(`Health snapshot reports ${health.images.missing} missing images.`);

  const adminResponse = await fetch(new URL('admin/news-health/', baseUrl), { cache: 'no-store' });
  const adminHtml = await adminResponse.text();
  if (!adminResponse.ok || !adminHtml.includes('data-news-health-admin')) errors.push('Read-only news health admin page is unavailable.');
  if (errors.length) throw new Error(`News health smoke test failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  return health;
}

const health = await verifyStaticHealth();
const executablePath = browserPath();
if (!executablePath) {
  if (server) server.close();
  throw new Error('Chrome/Chromium executable was not found.');
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const home = document.querySelector('[data-news-module="home"]');
    const archive = document.querySelector('[data-news-module="archive"]');
    return ['ready', 'empty', 'error'].includes(home?.dataset.newsStatus)
      && ['ready', 'empty', 'error'].includes(archive?.dataset.newsStatus);
  }, { timeout: 30000 });

  const state = await page.evaluate(() => {
    const apiHealth = window.IgropoiskNewsContent?.health?.() || {};
    const images = [...document.querySelectorAll('[data-news-module] .ig-news-card img')].map(image => image.src);
    return {
      homeStatus: document.querySelector('[data-news-module="home"]')?.dataset.newsStatus || '',
      archiveStatus: document.querySelector('[data-news-module="archive"]')?.dataset.newsStatus || '',
      homeCards: document.querySelectorAll('[data-news-home] .ig-news-card').length,
      archiveCards: document.querySelectorAll('[data-news-archive] .ig-news-card').length,
      search: Boolean(document.querySelector('[data-news-toolbar] [data-news-search]')),
      controls: document.querySelectorAll('[data-news-home-controls] [data-news-direction]').length,
      contentBackend: apiHealth.backend || '',
      contentVersion: apiHealth.version || '',
      fallbackReason: apiHealth.fallbackReason || '',
      storageImages: images.filter(source => source.startsWith('https://storage.yandexcloud.net/igropoisk-content/news/media/')).length,
      legacyScripts: [...document.scripts]
        .map(script => script.src)
        .filter(source => /news-(feed|click-fix|rail-controls|archive-full)/.test(source))
    };
  });

  state.healthStatus = health.status;
  state.baseUrl = baseUrl;
  const errors = [];
  if (state.homeStatus !== 'ready') errors.push(`Homepage news status: ${state.homeStatus}`);
  if (state.archiveStatus !== 'ready') errors.push(`Archive news status: ${state.archiveStatus}`);
  if (state.homeCards < 1) errors.push('Homepage news rendered no cards.');
  if (state.archiveCards < 1) errors.push('News archive rendered no cards.');
  if (!state.search) errors.push('News archive search was not rendered.');
  if (state.controls !== 2) errors.push(`Expected two homepage rail controls, found ${state.controls}.`);
  if (state.legacyScripts.length) errors.push(`Legacy news scripts loaded: ${state.legacyScripts.join(', ')}`);
  if (remoteBase && state.contentBackend !== 'object-storage') {
    errors.push(`Production news backend is ${state.contentBackend || 'missing'}: ${state.fallbackReason || 'no fallback reason'}`);
  }
  if (remoteBase && !state.contentVersion) errors.push('Production news snapshot version is missing.');
  if (remoteBase && state.storageImages < 1) errors.push('Production rendered no Object Storage news images.');
  const newsErrors = pageErrors.filter(error => /features\/news|IgropoiskNews|news module/i.test(error));
  if (newsErrors.length) errors.push(...newsErrors);

  if (errors.length) throw new Error(`News browser smoke test failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  console.log(JSON.stringify(state, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
