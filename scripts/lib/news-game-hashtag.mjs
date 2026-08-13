export function canonicalGameHashtag(game = {}) {
  const title = String(game?.title || game?.identity?.canonicalTitle?.value || game?.identity?.title || '').trim();
  const compact = title.replace(/[^\p{L}\p{N}]+/gu, '');
  const slug = String(game?.slug || game?.identity?.slug?.value || game?.identity?.slug || '').trim().toLowerCase();
  const fallback = slug.replace(/[^a-z0-9]+/gi, '');
  return `#${compact || fallback || 'game'}`;
}

export function hashtagKey(value = '') {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US');
}
