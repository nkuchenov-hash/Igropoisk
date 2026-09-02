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
  const duplicate = /(?<![\p{L}\p{N}])([\p{L}\p{N}][\p{L}\p{N}-]{2,})(?:\s+\1)+(?![\p{L}\p{N}-])/giu;
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(duplicate, '$1');
  }
  return text;
}

function removeBrokenListLead(value = '') {
  return String(value).replace(
    /(^|(?<=[.!?]\s))[^.!?]{0,220}(?<![\p{L}\p{N}])(?:следующим|следующие)\s+(?:характеристикам|требованиям|параметрам)\s*:\s+(?=[А-ЯЁA-Z])/giu,
    '$1'
  );
}

function polishParagraph(value = '') {
  return removeBrokenListLead(removeAdjacentWordDuplicates(decodeEntities(value)))
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/^(?:видимо,\s*)?дела\s+(?:совсем\s+)?плохо:\s*/iu, '')
    .replace(/^поэтому\s+([а-яё])/iu, (_, first) => first.toUpperCase())
    .replace(/^поэтому\s+/iu, '')
    .replace(/(?<![\p{L}\p{N}])вернет\s+вам\s+(\d+)\s+бакс(?:ов|а)?,\s+если\s+вы\s+предзакажете(?![\p{L}\p{N}])/giu, 'вернёт $1 долларов за предзаказ')
    .replace(/(?<![\p{L}\p{N}])(\d+)\s+бакс(?:ов|а)?(?![\p{L}\p{N}])/giu, '$1 долларов')
    .replace(/([а-яё]{3,}ями)и(?![\p{L}\p{N}])/giu, '$1')
    .replace(/\s+-\s+/g, ' — ')
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
  if (/(?<![\p{L}\p{N}])([\p{L}\p{N}][\p{L}\p{N}-]{2,})\s+\1(?![\p{L}\p{N}-])/iu.test(text)) issues.push('adjacent-duplicate-word');
  if (/\s+[»”\)\]]/.test(text)) issues.push('space-before-closing-punctuation');
  if (/(?<![\p{L}\p{N}])(?:следующим|следующие)\s+(?:характеристикам|требованиям|параметрам)\s*:\s*(?=[А-ЯЁA-Z])/iu.test(text)) issues.push('broken-list-introduction');
  if (/(?:вроде|как|серии|игр(?:а|ы|е|у|ой|ами|ах)?)\s+[A-Z]\.\s+(?=[А-ЯЁ])/u.test(text)) issues.push('truncated-dotted-game-acronym');
  if (/^(?:видимо,\s*)?дела\s+(?:совсем\s+)?плохо\s*:/iu.test(text)) issues.push('sensational-prefix');
  if (/(?:выпущен\p{L}*|запущен\p{L}*)\s+в\s+верси(?:ю|и)\s*\d|(?:бета|альфа)[- ]образц\p{L}*|основател\p{L}*\s+для\s+(?:первых|ранних)\s+покупател\p{L}*|чтобы\s+(?:они\s+)?привезли\s+людей/iu.test(text)) issues.push('machine-translation-grammar');
  return issues;
}
