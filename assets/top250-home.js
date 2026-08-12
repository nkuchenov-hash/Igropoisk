'use strict';

(() => {
  const ROOT = '/Igropoisk/';
  const nav = document.querySelector('.site-nav');
  const heroContent = document.querySelector('#home .hero .hero-content');
  if (!nav || !heroContent) return;

  const ensureNavLink = targetNav => {
    if (!targetNav || targetNav.querySelector('[data-top250-nav]')) return;
    const link = document.createElement('a');
    link.href = `${ROOT}top-250/`;
    link.textContent = 'Топ-250';
    link.dataset.top250Nav = 'true';
    const releaseLink = targetNav.querySelector('[data-ig-release-nav]');
    targetNav.insertBefore(link, releaseLink || targetNav.querySelector('[data-page="news"]') || null);
  };

  ensureNavLink(nav);
  ensureNavLink(document.querySelector('.mobile-menu nav'));

  let card = heroContent.querySelector('[data-home-hero-rating]');
  if (!card) {
    card = document.createElement('aside');
    card.className = 'ig-panel home-hero-rating';
    card.dataset.homeHeroRating = '';
    heroContent.appendChild(card);
  }
  if (card.dataset.top250HomeCard === 'true') return;

  card.dataset.top250HomeCard = 'true';
  card.setAttribute('aria-label', 'Игропоиск Топ-250');
  card.innerHTML = `
    <div class="home-hero-rating__head">
      <div>
        <div class="ig-kicker top250-home-kicker">Рейтинг Игропоиска</div>
        <a class="ig-card__title top250-home-title" href="${ROOT}top-250/">Топ-250</a>
      </div>
      <a class="top250-home-open" href="${ROOT}top-250/">Весь рейтинг →</a>
    </div>
    <div class="home-hero-rating__list" data-top250-home-list aria-live="polite">
      <div class="ig-empty-state top250-home-state">Загружаем рейтинг…</div>
    </div>`;

  const list = card.querySelector('[data-top250-home-list]');

  const normalizeImage = image => {
    if (!image) return '';
    if (/^https?:\/\//i.test(image) || image.startsWith('/')) return image;
    return `${ROOT}${image.replace(/^\.\//, '')}`;
  };

  const initials = title => String(title || 'И')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();

  const gameUrl = item => item.game_url || (item.slug ? `${ROOT}game/${encodeURIComponent(item.slug)}/` : `${ROOT}top-250/`);

  const coverCandidates = item => {
    const candidates = [...new Set([
      ...(item.image_candidates || []),
      item.image,
      item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900_2x.jpg`,
      item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900.jpg`
    ].filter(Boolean).map(normalizeImage))];
    return [
      ...candidates.filter(url => /library_600x900/i.test(url)),
      ...candidates.filter(url => !/library_600x900/i.test(url))
    ];
  };

  const createItem = (item, title) => {
    const row = document.createElement('a');
    row.className = 'home-hero-rating__row';
    row.href = gameUrl(item);
    row.setAttribute('aria-label', `${item.rank}. ${title} — открыть страницу игры`);

    const rank = document.createElement('span');
    rank.className = 'home-hero-rating__rank';
    rank.textContent = String(item.rank);

    const cover = document.createElement('span');
    cover.className = 'home-hero-rating__cover';
    cover.dataset.title = title;
    const candidates = coverCandidates(item);
    if (candidates.length) {
      const image = document.createElement('img');
      image.src = candidates[0];
      image.alt = `Обложка ${title}`;
      image.loading = Number(item.rank) <= 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.dataset.coverIndex = '0';
      image.addEventListener('error', () => {
        const next = Number(image.dataset.coverIndex || 0) + 1;
        if (next < candidates.length) {
          image.dataset.coverIndex = String(next);
          image.src = candidates[next];
          return;
        }
        cover.textContent = initials(title);
        cover.classList.add('is-placeholder');
      });
      cover.appendChild(image);
    } else {
      cover.textContent = initials(title);
      cover.classList.add('is-placeholder');
    }

    const copy = document.createElement('span');
    copy.className = 'home-hero-rating__game';
    const name = document.createElement('b');
    name.textContent = title;
    const meta = document.createElement('small');
    meta.textContent = 'Игропоиск';
    copy.append(name, meta);

    const score = document.createElement('strong');
    score.className = 'home-hero-rating__score';
    score.textContent = Number.isFinite(Number(item.score)) ? Number(item.score).toFixed(1) : '—';

    row.append(rank, cover, copy, score);
    return row;
  };

  Promise.all([
    fetch(`${ROOT}data/top-250/current.json`, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`Top-250 request failed: ${response.status}`);
      return response.json();
    }),
    fetch(`${ROOT}data/catalog-visible.json`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : [])
      .catch(() => [])
  ])
    .then(([data, catalog]) => {
      const ranking = Array.isArray(data.ranking) ? data.ranking : [];
      if (!ranking.length) throw new Error('Top-250 ranking is empty');
      const titles = new Map((Array.isArray(catalog) ? catalog : []).map(item => [item.slug, item.title]));
      list.replaceChildren(...ranking.map(item => createItem(item, titles.get(item.slug) || item.title || item.slug || 'Без названия')));
    })
    .catch(error => {
      console.warn(error);
      list.innerHTML = `<a class="ig-empty-state top250-home-state" href="${ROOT}top-250/">Открыть Топ-250 →</a>`;
    });
})();
