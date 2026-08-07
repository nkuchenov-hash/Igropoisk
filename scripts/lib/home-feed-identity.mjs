export function normalizeGameIdentity(value, suffixPatterns = []) {
  let normalized = String(value || '').trim();
  for (const pattern of suffixPatterns) normalized = normalized.replace(new RegExp(pattern, 'i'), '');
  normalized = normalized
    .replace(/[™®]/g, '')
    .replace(/(?:\(tm\)|\(r\))$/i, '')
    .normalize('NFKC')
    .toLowerCase();
  return normalized
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function duplicateIdentityMap(items, options = {}) {
  const suffixPatterns = options.suffixPatterns || [];
  const getTitle = options.getTitle || (item => item?.title);
  const getId = options.getId || (item => item?.slug);
  const seen = new Map();
  const duplicates = new Map();

  for (const item of items || []) {
    const key = normalizeGameIdentity(getTitle(item), suffixPatterns);
    if (!key) continue;
    if (seen.has(key)) duplicates.set(getId(item), seen.get(key));
    else seen.set(key, getId(item));
  }

  return duplicates;
}
