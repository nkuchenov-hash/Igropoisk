(() => {
  const list = document.querySelector('[data-top250-list]');
  const meta = document.querySelector('[data-top250-meta]');
  if (!list) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const imageUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw;
    return `/Igropoisk/${raw.replace(/^\.\//, '')}`;
  };
  const gameUrl = item => item.game_url || `/Igropoisk/game/${encodeURIComponent(item.slug)}/`;
  const initials = title => String(title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const candidates = item => [...new Set([item.image, ...(item.image_candidates || []), item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900_2x.jpg`, item.steam_appid && `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.steam_appid}/library_600x900.jpg`].filter(Boolean).map(imageUrl))];

  function installFallbacks(items) {
    list.querySelectorAll('[data-top250-slug]').forEach(row => {
      const item = items.find(candidate => candidate.slug === row.dataset.top250Slug);
      const image = row.querySelector('img[data-cover-index]');
      if (!item || !image) return;
      const urls = candidates(item);
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
    const missing = items.filter(item => !candidates(item).length);
    await Promise.all(missing.map(async item => {
      try {
        const [draftResponse, mediaResponse] = await Promise.all([
          fetch(`/Igropoisk/data/drafts/${encodeURIComponent(item.slug)}.json`, { cache: 'no-store' }),
          fetch(`/Igropoisk/data/article-media/${encodeURIComponent(item.slug)}.json`, { cache: 'no-store' })
        ]);
        const draft = draftResponse.ok ? await draftResponse.json() : null;
        const media = mediaResponse.ok ? await mediaResponse.json() : null;
        const recovered = [draft?.media?.cover, media?.cover?.url, draft?.media?.hero, media?.hero?.url, ...(media?.sections || []).flatMap(section => section.images || []).map(image => image?.url)].find(Boolean);
        if (recovered) {
          item.image = recovered;
          item.image_candidates = [recovered];
          const row = list.querySelector(`[data-top250-slug="${CSS.escape(item.slug)}"] .top250-media`);
          if (row) row.innerHTML = `<img src="${esc(imageUrl(recovered))}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-cover-index="0">`;
        }
      } catch {}
    }));
    installFallbacks(items);
  }

  fetch('/Igropoisk/data/top-250/current.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(async data => {
      const items = Array.isArray(data.ranking) ? data.ranking : [];
      if (meta) meta.textContent = `${items.length} игр в текущем рейтинге. Оценка, краткая суть и переход на страницу игры.`;
      list.innerHTML = items.map(item => {
        const urls = candidates(item);
        const cover = urls[0] || '';
        const summary = String(item.summary || '').trim() || 'Краткое описание игры пока уточняется редакцией.';
        return `<a class="ig-card ig-card--interactive top250-row" data-top250-slug="${esc(item.slug)}" href="${esc(gameUrl(item))}" aria-label="Открыть страницу игры ${esc(item.title)}"><strong class="ig-rating top250-rank">${Number(item.rank)}</strong><div class="ig-card__media top250-media">${cover ? `<img src="${esc(cover)}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-cover-index="0">` : `<div class="top250-cover-placeholder">${esc(initials(item.title))}</div>`}</div><div class="ig-card__body top250-copy"><span class="ig-card__title top250-name">${esc(item.title)}</span><p class="top250-summary">${esc(summary)}</p><div class="ig-card__meta top250-meta"><span>${item.year ? esc(item.year) : 'Год уточняется'}</span>${item.score != null ? `<span class="ig-rating">${esc(Number(item.score).toFixed(1))}</span>` : ''}</div></div></a>`;
      }).join('');
      installFallbacks(items);
      await recoverMissingCovers(items);
    })
    .catch(error => {
      list.innerHTML = `<div class="ig-empty-state">Рейтинг временно обновляется. ${esc(error.message)}</div>`;
    });
})();
