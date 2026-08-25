'use strict';

(() => {
  const fallbackClass = 'ig-news-media-fallback';

  function markFallback(container, image = null) {
    if (!container) return;
    container.classList.add(fallbackClass);
    if (image) {
      image.hidden = true;
      image.removeAttribute('src');
      image.removeAttribute('srcset');
    }
  }

  function storyHref(container) {
    const link = container.querySelector?.('[data-news-story-link]');
    return link?.href || '';
  }

  function hydrateMissingMedia(root = document) {
    root.querySelectorAll?.('.ig-news-card__story-media').forEach(container => {
      const image = container.querySelector('img');
      if (!image || !image.getAttribute('src')) markFallback(container, image);
    });

    root.querySelectorAll?.('.ig-news-entry').forEach(entry => {
      if (entry.querySelector('.ig-news-entry__media-link')) return;
      const link = document.createElement('a');
      link.className = `ig-card__media ig-news-entry__media-link ${fallbackClass}`;
      link.href = storyHref(entry) || '#';
      link.setAttribute('data-news-story-link', '');
      link.setAttribute('aria-label', 'Изображение новости недоступно');
      entry.insertBefore(link, entry.firstChild);
    });

    root.querySelectorAll?.('.ig-news-story').forEach(story => {
      if (story.querySelector('.ig-news-story__image') || story.querySelector(`.${fallbackClass}.ig-news-story__fallback`)) return;
      const fallback = document.createElement('div');
      fallback.className = `${fallbackClass} ig-news-story__fallback`;
      fallback.setAttribute('aria-label', 'Изображение новости недоступно');
      story.appendChild(fallback);
    });
  }

  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.matches('.ig-news-card img, .ig-news-entry img, .ig-news-story img')) return;
    markFallback(image.parentElement, image);
  }, true);

  let scheduled = false;
  const scheduleHydration = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      hydrateMissingMedia(document);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleHydration, { once: true });
  else scheduleHydration();

  new MutationObserver(scheduleHydration).observe(document.documentElement, { childList: true, subtree: true });
})();
