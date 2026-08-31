const sequelMarker = /^(?:2|3|4|5|6|7|8|9|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

export function normalizeNewsGameEvidence(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTitleAndUrl(item = {}) {
  let url = '';
  try {
    const parsed = new URL(item.primaryUrl || item.url || '');
    url = decodeURIComponent(`${parsed.pathname} ${parsed.search}`);
  } catch {
    url = item.primaryUrl || item.url || '';
  }
  return normalizeNewsGameEvidence(`${item.titleRu || ''} ${item.titleEn || ''} ${item.title || ''} ${url}`);
}

function exactContains(haystack, needle) {
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function canonicalAcronym(value = '') {
  const tokens = normalizeNewsGameEvidence(value).split(' ').filter(Boolean);
  if (tokens.length < 3) return '';
  const suffix = sequelMarker.test(tokens.at(-1) || '') ? ` ${tokens.at(-1)}` : '';
  const stem = suffix ? tokens.slice(0, -1) : tokens;
  if (stem.length < 3) return '';
  const acronym = stem.map(token => token[0]).join('');
  return acronym.length >= 3 ? `${acronym}${suffix}` : '';
}

export function canonicalGameIsPrimary(item = {}, game = {}) {
  const headlineAndUrl = sourceTitleAndUrl(item);
  const identities = [game.title, game.slug]
    .map(normalizeNewsGameEvidence)
    .filter(Boolean);
  for (const identity of identities) {
    if (exactContains(headlineAndUrl, identity)) return true;
    const acronym = canonicalAcronym(identity);
    if (acronym && exactContains(headlineAndUrl, acronym)) return true;
  }
  return false;
}
