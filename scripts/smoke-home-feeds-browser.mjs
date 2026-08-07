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

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

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

function withCacheBust(relativePath, token) {
  const url = new URL(relativePath, baseUrl);
  url.searchParams.set('smoke', token);
  return url.href;
}

async function fetchText(relativePath, marker, attempts) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = withCacheBust(relativePath, `${Date.now()}-${attempt}`);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache'
        },
        redirect: 'follow'
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (marker && !body.includes(marker)) throw new Error(`missing marker ${JSON.stringify(marker)}`);
      return {
        path: relativePath,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        bytes: Buffer.byteLength(body),
        body
      };
    } catch (error) {
      failures.push(`attempt ${attempt}: ${String(error?.message || error)}`);
      if (attempt < attempts) await sleep(1500 * attempt);
    }
  }
  throw new Error(`${relativePath} preflight failed: ${failures.join('; ')}`);
}

async function preflight(attempts) {
  const index = await fetchText('', 'id="releaseHomeGrid"', attempts);
  const popularScript = await fetchText('assets/popular-home.js', 'async function load()', attempts);
  const releasesScript = await fetchText('assets/home-releases/index.js', "fetch('data/releases/current.json'", attempts);
  const popularData = await fetchText('data/popular/current.json', '"ranking"', attempts);
  const releaseData = await fetchText('data/releases/current.json', '"releases"', attempts);

  const popularPayload = JSON.parse(popularData.body);
  const releasePayload = JSON.parse(releaseData.body);
  const rankingCount = Array.isArray(popularPayload.ranking) ? popularPayload.ranking.length : 0;
  const releaseCount = Array.isArray(releasePayload.releases) ? releasePayload.releases.length : 0;
  if (rankingCount < 20) throw new Error(`Popular preflight expected at least 20 records, found ${rankingCount}.`);
  if (releaseCount < 1) throw new Error('Release preflight found no records.');

  return {
    index: { status: index.status, bytes: index.bytes, contentType: index.contentType },
    popularScript: { status: popularScript.status, bytes: popularScript.bytes, contentType: popularScript.contentType },
    releasesScript: { status: releasesScript.status, bytes: releasesScript.bytes, contentType: releasesScript.contentType },
    popularData: { status: popularData.status, bytes: popularData.bytes, contentType: popularData.contentType, rankingCount },
    releaseData: { status: releaseData.status, bytes: releaseData.bytes, contentType: releaseData.contentType, releaseCount }
  };
}

async function pageState(page) {
  return page.evaluate(() => {
    const popular = [...document.querySelectorAll('#popular .popular-card')];
    const releases = [...document.querySelectorAll('#releaseHomeGrid .home-release-card')];
    return {
      popularCards: popular.length,
      popularTitles: popular.map(card => card.querySelector('h3')?.textContent?.trim()).filter(Boolean),
      popularImages: popular.filter(card => card.querySelector('img')).length,
      popularControls: document.querySelectorAll('[data-controls-for="popular"] [data-direction]').length,
      popularErrorState: Boolean(document.querySelector('#popular .popular-state')),
      popularStateText: document.querySelector('#popular')?.textContent?.trim().slice(0, 500) || '',
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
      releaseStateText: document.querySelector('#releaseHomeGrid')?.textContent?.trim().slice(0, 500) || '',
      popularScrollable: document.querySelector('#popular')?.scrollWidth > document.querySelector('#popular')?.clientWidth,
      releasesScrollable: document.querySelector('#releaseHomeGrid')?.scrollWidth > document.querySelector('#releaseHomeGrid')?.clientWidth,
      readyState: document.readyState,
      relevantScripts: [...document.scripts]
        .map(script => script.src)
        .filter(src => /popular-home|home-releases/i.test(src))
    };
  });
}

