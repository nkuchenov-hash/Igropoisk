// Canonical hashtag identity helper used by news normalization and audit stages.
function compact(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function canonicalGameHashtag(game = {}) {
  const title = compact(game?.title);
  const slug = compact(game?.slug);
  const value = title || slug;
  return value ? `#${value}` : '';
}

export function hashtagKey(value = '') {
  return compact(String(value || '').replace(/^#+/, '')).toLowerCase();
}
