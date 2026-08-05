import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceRequired(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) throw new Error(`Cannot migrate ${label}: source fragment was not found.`);
  return content.replace(search, replacement);
}

function removePattern(content, pattern) {
  return content.replace(pattern, '');
}

function cleanEmptyMedia(content) {
  return content.replace(/@media\([^)]*\)\{\}/g, '');
}

function migrateIndex() {
  const path = 'index.html';
  let html = read(path);
  const style = '  <link rel="stylesheet" href="features/news/styles/index.css?v=20260804-1">';
  if (!html.includes(style)) {
    html = replaceRequired(
      html,
      '  <link rel="stylesheet" href="assets/home-wide-rails.css?v=20260803-4">',
      `  <link rel="stylesheet" href="assets/home-wide-rails.css?v=20260803-4">\n${style}`,
      'index news stylesheet'
    );
  }

  const oldHome = '    <section class="section"><div class="section-head"><h2>Последние новости</h2></div><div class="news-grid" id="homeNews"></div></section>';
  const newHome = `    <section class="section ig-news ig-news--home" data-news-module="home">
      <div class="section-head">
        <h2>Последние новости</h2>
        <div class="ig-control-group ig-news__controls" data-news-home-controls aria-label="Управление лентой новостей">
          <button class="ig-icon-button ig-news__control" type="button" data-news-direction="prev" aria-label="Прокрутить новости влево">←</button>
          <button class="ig-icon-button ig-news__control" type="button" data-news-direction="next" aria-label="Прокрутить новости вправо">→</button>
        </div>
      </div>
      <div class="ig-news__home-grid" data-news-home aria-live="polite"><div class="ig-empty-state">Загружаем новости…</div></div>
    </section>`;
  html = replaceRequired(html, oldHome, newHome, 'home news widget');

  const oldArchive = '<main class="page" id="news"><div class="ig-container news-page"><h1>Новости</h1><div class="news-grid" id="newsPage"></div></div></main>';
  const newArchive = `<main class="page" id="news">
  <div class="ig-container ig-news ig-news--archive" data-news-module="archive">
    <h1 class="ig-page-title">Новости</h1>
    <div class="ig-toolbar ig-news-toolbar" data-news-toolbar></div>
    <div class="ig-news__archive-grid" data-news-archive aria-live="polite"><div class="ig-empty-state">Загружаем новости…</div></div>
  </div>
</main>`;
  html = replaceRequired(html, oldArchive, newArchive, 'news archive page');

  html = html
    .replace(/\n<script src="assets\/news-feed\.js[^"]*"><\/script>/g, '')
    .replace(/\n<script src="assets\/news-rail-controls\.js[^"]*"><\/script>/g, '')
    .replace(/\n<script src="assets\/news-click-fix\.js[^"]*"><\/script>/g, '');

  const moduleScripts = `
<script src="features/news/shared/translations-ru.js?v=20260804-1"></script>
<script src="features/news/content-api/index.js?v=20260805-1"></script>
<script src="features/news/shared/index.js?v=20260805-1"></script>
<script src="features/news/home-widget/index.js?v=20260804-1"></script>
<script src="features/news/archive-page/index.js?v=20260804-1"></script>`;

  if (!html.includes('features/news/shared/index.js')) {
    html = replaceRequired(
      html,
      '<script src="assets/auth.js?v=20260804-6"></script>',
      `${moduleScripts}\n<script src="assets/auth.js?v=20260804-6"></script>`,
      'news module scripts'
    );
  } else {
    if (!html.includes('features/news/content-api/index.js')) {
      html = replaceRequired(
        html,
        '<script src="features/news/shared/index.js?v=20260804-1"></script>',
        '<script src="features/news/content-api/index.js?v=20260805-1"></script>\n<script src="features/news/shared/index.js?v=20260805-1"></script>',
        'news content API script'
      );
    }
    html = html.replace(
      '<script src="features/news/shared/index.js?v=20260804-1"></script>',
      '<script src="features/news/shared/index.js?v=20260805-1"></script>'
    );
  }
  write(path, html);
}

function migrateHomePageScript() {
  const path = 'assets/home-page.js';
  let script = read(path);
  script = removePattern(script, /\nconst news = \[[\s\S]*?\n\];\n/);
  script = script
    .replace(/^\s*\$\('#homeNews'\)[^\n]*\n/m, '')
    .replace(/^\s*\$\('#newsPage'\)[^\n]*\n/m, '');
  write(path, script);
}

function migrateHomePageStyles() {
  const path = 'assets/home-page.css';
  let css = read(path);
  css = css
    .replace('.section h2,.results-head h1,.news-page h1', '.section h2,.results-head h1')
    .replace('.feature-card p,.news-card p', '.feature-card p')
    .replace(/\.news-grid\{[\s\S]*?\.news-tag-filter button\.is-active\{[^}]*\}\n/, '')
    .replace(/\.news-grid,\.news-page \.news-grid\{[^}]*\}/g, '')
    .replace(/\.news-page \.news-grid\{[^}]*\}/g, '')
    .replace(/\.news-toolbar__top input\{[^}]*\}/g, '');
  css = cleanEmptyMedia(css);
  write(path, css);
}

function migrateWideRails() {
  const path = 'assets/home-wide-rails.css';
  let css = read(path);
  css = css
    .replace(/;--home-news-card:[^;}]+/g, '')
    .replace('#home .game-row,#homeNews{', '#home .game-row{')
    .replace('#home .game-row::-webkit-scrollbar,#homeNews::-webkit-scrollbar{', '#home .game-row::-webkit-scrollbar{')
    .replace('#home .game-row.is-dragging,#homeNews.is-dragging{', '#home .game-row.is-dragging{')
    .replace(/#homeNews>\.news-card\{[^}]*\}\n/g, '')
    .replace(/#homeNews>\.news-card img\{[^}]*\}\n/g, '')
    .replace(/#homeNews>\.news-card \.card-body\{[^}]*\}\n/g, '')
    .replace(/#homeNews>\.news-card h3\{[^}]*\}\n/g, '')
    .replace('#home .game-row,#homeNews{gap:11px;padding-bottom:10px}', '#home .game-row{gap:11px;padding-bottom:10px}')
    .replace(/#homeNews>\.news-card \.card-body\{[^}]*\}/g, '')
    .replace('#home .game-row,#homeNews{scroll-behavior:auto}', '#home .game-row{scroll-behavior:auto}');
  write(path, css);
}

function migrateDesignSystem() {
  const path = 'assets/design-system.css';
  let css = read(path);
  css = css
    .replace(/\n\.news-page\{[^}]*\}\n\.news-page \.news-grid\{[^}]*\}\n\.news-card h3\{[^}]*\}\n/, '\n')
    .replace('.news-card p,.news-card__tags span,.date,.section-note{', '.date,.section-note{')
    .replace(/\.news-page \.news-grid\{[^}]*\}/g, '');
  css = cleanEmptyMedia(css);
  write(path, css);
}

function migrateFixLayer() {
  const path = 'fix.css';
  const css = read(path).replace('.card[role=link],.news-card,.feature-card,.small-card', '.card[role=link],.feature-card,.small-card');
  write(path, css);
}

migrateIndex();
migrateHomePageScript();
migrateHomePageStyles();
migrateWideRails();
migrateDesignSystem();
migrateFixLayer();
console.log('News UI is materialized inside features/news and consumes the versioned News Content API plus central components only.');
