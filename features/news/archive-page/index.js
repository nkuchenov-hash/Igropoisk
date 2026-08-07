'use strict';

(() => {
  async function loadModel() {
    if (window.IgropoiskNewsArchiveModel) return window.IgropoiskNewsArchiveModel;
    const current = document.currentScript?.src || document.baseURI;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('model.js', current).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error('News archive model failed to load.'));
      document.head.appendChild(script);
    });
    return window.IgropoiskNewsArchiveModel;
  }

  async function start() {
  const api = window.IgropoiskNews;
  const model = await loadModel();
  const root = document.querySelector('[data-news-module="archive"]');
  const toolbar = root?.querySelector('[data-news-toolbar]');
  const feed = root?.querySelector('[data-news-archive]');
  if (!api || !model || !root || !toolbar || !feed) return;

  const lang = api.language();
  const copy = api.labels(lang);
  let items = [];
  let activeGame = model.filterFromSearch(window.location.search);

  function openArchiveForDirectLink() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') !== 'news' && !params.has('game')) return;
    document.querySelector('[data-page="news"]')?.click();
  }

  function updateUrl(slug) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', 'news');
    if (slug) url.searchParams.set('game', slug);
    else url.searchParams.delete('game');
    window.history.replaceState({}, '', url);
  }

  function availableGames(source) {
    const games = new Map();
    source.forEach(item => api.resolvedGames(item).forEach(game => {
      if (!game.pageExists) return;
      games.set(game.slug, game);
    }));
    return [...games.values()].sort((a, b) => a.title.localeCompare(b.title, lang));
  }

  function filteredItems() {
    const query = (toolbar.querySelector('[data-news-search]')?.value || '').trim().toLowerCase();
    return model.filterByGame(items, activeGame).filter(item => {
      if (!query) return true;
      const gameTitles = api.resolvedGames(item).map(game => game.title).join(' ');
      const haystack = `${api.text(item, 'title', lang)} ${api.text(item, 'summary', lang)} ${gameTitles}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderFeed() {
    const filtered = filteredItems();
    const groups = model.groupByCalendarDay(filtered);
    feed.innerHTML = groups.length
      ? groups.map((group, index) => `<section class="ig-news-day" data-news-day="${api.escapeHtml(group.key)}" aria-labelledby="news-day-${api.escapeHtml(group.key)}">
          <header class="ig-news-day__header">
            <h2 id="news-day-${api.escapeHtml(group.key)}">${api.escapeHtml(model.formatDayHeading(group.key, { currentYear: new Date().getFullYear(), lang }))}</h2>
            <span class="ig-muted">${group.items.length}</span>
          </header>
          <div class="ig-news-day__items">${group.items.map(item => api.renderArchiveItem(item, { lang })).join('')}</div>
          ${index < groups.length - 1 ? '<div class="ig-tabs ig-news-day__divider" aria-hidden="true"></div>' : ''}
        </section>`).join('')
      : `<div class="ig-empty-state">${api.escapeHtml(copy.empty)}</div>`;
    root.dataset.newsVisibleCount = String(filtered.length);
    root.dataset.newsDayCount = String(groups.length);
  }

  function setGameFilter(slug) {
    activeGame = model.normalizeSlug(slug);
    const select = toolbar.querySelector('[data-news-game-filter]');
    if (select) select.value = activeGame;
    updateUrl(activeGame);
    renderFeed();
  }

  function buildToolbar() {
    const games = availableGames(items);
    if (activeGame && !games.some(game => game.slug === activeGame)) activeGame = '';
    toolbar.innerHTML = `<div class="ig-news-controls__search"><input class="ig-input ig-input--search" type="search" data-news-search placeholder="${api.escapeHtml(copy.search)}"></div>
      <div class="ig-news-controls__game">
        <label class="ig-muted" for="news-game-filter">${api.escapeHtml(copy.gameFilter)}</label>
        <select class="ig-input ig-filter-chip" id="news-game-filter" data-news-game-filter>
          <option value="">${api.escapeHtml(copy.all)}</option>
          ${games.map(game => `<option value="${api.escapeHtml(game.slug)}"${game.slug === activeGame ? ' selected' : ''}>${api.escapeHtml(game.title)}</option>`).join('')}
        </select>
      </div>`;

    toolbar.querySelector('[data-news-search]').addEventListener('input', renderFeed);
    toolbar.querySelector('[data-news-game-filter]').addEventListener('change', event => setGameFilter(event.target.value));
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-news-game-filter-button]');
    if (!button) return;
    event.preventDefault();
    setGameFilter(button.dataset.newsGameFilterButton || '');
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  window.addEventListener('popstate', () => {
    activeGame = model.filterFromSearch(window.location.search);
    const select = toolbar.querySelector('[data-news-game-filter]');
    if (select) select.value = activeGame;
    renderFeed();
  });

  async function render() {
    openArchiveForDirectLink();
    api.setState(feed, copy.loading);
    try {
      items = await api.loadAll(lang);
      buildToolbar();
      renderFeed();
      root.dataset.newsStatus = items.length ? 'ready' : 'empty';
      root.dispatchEvent(new CustomEvent('ig:news:archive-ready', {
        detail: { count: items.length, game: activeGame, days: Number(root.dataset.newsDayCount || 0) }
      }));
    } catch (error) {
      console.warn('News archive failed.', error);
      root.dataset.newsStatus = 'error';
      toolbar.innerHTML = '';
      api.setState(feed, copy.unavailable, 'error');
    }
  }

  render();
  }

  start().catch(error => console.warn('News archive bootstrap failed.', error));
})();
