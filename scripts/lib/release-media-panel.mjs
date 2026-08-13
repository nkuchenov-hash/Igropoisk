const canonical = value => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const uniq = values => [...new Set((values || []).filter(Boolean))];

export function buildPublisherIndex(config = {}) {
  const sources = Array.isArray(config.sources) ? config.sources : [];
  const aliasToSource = new Map();
  const familyToSource = new Map();
  for (const source of sources) {
    if (!source?.publisher_family) continue;
    familyToSource.set(source.publisher_family, source);
    for (const alias of uniq([source.name, source.publisher_family, ...(source.aliases || [])])) {
      const key = canonical(alias);
      if (key) aliasToSource.set(key, source);
    }
  }
  return { sources, aliasToSource, familyToSource };
}

export function resolvePublisher(value, index) {
  const key = canonical(value);
  if (!key) return null;
  if (index.aliasToSource.has(key)) return index.aliasToSource.get(key);
  for (const [alias, source] of index.aliasToSource) {
    if (key === alias || key.includes(alias) || alias.includes(key)) return source;
  }
  if (/^ign\b|\bign\s+(africa|france|brasil|brazil|benelux|greece|portugal|pakistan|india|nordic)\b/.test(key)) {
    return index.familyToSource.get('ign') || null;
  }
  return null;
}

export function buildMediaIntersection({ publisherNames = [], evidence = [], config = {}, generatedAt = new Date().toISOString() } = {}) {
  const index = buildPublisherIndex(config);
  const families = new Map();
  const normalizedEvidence = [];

  const add = (publisher, item = null) => {
    const source = resolvePublisher(publisher, index);
    if (!source) return;
    const family = source.publisher_family;
    if (!families.has(family)) families.set(family, source);
    if (item) normalizedEvidence.push({
      publisher: source.name,
      publisher_family: family,
      region: source.region || 'global',
      title: item.title || null,
      url: item.url || null,
      observed_at: item.observed_at || item.date || null,
      origin: item.origin || null,
    });
  };

  for (const publisher of publisherNames || []) add(publisher);
  for (const item of evidence || []) add(item.publisher || item.source || item.name, item);

  const publisherFamilies = [...families.keys()].sort();
  const publishers = publisherFamilies.map(family => families.get(family)?.name || family);
  const regionCounts = {};
  for (const family of publisherFamilies) {
    const region = families.get(family)?.region || 'global';
    regionCounts[region] = (regionCounts[region] || 0) + 1;
  }

  return {
    model: 'fixed-editorial-media-panel-v1',
    generated_at: generatedAt,
    panel_size: index.sources.length,
    overall_count: publisherFamilies.length,
    publisher_families: publisherFamilies,
    publishers,
    region_counts: regionCounts,
    evidence: normalizedEvidence.slice(0, 64),
    rules: {
      one_point_per_publisher_family: true,
      no_intersection_count_cap: true,
      stores_and_official_sources_excluded: true,
    },
  };
}

export function mergeMediaIntersections(...items) {
  const valid = items.filter(Boolean);
  if (!valid.length) return null;
  const publisherFamilies = uniq(valid.flatMap(item => item.publisher_families || [])).sort();
  const publisherByFamily = new Map();
  const regionCounts = {};
  const evidence = [];
  for (const item of valid) {
    (item.publisher_families || []).forEach((family, index) => {
      if (!publisherByFamily.has(family)) publisherByFamily.set(family, (item.publishers || [])[index] || family);
    });
    for (const [region, count] of Object.entries(item.region_counts || {})) regionCounts[region] = Math.max(regionCounts[region] || 0, Number(count || 0));
    evidence.push(...(item.evidence || []));
  }
  return {
    ...valid[valid.length - 1],
    overall_count: publisherFamilies.length,
    publisher_families: publisherFamilies,
    publishers: publisherFamilies.map(family => publisherByFamily.get(family) || family),
    region_counts: regionCounts,
    evidence: evidence.slice(0, 64),
  };
}
