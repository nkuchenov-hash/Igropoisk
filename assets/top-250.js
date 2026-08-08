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

  fetch('/Igropoisk/data/top-250/current.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const items = Array.isArray(data.ranking) ? data.ranking : [];
      const reviews = items.filter(item => item.review?.status === 'published').length;
      if (meta) meta.textContent = `${items.length} позиций опубликовано сейчас. Каждая позиция ведёт на каноническую страницу игры${reviews ? ` · строгих обзоров Игропоиска: ${reviews}` : ''}.`;
      list.innerHTML = items.map(item => {
        const cover = imageUrl(item.image);
        const review = item.review?.status === 'published' ? '<span class="ig-pill">Есть обзор Игропоиска</span>' : '';
        return `<a class="ig-card ig-card--interactive top250-row" href="${esc(gameUrl(item))}" aria-label="Открыть страницу игры ${esc(item.title)}"><strong class="ig-rating top250-rank">${Number(item.rank)}</strong><div class="ig-card__media top250-media">${cover ? `<img src="${esc(cover)}" alt="${esc(item.title)}" loading="lazy" decoding="async">` : ''}</div><div class="ig-card__body top250-copy"><span class="ig-card__title top250-name">${esc(item.title)}</span><div class="ig-card__meta top250-meta"><span class="ig-pill">${item.year ? esc(item.year) : 'Год уточняется'}</span>${item.score != null ? `<span class="ig-pill">Индекс популярности ${esc(item.score)}</span>` : ''}</div></div><div class="top250-state">${review}</div></a>`;
      }).join('');
    })
    .catch(error => {
      list.innerHTML = `<div class="ig-empty-state">Рейтинг временно обновляется. ${esc(error.message)}</div>`;
    });
})();
