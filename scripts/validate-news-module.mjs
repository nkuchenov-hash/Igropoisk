import fs from 'node:fs';

const requiredFiles = [
  'features/news/module.json',
  'features/news/RULES.md',
  'features/news/shared/translations-ru.js',
  'features/news/shared/index.js',
  'features/news/home-widget/index.js',
  'features/news/archive-page/index.js',
  'features/news/styles/index.css'
];
const errors = [];
const read = path => fs.readFileSync(path, 'utf8');

for (const path of requiredFiles) {
  if (!fs.existsSync(path)) errors.push(`Missing news module file: ${path}`);
}

if (!errors.length) {
  JSON.parse(read('features/news/module.json'));
  const index = read('index.html');
  const requiredReferences = [
    'data-news-module="home"',
    'data-news-home',
    'data-news-module="archive"',
    'data-news-archive',
    'features/news/styles/index.css',
    'features/news/shared/translations-ru.js',
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js',
    'class="ig-icon-button ig-news__control"',
    'class="ig-toolbar ig-news-toolbar"',
    'class="ig-page-title"',
    'class="ig-empty-state"'
  ];
  requiredReferences.forEach(reference => {
    if (!index.includes(reference)) errors.push(`index.html is missing: ${reference}`);
  });

  ['assets/news-feed.js', 'assets/news-rail-controls.js', 'assets/news-click-fix.js', 'assets/news-archive-full.js', 'assets/news-archive-full.css'].forEach(reference => {
    if (index.includes(reference)) errors.push(`Legacy news runtime is still referenced: ${reference}`);
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
      if (content.includes(token)) errors.push(`${path} still owns news selector or rendering token: ${token}`);
    });
  }

  const moduleCss = read('features/news/styles/index.css');
  const selectorPattern = /([^{}]+)\{/g;
  for (const match of moduleCss.matchAll(selectorPattern)) {
    const selectorGroup = match[1].trim();
    if (!selectorGroup || selectorGroup.startsWith('@')) continue;
    for (const selector of selectorGroup.split(',').map(value => value.trim())) {
      if (!selector.startsWith('.ig-news')) errors.push(`Unscoped news CSS selector: ${selector}`);
    }
  }

  const designSystem = read('assets/design-system.css');
  ['.ig-card--interactive', '.ig-icon-button', '.ig-input', '.ig-filter-chip', '.ig-empty-state'].forEach(token => {
    if (!designSystem.includes(token)) errors.push(`Central design system is missing required component: ${token}`);
  });

  const moduleScripts = [
    'features/news/shared/index.js',
    'features/news/home-widget/index.js',
    'features/news/archive-page/index.js'
  ].map(read).join('\n');
  ['#popular', '#reviews', '.site-header', '#search', '#calendar', 'assets/auth.js'].forEach(token => {
    if (moduleScripts.includes(token)) errors.push(`News runtime touches a foreign surface: ${token}`);
  });

  ['ig-card', 'ig-card__media', 'ig-card__body', 'ig-card__meta', 'ig-card__title', 'ig-chip', 'ig-input', 'ig-filter-chip', 'ig-empty-state'].forEach(token => {
    if (!moduleScripts.includes(token)) errors.push(`News module is not consuming central component: ${token}`);
  });

  const dataWrites = /(?:writeFile|appendFile|localStorage\.setItem|sessionStorage\.setItem)/;
  if (dataWrites.test(moduleScripts)) errors.push('News UI runtime contains a data write operation.');
}

if (errors.length) {
  throw new Error(`News module validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
}
console.log('News module boundary and runtime contract verified.');
