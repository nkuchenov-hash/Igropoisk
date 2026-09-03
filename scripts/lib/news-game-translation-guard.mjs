function normalizeKey(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityPattern(value = '') {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, 'giu');
}

function localizedDisplay(entity, localizedNames = {}) {
  const wanted = normalizeKey(entity);
  for (const [source, display] of Object.entries(localizedNames || {})) {
    if (normalizeKey(source) === wanted && String(display || '').trim()) return String(display).trim();
  }
  return String(entity || '').trim();
}

function polish(value = '') {
  return String(value)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([«(])\s+/g, '$1')
    .replace(/\s+([»)])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function protectedSpecs(entities = [], localizedNames = {}) {
  const seen = new Set();
  return [...entities]
    .map(entity => String(entity || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .filter(entity => {
      const key = normalizeKey(entity);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entity, index) => ({
      entity,
      display: localizedDisplay(entity, localizedNames),
      marker: `ZXQGAME${index}QXZ`
    }));
}

function protectedSpans(source, specs) {
  const spans = [];
  for (const spec of specs) {
    for (const match of source.matchAll(entityPattern(spec.entity))) {
      spans.push({ start: Number(match.index || 0), end: Number(match.index || 0) + match[0].length, spec });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted = [];
  for (const span of spans) {
    if (accepted.some(existing => span.start < existing.end && span.end > existing.start)) continue;
    accepted.push(span);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

async function translateBySegments(source, specs, translate) {
  const spans = protectedSpans(source, specs);
  if (!spans.length) return String(await translate(source) || '').trim();
  const parts = [];
  let cursor = 0;
  for (const span of spans) {
    const gap = source.slice(cursor, span.start);
    if (gap) {
      if (/\p{L}/u.test(gap)) {
        const translated = String(await translate(gap) || '').trim();
        if (!translated) return '';
        parts.push(translated);
      } else {
        parts.push(gap);
      }
    }
    parts.push(span.spec.display);
    cursor = span.end;
  }
  const tail = source.slice(cursor);
  if (tail) {
    if (/\p{L}/u.test(tail)) {
      const translated = String(await translate(tail) || '').trim();
      if (!translated) return '';
      parts.push(translated);
    } else {
      parts.push(tail);
    }
  }
  return polish(parts.join(' '));
}

export async function translatePreservingGameEntities(text, entities, translate, { localizedNames = {} } = {}) {
  const source = String(text || '').trim();
  if (!source) return '';
  if (typeof translate !== 'function') throw new TypeError('translate must be a function');
  const specs = protectedSpecs(entities, localizedNames);
  if (!specs.length) return String(await translate(source) || '').trim();

  let protectedText = source;
  let used = false;
  for (const spec of specs) {
    const next = protectedText.replace(entityPattern(spec.entity), spec.marker);
    used ||= next !== protectedText;
    protectedText = next;
  }
  if (!used) return String(await translate(source) || '').trim();

  const translated = String(await translate(protectedText) || '').trim();
  const markersIntact = translated && specs.every(spec => new RegExp(escapeRegExp(spec.marker), 'i').test(translated));
  if (markersIntact) {
    let restored = translated;
    for (const spec of specs) restored = restored.replace(new RegExp(escapeRegExp(spec.marker), 'gi'), spec.display);
    return polish(restored);
  }

  return translateBySegments(source, specs, translate);
}
