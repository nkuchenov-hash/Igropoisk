'use strict';

(() => {
  const api = window.IgropoiskNews;
  const root = document.querySelector('[data-news-module="archive"]');
  const toolbar = root?.querySelector('[data-news-toolbar]');
  const grid = root?.querySelector('[data-news-archive]');
  if (!api || !root || !toolbar || !grid) return;

  const lang = api.language();
  const copy = api.labels(lang);
  let items = [];
  let activeTag = '';

  function sorted(source) {
    const region = api.userRegion();
    return [...source].sort((a, b) => api.score(b, region) - api.score(a, region)
      || new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  function renderGrid() {
    const query = (toolbar.querySelector('[data-news-search]')?.value || '').trim().toLowerCase();
    const filtered = sorted(items.filter(item => {
      const tags = api.deriveTags(item, lang);
      if (activeTag && !tags.includes(activeTag)) return false;
      const haystack = `${api.text(item, 'title', lang)} ${api.text(item, 'summary', lang)} ${tags.join(' ')}`.toLowerCase();
      return !query || haystack.includes(query);
    }));
    grid.innerHTML = filtered.length
      ? filtered.map(item => api.renderCard(item, { compact: false, lang })).join('')
      : `<div class="ig-empty-state">${api.escapeHtml(copy.empty)}</div>`;
    root.dataset.newsVisibleCount = String(filtered.length);
  }

  function buildToolbar() {
    const frequencies = new Map();
    items.flatMap(item => api.deriveTags(item, lang))
      .forEach(tag => frequencies.set(tag, (frequencies.get(tag) || 0) + 1));
    const tags = [...frequencies]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], lang))
      .slice(0, 18)
      .map(([tag]) => tag);

    toolbar.innerHTML = `<div><input class="ig-input ig-input--search" type="search" data-news-search placeholder="${api.escapeHtml(copy.search)}"></div>
      <div class="ig-filter-list"><button class="ig-filter-chip is-active" type="button" data-news-tag="">${api.escapeHtml(copy.all)}</button>${tags.map(tag => `<button class="ig-filter-chip" type="button" data-news-tag="${api.escapeHtml(tag)}">${api.escapeHtml(tag)}</button>`).join('')}</div>`;

    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-news-tag]');
      if (!button) return;
      activeTag = button.dataset.newsTag || '';
      toolbar.querySelectorAll('[data-news-tag]')
        .forEach(candidate => candidate.classList.toggle('is-active', candidate === button));
      renderGrid();
    });
    toolbar.querySelector('[data-news-search]').addEventListener('input', renderGrid);
  }

  async function render() {
    api.setState(grid, copy.loading);
    try {
      items = await api.loadAll(lang);
      buildToolbar();
      renderGrid();
      root.dataset.newsStatus = items.length ? 'ready' : 'empty';
      root.dispatchEvent(new CustomEvent('ig:news:archive-ready', { detail: { count: items.length } }));
    } catch (error) {
      console.warn('News archive failed.', error);
      root.dataset.newsStatus = 'error';
      toolbar.innerHTML = '';
      api.setState(grid, copy.unavailable, 'error');
    }
  }

  render();
})();
