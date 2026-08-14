const decodeEntities = value => String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
const escapeAttribute = value => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const plainText = value => String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function unwrapBingResultUrl(value) {
  const original = String(value || '');
  try {
    const parsed = new URL(decodeEntities(original), 'https://www.bing.com/');
    if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/ck/')) return original;
    let encoded = parsed.searchParams.get('u') || '';
    if (!encoded) return original;
    try { encoded = decodeURIComponent(encoded); } catch {}
    if (encoded.startsWith('a1')) encoded = encoded.slice(2);
    encoded = encoded.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    encoded += '='.repeat((4 - (encoded.length % 4)) % 4);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
    return /^https?:\/\//i.test(decoded) ? decoded : original;
  } catch {
    return original;
  }
}

export function normalizeBingSearchHtml(html) {
  return String(html || '').replace(/<a\b([^>]*?)href=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi, (full, before, _quote, href, after, inner) => {
    const destination = unwrapBingResultUrl(href);
    const label = plainText(inner);
    if (!label) return full;
    return `<a${before}href="${escapeAttribute(destination)}"${after}>${label}</a>`;
  });
}

export function validateReviewSearchNormalizer() {
  const target = 'https://www.gamespot.com/reviews/rainbow-six-siege-review-2015/1900-6416324/';
  const encoded = `a1${Buffer.from(target).toString('base64url')}`;
  const wrapped = `https://www.bing.com/ck/a?!&&p=contract&u=${encoded}&ntb=1`;
  if (unwrapBingResultUrl(wrapped) !== target) throw new Error('Bing result redirect decoder contract failed.');
  if (unwrapBingResultUrl(target) !== target) throw new Error('Direct review URL must remain unchanged.');
  const normalized = normalizeBingSearchHtml(`<li class="b_algo"><h2><a href="${wrapped}"><span>Rainbow Six Siege Review</span></a></h2></li>`);
  if (!normalized.includes(`href="${target}"`) || !normalized.includes('>Rainbow Six Siege Review</a>')) throw new Error('Nested Bing result anchor normalization contract failed.');
  return true;
}
