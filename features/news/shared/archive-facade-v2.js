'use strict';

(() => {
  const contentApi = window.IgropoiskNewsContent;
  const previous = window.IgropoiskNews;
  if (!contentApi?.getArchive || !previous) return;

  async function loadAll(lang = previous.language(), { force = false } = {}) {
    return contentApi.getArchive({ lang, force });
  }

  window.IgropoiskNews = Object.freeze({
    ...previous,
    loadAll
  });
})();
