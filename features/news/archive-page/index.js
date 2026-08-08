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
    const viewCopy = lang === 'ru'
      ? { label: 'Вид новостей', list: 'Список', tile: 'Плитка' }
      : { label: 'News view', list: 'List', tile: 'Grid' };
    const initialParams = new URLSearchParams(window.location.search);
    let items = [];
    let homeItems = [];
    let activeGame = model.filterFromSearch(window.location.search);
    let activeType = initialParams.get('type') || '';
    let activeStory = initialParams.get('story') || '';
    let activeView = initialParams.get('view') === 'tile' ? 'tile' : 'list';

    function openArchiveForDirectLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('page') !== 'news' && !params.has('game') && !params.has('story')) return;
      document.querySelector('[data-page="news"]')?.click();
    }

    function updateUrl({ game = activeGame, type = activeType, story = activeStory, view = activeView } = {}) {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'news');
      if (game) url.searchParams.set('game', game); else url.searchParams.delete('game');
      if (type) url.searchParams.set('type', type); else url.searchParams.delete('type');
      if (story) url.searchParams.set('story', story); else url.searchParams.delete('story');
      if (view === 'tile') url.searchParams.set('view', 'tile'); else url.searchParams.delete('view');
      window.history.replaceState({}, '', url);
    }

    function gameFilterUrl(slug) {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'news');
      url.searchParams.set('game', slug);
      url.searchParams.delete('story');
      return url.href;
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
      const query = (toolbar.querySelector('[data-news-search]')?.value || '').trim().toLocaleLowerCase(lang);
      return model.filterByGame(items, activeGame).filter(item => {
        if (activeType && !api.deriveTypeTags(item, lang).includes(activeType)) return false;
        if (!query) return true;
        const gameTitles = api.resolvedGames(item).map(game => game.title).join(' ');
        const haystack = `${api.text(item, 'title', lang)} ${api.text(item, 'summary', lang)} ${gameTitles}`.toLocaleLowerCase(lang);
        return haystack.includes(query);
      });
    }

    function renderStory() {
      const item = [...items, ...homeItems].find(candidate => String(candidate.id || '') === activeStory);
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
      root.dataset.newsLayout = activeView;
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

    function hideGameSuggestions() {
      const panel = toolbar.querySelector('[data-news-game-suggestions]');
      const input = toolbar.querySelector('[data-news-game-search]');
      if (panel) panel.hidden = true;
      if (input) input.setAttribute('aria-expanded', 'false');
    }

    function renderGameSuggestions(query) {
      const panel = toolbar.querySelector('[data-news-game-suggestions]');
      const input = toolbar.querySelector('[data-news-game-search]');
      if (!panel || !input) return;
      const needle = String(query || '').trim().toLocaleLowerCase(lang);
      if (!needle) {
        hideGameSuggestions();
        return;
      }
      const games = availableGames(items);
      const matches = games
        .map(game => ({ game, title: game.title.toLocaleLowerCase(lang) }))
        .filter(({ title }) => title.includes(needle))
        .sort((a, b) => Number(b.title.startsWith(needle)) - Number(a.title.startsWith(needle)) || a.game.title.localeCompare(b.game.title, lang))
        .slice(0, 7)
        .map(({ game }) => game);
      panel.innerHTML = matches.map(game => `<a class="ig-button ig-text-link ig-news-game-suggestion" role="option" href="${api.escapeHtml(gameFilterUrl(game.slug))}" data-news-game-suggestion="${api.escapeHtml(game.slug)}">${api.escapeHtml(game.title)}</a>`).join('');
      panel.hidden = matches.length === 0;
      input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
    }

    function setGameFilter(slug) {
      activeGame = model.normalizeSlug(slug);
      activeStory = '';
      const games = availableGames(items);
      const input = toolbar.querySelector('[data-news-game-search]');
      const selected = games.find(game => game.slug === activeGame);
      if (input) input.value = selected?.title || '';
      hideGameSuggestions();
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

    function setView(view) {
      activeView = view === 'tile' ? 'tile' : 'list';
      toolbar.querySelectorAll('[data-news-view]').forEach(button => {
        const selected = button.dataset.newsView === activeView;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      updateUrl({ view: activeView });
      renderFeed();
    }

    function buildToolbar() {
      const games = availableGames(items);
      const types = availableTypes(items);
      if (activeGame && !games.some(game => game.slug === activeGame)) activeGame = '';
      if (activeType && !types.some(([tag]) => tag === activeType)) activeType = '';
      const activeGameTitle = games.find(game => game.slug === activeGame)?.title || '';
      toolbar.innerHTML = `<div class="ig-news-controls__game-search">
          <label class="ig-muted" for="news-game-search">${api.escapeHtml(copy.gameFilter)}</label>
          <div class="ig-news-game-search">
            <input class="ig-input ig-input--search" id="news-game-search" type="search" data-news-game-search value="${api.escapeHtml(activeGameTitle)}" placeholder="${api.escapeHtml(copy.gameSearchPlaceholder)}" autocomplete="off" aria-autocomplete="list" aria-controls="news-game-suggestions" aria-expanded="false">
            <div class="ig-panel ig-news__game-suggestions" id="news-game-suggestions" data-news-game-suggestions role="listbox" hidden></div>
          </div>
        </div>
        <div class="ig-filter-list ig-news-controls__types" aria-label="${api.escapeHtml(copy.typeFilter)}">
          <button class="ig-filter-chip${activeType ? '' : ' is-active'}" type="button" data-news-type-filter="" aria-pressed="${activeType ? 'false' : 'true'}">${api.escapeHtml(copy.allTypes)}</button>
          ${types.map(([tag, count]) => `<button class="ig-filter-chip${tag === activeType ? ' is-active' : ''}" type="button" data-news-type-filter="${api.escapeHtml(tag)}" aria-pressed="${tag === activeType ? 'true' : 'false'}">${api.escapeHtml(tag)} <span>${count}</span></button>`).join('')}
        </div>
        <div class="ig-news-controls__secondary">
          <div class="ig-filter-list ig-news-controls__view" aria-label="${api.escapeHtml(viewCopy.label)}">
            <button class="ig-filter-chip${activeView === 'list' ? ' is-active' : ''}" type="button" data-news-view="list" aria-pressed="${activeView === 'list' ? 'true' : 'false'}">${api.escapeHtml(viewCopy.list)}</button>
            <button class="ig-filter-chip${activeView === 'tile' ? ' is-active' : ''}" type="button" data-news-view="tile" aria-pressed="${activeView === 'tile' ? 'true' : 'false'}">${api.escapeHtml(viewCopy.tile)}</button>
          </div>
          <div class="ig-news-controls__search"><input class="ig-input ig-input--search" type="search" data-news-search placeholder="${api.escapeHtml(copy.search)}"></div>
        </div>`;

      const gameSearch = toolbar.querySelector('[data-news-game-search]');
      gameSearch.addEventListener('input', event => {
        const value = event.target.value;
        if (!value.trim() && activeGame) {
          activeGame = '';
          activeStory = '';
          updateUrl({ game: '', story: '' });
          renderFeed();
        }
        renderGameSuggestions(value);
      });
      gameSearch.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          hideGameSuggestions();
          return;
        }
        if (event.key === 'Enter') {
          const first = toolbar.querySelector('[data-news-game-suggestion]');
          if (!first) return;
          event.preventDefault();
          setGameFilter(first.dataset.newsGameSuggestion || '');
        }
      });
      toolbar.querySelector('[data-news-search]').addEventListener('input', renderFeed);
      toolbar.querySelectorAll('[data-news-type-filter]').forEach(button => button.addEventListener('click', () => setTypeFilter(button.dataset.newsTypeFilter || '')));
      toolbar.querySelectorAll('[data-news-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.newsView || 'list')));
    }

    root.addEventListener('click', event => {
      const suggestion = event.target.closest('[data-news-game-suggestion]');
      if (!suggestion) return;
      event.preventDefault();
      setGameFilter(suggestion.dataset.newsGameSuggestion || '');
    });

    document.addEventListener('click', event => {
      if (!toolbar.contains(event.target)) hideGameSuggestions();
    });

    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      activeGame = model.filterFromSearch(window.location.search);
      activeType = params.get('type') || '';
      activeStory = params.get('story') || '';
      activeView = params.get('view') === 'tile' ? 'tile' : 'list';
      buildToolbar();
      renderFeed();
    });

    async function render() {
      openArchiveForDirectLink();
      api.setState(feed, copy.loading);
      try {
        items = await api.loadAll(lang);
        homeItems = activeStory ? await api.loadHome(lang).catch(() => []) : [];
        buildToolbar();
        renderFeed();
        root.dataset.newsStatus = items.length ? 'ready' : 'empty';
        root.dispatchEvent(new CustomEvent('ig:news:archive-ready', {
          detail: { count: items.length, game: activeGame, type: activeType, story: activeStory, view: activeView, days: Number(root.dataset.newsDayCount || 0) }
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
