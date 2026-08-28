import { createHash } from 'node:crypto';

export const NEWS_EDITORIAL_VERSION = 8;

export function hasCyrillic(value = '') {
  return /[А-Яа-яЁё]/.test(String(value));
}

export function canonicalEditorialUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|ref_|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${search ? `?${search}` : ''}`;
  } catch {
    return String(value || '').trim();
  }
}

export function editorialSourceHash(item = {}, version = NEWS_EDITORIAL_VERSION) {
  return createHash('sha1').update([
    version,
    canonicalEditorialUrl(item.primaryUrl || item.url || ''),
    String(item.titleEn || item.title || ''),
    String(item.summaryEn || item.summary || '')
  ].join('\n')).digest('hex');
}

export function hasValidEditorialCache(item = {}, version = NEWS_EDITORIAL_VERSION) {
  const status = String(item.editorialStatus || '');
  if (!['approved', 'source-ru'].includes(status)) return false;
  if (Number(item.editorialVersion) !== Number(version)) return false;
  if (item.editorialSourceHash !== editorialSourceHash(item, version)) return false;
  if (!hasCyrillic(item.titleRu)) return false;
  if (String(item.summaryRu || '').length < 120) return false;
  return true;
}
