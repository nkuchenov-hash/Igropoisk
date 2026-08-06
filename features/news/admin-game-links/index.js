'use strict';

(() => {
  const root = document.querySelector('[data-news-game-review-admin]');
  if (!root) return;

  const scriptUrl = document.currentScript?.src || document.baseURI;
  const siteBase = new URL('../../../', scriptUrl);
  const storageKey = 'igropoisk.news-game-overrides.draft.v1';
  const list = root.querySelector('[data-news-game-review-list]');
  const status = root.querySelector('[data-news-game-review-status]');
  const saveButton = root.querySelector('[data-news-game-review-save]');
  const exportButton = root.querySelector('[data-news-game-review-export]');
  const resetButton = root.querySelector('[data-news-game-review-reset]');
  let catalog = [];
  let review = [];
  let overrides = { schemaVersion: 1, updatedAt: null, items: {} };

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(new URL(path, siteBase), { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status}`);
      return response.json();
    } catch (error) {
      console.warn(`Cannot load ${path}.`, error);
      return fallback;
    }
  }

  function localDraft() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || 'null');
    } catch {
      return null;
    }
  }

  function selectedGames(itemId) {
    return new Set((overrides.items?.[itemId]?.games || []).map(String));
  }

  function render() {
    if (!review.length) {
      list.innerHTML = '<div class="parser-note">Неоднозначных или непривязанных новостей сейчас нет.</div>';
      status.textContent = 'Очередь проверки пуста.';
      return;
    }
    list.innerHTML = review.map(item => {
      const selected = selectedGames(item.id);
      const candidateText = (item.candidates || []).map(candidate => `${candidate.name}: ${candidate.reason}`).join('; ');
      return `<article class="parser-preview" data-news-review-item="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.titleRu || item.titleEn || item.id)}</strong>
        <small>${escapeHtml(item.publishedAt || '')}</small>
        <p>${escapeHtml(candidateText || (item.reasons || []).join(', ') || 'Требуется редакционная проверка')}</p>
        <label>Канонические игры
          <select class="ig-button" multiple size="5" data-news-review-games>
            ${catalog.map(game => `<option value="${escapeHtml(game.slug)}"${selected.has(game.slug) ? ' selected' : ''}>${escapeHtml(game.title)}</option>`).join('')}
          </select>
        </label>
        <label><input type="checkbox" data-news-review-no-game${overrides.items?.[item.id]?.status === 'no-game' ? ' checked' : ''}> Подтвердить, что игра не определена</label>
        <div class="source-actions">
          <a class="ig-button" href="${escapeHtml(item.primaryUrl || '#')}" target="_blank" rel="noopener noreferrer">Открыть источник</a>
          <a class="ig-button" href="../game-data/?news=${encodeURIComponent(item.id)}">Создать или привязать страницу игры</a>
        </div>
      </article>`;
    }).join('');
    status.textContent = `На проверке: ${review.length}. Изменения сохраняются в черновике и экспортируются в data/news-game-overrides.json.`;
  }

  function collect() {
    const items = { ...(overrides.items || {}) };
    root.querySelectorAll('[data-news-review-item]').forEach(card => {
      const id = card.dataset.newsReviewItem;
      const games = [...card.querySelector('[data-news-review-games]').selectedOptions].map(option => option.value);
      const noGame = card.querySelector('[data-news-review-no-game]').checked;
      if (!games.length && !noGame) {
        delete items[id];
        return;
      }
      items[id] = {
        games,
        status: noGame ? 'no-game' : 'linked',
        reviewedAt: new Date().toISOString(),
        sourceUrl: review.find(item => item.id === id)?.primaryUrl || ''
      };
    });
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), items };
  }

  function saveDraft() {
    overrides = collect();
    localStorage.setItem(storageKey, JSON.stringify(overrides));
    status.textContent = 'Черновик ручных привязок сохранён в браузере.';
  }

  function exportDraft() {
    overrides = collect();
    localStorage.setItem(storageKey, JSON.stringify(overrides));
    const blob = new Blob([`${JSON.stringify(overrides, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'news-game-overrides.json';
    link.click();
    URL.revokeObjectURL(link.href);
    status.textContent = 'Файл экспортирован. Поместите его в data/news-game-overrides.json; следующие запуски parser сохранят решения.';
  }

  function resetDraft() {
    localStorage.removeItem(storageKey);
    window.location.reload();
  }

  async function start() {
    status.textContent = 'Загружаем очередь проверки…';
    const [catalogPayload, reviewPayload, repositoryOverrides] = await Promise.all([
      loadJson('data/catalog-visible.json', []),
      loadJson('data/news-game-review.json', { items: [] }),
      loadJson('data/news-game-overrides.json', { schemaVersion: 1, items: {} })
    ]);
    catalog = Array.isArray(catalogPayload) ? catalogPayload : (catalogPayload.items || []);
    review = Array.isArray(reviewPayload) ? reviewPayload : (reviewPayload.items || []);
    overrides = localDraft() || repositoryOverrides;
    render();
    saveButton.addEventListener('click', saveDraft);
    exportButton.addEventListener('click', exportDraft);
    resetButton.addEventListener('click', resetDraft);
  }

  start();
})();
