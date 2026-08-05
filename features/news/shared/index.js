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
      ? { loading: 'Загружаем новости…', unavailable: 'Новости временно недоступны.', empty: 'По выбранным параметрам новостей нет.', search: 'Найти игру, студию или тему', all: 'Все новости', official: 'От разработчиков' }
      : { loading: 'Loading news…', unavailable: 'News is temporarily unavailable.', empty: 'No news matches the selected filters.', search: 'Search games, studios or topics', all: 'All news', official: 'From developers' };
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

  function deriveTags(item, lang) {
    const body = `${text(item, 'title', lang)} ${text(item, 'summary', lang)}`.toLowerCase();
    const tags = [];
    if (item.game) tags.push(item.game);
    const organization = item.organization || item.publisher || item.sources?.find(source => source.official)?.organization;
    if (organization && organization !== item.game) tags.push(organization);
    const groups = lang === 'ru'
      ? [
          ['Релизы', /релиз|вышел|вышла|выходит|дата выхода|ранн.*доступ|снимут с продажи/],
          ['Обновления', /патч|обновлен|хотфикс|сезон|update|драйвер|перерабатывает/],
          ['Анонсы', /анонс|представил|трейлер|показал|direct/],
          ['DLC', /\bdlc\b|дополнен|expansion/],
          ['Индустрия', /студи|издател|увольнен|закрыт|поглощен|продаж|директор|компания/],
          ['Технологии', /движок|график|видеокарт|драйвер|unreal|unity|oled|желез|\bai\b/],
          ['RPG', /\brpg\b|ролевая|ролевой/],
          ['Стратегии', /стратег|\brts\b/],
          ['Шутеры', /шутер|shoot/],
          ['Симуляторы', /симулятор|simulator/],
          ['Хорроры', /хоррор|horror|silent hill/]
        ]
      : [
          ['Releases', /release|launch|early access/], ['Updates', /patch|update|hotfix|season|driver/], ['Announcements', /announce|trailer|reveal|direct/], ['DLC', /\bdlc\b|expansion/], ['Industry', /studio|publisher|layoff|acquisition|sales|director/], ['Technology', /engine|graphics|gpu|driver|unreal|unity|oled|\bai\b/], ['RPG', /\brpg\b/], ['Strategy', /strategy|\brts\b/], ['Shooters', /shooter/], ['Simulation', /simulator/], ['Horror', /horror/]
        ];
    groups.forEach(([tag, pattern]) => { if (pattern.test(body)) tags.push(tag); });
    if (contentApi.isOfficial(item)) tags.push(labels(lang).official);
    return [...new Set(tags)].slice(0, 5);
  }

  async function loadAll(lang = language(), { force = false } = {}) {
    return contentApi.getAll({ lang, force });
  }

  async function loadHome(lang = language()) {
    return contentApi.getHome({ lang });
  }

  function renderCard(item, { compact = false, lang = language() } = {}) {
    const title = escapeHtml(text(item, 'title', lang));
    const summary = escapeHtml(text(item, 'summary', lang));
    const tags = deriveTags(item, lang);
    return `<a class="ig-card ig-card--interactive ig-news-card${compact ? ' ig-news-card--compact' : ''}" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer" data-news-external>
      <img class="ig-card__media ig-card__media--landscape" src="${escapeHtml(absoluteAsset(item.image))}" alt="${title}" loading="lazy">
      <div class="ig-card__body">
        <div class="ig-card__meta">${escapeHtml(formatters[lang].format(new Date(item.publishedAt)))} · ${escapeHtml(sourceName(item))}</div>
        ${tags.length ? `<div class="ig-chip-list">${tags.map(tag => `<span class="ig-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3 class="ig-card__title">${title}</h3>
        ${compact || !summary ? '' : `<p class="ig-card__summary">${summary}</p>`}
      </div>
    </a>`;
  }

  function setState(target, message, kind = '') {
    if (!target) return;
    target.innerHTML = `<div class="ig-empty-state${kind ? ` ig-empty-state--${escapeHtml(kind)}` : ''}">${escapeHtml(message)}</div>`;
  }

  window.IgropoiskNews = Object.freeze({
    absoluteAsset,
    content: contentApi,
    deriveTags,
    escapeHtml,
    isGlobal,
    labels,
    language,
    loadAll,
    loadHome,
    matchesRegion,
    renderCard,
    score,
    setState,
    text,
    userRegion
  });
})();
