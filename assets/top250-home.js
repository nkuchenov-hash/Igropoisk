'use strict';

(() => {
  const nav = document.querySelector('.site-nav');
  const heroContent = document.querySelector('#home .hero .hero-content');
  if (!nav || !heroContent) return;

  if (!document.querySelector('link[data-top250-home-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'assets/top250-home.css?v=20260808-1';
    style.dataset.top250HomeStyle = 'true';
    document.head.appendChild(style);
  }

  if (!nav.querySelector('[data-top250-nav]')) {
    const link = document.createElement('a');
    link.href = 'top-250/';
    link.textContent = 'Топ-250';
    link.dataset.top250Nav = 'true';
    const releaseLink = nav.querySelector('[data-ig-release-nav]');
    nav.insertBefore(link, releaseLink || nav.querySelector('[data-page="news"]') || null);
  }

  if (heroContent.querySelector('[data-top250-home-card]')) return;
  heroContent.classList.add('hero-content--with-top250');

  const card = document.createElement('aside');
  card.className = 'top250-home-card';
  card.dataset.top250HomeCard = 'true';
  card.setAttribute('aria-label', 'Игропоиск Топ-250');
  card.innerHTML = `
    <div class="top250-home-card__head">
      <div>
        <div class="top250-home-card__kicker">Рейтинг Игропоиска</div>
        <a class="top250-home-card__title" href="top-250/">Топ-250</a>
      </div>
      <div class="top250-home-card__controls" aria-label="Листать рейтинг">
        <button class="top250-home-card__control" type="button" data-top250-direction="-1" aria-label="Предыдущие игры">‹</button>
        <button class="top250-home-card__control" type="button" data-top250-direction="1" aria-label="Следующие игры">›</button>
      </div>
    </div>
    <div class="top250-home-card__list" data-top250-home-list aria-live="polite">
      <div class="top250-home-card__state">Загружаем рейтинг…</div>
    </div>
    <div class="top250-home-card__footer">
      <span class="top250-home-card__counter" data-top250-home-counter></span>
      <a class="top250-home-card__all" href="top-250/">Весь Топ-250 →</a>
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
    return image.replace(/^\.\//, '');
  };

  const createItem = item => {
    const row = document.createElement('a');
    row.className = 'top250-home-card__item';
    row.href = 'top-250/';
    row.setAttribute('aria-label', `${item.rank}. ${item.title} — открыть Топ-250`);

    const rank = document.createElement('span');
    rank.className = 'top250-home-card__rank';
    rank.textContent = String(item.rank);

    const cover = document.createElement('img');
    cover.className = 'top250-home-card__cover';
    cover.src = normalizeImage(item.image);
    cover.alt = '';
    cover.loading = 'lazy';

    const copy = document.createElement('span');
    copy.className = 'top250-home-card__copy';
    const name = document.createElement('span');
    name.className = 'top250-home-card__name';
    name.textContent = item.title || 'Без названия';
    const meta = document.createElement('span');
    meta.className = 'top250-home-card__meta';
    if (item.year) {
      const year = document.createElement('span');
      year.textContent = String(item.year);
      meta.appendChild(year);
    }
    if (item.review?.status === 'published') {
      const review = document.createElement('span');
      review.className = 'top250-home-card__review';
      review.textContent = 'есть обзор';
      meta.appendChild(review);
    }
    copy.append(name, meta);

    const arrow = document.createElement('span');
    arrow.className = 'top250-home-card__arrow';
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

  fetch('data/top-250/current.json', { cache: 'no-store' })
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
      list.innerHTML = '<a class="top250-home-card__state" href="top-250/">Открыть Топ-250 →</a>';
      counter.textContent = '';
    });
})();
