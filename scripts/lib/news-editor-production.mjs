import {
  editNewsToRussian as generateRussianDraft,
  fetchArticleText,
  normalizeEditorialNames,
  warmNewsEditor
} from './news-editor-qwen.mjs';
import { isLikelyNewsContent } from './news-content-policy.mjs';

export { fetchArticleText, warmNewsEditor };

const boilerplatePattern = /cookie|newsletter|subscribe|sign up|privacy policy|when you (?:purchase|buy) through links|we may (?:earn|receive) (?:an )?(?:affiliate )?commission|affiliate commission|here(?:'s| is) how (?:it|this) works|support us|terms (?:of|and) conditions|all rights reserved|recommended by|shopping links|buying guide|follow us|more about|contact me with news/i;
const literalMachinePattern = /(?:переоснащ(?:ен|ена|ение)|исключ(?:ен(?:а|о)?|ени[ея]) из списка)/iu;
const awkwardRussianPattern = /(?:леверед|бай[- ]?аут|крупн\p{L}* купл[ие]-продаж|факт подтверждает (?:лишь )?теори|вызвал[аи]? спрос на возможн|оста[её]тся вероятн\p{L}+ налич|удал[её]нн(?:ая|ую|ой) игр[ау]|микроперекуп|генеративн\p{L}+\s+(?:аи|AI)|целый другой мир|не будут единственн\p{L}+ в насилии|мать в хаосе|действие на PS5 начн[её]тся|полувещ|полувозмож|инфицированност|демоническ\p{L}+ инфицир|продемонстрировал[аи]? \d+[\s\S]{0,30}копи[йи] продано|достиг(?:ла|ло|ли)?\s+консол\p{L}*|собаком|постапокалипсисн\p{L}+\s+действи\p{L}*|уменьшен\p{L}+\s+метр\p{L}*\s+(?:враг|противник)\p{L}*|уменьшения\s+метров|управля(?:йте|ет|ют|я)\s+(?:день|ночь)|распадаясь\s+на\s+групп\p{L}*|система\s+wanted|сниз\p{L}+\s+уровень\s+внимания|действие\s+в\s+постапокалиптическ\p{L}+|правомерност\p{L}+\s+поступк\p{L}*|появляющ\p{L}+\s+ангел\p{L}+\s+и\s+демон\p{L}+|о\s+главном\s+герою|тур[- ]?базов\p{L}*|гангов\p{L}*\s+(?:бой|боев)|ранее\s+отмечавш\p{L}+\s+как\s+от|обрадовал\p{L}+\s+запуском|версайск\p{L}+\s+город|трейлер\s+неофициальн\p{L}+\s+видеоигр\p{L}*|каждый\s+платформа|эксклюзивных\s+контентах|запускатор\p{L}*)/iu;
const metaPattern = /(?:я как ии|искусственный интеллект|как модель|перевод статьи|в статье говорится|по данным материала)/iu;
const authorCommentPattern = /\b(?:i think|i'm|i am|we think|we're|my bet|i bet|i'm just glad)\b/i;
const truncatedBriefPattern = /(?:\.\.\.|…)/u;
const englishPossessiveCompanyPattern = /(?:Motive|Rockstar|Ubisoft|Bethesda|Microsoft|Nintendo|Capcom|Konami|SEGA|Valve|PlayStation|Xbox)'s\b/i;

const stableEntities = [
  'Ubisoft', 'EA', 'Electronic Arts', 'Steam', 'Steam Deck', 'Xbox', 'PlayStation', 'Nintendo', 'NVIDIA', 'AMD',
  'Microsoft', 'Konami', 'Capcom', 'SEGA', 'Bethesda', 'Valve', 'Rockstar', 'Activision', 'miHoYo', 'HoYoverse',
  'Pearl Abyss', 'CD Projekt Red', 'Gamescom', 'QuakeCon', 'Epic Games', 'Bandai Namco'
];

const contextualEntitySuffix = /\b(?:City|Studios?|Games|Interactive|Entertainment|Assembly|Productions?|Engine)$/i;
const allowedMixedRussianToken = /^(?:PC|PS[345]|Xbox|Steam|Switch|CERO)-[А-Яа-яЁё]+$/u;

function canonical(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function polishEditorialNames(value = '') {
  return normalizeEditorialNames(value)
    .replace(/(?<![\p{L}\p{N}])XBOX(?![\p{L}\p{N}])/gu, 'Xbox')
    .replace(/(?<![\p{L}\p{N}])PLAYSTATION(?![\p{L}\p{N}])/gu, 'PlayStation')
    .replace(/(?<![\p{L}\p{N}])Nvidia(?![\p{L}\p{N}])/gu, 'NVIDIA')
    .replace(/(\d)\.\s+(?=\d)/g, '$1.')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([«(])\s+/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsEntity(value = '', entity = '') {
  const text = canonical(value);
  const needle = canonical(entity).replace(/^(?:the|a|an)\s+/, '');
  if (!needle) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'iu').test(text.replace(/^(?:the|a|an)\s+/, ''));
}

function countLetters(value = '', pattern) {
  return (String(value).match(pattern) || []).length;
}

function mixedScriptTokens(value = '') {
  return (String(value).match(/[\p{L}\p{N}'’.-]+/gu) || [])
    .filter(token => /[A-Za-z]/.test(token) && /[А-Яа-яЁё]/.test(token) && !allowedMixedRussianToken.test(token));
}

function normalizedSentences(value = '') {
  return String(value)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.length >= 20);
}

function numericTokens(value = '') {
  return new Set((String(value).match(/\d+(?:[.,]\d+)?/g) || []).map(token => token.replace(',', '.')));
}

function unsupportedNumbers(value = '', input = {}) {
  const source = numericTokens(`${input.title || ''} ${input.summary || ''} ${input.articleText || ''}`);
  return [...numericTokens(value)].filter(token => !source.has(token));
}

function requiredStableEntities(input = {}) {
  const source = `${input.title || ''} ${input.summary || ''}`;
  return stableEntities.filter(entity => containsEntity(source, entity));
}

function requiredContextEntities(input = {}) {
  const source = String(input.summary || '');
  const matches = source.match(/\b(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+)(?:\s+(?:[A-Z]{2,}|[A-Z][A-Za-z0-9'’.-]+)){1,3}\b/g) || [];
  return [...new Set(matches
    .map(value => value.trim())
    .filter(value => contextualEntitySuffix.test(value)))]
    .slice(0, 4);
}

function requiredExplicitEntities(input = {}) {
  return [...new Set((Array.isArray(input.requiredEntities) ? input.requiredEntities : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))].slice(0, 12);
}

function looksLikeUntranslatedClause(value = '') {
  const sequences = String(value).match(/\b[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){4,}\b/g) || [];
  const nameConnectors = new Set(['of', 'the', 'and', 'to', 'for', 'in', 'on', 'from', 'with', 'vs']);
  return sequences.some(sequence => {
    const words = sequence.split(/\s+/);
    const titleLike = words.every(word => {
      const lower = word.toLowerCase();
      return nameConnectors.has(lower) || /^[A-Z]/.test(word) || /^[A-Z]{2,}$/.test(word);
    });
    return !titleLike;
  });
}

function firstSentence(value = '') {
  return String(value).split(/(?<=[.!?])\s+/)[0]?.trim() || '';
}

function headlineRepeatedInLead(title = '', brief = '') {
  const a = canonical(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const b = canonical(firstSentence(brief)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!a || !b) return false;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  return shorter >= 30 && shorter / longer >= 0.82 && (a.includes(b) || b.includes(a));
}

function hasBalancedQuotes(value = '') {
  const pairs = [['«', '»'], ['“', '”']];
  return pairs.every(([open, close]) => (String(value).split(open).length - 1) === (String(value).split(close).length - 1));
}

export function isLikelyNewsSource(input = {}) {
  return isLikelyNewsContent(input);
}

export function validateProductionNews(value, input = {}) {
  const titleRu = polishEditorialNames(value?.titleRu || '').replace(/\s+/g, ' ').trim();
  const briefRu = polishEditorialNames(value?.briefRu || '').replace(/\n{3,}/g, '\n\n').trim();
  const reasons = [];

  const titleCyr = countLetters(titleRu, /[А-Яа-яЁё]/g);
  const titleLat = countLetters(titleRu, /[A-Za-z]/g);
  const briefCyr = countLetters(briefRu, /[А-Яа-яЁё]/g);
  const briefLat = countLetters(briefRu, /[A-Za-z]/g);

  if (!titleCyr) reasons.push('title has no Cyrillic');
  if (!briefCyr) reasons.push('brief has no Cyrillic');
  if (titleRu.length < 25 || titleRu.length > 180) reasons.push(`title length ${titleRu.length}`);
  if (briefRu.length < 135 || briefRu.length > 720) reasons.push(`brief length ${briefRu.length}`);
  if ((briefRu.match(/[.!?](?:[»”)]?)(?:\s|$)/g) || []).length < 2) reasons.push('brief has fewer than 2 complete sentences');
  if (!/[.!?…»”)]$/.test(briefRu)) reasons.push('brief does not end as a complete sentence');
  if (truncatedBriefPattern.test(briefRu)) reasons.push('brief looks truncated');
  if (!hasBalancedQuotes(`${titleRu} ${briefRu}`)) reasons.push('unbalanced quotation marks');
  if (headlineRepeatedInLead(titleRu, briefRu)) reasons.push('lead repeats headline');

  if (titleLat > 28 && titleLat > titleCyr * 2.4) reasons.push('title is dominated by untranslated English');
  if (briefLat > 45 && briefLat > briefCyr * 0.65) reasons.push('brief is dominated by untranslated English');
  if (looksLikeUntranslatedClause(titleRu) && titleCyr < 35) reasons.push('untranslated English clause');
  if (looksLikeUntranslatedClause(briefRu) && briefLat > 35) reasons.push('untranslated English clause');

  if (metaPattern.test(`${titleRu} ${briefRu}`)) reasons.push('meta language');
  if (boilerplatePattern.test(briefRu)) reasons.push('site boilerplate leaked into brief');
  if (literalMachinePattern.test(`${titleRu} ${briefRu}`)) reasons.push('literal machine translation');
  if (awkwardRussianPattern.test(`${titleRu} ${briefRu}`)) reasons.push('awkward machine-like Russian');
  if (authorCommentPattern.test(`${titleRu} ${briefRu}`)) reasons.push('source-author commentary leaked');
  if (englishPossessiveCompanyPattern.test(`${titleRu} ${briefRu}`)) reasons.push('English possessive company name leaked into Russian copy');
  if (mixedScriptTokens(`${titleRu} ${briefRu}`).length) reasons.push('mixed Latin/Cyrillic token');
  if (/(?:^|\s)спустя(?:\s+\S+){0,7}\s+спустя(?:\s|$)/iu.test(titleRu) || /(?:^|\s)после(?:\s+\S+){0,7}\s+после(?:\s|$)/iu.test(titleRu)) {
    reasons.push('repeated connector in title');
  }

  const sentences = normalizedSentences(briefRu);
  if (sentences.length >= 2 && new Set(sentences).size !== sentences.length) reasons.push('duplicate sentence');

  const newNumbers = unsupportedNumbers(`${titleRu} ${briefRu}`, input);
  if (newNumbers.length) reasons.push(`unsupported number: ${newNumbers.join(', ')}`);

  const requiredEntities = [...new Set([
    ...requiredStableEntities(input),
    ...requiredContextEntities(input),
    ...requiredExplicitEntities(input)
  ])];
  for (const entity of requiredEntities) {
    if (!containsEntity(`${titleRu} ${briefRu}`, entity)) reasons.push(`source entity missing: ${entity}`);
  }

  return { ok: reasons.length === 0, reasons, titleRu, briefRu };
}

function finalize(generated, validation, { attempts, elapsedMs, salvaged = false } = {}) {
  return {
    ...generated,
    ...validation,
    reasons: validation.reasons,
    ok: validation.ok,
    attempts: attempts ?? generated.attempts,
    elapsedMs: elapsedMs ?? generated.elapsedMs,
    productionSalvaged: Boolean(salvaged && validation.ok)
  };
}

export async function editNewsToRussian(input, options = {}) {
  const maxNewTokens = Math.max(115, Math.min(145, Number(options.maxNewTokens || 130)));
  const first = await generateRussianDraft(input, { maxAttempts: 1, maxNewTokens });
  const firstValidation = validateProductionNews(first, input);
  if (firstValidation.ok) return finalize(first, firstValidation);

  const rejectionFeedback = `Редакционный контроль забраковал этот вариант: ${firstValidation.reasons.join('; ') || 'неестественный русский или формат'}. Перепиши текст полностью естественным литературным русским. Сохрани проверенные MUST_KEEP, цифры и факты источника, исправь грамматику и не повторяй заголовок первым предложением.`;
  const second = await generateRussianDraft({
    ...input,
    draftTitleRu: firstValidation.titleRu || first.titleRu || '',
    draftSummaryRu: `${rejectionFeedback}\n${firstValidation.briefRu || first.briefRu || ''}`.trim()
  }, { maxAttempts: 1, maxNewTokens });
  const secondValidation = validateProductionNews(second, input);

  return finalize(second, secondValidation, {
    attempts: Number(first.attempts || 1) + Number(second.attempts || 1),
    elapsedMs: Number(first.elapsedMs || 0) + Number(second.elapsedMs || 0),
    salvaged: true
  });
}
