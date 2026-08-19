import fs from 'node:fs';

const requiredFiles = [
  'features/news/module.json',
  'features/news/RULES.md',
  'features/news/shared/translations-ru.js',
  'features/news/content-api/index.js',
  'features/news/shared/index.js',
  'features/news/home-widget/index.js',
  'features/news/archive-page/index.js',
  'features/news/admin-health/index.js',
  'features/news/styles/index.css',
  'admin/news-health/index.html',
  'data/news-pipeline-health.json',
  'config/news-pipeline.json',
  'scripts/build-news-pipeline-health.mjs',
  'scripts/run-news-pipeline.mjs',
  'scripts/validate-news-pipeline.mjs',
  'scripts/test-news-pipeline.mjs',
  'scripts/test-news-pipeline-health.mjs',
  'scripts/test-news-content-api.mjs',
  'scripts/test-news-storage-content-api.mjs',
  'scripts/test-news-storage-retention.mjs',
  'scripts/test-news-monthly-archive.mjs',
  'scripts/lib/yandex-object-storage.mjs',
  'scripts/prune-news-storage.mjs',
  'scripts/publish-news-storage.mjs',
  '.github/workflows/news-pipeline.yml',
  '.github/workflows/yandex-storage-connectivity.yml',
  '.github/workflows/update-news.yml',
  '.github/workflows/update-publisher-news.yml'
];
const errors = [];
const read = file => fs.readFileSync(file, 'utf8');
const fail = message => errors.push(message);

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) fail(`Missing news module file: ${file}`);
}

