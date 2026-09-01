const namedEntities = Object.freeze({
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  minus: '−',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  hellip: '…'
});

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? match);
}

function removeAdjacentWordDuplicates(value = '') {
  let text = String(value);
  const duplicate = /\b([\p{L}\p{N}][\p{L}\p{N}-]{2,})\b(?:\s+\1\b)+/giu;
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(duplicate, '$1');
  }
  return text;
}

function removeBrokenListLead(value = '') {
  return String(value).replace(
    /(^|(?<=[.!?]\s))[^.!?]{0,220}\b(?:следующим|следующие)\s+(?:характеристикам|требованиям|параметрам)\s*:\s+(?=[А-ЯЁA-Z])/giu,
    '$1'
  );
}

function polishParagraph(value = '') {
  return removeBrokenListLead(removeAdjacentWordDuplicates(decodeEntities(value)))
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?;:»”\)\]])/g, '$1')
    .replace(/([«“\(\[])\s+/g, '$1')
    .replace(/\s+([—–])\s+/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeCommercialNewsCopy(value = '') {
  return String(value)
    .split(/\n{2,}/)
    .map(polishParagraph)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function commercialNewsCopyIssues(value = '') {
  const text = String(value || '');
  const issues = [];
  if (/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(text)) issues.push('html-entity');
  if (/\b([\p{L}\p{N}][\p{L}\p{N}-]{2,})\b\s+\1\b/iu.test(text)) issues.push('adjacent-duplicate-word');
  if (/\s+[»”\)\]]/.test(text)) issues.push('space-before-closing-punctuation');
  if (/\b(?:следующим|следующие)\s+(?:характеристикам|требованиям|параметрам)\s*:\s*(?=[А-ЯЁA-Z])/iu.test(text)) issues.push('broken-list-introduction');
  return issues;
}
