import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const remoteBase = String(process.env.HOME_FEEDS_SMOKE_BASE_URL || '').trim();
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
    server.listen(4174, '127.0.0.1', resolve);
  });
  baseUrl = 'http://127.0.0.1:4174/';
}
if (!baseUrl.endsWith('/')) baseUrl += '/';

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
  await page.waitForFunction(() => (
    document.querySelectorAll('#popular .popular-card').length === 20
    && document.querySelectorAll('#releaseHomeGrid .home-release-card').length > 0
  ), { timeout: 30000 });

  const state = await page.evaluate(() => {
    const popular = [...document.querySelectorAll('#popular .popular-card')];
    const releases = [...document.querySelectorAll('#releaseHomeGrid .home-release-card')];
    return {
      popularCards: popular.length,
      popularTitles: popular.map(card => card.querySelector('h3')?.textContent?.trim()).filter(Boolean),
      popularImages: popular.filter(card => card.querySelector('img')).length,
      popularControls: document.querySelectorAll('[data-controls-for="popular"] [data-direction]').length,
      popularErrorState: Boolean(document.querySelector('#popular .popular-state')),
      releaseCards: releases.length,
      recentReleases: releases.filter(card => card.dataset.releaseKind === 'recent').length,
      upcomingReleases: releases.filter(card => card.dataset.releaseKind === 'upcoming').length,
      releaseLinks: releases.filter(card => card.querySelector('a[href^="calendar/#game="]')).length,
      releaseMedia: releases.filter(card => {
        const media = card.querySelector('.home-release-card__media');
        return Boolean(media?.querySelector('img') || media?.dataset.initials);
      }).length,
      releaseControls: document.querySelectorAll('[data-release-rail]').length,
      releaseErrorState: Boolean(document.querySelector('#releaseHomeGrid .home-release-empty')),
      popularScrollable: document.querySelector('#popular')?.scrollWidth > document.querySelector('#popular')?.clientWidth,
      releasesScrollable: document.querySelector('#releaseHomeGrid')?.scrollWidth > document.querySelector('#releaseHomeGrid')?.clientWidth
    };
  });

  state.baseUrl = baseUrl;
  const errors = [];
  if (state.popularCards !== 20) errors.push(`Expected 20 popular cards, found ${state.popularCards}.`);
  if (new Set(state.popularTitles).size !== 20) errors.push('Popular cards do not have 20 unique titles.');
  if (state.popularImages !== 20) errors.push(`Popular cards with images: ${state.popularImages}/20.`);
  if (state.popularControls !== 2) errors.push(`Popular rail controls: ${state.popularControls}/2.`);
  if (state.popularErrorState) errors.push('Popular block rendered an error/loading state.');
  if (state.releaseCards < 1) errors.push('Release block rendered no cards.');
  if (state.recentReleases + state.upcomingReleases !== state.releaseCards) errors.push('Some release cards have no recent/upcoming classification.');
  if (state.upcomingReleases < 1) errors.push('Release block rendered no expected releases.');
  if (state.releaseLinks !== state.releaseCards) errors.push('Some release cards do not link to the calendar.');
  if (state.releaseMedia !== state.releaseCards) errors.push('Some release cards have neither an image nor initials fallback.');
  if (state.releaseControls !== 2) errors.push(`Release rail controls: ${state.releaseControls}/2.`);
  if (state.releaseErrorState) errors.push('Release block rendered an empty/error state.');
  const relevantErrors = pageErrors.filter(error => /popular-home|home-releases|releaseHomeGrid|IgropoiskInfiniteRail/i.test(error));
  if (relevantErrors.length) errors.push(...relevantErrors);

  if (errors.length) throw new Error(`Homepage feed browser smoke failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  console.log(JSON.stringify(state, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
