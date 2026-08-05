import fs from 'node:fs';

function injectBefore(text, closing, payload) {
  if (text.includes(payload)) return text;
  const index = text.toLowerCase().lastIndexOf(closing.toLowerCase());
  if (index < 0) throw new Error(`Missing ${closing}`);
  return `${text.slice(0, index).trimEnd()}\n${payload}\n${text.slice(index)}`;
}

const showcaseSection = `
    <section class="section home-editorial-showcase" data-ig-home-editorial="section">
      <div class="home-editorial-showcase__grid">
        <section class="reviews-of-day" aria-labelledby="reviewsOfDayTitle">
          <div class="home-showcase-heading"><span class="home-showcase-heading__icon" aria-hidden="true">▱</span><h2 id="reviewsOfDayTitle">Обзоры дня</h2></div>
          <div class="reviews-of-day__main" id="reviewsOfDayMain" aria-live="polite"><div class="home-widget-loading">Выбираем обзор…</div></div>
          <div id="reviews" hidden></div>
          <div class="reviews-of-day__rail-shell">
            <button class="home-rail-button" type="button" data-review-rail="-1" aria-label="Предыдущие обзоры">‹</button>
            <div class="reviews-of-day__rail" id="reviewsOfDayRail" aria-label="Другие обзоры"></div>
            <button class="home-rail-button" type="button" data-review-rail="1" aria-label="Следующие обзоры">›</button>
          </div>
        </section>
        <section class="home-releases" aria-labelledby="homeReleasesTitle">
          <div class="home-showcase-heading home-showcase-heading--split"><span class="home-showcase-heading__icon" aria-hidden="true">□</span><h2 id="homeReleasesTitle">Новые и ожидаемые релизы</h2><a href="calendar/">Смотреть календарь</a></div>
          <div class="home-releases__rail-shell">
            <button class="home-rail-button" type="button" data-release-rail="-1" aria-label="Предыдущие релизы">‹</button>
            <div class="home-releases__rail" id="releaseHomeGrid" aria-live="polite"><div class="home-widget-loading">Загружаем новые и ожидаемые релизы…</div></div>
            <button class="home-rail-button" type="button" data-release-rail="1" aria-label="Следующие релизы">›</button>
          </div>
        </section>
      </div>
    </section>`;

function injectHomepage() {
  const file = 'index.html';
  let html = fs.readFileSync(file, 'utf8');

  html = html
    .replace(/\n?<link[^>]+(?:data-ig-release-home="style"|href="assets\/release-home\.css[^"]*")[^>]*>/g, '')
    .replace(/\n?<script[^>]+(?:data-ig-release-home="script"|src="assets\/release-home\.js[^"]*")[^>]*><\/script>/g, '')
    .replace(/\s*<section class="section release-home-section"[^>]*data-ig-release-home="section"[\s\S]*?<\/section>/g, '');

  const styles = [
    '<link rel="stylesheet" href="assets/reviews-of-day/index.css?v=20260804-1">',
    '<link rel="stylesheet" href="assets/home-releases/index.css?v=20260804-1">'
  ];
  for (const style of styles) html = injectBefore(html, '</head>', style);

  if (!html.includes('data-ig-release-nav')) {
    const newsButton = '<button data-page="news">Новости</button>';
    const link = '<a class="release-nav-link" href="calendar/" data-ig-release-nav>Календарь релизов</a>';
    if (html.includes(newsButton)) html = html.replace(newsButton, `${link}\n      ${newsButton}`);
    else html = html.replace('</nav>', `${link}</nav>`);
  }

  if (!html.includes('data-ig-home-editorial="section"')) {
    const oldReviews = /<section class="section"><div class="section-head"><h2>Свежие обзоры<\/h2>[\s\S]*?<\/section>/;
    if (oldReviews.test(html)) {
      html = html.replace(oldReviews, showcaseSection.trim());
    } else {
      const popularMarker = 'id="popular"';
      const markerIndex = html.indexOf(popularMarker);
      if (markerIndex < 0) throw new Error('Homepage popular block was not found');
      const sectionEnd = html.indexOf('</section>', markerIndex);
      if (sectionEnd < 0) throw new Error('Homepage popular section closing tag was not found');
      const insertAt = sectionEnd + '</section>'.length;
      html = `${html.slice(0, insertAt)}${showcaseSection}${html.slice(insertAt)}`;
    }
  }

  const scripts = [
    '<script src="assets/reviews-of-day/index.js?v=20260804-1"></script>',
    '<script src="assets/home-releases/index.js?v=20260805-1"></script>'
  ];
  for (const script of scripts) html = injectBefore(html, '</body>', script);

  fs.writeFileSync(file, html, 'utf8');
}

function injectAdmin() {
  const file = 'admin/index.html';
  let html = fs.readFileSync(file, 'utf8');
  const overview = '<a class="active" href="#overview">Обзор</a>';
  const widgetLinks = '<a href="home-widgets/releases/" data-ig-home-release-admin>Ближайшие релизы</a><a href="home-widgets/reviews-of-day/" data-ig-review-day-admin>Обзоры дня</a>';
  if (!html.includes('href="home-widgets/releases/"') && html.includes(overview)) html = html.replace(overview, `${overview}${widgetLinks}`);
  if (!html.includes('href="parsers/releases/"')) {
    const gameData = '<a href="parsers/game-data/">Данные игры</a>';
    if (html.includes(gameData)) html = html.replace(gameData, `${gameData}<a href="parsers/releases/">Календарь релизов</a>`);
  }
  fs.writeFileSync(file, html, 'utf8');
}

injectHomepage();
injectAdmin();
console.log('Homepage review/release showcase UI injected into deployment HTML.');