if (!errors.length) {
  const module = JSON.parse(read('features/news/module.json'));
  const config = JSON.parse(read('config/news-pipeline.json'));
  const page = read('index.html');
  const contentApi = read('features/news/content-api/index.js');
  const presentation = [
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ].map(read).join('\n');
  const adminPage = read('admin/news-health/index.html');
  const adminRuntime = read('features/news/admin-health/index.js');

  const pageReferences = [
    'data-news-module="home"',
    'data-news-home',
    'data-news-module="archive"',
    'data-news-archive',
    'features/news/styles/index.css',
    'features/news/shared/translations-ru.js',
    'features/news/content-api/index.js',
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ];
  pageReferences.forEach(reference => {
    if (!page.includes(reference)) fail(`index.html is missing: ${reference}`);
  });

  const orderedScripts = [
    'features/news/shared/translations-ru.js',
    'features/news/content-api/index.js',
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ];
  let previous = -1;
  for (const script of orderedScripts) {
    const position = page.indexOf(script);
    if (position <= previous) fail(`News runtime script order is invalid around: ${script}`);
    previous = position;
  }

  if (module.version < 8) fail('News module manifest must use version 8 or newer.');
  if (module.contentApi?.global !== 'IgropoiskNewsContent') fail('News module manifest is missing the content API global.');
  if (module.contentApi?.version !== 2) fail('News Content API version must be 2 for monthly archive support.');
  if (module.contentApi?.backend !== 'yandex-object-storage-compact-live-plus-monthly-archive-with-repository-fallback') fail('News module has an invalid backend declaration.');
  if (module.contentApi?.manifest !== 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json') fail('News module has an invalid manifest declaration.');
  ['getAll', 'getArchive', 'getHome', 'health', 'invalidate'].forEach(method => {
    if (!module.contentApi?.interface?.includes(method)) fail(`News module is missing Content API method: ${method}`);
  });

  const expectedPipeline = {
    config: 'config/news-pipeline.json',
    workflow: '.github/workflows/news-pipeline.yml',
    orchestrator: 'scripts/run-news-pipeline.mjs',
    publicationGate: 'scripts/validate-news-pipeline.mjs',
    publisher: 'scripts/publish-news-storage.mjs',
    storageClient: 'scripts/lib/yandex-object-storage.mjs',
    healthBuilder: 'scripts/build-news-pipeline-health.mjs',
    health: 'data/news-pipeline-health.json',
    publication: 'compact-live-snapshot-plus-stable-monthly-archive-with-atomic-manifest'
  };
  for (const [key, value] of Object.entries(expectedPipeline)) {
    if (module.pipeline?.[key] !== value) fail(`News module has invalid pipeline.${key}.`);
  }

  const groupIds = new Set((config.groups || []).map(group => group.id));
  ['global-media', 'official-sources'].forEach(id => {
    if (!groupIds.has(id)) fail(`News pipeline config is missing source group: ${id}`);
  });
  ['node scripts/build-news-events.mjs', 'node scripts/build-home-news.mjs'].forEach(command => {
    if (!config.rebuild_commands?.includes(command)) fail(`News pipeline is missing rebuild command: ${command}`);
  });
  if (config.health?.output_file !== 'data/news-pipeline-health.json') fail('News health output is not canonical.');
  if (Number(config.health?.persistent_failure_threshold || 0) < 2) fail('Persistent source failure threshold is too low.');

  const storage = config.publication?.storage || {};
  const expectedStorage = {
    provider: 'yandex-object-storage',
    current_manifest: 'news/manifests/current.json',
    snapshot_prefix: 'news/snapshots',
    archive_prefix: 'news/archive',
    media_prefix: 'news/media'
  };
  for (const [key, value] of Object.entries(expectedStorage)) {
    if (storage[key] !== value) fail(`News storage has invalid ${key}.`);
  }
  if (Number(storage.maximum_snapshot_bytes || 0) <= 0) fail('News storage has no snapshot size guard.');
  if (Number(storage.live_window_days || 0) < 7 || Number(storage.live_window_days || 0) > 60) fail('News live window must stay bounded between 7 and 60 days.');
  const publicFiles = new Set(storage.public_files || []);
  ['data/news-events.json', 'data/news.json', 'data/publisher-news.json', 'data/news-home-ru.json'].forEach(file => {
    if (!publicFiles.has(file)) fail(`News storage public_files is missing browser data: ${file}`);
  });
  ['data/youtube-signals.json', 'data/news-game-review.json', 'data/news-game-aliases.json', 'data/news-game-overrides.json', 'data/news-pipeline-health.json'].forEach(file => {
    if (publicFiles.has(file)) fail(`Internal pipeline file must not be copied into every public snapshot: ${file}`);
  });
  if (Number(storage.retention?.keep_recent_snapshots) !== 3) fail('News storage must retain exactly 3 rollback snapshots.');
  if (Number(storage.retention?.keep_daily_snapshots) !== 0) fail('News storage must not retain redundant daily snapshot copies.');

  const workflow = read('.github/workflows/news-pipeline.yml');
  if (!workflow.includes("cron: '23 * * * *'")) fail('Canonical news schedule is missing.');
  if (!workflow.includes('workflow_call:')) fail('Canonical news workflow is not reusable.');
  if (!workflow.includes('node scripts/run-news-pipeline.mjs')) fail('Canonical news workflow does not run the orchestrator.');
  if (!workflow.includes('node scripts/prune-news-storage.mjs')) fail('Canonical news workflow does not reclaim redundant snapshots before publication.');
  if (!workflow.includes('node scripts/publish-news-storage.mjs')) fail('Canonical news workflow does not publish Object Storage snapshots.');
  if (!workflow.includes('node scripts/test-news-monthly-archive.mjs')) fail('Canonical news workflow does not test monthly archive partitioning.');
  if (workflow.includes('contents: write') || /\bgit\s+push\b/.test(workflow)) fail('Canonical news workflow still writes generated content to GitHub.');
  ['YC_S3_ACCESS_KEY_ID', 'YC_S3_SECRET_ACCESS_KEY', 'YC_S3_BUCKET'].forEach(secret => {
    if (!workflow.includes(`secrets.${secret}`)) fail(`Canonical news workflow is missing ${secret}.`);
  });

  for (const aliasPath of ['.github/workflows/update-news.yml', '.github/workflows/update-publisher-news.yml']) {
    const alias = read(aliasPath);
    if (/\bschedule\s*:/.test(alias)) fail(`${aliasPath} still has an independent schedule.`);
    if (!alias.includes('uses: ./.github/workflows/news-pipeline.yml')) fail(`${aliasPath} bypasses the canonical pipeline.`);
  }

  const requiredContentApiTokens = [
    "const storageOrigin = 'https://storage.yandexcloud.net'",
    "const storageBucketPath = '/igropoisk-content/'",
    'news/manifests/current.json',
    'news/archive/',
    'object-storage',
    'repository-fallback',
    'window.IgropoiskNewsContent',
    'data/news-events.json',
    'data/news.json',
    'data/publisher-news.json',
    'data/news-home-ru.json'
  ];
  requiredContentApiTokens.forEach(token => {
    if (!contentApi.includes(token)) fail(`News Content API is missing contract token: ${token}`);
  });
  ['getAll', 'getArchive', 'getHome', 'health', 'invalidate'].forEach(method => {
    if (!contentApi.includes(method)) fail(`News Content API implementation is missing: ${method}`);
  });
  if (!presentation.includes('contentApi.getArchive')) fail('News archive facade does not consume the monthly archive API.');

  ['#popular', '#reviews', '.site-header', '#search', '#calendar', 'assets/auth.js'].forEach(token => {
    if (`${contentApi}\n${presentation}`.includes(token)) fail(`Public news runtime touches a foreign surface: ${token}`);
  });
  if (/\bfetch\s*\(/.test(presentation)) fail('News presentation bypasses the Content API.');
  if (!presentation.includes('window.IgropoiskNewsContent')) fail('News presentation does not consume the Content API.');
  ['ig-card', 'ig-card__media', 'ig-card__body', 'ig-card__meta', 'ig-card__title', 'ig-chip', 'ig-input', 'ig-filter-chip', 'ig-empty-state'].forEach(token => {
    if (!presentation.includes(token)) fail(`News presentation is not consuming central component: ${token}`);
  });

  const sharedOwnership = {
    'assets/home-page.js': ['#homeNews', '#newsPage', 'const news ='],
    'assets/home-page.css': ['.news-grid', '.news-card', '.news-page', '.news-toolbar', '.news-tag-filter'],
    'assets/home-wide-rails.css': ['#homeNews'],
    'assets/design-system.css': ['.news-page', '.news-card', '.news-grid'],
    'fix.css': ['.news-card']
  };
  for (const [file, forbidden] of Object.entries(sharedOwnership)) {
    const value = read(file);
    forbidden.forEach(token => {
      if (value.includes(token)) fail(`${file} still owns news selector or rendering token: ${token}`);
    });
  }

  const moduleCss = read('features/news/styles/index.css');
  for (const match of moduleCss.matchAll(/([^{}]+)\{/g)) {
    const selectorGroup = match[1].trim();
    if (!selectorGroup || selectorGroup.startsWith('@')) continue;
    for (const selector of selectorGroup.split(',').map(value => value.trim())) {
      if (!selector.startsWith('.ig-news')) fail(`Unscoped news CSS selector: ${selector}`);
    }
  }
  const designSystem = read('assets/design-system.css');
  ['.ig-card--interactive', '.ig-icon-button', '.ig-input', '.ig-filter-chip', '.ig-empty-state', '.ig-panel'].forEach(token => {
    if (!designSystem.includes(token)) fail(`Central design system is missing required component: ${token}`);
  });

  if (!adminPage.includes('data-news-health-admin')) fail('Read-only health admin root is missing.');
  if (!adminPage.includes('features/news/admin-health/index.js')) fail('Read-only health admin runtime is not loaded.');
  if (!adminPage.includes('assets/auth.js') || !adminPage.includes('assets/admin-page.js')) fail('Read-only health admin page is not protected by admin auth.');
  if (!adminRuntime.includes("requireAuth({role:'admin'")) fail('Health admin runtime does not require the admin role.');
  if (!adminRuntime.includes('news/manifests/current.json')) fail('Health admin runtime does not read the external manifest.');
  if (!adminRuntime.includes('data/news-pipeline-health.json')) fail('Health admin runtime does not retain the repository fallback.');
  if (!adminRuntime.includes("cache:'no-store'")) fail('Health admin runtime may display cached data.');

  const browserWrites = /(?:writeFile|appendFile|localStorage\.setItem|sessionStorage\.setItem)/;
  if (browserWrites.test(contentApi) || browserWrites.test(presentation)) fail('Public news runtime contains a data write operation.');
  if (/(?:writeFile|appendFile|fetch\([^)]*,\s*\{[^}]*method\s*:)/s.test(adminRuntime)) fail('Read-only health admin runtime contains a write operation.');
}

if (errors.length) {
  throw new Error(`News module validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}
console.log('News module compact live feed, monthly Object Storage archive, repository fallback and central design-system contract verified.');
