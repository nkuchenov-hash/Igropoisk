(() => {
  const list = document.querySelector('[data-top250-list]');
  const meta = document.querySelector('[data-top250-meta]');
  if (!list) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const imageUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw;
    return `../${raw.replace(/^\.\//, '')}`;
  };
  const reviewLabel = status => status === 'published' ? 'Обзор Игропоиска' : status === 'ready_to_render' ? 'Обзор готовится' : 'Обзор в очереди';

  fetch('../data/top-250/current.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const items = Array.isArray(data.ranking) ? data.ranking : [];
      const reviews = items.filter(item => item.review?.status === 'published').length;
      if (meta) meta.textContent = `Сейчас опубликованы первые ${items.length} позиций рейтинга · обзоров Игропоиска: ${reviews}`;
      list.innerHTML = items.map(item => {
        const cover = imageUrl(item.image);
        const title = esc(item.title);
        const gameTitle = item.game_url ? `<a class="top250-title" href="${esc(item.game_url)}">${title}</a>` : `<span class="top250-title">${title}</span>`;
        const review = item.review?.url
          ? `<a class="top250-review top250-review--ready" href="${esc(item.review.url)}">${reviewLabel(item.review.status)}</a>`
          : `<span class="top250-review">${reviewLabel(item.review?.status)}</span>`;
        return `<article class="top250-row"><div class="top250-rank">${Number(item.rank)}</div><div class="top250-cover">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : ''}</div><div class="top250-main">${gameTitle}<div class="top250-sub">${item.year ? esc(item.year) : 'Год уточняется'}${item.score != null ? ` · популярность ${esc(item.score)}` : ''}</div></div><div class="top250-status">${review}</div></article>`;
      }).join('');
    })
    .catch(error => {
      list.innerHTML = `<div class="top250-error">Рейтинг временно обновляется. ${esc(error.message)}</div>`;
    });
})();
