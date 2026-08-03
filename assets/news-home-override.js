'use strict';

(() => {
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

  function tags(item) {
    const text = `${item.titleRu || ''} ${item.summaryRu || ''}`.toLowerCase();
    const result = [];
    if (/релиз|выйдет|ранн.*доступ/.test(text)) result.push('Релизы');
    if (/обновлен|патч|сезон|переработ/.test(text)) result.push('Обновления');
    if (/анонс|direct|представ/.test(text)) result.push('Анонсы');
    if (/dlc|дополнен/.test(text)) result.push('DLC');
    if (/монитор|oled|технолог/.test(text)) result.push('Технологии');
    if (/rpg|ролевая/.test(text)) result.push('RPG');
    if (/стратег/.test(text)) result.push('Стратегии');
    if (/silent hill/.test(text)) result.push('Хорроры');
    return [...new Set(result)].slice(0, 3);
  }

  function card(item) {
    const chips = tags(item);
    return `<a class="card news-card news-event-card" href="${escapeHtml(item.primaryUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.titleRu)}" loading="lazy">
      <div class="card-body">
        <div class="date">${escapeHtml(formatter.format(new Date(item.publishedAt)))} · ${escapeHtml(item.primarySource || '')}</div>
        ${chips.length ? `<div class="news-card__tags">${chips.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <h3>${escapeHtml(item.titleRu)}</h3>
      </div>
    </a>`;
  }

  async function render() {
    const target = document.querySelector('#homeNews');
    if (!target || !document.documentElement.lang.toLowerCase().startsWith('ru')) return;
    try {
      const response = await fetch(`data/news-home-ru.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const items = (payload.items || []).slice(0, 12);
      if (items.length !== 12) return;
      target.innerHTML = items.map(card).join('');
    } catch (error) {
      console.warn('Curated home news feed unavailable.', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(render, 1200);
      setTimeout(render, 3000);
    }, { once: true });
  } else {
    setTimeout(render, 1200);
    setTimeout(render, 3000);
  }
})();
