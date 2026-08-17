(() => {
  const list = document.querySelector('[data-top250-list]');
  const meta = document.querySelector('[data-top250-meta]');
  const count = document.querySelector('[data-top250-count]');
  const bestScore = document.querySelector('[data-top250-best-score]');
  const heroImage = document.querySelector('[data-top250-hero-image]');
  if (!list) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const imageUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw;
    return `/Igropoisk/${raw.replace(/^\.\//, '')}`;
  };
  const gameUrl = item => item.game_url || `/Igropoisk/game/${encodeURIComponent(item.slug)}/`;
  const initials = title => String(title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const unique = values => [...new Set(values.filter(Boolean))];
  const allCandidates = item => unique([
    item.hero,
    item.image,
    ...(item.image_candidates || []),
    item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900_2x.jpg`,
    item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900.jpg`
  ].map(imageUrl));
  const landscapeCandidates = item => {
    const all = allCandidates(item);
    const portrait = /(?:library_600x900|portrait)/i;
    const landscape = /(?:header|page_bg|background|ss_|screenshot|1920x1080|1200x630|width=1[01-9]\d{2})/i;
    const preferred = all.filter(url => landscape.test(url) && !portrait.test(url));
    const neutral = all.filter(url => !preferred.includes(url) && !portrait.test(url));
    return unique([...preferred, ...neutral, ...all]);
  };
  const genreLabels = new Map([
    ['action', 'Экшен'],
    ['adventure', 'Приключения'],
    ['strategy', 'Стратегия'],
    ['simulation', 'Симулятор'],
    ['shooter', 'Шутер'],
    ['puzzle', 'Головоломка'],
    ['platformer', 'Платформер'],
    ['horror', 'Хоррор'],
    ['indie', 'Инди'],
    ['rpg', 'RPG'],
    ['vr', 'VR']
  ]);
  const genreLabel = value => genreLabels.get(String(value || '').trim().toLowerCase()) || String(value || '').trim();

  function installFallbacks(items) {
    list.querySelectorAll('[data-top250-slug]').forEach(row => {
      const item = items.find(candidate => candidate.slug === row.dataset.top250Slug);
      const image = row.querySelector('img[data-cover-index]');
      if (!item || !image) return;
      const urls = landscapeCandidates(item);
      image.addEventListener('error', () => {
        const next = Number(image.dataset.coverIndex || 0) + 1;
        if (next < urls.length) {
          image.dataset.coverIndex = String(next);
          image.src = urls[next];
          return;
        }
        const placeholder = document.createElement('div');
        placeholder.className = 'top250-cover-placeholder';
        placeholder.textContent = initials(item.title);
        image.replaceWith(placeholder);
      });
    });
  }

  async function recoverMissingCovers(items) {
    const missing = items.filter(item => !landscapeCandidates(item).length);
    await Promise.all(missing.map(async item => {
      try {
        const [draftResponse, mediaResponse] = await Promise.all([
          fetch(`/Igropoisk/data/drafts/${encodeURIComponent(item.slug)}.json`, { cache: 'no-store' }),
          fetch(`/Igropoisk/data/article-media/${encodeURIComponent(item.slug)}.json`, { cache: 'no-store' })
        ]);
        const draft = draftResponse.ok ? await draftResponse.json() : null;
        const media = mediaResponse.ok ? await mediaResponse.json() : null;
        const recovered = [
          draft?.media?.hero,
          media?.hero?.url,
          ...(media?.sections || []).flatMap(section => section.images || []).map(image => image?.url),
          draft?.media?.cover,
          media?.cover?.url
        ].find(Boolean);
        if (recovered) {
          item.hero = recovered;
          const row = list.querySelector(`[data-top250-slug="${CSS.escape(item.slug)}"] .top250-media`);
          if (row) row.innerHTML = `<img src="${esc(imageUrl(recovered))}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-cover-index="0">`;
        }
      } catch {}
    }));
    installFallbacks(items);
  }

  function renderGenres(item) {
    return unique((item.genres || []).map(genreLabel).filter(Boolean)).slice(0, 3).map(genre => `<span class="ig-chip">${esc(genre)}</span>`).join('');
  }

  function fetchJson(url, fallback) {
    return fetch(url, { cache: 'no-store' }).then(response => {
      if (!response.ok) {
        if (fallback !== undefined) return fallback;
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    });
  }

  Promise.all([
    fetchJson('/Igropoisk/data/top-250/current.json'),
    fetchJson('/Igropoisk/data/catalog-visible.json', [])
  ])
    .then(async ([data, catalog]) => {
      const catalogBySlug = new Map((Array.isArray(catalog) ? catalog : []).map(item => [item.slug, item]));
      const items = (Array.isArray(data.ranking) ? data.ranking : []).map(item => ({
        ...item,
        title: String(catalogBySlug.get(item.slug)?.title || item.title || item.slug).trim()
      }));

      if (meta) meta.textContent = `${items.length} игр в рейтинге. Оценки сформированы по опубликованным обзорам Игропоиска.`;
      if (count) count.textContent = String(items.length);
      if (bestScore) {
        const score = Number(items[0]?.score);
        bestScore.textContent = Number.isFinite(score) ? score.toFixed(1) : '—';
      }
      if (heroImage && items.length) {
        const hero = landscapeCandidates(items[0])[0];
        if (hero) {
          heroImage.src = hero;
          heroImage.hidden = false;
        }
      }

      list.innerHTML = items.map(item => {
        const urls = landscapeCandidates(item);
        const image = urls[0] || '';
        const summary = String(item.summary || '').trim();
        const score = Number(item.score);
        const scoreMarkup = Number.isFinite(score)
          ? `<div class="ig-pill top250-score"><strong>★ ${esc(score.toFixed(1))}</strong><span>Оценка Игропоиска</span></div>`
          : '';
        const genres = renderGenres(item);
        const rank = Number(item.rank);
        return `<a class="ig-card ig-card--interactive top250-row" data-top250-slug="${esc(item.slug)}" href="${esc(gameUrl(item))}" aria-label="Открыть страницу игры ${esc(item.title)}"><div class="top250-rank-wrap">${rank === 1 ? '<span class="top250-crown" aria-hidden="true">♛</span>' : ''}<strong class="top250-rank">${rank}</strong></div><div class="ig-card__media top250-media">${image ? `<img src="${esc(image)}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-cover-index="0">` : `<div class="top250-cover-placeholder">${esc(initials(item.title))}</div>`}</div><div class="ig-card__body top250-copy"><span class="ig-card__title top250-name">${esc(item.title)}</span>${summary ? `<p class="ig-card__summary top250-summary">${esc(summary)}</p>` : ''}</div><div class="top250-year"><strong>${item.year ? esc(item.year) : '—'}</strong><span>Релиз</span></div><div class="top250-genres">${genres}</div>${scoreMarkup}<span class="top250-chevron" aria-hidden="true">›</span></a>`;
      }).join('');
      list.setAttribute('aria-busy', 'false');
      installFallbacks(items);
      await recoverMissingCovers(items);
    })
    .catch(() => {
      list.setAttribute('aria-busy', 'false');
      list.innerHTML = '<div class="ig-empty-state">Не удалось показать рейтинг. Обновите страницу.</div>';
    });
})();
