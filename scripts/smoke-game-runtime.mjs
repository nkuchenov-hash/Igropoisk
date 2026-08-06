const rawBase = String(process.env.GAME_RUNTIME_SMOKE_BASE_URL || '').trim();
if (!rawBase) {
  throw new Error('GAME_RUNTIME_SMOKE_BASE_URL is required.');
}

const baseUrl = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
const cacheBust = `smoke=${Date.now()}`;

const checks = [
  {
    path: 'game/_shared/game-page-v3.js',
    type: /javascript/i,
    markers: ['function renderHero(', 'function hydrateSimilarGames(', 'function renderReviews('],
  },
  {
    path: 'game/_shared/game-page-v3.css',
    type: /css/i,
    markers: ['.game-page'],
  },
  {
    path: 'game/_shared/game-shell.js',
    type: /javascript/i,
    markers: ['game-page-v3-bootstrap.js'],
  },
  {
    path: 'game/the-witcher-3-wild-hunt/',
    type: /html/i,
    markers: [
      'data-slug="the-witcher-3-wild-hunt"',
      '../_shared/game-page.css',
      '../_shared/game-shell.js',
    ],
  },
  {
    path: 'game/elden-ring/',
    type: /html/i,
    markers: ['data-slug="elden-ring"', '../_shared/game-shell.js'],
  },
];

const results = [];
for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  url.search = cacheBust;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
    redirect: 'follow',
  });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const errors = [];

  if (!response.ok) errors.push(`HTTP ${response.status}`);
  if (!check.type.test(contentType)) errors.push(`unexpected content-type ${contentType || '(missing)'}`);
  if (/<!doctype html>|<html/i.test(body) && !/html/i.test(contentType)) {
    errors.push('asset request returned HTML');
  }
  for (const marker of check.markers) {
    if (!body.includes(marker)) errors.push(`missing marker ${JSON.stringify(marker)}`);
  }

  results.push({
    path: check.path,
    status: response.status,
    contentType,
    bytes: Buffer.byteLength(body),
    errors,
  });
}

const failures = results.filter(result => result.errors.length);
if (failures.length) {
  throw new Error(
    `Game runtime production smoke failed:\n${failures
      .map(result => `- ${result.path}: ${result.errors.join('; ')}`)
      .join('\n')}`,
  );
}

console.log(JSON.stringify({ baseUrl, checks: results }, null, 2));
