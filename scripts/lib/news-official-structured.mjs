const articleTypes = new Set(['newsarticle', 'article', 'blogposting', 'reportagenewsarticle', 'techarticle']);

function absolute(value = '', base = '') {
  try {
    const url = new URL(String(value || ''), base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function hostname(value = '') {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function sameOfficialHost(candidate = '', base = '') {
  const left = hostname(candidate);
  const right = hostname(base);
  return Boolean(left && right && left === right);
}

function types(node = {}) {
  const value = node?.['@type'];
  return (Array.isArray(value) ? value : [value])
    .map(entry => String(entry || '').toLowerCase().trim())
    .filter(Boolean);
}

function isArticleNode(node = {}) {
  return types(node).some(type => articleTypes.has(type));
}

function nodeUrl(node = {}, base = '') {
  const candidates = [
    node.url,
    node?.mainEntityOfPage?.['@id'],
    node?.mainEntityOfPage?.url,
    node?.['@id']
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const resolved = absolute(candidate, base);
      if (resolved) return resolved;
    } else if (candidate && typeof candidate === 'object') {
      const resolved = absolute(candidate.url || candidate['@id'] || '', base);
      if (resolved) return resolved;
    }
  }
  return '';
}

function textValue(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(' ').trim();
  return '';
}

function parsePublishedAt(node = {}) {
  // Commercial fallback never invents a publication time. datePublished is mandatory.
  const value = textValue(node.datePublished);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function visit(value, out, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) visit(child, out, seen);
    return;
  }
  if (isArticleNode(value)) out.push(value);
  for (const child of Object.values(value)) visit(child, out, seen);
}

function jsonLdPayloads(html = '') {
  const payloads = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of String(html).matchAll(scriptPattern)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1] || '')) continue;
    let raw = String(match[2] || '').trim()
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .replace(/;\s*$/, '')
      .trim();
    if (!raw) continue;
    try { payloads.push(JSON.parse(raw)); }
    catch { /* Invalid structured data is ignored instead of weakening the parser. */ }
  }
  return payloads;
}

export function parseStructuredOfficialNews(html = '', source = {}, pageUrl = source.siteUrl || '', options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays || 14));
  const maxAgeMs = maxAgeDays * 864e5;
  const nodes = [];
  const seenObjects = new Set();
  for (const payload of jsonLdPayloads(html)) visit(payload, nodes, seenObjects);

  const byUrl = new Map();
  for (const node of nodes) {
    const title = textValue(node.headline || node.name);
    const summary = textValue(node.description || node.abstract).slice(0, 420);
    const publishedAt = parsePublishedAt(node);
    const url = nodeUrl(node, pageUrl);
    const time = Date.parse(publishedAt);
    if (!title || title.length < 10 || !url || !publishedAt) continue;
    if (!sameOfficialHost(url, pageUrl)) continue;
    if (time > now + 2 * 3600e3 || now - time > maxAgeMs) continue;

    const item = {
      title,
      summary,
      url,
      publishedAt,
      sourceId: source.id,
      source: source.name,
      organization: source.organization,
      sourceKind: source.kind,
      game: source.game || '',
      sourceLanguage: source.language || 'en',
      discoveryMode: 'jsonld'
    };
    if (!byUrl.has(url)) byUrl.set(url, item);
  }

  return [...byUrl.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