function validateState(state, pageErrors) {
  const errors = [];
  if (state.popularCards !== 20) errors.push(`Expected 20 popular cards, found ${state.popularCards}.`);
  if (new Set(state.popularTitles).size !== 20) errors.push('Popular cards do not have 20 unique titles.');
  if (state.popularImages !== 20) errors.push(`Popular cards with images: ${state.popularImages}/20.`);
  if (state.popularControls !== 2) errors.push(`Popular rail controls: ${state.popularControls}/2.`);
  if (state.popularErrorState) errors.push(`Popular block rendered a state: ${state.popularStateText}`);
  if (state.releaseCards < 1) errors.push('Release block rendered no cards.');
  if (state.recentReleases + state.upcomingReleases !== state.releaseCards) errors.push('Some release cards have no recent/upcoming classification.');
  if (state.recentReleases + state.upcomingReleases < 1) errors.push('Release block rendered no valid recent/upcoming releases.');
  if (state.releaseLinks !== state.releaseCards) errors.push('Some release cards do not link to the calendar.');
  if (state.releaseMedia !== state.releaseCards) errors.push('Some release cards have neither an image nor initials fallback.');
  if (state.releaseControls !== 2) errors.push(`Release rail controls: ${state.releaseControls}/2.`);
  if (state.releaseErrorState) errors.push(`Release block rendered a state: ${state.releaseStateText}`);
  const relevantErrors = pageErrors.filter(error => /popular-home|home-releases|releaseHomeGrid|IgropoiskInfiniteRail/i.test(error));
  if (relevantErrors.length) errors.push(...relevantErrors);
  return errors;
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const remoteAttempts = remoteBase ? 3 : 1;
  const preflightState = await preflight(remoteAttempts);
  const attempts = [];

  for (let attempt = 1; attempt <= remoteAttempts; attempt += 1) {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleMessages = [];
    const requestFailures = [];
    const relevantResponses = [];

    page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on('requestfailed', request => {
      const url = request.url();
      if (/popular|releases|catalog-visible/i.test(url)) {
        requestFailures.push(`${url}: ${request.failure()?.errorText || 'request failed'}`);
      }
    });
    page.on('response', response => {
      const url = response.url();
      if (/popular\/current|releases\/current|catalog-visible|popular-home|home-releases/i.test(url)) {
        relevantResponses.push({ url, status: response.status(), fromCache: response.fromCache() });
      }
    });

    await page.setCacheEnabled(false);
    await page.setExtraHTTPHeaders({
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache'
    });

    let navigationError = null;
    let waitError = null;
    try {
      await page.goto(withCacheBust('', `${Date.now()}-${attempt}`), {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (error) {
      navigationError = String(error?.stack || error);
    }

    if (!navigationError) {
      try {
        await page.waitForFunction(() => (
          document.querySelectorAll('#popular .popular-card').length === 20
          && document.querySelectorAll('#releaseHomeGrid .home-release-card').length > 0
        ), { timeout: 30000, polling: 250 });
      } catch (error) {
        waitError = String(error?.stack || error);
      }
    }

    const state = await pageState(page).catch(error => ({ evaluationError: String(error?.stack || error) }));
    state.baseUrl = baseUrl;
    const errors = state.evaluationError ? [state.evaluationError] : validateState(state, pageErrors);
    if (navigationError) errors.unshift(navigationError);
    if (waitError && errors.length) errors.unshift(waitError);

    const diagnostics = {
      attempt,
      errors,
      state,
      relevantResponses: relevantResponses.slice(-20),
      requestFailures: requestFailures.slice(-20),
      consoleMessages: consoleMessages.slice(-20),
      pageErrors: pageErrors.slice(-20)
    };
    attempts.push(diagnostics);
    await page.close();

    if (!errors.length) {
      console.log(JSON.stringify({ preflight: preflightState, ...state, attempts: attempt }, null, 2));
      process.exitCode = 0;
      break;
    }

    if (attempt < remoteAttempts) await sleep(3000 * attempt);
  }

  if (attempts.every(attempt => attempt.errors.length)) {
    throw new Error(`Homepage feed browser smoke failed after ${attempts.length} attempt(s):\n${JSON.stringify({ preflight: preflightState, attempts }, null, 2)}`);
  }
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
