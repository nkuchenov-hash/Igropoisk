// News pipeline publication trigger: 2026-08-24T11:01Z
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
