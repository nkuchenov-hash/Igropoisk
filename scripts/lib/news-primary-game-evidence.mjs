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

function sourceSummary(item = {}) {
  return normalizeNewsGameEvidence(`${item.summaryRu || ''} ${item.summaryEn || ''} ${item.summary || ''}`);
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

function sequelTokens(value = '') {
  return normalizeNewsGameEvidence(value).split(' ').filter(token => sequelMarker.test(token));
}

export function canonicalGameIsPrimary(item = {}, game = {}) {
  const headlineAndUrl = sourceTitleAndUrl(item);
  const summary = sourceSummary(item);
  const identities = [game.title, game.slug]
    .map(normalizeNewsGameEvidence)
    .filter(Boolean);
  for (const identity of identities) {
    if (exactContains(headlineAndUrl, identity)) return true;
    const acronym = canonicalAcronym(identity);
    if (acronym && exactContains(headlineAndUrl, acronym)) return true;

    // Russian headlines can decline a translated game name while the source summary keeps
    // the canonical English title. A matching sequel marker in the headline is sufficient
    // supporting evidence only when the full canonical identity is present in the summary.
    // This keeps comparison-only games such as Stardew Valley out of Haunted Chocolatier news.
    if (exactContains(summary, identity)) {
      const markers = sequelTokens(identity);
      if (markers.some(marker => exactContains(headlineAndUrl, marker))) return true;
    }
  }
  return false;
}