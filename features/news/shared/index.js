'use strict';

(() => {
  const contentApi = window.IgropoiskNewsContent;
  if (!contentApi) {
    console.error('News Content API is not loaded.');
    return;
  }

  const scriptUrl = document.currentScript?.src || document.baseURI;
  const siteBase = new URL('../../../', scriptUrl);
  const formatters = {
    ru: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }),
    en: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
  };
  const timeFormatters = new Map();

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const absoluteAsset = path => new URL(path, siteBase).href;

  function language() {
    return contentApi.language();
  }

  function labels(lang) {
    return lang === 'ru'
      ? {
          loading: 'Загружаем новости…',
          unavailable: 'Новости временно недоступны.',
          empty: 'По выбранным параметрам новостей нет.',
          search: 'Поиск по заголовку или тексту',
          all: 'Все игры',
          allTypes: 'Все темы',
          allNews: 'Все новости',
          official: 'От разработчиков',
          gameFilter: 'Игра',
          typeFilter: 'Темы новостей',
          allNewsAboutGame: 'Все новости об игре',
          openGame: 'Открыть страницу игры',
          backToNews: '← Все новости',
          source: 'Источник'
        }
      : {
          loading: 'Loading news…',
          unavailable: 'News is temporarily unavailable.',
          empty: 'No news matches the selected filters.',
          search: 'Search headlines or summaries',
          all: 'All games',
          allTypes: 'All topics',
          allNews: 'All news',
          official: 'From developers',
          gameFilter: 'Game',
          typeFilter: 'News topics',
          allNewsAboutGame: 'All news about this game',
          openGame: 'Open game page',
          backToNews: '← All news',
          source: 'Source'
        };
  }

  function text(item, field, lang) {
    return contentApi.text(item, field, lang);
  }

  function userRegion() {
    return contentApi.userRegion();
  }

  function isGlobal(item) {
    return contentApi.isGlobal(item);
  }

  function matchesRegion(item, region = userRegion()) {
    return contentApi.matchesRegion(item, region);
  }

  function score(item, region = userRegion()) {
    return contentApi.score(item, region);
  }

  function sourceName(item) {
    return contentApi.sourceName(item);
  }

  function resolvedGames(item) {
    const source = Array.isArray(item?.games) ? item.games : [];
    const seen = new Set();
    return source.flatMap(game => {
      const normalized = typeof game === 'string' ? { slug: game, title: game } : game;
      const slug = String(normalized?.slug || '').trim().toLowerCase();
      if (!slug || seen.has(slug)) return [];
      seen.add(slug);
      return [{
        slug,
        title: String(normalized?.title || slug),
        pageExists: normalized?.pageExists !== false && Boolean(normalized?.pageUrl),
        pageUrl: normalized?.pageExists !== false && normalized?.pageUrl ? String(normalized.pageUrl) : '',
        manual: Boolean(normalized?.manual)
      }];
    });
  }

  function typeDefinitions(lang) {
    return lang === 'ru'
      ? [
          ['Релизы', /релиз|вышел|вышла|выходит|дата выхода|ранн.*доступ|снимут с продажи/],
          ['Обновления', /патч|обновлен|хотфикс|сезон|update|драйвер|перерабатывает/],
          ['Анонсы', /анонс|представил|трейлер|показал|direct/],
          ['DLC', /\bdlc\b|дополнен|expansion/],
          ['Индустрия', /студи|издател|увольнен|закрыт|поглощен|продаж|директор|компания/],
          ['Технологии', /движок|график|видеокарт|драйвер|unreal|unity|oled|желез|\bai\b/]
        ]
      : [
          ['Releases', /release|launch|early access/],
          ['Updates', /patch|update|hotfix|season|driver/],
          ['Announcements', /announce|trailer|reveal|direct/],
          ['DLC', /\bdlc\b|expansion/],
          ['Industry', /studio|publisher|layoff|acquisition|sales|director/],
          ['Technology', /engine|graphics|gpu|driver|unreal|unity|oled|\bai\b/]
        ];
  }

  function deriveTypeTags(item, lang = language()) {
    const body = `${text(item, 'title', lang)} ${text(item, 'summary', lang)}`.toLowerCase();
    const tags = typeDefinitions(lang).flatMap(([tag, pattern]) => pattern.test(body) ? [tag] : []);
    if (contentApi.isOfficial(item)) tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 3);
  }

  function deriveTags(item, lang) {
    const body = `${text(item, 'title', lang)} ${text(item, 'summary', lang)}`.toLowerCase();
    const tags = resolvedGames(item).map(game => game.title);
    const organization = item.organization || item.publisher || item.sources?.find(source => source.official)?.organization;
    if (organization && !tags.includes(organization)) tags.push(organization);
    typeDefinitions(lang).forEach(([tag, pattern]) => { if (pattern.test(body)) tags.push(tag); });
    const genres = lang === 'ru'
      ? [
          ['RPG', /\brpg\b|ролевая|ролевой/],
          ['Стратегии', /стратег|\brts\b/],
          ['Шутеры', /шутер|shoot/],
          ['Симуляторы', /симулятор|simulator/],
          ['Хорроры', /хоррор|horror|silent hill/]
        ]
      : [
          ['RPG', /\brpg\b/], ['Strategy', /strategy|\brts\b/], ['Shooters', /shooter/], ['Simulation', /simulator/], ['Horror', /horror/]
        ];
    genres.forEach(([tag, pattern]) => { if (pattern.test(body)) tags.push(tag); });
    if (contentApi.isOfficial(item)) tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 5);
  }

  async function loadAll(lang = language(), { force = false } = {}) {
    return contentApi.getAll({ lang, force });
  }

  async function loadHome(lang = language()) {
    return contentApi.getHome({ lang });
  }

  function storyUrl(item) {
    const url = new URL(siteBase.href);
    url.searchParams.set('page', 'news');
    url.searchParams.set('story', String(item?.id || ''));
    return url.href;
  }

  function renderCard(item, { compact = false, lang = language() } = {}) {
    const title = escapeHtml(text(item, 'title', lang));
    const summary = escapeHtml(text(item, 'summary', lang));
    const tags = deriveTypeTags(item, lang);
    return `<a class="ig-card ig-card--interactive ig-news-card${compact ? ' ig-news-card--compact' : ''}" href="${escapeHtml(storyUrl(item))}" data-news-story-link>
      <img class="ig-card__media ig-card__media--landscape" src="${escapeHtml(absoluteAsset(item.image))}" alt="${title}" loading="lazy">
      <div class="ig-card__body">
        ${tags.length ? `<div class="ig-chip-list">${tags.map(tag => `<span class="ig-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3 class="ig-card__title">${title}</h3>
        ${compact || !summary ? '' : `<p class="ig-card__summary">${summary}</p>`}
        <div class="ig-card__meta">${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · ${escapeHtml(sourceName(item))}</div>
      </div>
    </a>`;
  }

  function publicationTime(item, lang = language()) {
    if (item?.publishedLocalTime && /^\d{1,2}:\d{2}$/.test(item.publishedLocalTime)) return item.publishedLocalTime;
    const timeZone = item?.publicationTimeZone || 'Europe/Moscow';
    const key = `${lang}:${timeZone}`;
    if (!timeFormatters.has(key)) {
      try {
        timeFormatters.set(key, new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone
        }));
      } catch {
        timeFormatters.set(key, new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'UTC'
        }));
      }
    }
    return timeFormatters.get(key).format(new Date(item.publishedAt));
  }

  function renderGameTags(item, { lang = language() } = {}) {
    const copy = labels(lang);
    return resolvedGames(item).map(game => {
      const title = escapeHtml(game.title);
      if (!game.pageExists) return `<span class="ig-chip ig-news-game-tag ig-news-game-unlinked" title="${escapeHtml(lang === 'ru' ? 'Страница игры ещё не создана' : 'Game page is not available yet')}">${title}</span>`;
      const pageUrl = escapeHtml(new URL(game.pageUrl, siteBase).href);
      return `<span class="ig-chip ig-news-game-tag" data-news-game-tag="${escapeHtml(game.slug)}">
        <a class="ig-news-game-link" href="${pageUrl}" title="${escapeHtml(copy.openGame)}">${title}</a>
        <button class="ig-icon-button ig-news-game-filter" type="button" data-news-game-filter-button="${escapeHtml(game.slug)}" aria-label="${escapeHtml(`${copy.allNewsAboutGame}: ${game.title}`)}">⌕</button>
      </span>`;
    }).join('');
  }

  function renderArchiveItem(item, { lang = language() } = {}) {
    const title = escapeHtml(text(item, 'title', lang));
    const summary = escapeHtml(text(item, 'summary', lang));
    const games = renderGameTags(item, { lang });
    const types = deriveTypeTags(item, lang);
    const image = item.image ? `<img class="ig-card__media ig-card__media--landscape ig-news-entry__image" src="${escapeHtml(absoluteAsset(item.image))}" alt="" loading="lazy">` : '';
    return `<article class="ig-card ig-news-entry ig-news-card" data-news-id="${escapeHtml(item.id || '')}">
      ${image}
      <div class="ig-card__body ig-news-entry__body">
        ${types.length ? `<div class="ig-chip-list ig-news-entry__types">${types.map(tag => `<span class="ig-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3 class="ig-card__title ig-news-entry__title"><a href="${escapeHtml(storyUrl(item))}" data-news-story-link>${title}</a></h3>
        ${summary ? `<p class="ig-card__summary ig-news-entry__summary">${summary}</p>` : ''}
        <div class="ig-card__meta"><time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(publicationTime(item, lang))}</time> · ${escapeHtml(sourceName(item))}</div>
        ${games ? `<div class="ig-chip-list ig-news-entry__games">${games}</div>` : ''}
      </div>
    </article>`;
  }

  function renderStory(item, { lang = language() } = {}) {
    const copy = labels(lang);
    const title = escapeHtml(text(item, 'title', lang));
    const summary = escapeHtml(text(item, 'summary', lang));
    const types = deriveTypeTags(item, lang);
    const games = renderGameTags(item, { lang });
    const source = escapeHtml(sourceName(item));
    const sourceUrl = escapeHtml(item.primaryUrl || '');
    const date = escapeHtml(formatters[lang].format(new Date(item.publishedAt)));
    const image = item.image ? `<img class="ig-card__media ig-card__media--landscape ig-news-story__image" src="${escapeHtml(absoluteAsset(item.image))}" alt="${title}" loading="lazy">` : '';
    return `<article class="ig-panel ig-news-story" data-news-story="${escapeHtml(item.id || '')}">
      <a class="ig-button ig-news-story__back" href="${escapeHtml(new URL('?page=news', siteBase).href)}">${escapeHtml(copy.backToNews)}</a>
      <h1 class="ig-page-title ig-news-story__title">${title}</h1>
      ${summary ? `<p class="article-lead ig-news-story__lead">${summary}</p>` : ''}
      <div class="ig-news-story__meta"><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.source)}: ${source} ↗</a><span>·</span><span>${date}</span></div>
      ${types.length ? `<div class="ig-chip-list ig-news-story__types">${types.map(tag => `<span class="ig-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${games ? `<div class="ig-chip-list ig-news-story__games">${games}</div>` : ''}
      ${image}
    </article>`;
  }

  function setState(target, message, kind = '') {
    if (!target) return;
    target.innerHTML = `<div class="ig-empty-state${kind ? ` ig-empty-state--${escapeHtml(kind)}` : ''}">${escapeHtml(message)}</div>`;
  }

  window.IgropoiskNews = Object.freeze({
    absoluteAsset,
    content: contentApi,
    deriveTags,
    deriveTypeTags,
    escapeHtml,
    isGlobal,
    labels,
    language,
    loadAll,
    loadHome,
    matchesRegion,
    publicationTime,
    renderArchiveItem,
    renderCard,
    renderGameTags,
    renderStory,
    resolvedGames,
    score,
    setState,
    sourceName,
    storyUrl,
    text,
    userRegion
  });
})();
