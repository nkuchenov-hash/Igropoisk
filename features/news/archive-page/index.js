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
    const pageTitle = root?.querySelector('.ig-page-title');
    if (!api || !model || !root || !toolbar || !feed) return;

    const lang = api.language();
    const copy = api.labels(lang);
    let items = [];
    let activeGame = model.filterFromSearch(window.location.search);
    let activeType = new URLSearchParams(window.location.search).get('type') || '';
    let activeStory = new URLSearchParams(window.location.search).get('story') || '';

    function openArchiveForDirectLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('page') !== 'news' && !params.has('game') && !params.has('story')) return;
      document.querySelector('[data-page="news"]')?.click();
    }

    function updateUrl({ game = activeGame, type = activeType, story = activeStory } = {}) {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'news');
      if (game) url.searchParams.set('game', game); else url.searchParams.delete('game');
      if (type) url.searchParams.set('type', type); else url.searchParams.delete('type');
      if (story) url.searchParams.set('story', story); else url.searchParams.delete('story');
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

    function availableTypes(source) {
      const counts = new Map();
      source.forEach(item => api.deriveTypeTags(item, lang).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }

    function filteredItems() {
      return model.filterByGame(items, activeGame).filter(item => !activeType || api.deriveTypeTags(item, lang).includes(activeType));
    }

    function renderStory() {
      const item = items.find(candidate => String(candidate.id || '') === activeStory);
      if (!item) {
        activeStory = '';
        updateUrl({ story: '' });
        return false;
      }
      toolbar.hidden = true;
      if (pageTitle) pageTitle.hidden = true;
      feed.innerHTML = api.renderStory(item, { lang });
      root.dataset.newsVisibleCount = '1';
      root.dataset.newsDayCount = '0';
      root.dataset.newsView = 'story';
      return true;
    }

    function renderFeed() {
      if (activeStory && renderStory()) return;
      toolbar.hidden = false;
      if (pageTitle) pageTitle.hidden = false;
      root.dataset.newsView = 'archive';
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
      activeStory = '';
      const select = toolbar.querySelector('[data-news-game-filter]');
      if (select) select.value = activeGame;
      updateUrl({ game: activeGame, story: '' });
      renderFeed();
    }

    function setTypeFilter(type) {
      activeType = String(type || '');
      activeStory = '';
      toolbar.querySelectorAll('[data-news-type-filter]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.newsTypeFilter === activeType);
        button.setAttribute('aria-pressed', button.dataset.newsTypeFilter === activeType ? 'true' : 'false');
      });
      updateUrl({ type: activeType, story: '' });
      renderFeed();
    }

    function buildToolbar() {
      const games = availableGames(items);
      const types = availableTypes(items);
      if (activeGame && !games.some(game => game.slug === activeGame)) activeGame = '';
      if (activeType && !types.some(([tag]) => tag === activeType)) activeType = '';
      toolbar.innerHTML = `<div class="ig-filter-list ig-news-controls__types" aria-label="${api.escapeHtml(copy.typeFilter)}">
          <button class="ig-filter-chip${activeType ? '' : ' is-active'}" type="button" data-news-type-filter="" aria-pressed="${activeType ? 'false' : 'true'}">${api.escapeHtml(copy.allTypes)}</button>
          ${types.map(([tag, count]) => `<button class="ig-filter-chip${tag === activeType ? ' is-active' : ''}" type="button" data-news-type-filter="${api.escapeHtml(tag)}" aria-pressed="${tag === activeType ? 'true' : 'false'}">${api.escapeHtml(tag)} <span>${count}</span></button>`).join('')}
        </div>
        <div class="ig-news-controls__game">
          <label class="ig-muted" for="news-game-filter">${api.escapeHtml(copy.gameFilter)}</label>
          <select class="ig-input" id="news-game-filter" data-news-game-filter>
            <option value="">${api.escapeHtml(copy.all)}</option>
            ${games.map(game => `<option value="${api.escapeHtml(game.slug)}"${game.slug === activeGame ? ' selected' : ''}>${api.escapeHtml(game.title)}</option>`).join('')}
          </select>
        </div>`;
      toolbar.querySelector('[data-news-game-filter]').addEventListener('change', event => setGameFilter(event.target.value));
      toolbar.querySelectorAll('[data-news-type-filter]').forEach(button => button.addEventListener('click', () => setTypeFilter(button.dataset.newsTypeFilter || '')));
    }

    root.addEventListener('click', event => {
      const button = event.target.closest('[data-news-game-filter-button]');
      if (!button) return;
      event.preventDefault();
      setGameFilter(button.dataset.newsGameFilterButton || '');
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      activeGame = model.filterFromSearch(window.location.search);
      activeType = params.get('type') || '';
      activeStory = params.get('story') || '';
      buildToolbar();
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
          detail: { count: items.length, game: activeGame, type: activeType, story: activeStory, days: Number(root.dataset.newsDayCount || 0) }
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
