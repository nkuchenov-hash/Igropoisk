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
  'scripts/lib/yandex-object-storage.mjs',
  'scripts/publish-news-storage.mjs',
  '.github/workflows/news-pipeline.yml',
  '.github/workflows/yandex-storage-connectivity.yml',
  '.github/workflows/update-news.yml',
  '.github/workflows/update-publisher-news.yml'
];
const errors = [];
const read = path => fs.readFileSync(path, 'utf8');
const fail = message => errors.push(message);

for (const path of requiredFiles) {
  if (!fs.existsSync(path)) fail(`Missing news module file: ${path}`);
}

if (!errors.length) {
  const manifest = JSON.parse(read('features/news/module.json'));
  const pipelineConfig = JSON.parse(read('config/news-pipeline.json'));
  const index = read('index.html');
  const contentApi = read('features/news/content-api/index.js');
  const adminHealthPage = read('admin/news-health/index.html');
  const adminHealthRuntime = read('features/news/admin-health/index.js');
  const presentationScripts = [
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ].map(read).join('\n');

  const requiredReferences = [
    'data-news-module="home"',
    'data-news-home',
    'data-news-module="archive"',
    'data-news-archive',
    'features/news/styles/index.css',
    'features/news/shared/translations-ru.js',
    'features/news/content-api/index.js',
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js',
    'class="ig-icon-button ig-news__control"',
    'class="ig-toolbar ig-news-toolbar"',
    'class="ig-page-title"',
    'class="ig-empty-state"'
  ];
  requiredReferences.forEach(reference => {
    if (!index.includes(reference)) fail(`index.html is missing: ${reference}`);
  });

  const orderedScripts = [
    'features/news/shared/translations-ru.js',
    'features/news/content-api/index.js',
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ];
  let previousIndex = -1;
  for (const script of orderedScripts) {
    const position = index.indexOf(script);
    if (position <= previousIndex) fail(`News runtime script order is invalid around: ${script}`);
    previousIndex = position;
  }

  if (manifest.version < 5) fail('News module manifest must use version 5 or newer.');
  if (manifest.contentApi?.global !== 'IgropoiskNewsContent') fail('News module manifest is missing the content API global.');
  if (manifest.contentApi?.version !== 1) fail('News module manifest must declare News Content API version 1.');
  if (manifest.contentApi?.backend !== 'yandex-object-storage-with-repository-fallback') fail('News module does not declare Object Storage with repository fallback.');
  if (manifest.contentApi?.manifest !== 'https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json') fail('News module has an invalid external manifest URL.');
  ['getAll', 'getHome', 'health', 'invalidate'].forEach(method => {
    if (!manifest.contentApi?.interface?.includes(method)) fail(`News module manifest is missing content API method: ${method}`);
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
    test: 'scripts/test-news-pipeline.mjs',
    healthTest: 'scripts/test-news-pipeline-health.mjs',
    publication: 'external-immutable-snapshot-with-atomic-manifest'
  };
  for (const [key, value] of Object.entries(expectedPipeline)) {
    if (manifest.pipeline?.[key] !== value) fail(`News module manifest has invalid pipeline.${key}.`);
  }

  const groupIds = new Set((pipelineConfig.groups || []).map(group => group.id));
  ['global-media', 'official-sources'].forEach(id => {
    if (!groupIds.has(id)) fail(`News pipeline config is missing source group: ${id}`);
  });
  if (!pipelineConfig.rebuild_commands?.includes('node scripts/build-news-events.mjs')) fail('News pipeline does not rebuild unified events.');
  if (!pipelineConfig.rebuild_commands?.includes('node scripts/build-home-news.mjs')) fail('News pipeline does not rebuild the homepage feed.');
  if (pipelineConfig.health?.output_file !== 'data/news-pipeline-health.json') fail('News pipeline health output is not canonical.');
  if (pipelineConfig.health?.command !== 'node scripts/build-news-pipeline-health.mjs') fail('News pipeline health builder is not canonical.');
  if (Number(pipelineConfig.health?.persistent_failure_threshold || 0) < 2) fail('Persistent source failure threshold is too low or missing.');

  const storage = pipelineConfig.publication?.storage || {};
  if (storage.provider !== 'yandex-object-storage') fail('News pipeline storage provider is invalid.');
  if (storage.current_manifest !== 'news/manifests/current.json') fail('News pipeline current manifest key is invalid.');
  if (storage.snapshot_prefix !== 'news/snapshots') fail('News pipeline snapshot prefix is invalid.');
  if (storage.media_prefix !== 'news/media') fail('News pipeline media prefix is invalid.');
  if (Number(storage.maximum_snapshot_bytes || 0) <= 0) fail('News pipeline has no snapshot size guard.');

  const canonicalWorkflow = read('.github/workflows/news-pipeline.yml');
  if (!canonicalWorkflow.includes("cron: '23 * * * *'")) fail('Canonical news pipeline schedule is missing or changed.');
  if (!canonicalWorkflow.includes('workflow_call:')) fail('Canonical news pipeline is not reusable by manual aliases.');
  if (!canonicalWorkflow.includes('node scripts/run-news-pipeline.mjs')) fail('Canonical workflow does not run the orchestrator.');
  if (!canonicalWorkflow.includes('node scripts/test-news-pipeline-health.mjs')) fail('Canonical workflow does not test the health snapshot.');
  if (!canonicalWorkflow.includes('node scripts/publish-news-storage.mjs')) fail('Canonical workflow does not publish the external snapshot.');
  if (canonicalWorkflow.includes('contents: write') || /\bgit\s+push\b/.test(canonicalWorkflow)) fail('Canonical news workflow still writes generated content to GitHub.');
  ['YC_S3_ACCESS_KEY_ID', 'YC_S3_SECRET_ACCESS_KEY', 'YC_S3_BUCKET'].forEach(secret => {
    if (!canonicalWorkflow.includes(`secrets.${secret}`)) fail(`Canonical news workflow is missing ${secret}.`);
  });

  for (const aliasPath of ['.github/workflows/update-news.yml', '.github/workflows/update-publisher-news.yml']) {
    const alias = read(aliasPath);
    if (/\bschedule\s*:/.test(alias)) fail(`${aliasPath} still has an independent schedule.`);
    if (!alias.includes('uses: ./.github/workflows/news-pipeline.yml')) fail(`${aliasPath} bypasses the canonical pipeline.`);
  }

  ['assets/news-feed.js', 'assets/news-rail-controls.js', 'assets/news-click-fix.js', 'assets/news-archive-full.js', 'assets/news-archive-full.css'].forEach(reference => {
    if (index.includes(reference)) fail(`Legacy news runtime is still referenced: ${reference}`);
  });

  const sharedOwnership = {
    'assets/home-page.js': ['#homeNews', '#newsPage', 'const news ='],
    'assets/home-page.css': ['.news-grid', '.news-card', '.news-page', '.news-toolbar', '.news-tag-filter'],
    'assets/home-wide-rails.css': ['#homeNews'],
    'assets/design-system.css': ['.news-page', '.news-card', '.news-grid'],
    'fix.css': ['.news-card']
  };
  for (const [path, forbidden] of Object.entries(sharedOwnership)) {
    const content = read(path);
    forbidden.forEach(token => {
      if (content.includes(token)) fail(`${path} still owns news selector or rendering token: ${token}`);
    });
  }

  const moduleCss = read('features/news/styles/index.css');
  const selectorPattern = /([^{}]+)\{/g;
  for (const match of moduleCss.matchAll(selectorPattern)) {
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

  ['#popular', '#reviews', '.site-header', '#search', '#calendar', 'assets/auth.js'].forEach(token => {
    if (`${contentApi}\n${presentationScripts}`.includes(token)) fail(`Public news runtime touches a foreign surface: ${token}`);
  });

  ['ig-card', 'ig-card__media', 'ig-card__body', 'ig-card__meta', 'ig-card__title', 'ig-chip', 'ig-input', 'ig-filter-chip', 'ig-empty-state'].forEach(token => {
    if (!presentationScripts.includes(token)) fail(`News presentation is not consuming central component: ${token}`);
  });

  ['data/news-events.json', 'data/news.json', 'data/publisher-news.json', 'data/news-home-ru.json'].forEach(path => {
    if (!contentApi.includes(path)) fail(`News Content API is missing repository fallback source: ${path}`);
    if (presentationScripts.includes(path)) fail(`News presentation bypasses the Content API: ${path}`);
  });
  if (!contentApi.includes('https://storage.yandexcloud.net/igropoisk-content/news/manifests/current.json')) fail('News Content API is missing the Object Storage manifest.');
  if (!contentApi.includes('repository-fallback')) fail('News Content API is missing repository fallback behavior.');
  if (!contentApi.includes('window.IgropoiskNewsContent')) fail('News Content API does not publish its versioned global contract.');
  ['getAll', 'getHome', 'health', 'invalidate'].forEach(method => {
    if (!contentApi.includes(method)) fail(`News Content API implementation is missing: ${method}`);
  });
  if (!presentationScripts.includes('window.IgropoiskNewsContent')) fail('News presentation does not consume the Content API.');
  if (/\bfetch\s*\(/.test(presentationScripts)) fail('News presentation performs a direct data fetch instead of using the Content API.');

  if (!adminHealthPage.includes('data-news-health-admin')) fail('Read-only health admin root is missing.');
  if (!adminHealthPage.includes('features/news/admin-health/index.js')) fail('Read-only health admin runtime is not loaded.');
  if (!adminHealthPage.includes('assets/auth.js') || !adminHealthPage.includes('assets/admin-page.js')) fail('Read-only health admin page is not protected by admin auth.');
  if (!adminHealthRuntime.includes("requireAuth({role:'admin'")) fail('Health admin runtime does not require the admin role.');
  if (!adminHealthRuntime.includes('data/news-pipeline-health.json')) fail('Health admin runtime does not retain the repository health fallback.');
  if (!adminHealthRuntime.includes("cache:'no-store'")) fail('Health admin runtime may display a cached snapshot.');

  const dataWrites = /(?:writeFile|appendFile|localStorage\.setItem|sessionStorage\.setItem)/;
  if (dataWrites.test(contentApi) || dataWrites.test(presentationScripts)) fail('Public news runtime contains a data write operation.');
  if (/(?:writeFile|appendFile|fetch\([^)]*,\s*\{[^}]*method\s*:)/s.test(adminHealthRuntime)) fail('Read-only health admin runtime contains a write operation.');
}

if (errors.length) {
  throw new Error(`News module validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}
console.log('News module Object Storage primary repository fallback and central design-system contract verified.');
