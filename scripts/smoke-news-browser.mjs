import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
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

const server = http.createServer((request, response) => {
  const file = safePath(request.url || '/');
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
  server.listen(4173, '127.0.0.1', resolve);
});

const executablePath = browserPath();
if (!executablePath) {
  server.close();
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
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const home = document.querySelector('[data-news-module="home"]');
    const archive = document.querySelector('[data-news-module="archive"]');
    return ['ready', 'empty', 'error'].includes(home?.dataset.newsStatus)
      && ['ready', 'empty', 'error'].includes(archive?.dataset.newsStatus);
  }, { timeout: 30000 });

  const state = await page.evaluate(() => ({
    homeStatus: document.querySelector('[data-news-module="home"]')?.dataset.newsStatus || '',
    archiveStatus: document.querySelector('[data-news-module="archive"]')?.dataset.newsStatus || '',
    homeCards: document.querySelectorAll('[data-news-home] .ig-news-card').length,
    archiveCards: document.querySelectorAll('[data-news-archive] .ig-news-card').length,
    search: Boolean(document.querySelector('[data-news-toolbar] [data-news-search]')),
    controls: document.querySelectorAll('[data-news-home-controls] [data-news-direction]').length,
    legacyScripts: [...document.scripts]
      .map(script => script.src)
      .filter(source => /news-(feed|click-fix|rail-controls|archive-full)/.test(source))
  }));

  const errors = [];
  if (state.homeStatus !== 'ready') errors.push(`Homepage news status: ${state.homeStatus}`);
  if (state.archiveStatus !== 'ready') errors.push(`Archive news status: ${state.archiveStatus}`);
  if (state.homeCards < 1) errors.push('Homepage news rendered no cards.');
  if (state.archiveCards < 1) errors.push('News archive rendered no cards.');
  if (!state.search) errors.push('News archive search was not rendered.');
  if (state.controls !== 2) errors.push(`Expected two homepage rail controls, found ${state.controls}.`);
  if (state.legacyScripts.length) errors.push(`Legacy news scripts loaded: ${state.legacyScripts.join(', ')}`);
  const newsErrors = pageErrors.filter(error => /features\/news|IgropoiskNews|news module/i.test(error));
  if (newsErrors.length) errors.push(...newsErrors);

  if (errors.length) throw new Error(`News browser smoke test failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  console.log(JSON.stringify(state, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
