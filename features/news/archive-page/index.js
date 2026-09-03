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
    const ui = lang === 'ru'
      ? {
          search: 'Поиск по новостям',
          viewLabel: 'Вид новостей',
          list: 'Список',
          tile: 'Плитка',
          sortLabel: 'Сортировка новостей',
          important: 'Сначала важные',
          newest: 'Сначала новые',
          featured: 'Главная новость',
          trending: 'Сейчас в тренде',
          popular: 'Популярные темы',
          stats: 'Новости в цифрах',
          total: 'Всего новостей',
          week: 'За неделю',
          sources: 'Источников',
          newsCount: count => `${count} ${count === 1 ? 'новость' : count >= 2 && count <= 4 ? 'новости' : 'новостей'}`,
          activeGame: 'Игра'
        }
      : {
          search: 'Search news',
          viewLabel: 'News view',
          list: 'List',
          tile: 'Grid',
          sortLabel: 'Sort news',
          important: 'Most important',
          newest: 'Newest first',
          featured: 'Top story',
          trending: 'Trending now',
          popular: 'Popular topics',
          stats: 'News by numbers',
          total: 'Total stories',
          week: 'This week',
          sources: 'Sources',
          newsCount: count => `${count} ${count === 1 ? 'story' : 'stories'}`,
          activeGame: 'Game'
        };

    const initialParams = new URLSearchParams(window.location.search);
    let items = [];
    let homeItems = [];
    let activeGame = model.filterFromSearch(window.location.search);
    let activeType = initialParams.get('type') || '';
    let activeStory = initialParams.get('story') || '';
    let activeView = initialParams.get('view') === 'tile' ? 'tile' : 'list';
    let activeSort = initialParams.get('sort') === 'new' ? 'new' : 'important';

    function openArchiveForDirectLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('page') !== 'news' && !params.has('game') && !params.has('story')) return;
      document.querySelector('[data-page="news"]')?.click();
    }

    function updateUrl({
      game = activeGame,
      type = activeType,
      story = activeStory,
      view = activeView,
      sort = activeSort
    } = {}) {
      const url = new URL(window.location.href);
      url.searchParams.set('page', 'news');
      if (game) url.searchParams.set('game', game); else url.searchParams.delete('game');
      if (type) url.searchParams.set('type', type); else url.searchParams.delete('type');
      if (story) url.searchParams.set('story', story); else url.searchParams.delete('story');
      if (view === 'tile') url.searchParams.set('view', 'tile'); else url.searchParams.delete('view');
      if (sort === 'new') url.searchParams.set('sort', 'new'); else url.searchParams.delete('sort');
      window.history.replaceState({}, '', url);
    }

    function availableGames(source) {
      const games = new Map();
      source.forEach(item => api.resolvedGames(item).forEach(game => {
        const current = games.get(game.slug) || { ...game, count: 0 };
        current.count += 1;
        games.set(game.slug, current);
      }));
      return [...games.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, lang));
    }

    function availableTypes(source) {
      const counts = new Map();
      source.forEach(item => api.deriveTypeTags(item, lang).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], lang));
    }

    function queryValue() {
      return (toolbar.querySelector('[data-news-search]')?.value || '').trim().toLocaleLowerCase(lang);
    }

    function filteredItems() {
      const query = queryValue();
      return model.filterByGame(items, activeGame).filter(item => {
        if (activeType && !api.deriveTypeTags(item, lang).includes(activeType)) return false;
        if (!query) return true;
        const gameTitles = api.resolvedGames(item).map(game => game.title).join(' ');
        const typeTags = api.deriveTypeTags(item, lang).join(' ');
        const source = api.sourceName(item);
        const haystack = `${api.text(item, 'title', lang)} ${api.text(item, 'summary', lang)} ${gameTitles} ${typeTags} ${source}`.toLocaleLowerCase(lang);
        return haystack.includes(query);
      }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    function groupItems(source) {
      const groups = model.groupByCalendarDay(source);
      groups.forEach(group => {
        group.items.sort((a, b) => activeSort === 'important'
          ? api.score(b) - api.score(a) || new Date(b.publishedAt) - new Date(a.publishedAt)
          : new Date(b.publishedAt) - new Date(a.publishedAt));
      });
      return groups;
    }

    function pickFeatured(source) {
      if (!source.length || queryValue() || activeGame || activeType) return null;
      const candidates = source.slice(0, 24);
      return activeSort === 'important'
        ? [...candidates].sort((a, b) => api.score(b) - api.score(a) || new Date(b.publishedAt) - new Date(a.publishedAt))[0]
        : candidates[0];
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

    function sidebarMarkup() {
      const games = availableGames(items).slice(0, 5);
      const types = availableTypes(items).slice(0, 8);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekly = items.filter(item => new Date(item.publishedAt).getTime() >= weekAgo).length;
      const sourceCount = new Set(items.map(item => api.sourceName(item)).filter(Boolean)).size;
      const trendRows = games.length
        ? games.map((game, index) => `<button class="ig-button ig-news-trend-row" type="button" data-news-game-filter="${api.escapeHtml(game.slug)}">
            <span class="ig-news-trend-row__rank">${index + 1}</span>
            <span class="ig-news-trend-row__copy"><strong>${api.escapeHtml(game.title)}</strong><small>${api.escapeHtml(ui.newsCount(game.count))}</small></span>
            <span class="ig-news-trend-row__arrow" aria-hidden="true">↗</span>
          </button>`).join('')
        : `<div class="ig-muted">${api.escapeHtml(copy.empty)}</div>`;
      const topicRows = types.length
        ? types.map(([type, count]) => `<button class="ig-filter-chip ig-news-topic-chip${type === activeType ? ' is-active' : ''}" type="button" data-news-type-filter="${api.escapeHtml(type)}" aria-pressed="${type === activeType ? 'true' : 'false'}">#${api.escapeHtml(type)} <span>${count}</span></button>`).join('')
        : '';
      return `<aside class="ig-news-sidebar" aria-label="${api.escapeHtml(lang === 'ru' ? 'Обзор новостей' : 'News overview')}">
        <section class="ig-panel ig-news-side-card">
          <h2 class="ig-news-side-card__title"><span aria-hidden="true">ϟ</span>${api.escapeHtml(ui.trending)}</h2>
          <div class="ig-news-trend-list">${trendRows}</div>
        </section>
        <section class="ig-panel ig-news-side-card">
          <h2 class="ig-news-side-card__title"><span aria-hidden="true">#</span>${api.escapeHtml(ui.popular)}</h2>
          <div class="ig-news-topic-list">${topicRows}</div>
        </section>
        <section class="ig-panel ig-news-side-card">
          <h2 class="ig-news-side-card__title"><span aria-hidden="true">▥</span>${api.escapeHtml(ui.stats)}</h2>
          <div class="ig-news-stats">
            <div><strong>${items.length.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}</strong><span>${api.escapeHtml(ui.total)}</span></div>
            <div><strong>${weekly.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}</strong><span>${api.escapeHtml(ui.week)}</span></div>
            <div><strong>${sourceCount.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}</strong><span>${api.escapeHtml(ui.sources)}</span></div>
          </div>
        </section>
      </aside>`;
    }

    function renderFeed() {
      if (activeStory && renderStory()) return;
      toolbar.hidden = false;
      if (pageTitle) pageTitle.hidden = false;
      root.dataset.newsView = 'archive';
      root.dataset.newsLayout = activeView;
      root.dataset.newsSort = activeSort;

      const filtered = filteredItems();
      const featured = pickFeatured(filtered);
      const remaining = featured ? filtered.filter(item => item !== featured) : filtered;
      const groups = groupItems(remaining);
      const featuredMarkup = featured
        ? `<section class="ig-news-featured" aria-label="${api.escapeHtml(ui.featured)}">
            <span class="ig-news-featured-badge">${api.escapeHtml(ui.featured)}</span>
            ${api.renderArchiveItem(featured, { lang })}
          </section>`
        : '';
      const daysMarkup = groups.length
        ? groups.map((group, index) => `<section class="ig-news-day" data-news-day="${api.escapeHtml(group.key)}" aria-labelledby="news-day-${api.escapeHtml(group.key)}">
            <header class="ig-news-day__header">
              <h2 id="news-day-${api.escapeHtml(group.key)}">${api.escapeHtml(model.formatDayHeading(group.key, { currentYear: new Date().getFullYear(), lang }))}</h2>
              <span class="ig-muted">${group.items.length}</span>
            </header>
            <div class="ig-news-day__items">${group.items.map(item => api.renderArchiveItem(item, { lang })).join('')}</div>
            ${index < groups.length - 1 ? '<div class="ig-tabs ig-news-day__divider" aria-hidden="true"></div>' : ''}
          </section>`).join('')
        : (featured ? '' : `<div class="ig-empty-state">${api.escapeHtml(copy.empty)}</div>`);

      feed.innerHTML = `<div class="ig-news-archive-shell">
        <div class="ig-news-main-column">${featuredMarkup}${daysMarkup}</div>
        ${sidebarMarkup()}
      </div>`;
      root.dataset.newsVisibleCount = String(filtered.length);
      root.dataset.newsDayCount = String(groups.length);
    }

    function setGameFilter(slug) {
      activeGame = model.normalizeSlug(slug);
      activeStory = '';
      updateUrl({ game: activeGame, story: '' });
      buildToolbar();
      renderFeed();
    }

    function setTypeFilter(type) {
      activeType = String(type || '');
      activeStory = '';
      updateUrl({ type: activeType, story: '' });
      buildToolbar();
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

    function setSort(sort) {
      activeSort = sort === 'new' ? 'new' : 'important';
      updateUrl({ sort: activeSort });
      renderFeed();
    }

    function buildToolbar() {
      const games = availableGames(items);
      const types = availableTypes(items);
      if (activeGame && !games.some(game => game.slug === activeGame)) activeGame = '';
      if (activeType && !types.some(([tag]) => tag === activeType)) activeType = '';
      const activeGameTitle = games.find(game => game.slug === activeGame)?.title || activeGame;
      const existingQuery = toolbar.querySelector('[data-news-search]')?.value || '';

      toolbar.innerHTML = `<div class="ig-news-controls__search-primary">
          <input class="ig-input ig-input--search" type="search" data-news-search value="${api.escapeHtml(existingQuery)}" placeholder="${api.escapeHtml(ui.search)}" aria-label="${api.escapeHtml(ui.search)}">
        </div>
        <div class="ig-filter-list ig-news-controls__types" aria-label="${api.escapeHtml(copy.typeFilter)}">
          <button class="ig-filter-chip${activeType ? '' : ' is-active'}" type="button" data-news-type-filter="" aria-pressed="${activeType ? 'false' : 'true'}">${api.escapeHtml(copy.allTypes)} <span>${items.length}</span></button>
          ${types.map(([tag, count]) => `<button class="ig-filter-chip${tag === activeType ? ' is-active' : ''}" type="button" data-news-type-filter="${api.escapeHtml(tag)}" aria-pressed="${tag === activeType ? 'true' : 'false'}">${api.escapeHtml(tag)} <span>${count}</span></button>`).join('')}
        </div>
        <div class="ig-news-controls__secondary">
          <div class="ig-filter-list ig-news-controls__view" aria-label="${api.escapeHtml(ui.viewLabel)}">
            <button class="ig-filter-chip${activeView === 'list' ? ' is-active' : ''}" type="button" data-news-view="list" aria-pressed="${activeView === 'list' ? 'true' : 'false'}">☷ ${api.escapeHtml(ui.list)}</button>
            <button class="ig-filter-chip${activeView === 'tile' ? ' is-active' : ''}" type="button" data-news-view="tile" aria-pressed="${activeView === 'tile' ? 'true' : 'false'}">⊞ ${api.escapeHtml(ui.tile)}</button>
          </div>
          ${activeGame ? `<button class="ig-filter-chip is-active ig-news-active-game" type="button" data-news-clear-game title="${api.escapeHtml(lang === 'ru' ? 'Сбросить фильтр по игре' : 'Clear game filter')}">${api.escapeHtml(ui.activeGame)}: ${api.escapeHtml(activeGameTitle)} ×</button>` : ''}
          <select class="ig-input ig-news-sort" data-news-sort aria-label="${api.escapeHtml(ui.sortLabel)}">
            <option value="important"${activeSort === 'important' ? ' selected' : ''}>${api.escapeHtml(ui.important)}</option>
            <option value="new"${activeSort === 'new' ? ' selected' : ''}>${api.escapeHtml(ui.newest)}</option>
          </select>
        </div>`;

      toolbar.querySelector('[data-news-search]').addEventListener('input', renderFeed);
      toolbar.querySelectorAll('[data-news-type-filter]').forEach(button => button.addEventListener('click', () => setTypeFilter(button.dataset.newsTypeFilter || '')));
      toolbar.querySelectorAll('[data-news-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.newsView || 'list')));
      toolbar.querySelector('[data-news-sort]')?.addEventListener('change', event => setSort(event.target.value));
      toolbar.querySelector('[data-news-clear-game]')?.addEventListener('click', () => setGameFilter(''));
    }

    root.addEventListener('click', event => {
      const gameButton = event.target.closest('[data-news-game-filter]');
      if (gameButton) {
        setGameFilter(gameButton.dataset.newsGameFilter || '');
        return;
      }
      const typeButton = event.target.closest('.ig-news-sidebar [data-news-type-filter]');
      if (typeButton) setTypeFilter(typeButton.dataset.newsTypeFilter || '');
    });

    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      activeGame = model.filterFromSearch(window.location.search);
      activeType = params.get('type') || '';
      activeStory = params.get('story') || '';
      activeView = params.get('view') === 'tile' ? 'tile' : 'list';
      activeSort = params.get('sort') === 'new' ? 'new' : 'important';
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
          detail: {
            count: items.length,
            game: activeGame,
            type: activeType,
            story: activeStory,
            view: activeView,
            sort: activeSort,
            days: Number(root.dataset.newsDayCount || 0)
          }
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
