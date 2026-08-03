import fs from 'node:fs';

function injectBefore(text, closing, payload) {
  if (text.includes(payload)) return text;
  const index = text.toLowerCase().lastIndexOf(closing.toLowerCase());
  if (index < 0) throw new Error(`Missing ${closing}`);
  return `${text.slice(0, index).trimEnd()}\n${payload}\n${text.slice(index)}`;
}

function injectHomepage() {
  const file = 'index.html';
  let html = fs.readFileSync(file, 'utf8');
  const css = '<link rel="stylesheet" href="assets/release-home.css?v=20260803-1" data-ig-release-home="style">';
  const script = '<script src="assets/release-home.js?v=20260803-1" data-ig-release-home="script" defer></script>';
  html = injectBefore(html, '</head>', css);

  if (!html.includes('data-ig-release-nav')) {
    const newsButton = '<button data-page="news">Новости</button>';
    const link = '<a class="release-nav-link" href="calendar/" data-ig-release-nav>Календарь релизов</a>';
    if (html.includes(newsButton)) html = html.replace(newsButton, `${link}${newsButton}`);
    else html = html.replace('</nav>', `${link}</nav>`);
  }

  if (!html.includes('data-ig-release-home="section"')) {
    const popularMarker = 'id="popular"';
    const markerIndex = html.indexOf(popularMarker);
    if (markerIndex < 0) throw new Error('Homepage popular block was not found');
    const sectionEnd = html.indexOf('</section>', markerIndex);
    if (sectionEnd < 0) throw new Error('Homepage popular section closing tag was not found');
    const insertAt = sectionEnd + '</section>'.length;
    const section = `
    <section class="section release-home-section" data-ig-release-home="section">
      <div class="release-home-head">
        <div><div class="release-home-kicker">Календарь выходов</div><h2>Новые релизы</h2></div>
        <a class="release-home-link" href="calendar/">Весь календарь →</a>
      </div>
      <div class="release-home-grid" id="releaseHomeGrid" aria-live="polite">
        <div class="release-home-loading">Загружаем ближайшие релизы…</div>
      </div>
    </section>`;
    html = `${html.slice(0, insertAt)}${section}${html.slice(insertAt)}`;
  }

  html = injectBefore(html, '</body>', script);
  fs.writeFileSync(file, html, 'utf8');
}

function injectAdmin() {
  const file = 'admin/index.html';
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('data-ig-release-admin-link')) {
    const anchor = '<a href="parsers/game-data/">Данные игры</a>';
    const link = '<a href="parsers/releases/" data-ig-release-admin-link>Календарь релизов</a>';
    if (html.includes(anchor)) html = html.replace(anchor, `${anchor}${link}`);
    else html = html.replace('</aside>', `${link}</aside>`);
  }
  const script = '<script src="../assets/release-admin-card.js?v=20260803-1" data-ig-release-admin-card defer></script>';
  html = injectBefore(html, '</body>', script);
  fs.writeFileSync(file, html, 'utf8');
}

injectHomepage();
injectAdmin();
console.log('Release calendar UI injected into deployment HTML.');
