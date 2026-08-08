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

  if (heroContent.querySelector('[data-top250-home-card]')) return;
  heroContent.classList.add('hero-content--with-top250');

  const card = document.createElement('aside');
  card.className = 'ig-card top250-home-preview';
  card.dataset.top250HomeCard = 'true';
  card.setAttribute('aria-label', 'Игропоиск Топ-250');
  card.innerHTML = `
    <div data-top250-home-head>
      <div>
        <div class="ig-kicker top250-home-kicker">Рейтинг Игропоиска</div>
        <a class="ig-card__title top250-home-title" href="${ROOT}top-250/">Топ-250</a>
      </div>
      <div class="ig-control-group" aria-label="Листать рейтинг">
        <button class="ig-icon-button" type="button" data-top250-direction="-1" aria-label="Предыдущие игры">‹</button>
        <button class="ig-icon-button" type="button" data-top250-direction="1" aria-label="Следующие игры">›</button>
      </div>
    </div>
    <div data-top250-home-list aria-live="polite">
      <div class="ig-empty-state top250-home-state">Загружаем рейтинг…</div>
    </div>
    <div data-top250-home-footer>
      <span class="ig-muted top250-home-counter" data-top250-home-counter></span>
      <a class="ig-button top250-home-all" href="${ROOT}top-250/">Весь Топ-250 →</a>
    </div>`;
  heroContent.appendChild(card);

  const list = card.querySelector('[data-top250-home-list]');
  const counter = card.querySelector('[data-top250-home-counter]');
  const pageSize = 4;
  let ranking = [];
  let offset = 0;
  let timer = 0;

  const normalizeImage = image => {
    if (!image) return '';
    if (/^https?:\/\//i.test(image) || image.startsWith('/')) return image;
    return `${ROOT}${image.replace(/^\.\//, '')}`;
  };

  const gameUrl = item => item.game_url || (item.slug ? `${ROOT}game/${encodeURIComponent(item.slug)}/` : `${ROOT}top-250/`);

  const createItem = item => {
    const row = document.createElement('a');
    row.className = 'ig-card ig-card--interactive top250-home-row';
    row.href = gameUrl(item);
    row.setAttribute('aria-label', `${item.rank}. ${item.title} — открыть страницу игры`);

    const rank = document.createElement('span');
    rank.className = 'ig-muted top250-home-rank';
    rank.textContent = String(item.rank);

    const cover = document.createElement('img');
    cover.className = 'ig-card__media top250-home-cover';
    cover.src = normalizeImage(item.image);
    cover.alt = '';
    cover.loading = 'lazy';

    const copy = document.createElement('span');
    copy.className = 'ig-card__body top250-home-copy';
    const name = document.createElement('span');
    name.className = 'ig-card__title top250-home-name';
    name.textContent = item.title || 'Без названия';
    const meta = document.createElement('span');
    meta.className = 'ig-card__meta top250-home-meta';
    if (item.year) {
      const year = document.createElement('span');
      year.textContent = String(item.year);
      meta.appendChild(year);
    }
    if (item.review?.status === 'published') {
      const review = document.createElement('span');
      review.className = 'ig-pill top250-home-review';
      review.textContent = 'есть обзор';
      meta.appendChild(review);
    }
    copy.append(name, meta);

    const arrow = document.createElement('span');
    arrow.className = 'ig-muted top250-home-arrow';
    arrow.textContent = '›';
    arrow.setAttribute('aria-hidden', 'true');

    row.append(rank, cover, copy, arrow);
    return row;
  };

  const render = () => {
    if (!ranking.length) return;
    const items = [];
    for (let index = 0; index < Math.min(pageSize, ranking.length); index += 1) {
      items.push(ranking[(offset + index) % ranking.length]);
    }
    list.replaceChildren(...items.map(createItem));
    const start = offset + 1;
    const end = Math.min(offset + pageSize, ranking.length);
    counter.textContent = `${start}–${end} из ${ranking.length}`;
  };

  const move = direction => {
    if (!ranking.length) return;
    const step = Math.min(pageSize, ranking.length);
    offset = (offset + direction * step + ranking.length) % ranking.length;
    render();
  };

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
  };

  const start = () => {
    stop();
    if (ranking.length > pageSize) timer = window.setInterval(() => move(1), 6500);
  };

  card.querySelectorAll('[data-top250-direction]').forEach(button => {
    button.addEventListener('click', () => {
      move(Number(button.dataset.top250Direction));
      start();
    });
  });
  card.addEventListener('mouseenter', stop);
  card.addEventListener('mouseleave', start);
  card.addEventListener('focusin', stop);
  card.addEventListener('focusout', event => {
    if (!card.contains(event.relatedTarget)) start();
  });

  fetch(`${ROOT}data/top-250/current.json`, { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Top-250 request failed: ${response.status}`);
      return response.json();
    })
    .then(data => {
      ranking = Array.isArray(data.ranking) ? data.ranking.slice(0, 20) : [];
      if (!ranking.length) throw new Error('Top-250 ranking is empty');
      render();
      start();
    })
    .catch(error => {
      console.warn(error);
      list.innerHTML = `<a class="ig-empty-state top250-home-state" href="${ROOT}top-250/">Открыть Топ-250 →</a>`;
      counter.textContent = '';
    });
})();
