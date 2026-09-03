const commonCapitalizedWords = new Set([
  'a','an','and','are','as','at','be','but','by','can','could','day','do','does','done','easy','everyone','expect','final','for','from','game','games','get','gets','getting','good','has','have','how','i','in','into','is','it','its','makers','more','my','new','news','no','not','of','on','one','out','ride','set','should','so','some','than','that','the','their','this','to','up','was','we','what','when','where','who','why','will','with','you','your'
]);

const stableEntities = [
  'Ubisoft', 'EA', 'Electronic Arts', 'Steam', 'Steam Deck', 'Xbox', 'PlayStation', 'Nintendo', 'NVIDIA', 'AMD',
  'Microsoft', 'Konami', 'Capcom', 'SEGA', 'Bethesda', 'Valve', 'Rockstar', 'Activision', 'miHoYo', 'HoYoverse',
  'Pearl Abyss', 'CD Projekt Red', 'Gamescom', 'QuakeCon', 'Epic Games', 'Bandai Namco'
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

function sourceText(input = {}) {
  return decodeNewsSourceText(`${input.titleEn || input.title || ''} ${input.summaryEn || input.summary || ''}`);
}

function sourceUrl(input = {}) {
  return String(input.primaryUrl || input.url || '').trim();
}

function urlText(input = {}) {
  try { return decodeURIComponent(new URL(sourceUrl(input)).pathname).toLowerCase(); }
  catch { return ''; }
}

function titleCaseMultiwordCandidates(value = '') {
  const matches = String(value).match(/\b(?:[A-Z][A-Za-z0-9'’.-]{2,}|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9'’.-]{2,}|[A-Z]{2,})){1,3}\b/g) || [];
  return matches.filter(candidate => {
    const words = candidate.split(/\s+/).map(word => canonical(word));
    return words.some(word => word && !commonCapitalizedWords.has(word));
  });
}

function urlBackedSingleCandidates(value = '', input = {}) {
  const path = urlText(input);
  if (!path) return [];
  const matches = String(value).match(/\b(?:[A-Z][A-Za-z0-9'’.-]{3,}|[A-Z]{3,})\b/g) || [];
  return matches.filter(candidate => {
    const key = canonical(candidate);
    if (!key || commonCapitalizedWords.has(key)) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(key)}(?:[^a-z0-9]|$)`, 'i').test(path.replace(/[-_/]+/g, ' '));
  });
}

function explicitGameEntities(input = {}) {
  return (Array.isArray(input.games) ? input.games : [])
    .map(game => String(game?.title || '').trim())
    .filter(Boolean);
}

export function sourceEntityCandidates(input = {}) {
  const source = sourceText(input);
  const values = [
    ...stableEntities.filter(entity => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entity)}(?![\\p{L}\\p{N}])`, 'iu').test(source)),
    ...explicitGameEntities(input),
    ...titleCaseMultiwordCandidates(source),
    ...urlBackedSingleCandidates(source, input)
  ];
  const seen = new Set();
  return values
    .map(value => String(value || '').trim())
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
  return /\b([А-Яа-яЁёA-Za-z]{4,})\s+\1\b/iu.test(String(value));
}

function htmlLeak(value = '') {
  return /&(?:[a-z]{2,8}|#\d{2,6});/iu.test(String(value));
}

function orphanLatinFragment(value = '') {
  return /(?:^|\s)[a-z]{1,2}\s*[.!?…»”)]*$/u.test(String(value).trim())
    && /[А-Яа-яЁё]/u.test(String(value));
}

function requiresNoOneMeaning(source = '') {
  return /\b(?:no one|nobody)\b/i.test(source);
}

function preservesNoOneMeaning(target = '') {
  return /(?:\bникто\b|\bникого\b|\bникому\b|\bни\s+для\s+кого\b|\bни\s+у\s+кого\b)/iu.test(target);
}

function requiresNothingMeaning(source = '') {
  return /\bnothing\b/i.test(source);
}

function preservesNothingMeaning(target = '') {
  return /\b(?:ничего|ничто)\b/iu.test(target);
}

function requiresNeverMeaning(source = '') {
  return /\bnever\b/i.test(source);
}

function preservesNeverMeaning(target = '') {
  return /(?:\bникогда\b|\bни\s+разу\b)/iu.test(target);
}

function requiresWithoutMeaning(source = '') {
  return /\bwithout\b/i.test(source);
}

function preservesWithoutMeaning(target = '') {
  return /\bбез\b/iu.test(target);
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
