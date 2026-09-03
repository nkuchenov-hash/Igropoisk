const stableEntities = [
  'Ubisoft', 'EA', 'Electronic Arts', 'Steam', 'Steam Deck', 'Xbox', 'PlayStation', 'Nintendo', 'NVIDIA', 'AMD',
  'Microsoft', 'Konami', 'Capcom', 'SEGA', 'Bethesda', 'Valve', 'Rockstar', 'Activision', 'miHoYo', 'HoYoverse',
  'Pearl Abyss', 'CD Projekt Red', 'Gamescom', 'QuakeCon', 'Epic Games', 'Bandai Namco', 'Frontier Developments'
];

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonical(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cleanEntityCandidate(value = '') {
  return String(value || '')
    .replace(/[’‘`´]/g, "'")
    .replace(/^[\s:;,.!?–—-]+|[\s:;,.!?–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unicodeTokenPattern(body) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
}

export function decodeNewsSourceText(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;|&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&#8220;/gi, '“')
    .replace(/&rdquo;|&#8221;/gi, '”')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTitle(input = {}) {
  return decodeNewsSourceText(input.titleEn || input.title || '');
}

function sourceSummary(input = {}) {
  return decodeNewsSourceText(input.summaryEn || input.summary || '');
}

function sourceText(input = {}) {
  return `${sourceTitle(input)} ${sourceSummary(input)}`.trim();
}

function sourceContains(source = '', entity = '') {
  const text = canonical(source);
  const needle = canonical(entity);
  if (!needle) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

const properWord = "(?:[A-Z][A-Za-z0-9.-]{1,}|[A-Z]{2,})";
const properPhrase = `${properWord}(?:\\s+${properWord}){0,3}`;

function relationBackedCandidates(value = '') {
  const text = decodeNewsSourceText(value);
  const candidates = [];
  const patterns = [
    new RegExp(`\\b(?:team|studio|makers?|creators?|developers?)\\s+(?:of|behind)\\s+(${properPhrase})`, 'g'),
    new RegExp(`\\b(${properPhrase})['’]s\\s+(?:upcoming|new|next|latest|game|title|project)\\b`, 'g'),
    new RegExp(`\\b(?:studio|developer|publisher)\\s+(${properPhrase})\\b`, 'g')
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanEntityCandidate(match[1]);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function explicitGameEntities(input = {}) {
  return (Array.isArray(input.games) ? input.games : [])
    .map(game => cleanEntityCandidate(game?.title || ''))
    .filter(Boolean);
}

export function sourceEntityCandidates(input = {}) {
  const source = sourceText(input);
  const values = [
    ...stableEntities.filter(entity => sourceContains(source, entity)),
    ...explicitGameEntities(input),
    ...relationBackedCandidates(sourceTitle(input)),
    ...relationBackedCandidates(sourceSummary(input))
  ];
  const seen = new Set();
  return values
    .map(cleanEntityCandidate)
    .filter(value => value.length >= 2)
    .filter(value => {
      const key = canonical(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function localizedDisplay(entity, localizedNames = {}) {
  const wanted = canonical(entity);
  for (const [source, display] of Object.entries(localizedNames || {})) {
    if (canonical(source) === wanted && String(display || '').trim()) return String(display).trim();
  }
  return '';
}

function containsEntity(value = '', entity = '') {
  const text = canonical(value);
  const needle = canonical(entity);
  if (!needle) return true;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function entityMissing(target, entity, localizedNames = {}) {
  if (containsEntity(target, entity)) return false;
  const display = localizedDisplay(entity, localizedNames);
  return display ? !containsEntity(target, display) : true;
}

function repeatedParenthetical(value = '') {
  const matches = String(value).match(/([А-Яа-яЁёA-Za-z]{3,})\s*\(\s*([А-Яа-яЁёA-Za-z]{3,})\s*\)/gu) || [];
  return matches.some(match => {
    const parts = match.match(/[А-Яа-яЁёA-Za-z]{3,}/gu) || [];
    return parts.length >= 2 && canonical(parts[0]) === canonical(parts[1]);
  });
}

function repeatedAdjacentWord(value = '') {
  return /(?<![\p{L}\p{N}])([\p{L}]{4,})\s+\1(?![\p{L}\p{N}])/iu.test(String(value));
}

function htmlLeak(value = '') {
  return /&(?:[a-z]{2,8}|#\d{2,6});/iu.test(String(value));
}

function orphanLatinFragment(value = '') {
  return /(?:^|\s)[a-z]{1,2}\s*[.!?…»”)]*$/u.test(String(value).trim())
    && /[А-Яа-яЁё]/u.test(String(value));
}

function untranslatedEnglishGrammarFragment(value = '') {
  const text = String(value || '');
  if (!/[А-Яа-яЁё]/u.test(text)) return false;
  return /(?:^|\s)(?:the|a|an|this|that|these|those)\s+(?=[А-Яа-яЁё])/iu.test(text);
}

function requiresNoOneMeaning(source = '') {
  return /\b(?:no one|nobody)\b/i.test(source);
}

function preservesNoOneMeaning(target = '') {
  return unicodeTokenPattern('(?:никто|никого|никому|ни\\s+для\\s+кого|ни\\s+у\\s+кого)').test(target);
}

function requiresNothingMeaning(source = '') {
  return /\bnothing\b/i.test(source);
}

function preservesNothingMeaning(target = '') {
  return unicodeTokenPattern('(?:ничего|ничто)').test(target);
}

function requiresNeverMeaning(source = '') {
  return /\bnever\b/i.test(source);
}

function preservesNeverMeaning(target = '') {
  return unicodeTokenPattern('(?:никогда|ни\\s+разу)').test(target);
}

function requiresWithoutMeaning(source = '') {
  return /\bwithout\b/i.test(source);
}

function preservesWithoutMeaning(target = '') {
  return unicodeTokenPattern('без').test(target);
}

export function sourceLooksTruncated(input = {}) {
  const summary = decodeNewsSourceText(input.summaryEn || input.summary || '');
  if (!summary) return false;
  if (/[.!?…»”)]$/.test(summary)) return false;
  const tail = summary.match(/([A-Za-z]+)$/)?.[1] || '';
  return tail.length <= 2 || summary.length >= 240;
}

export function publicationSemanticReasons(input = {}, output = {}, { localizedNames = {} } = {}) {
  const titleRu = String(output.titleRu || '').trim();
  const summaryRu = String(output.summaryRu || output.briefRu || '').trim();
  const target = `${titleRu} ${summaryRu}`.trim();
  const source = sourceText(input);
  const reasons = [];

  if (htmlLeak(target)) reasons.push('HTML entity leaked into Russian publication copy');
  if (repeatedParenthetical(target)) reasons.push('machine translation repeated the same word in parentheses');
  if (repeatedAdjacentWord(target)) reasons.push('machine translation repeated the same adjacent word');
  if (orphanLatinFragment(summaryRu)) reasons.push('orphan Latin fragment leaked into Russian summary');
  if (untranslatedEnglishGrammarFragment(titleRu) || untranslatedEnglishGrammarFragment(summaryRu)) reasons.push('untranslated English grammar fragment mixed into Russian publication copy');

  if (requiresNoOneMeaning(source) && !preservesNoOneMeaning(target)) reasons.push('source meaning lost: no one/nobody');
  if (requiresNothingMeaning(source) && !preservesNothingMeaning(target)) reasons.push('source meaning lost: nothing');
  if (requiresNeverMeaning(source) && !preservesNeverMeaning(target)) reasons.push('source meaning lost: never');
  if (requiresWithoutMeaning(source) && !preservesWithoutMeaning(target)) reasons.push('source meaning lost: without');

  for (const entity of sourceEntityCandidates(input)) {
    if (entityMissing(target, entity, localizedNames)) reasons.push(`source entity changed or missing: ${entity}`);
  }

  return [...new Set(reasons)];
}

export function isMachineLocalizedDraft(item = {}) {
  const status = String(item.localizationStatus || '').toLowerCase();
  const model = String(item.editorialModel || '').toLowerCase();
  return /(?:opus|google-fallback|mymemory-fallback)/.test(status)
    || model === 'validated-upstream-local-translation';
}
