export function canonicalGameHashtag(game = {}) {
  const slug = String(game?.slug || game?.identity?.slug?.value || game?.identity?.slug || '').trim().toLowerCase();
  if (!slug) return '';
  return `#${slug}`;
}

export function normalizeCanonicalGameHashtag(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('#') ? raw : `#${raw}`;
}
