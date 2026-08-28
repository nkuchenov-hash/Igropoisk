import {
  editNewsToRussian as generateRussianDraft,
  fetchArticleText,
  normalizeEditorialNames,
  warmNewsEditor
} from './news-editor-qwen.mjs';

export { fetchArticleText, warmNewsEditor };

const boilerplatePattern = /cookie|newsletter|subscribe|sign up|privacy policy|when you (?:purchase|buy) through links|we may (?:earn|receive) (?:an )?(?:affiliate )?commission|affiliate commission|here(?:'s| is) how (?:it|this) works|support us|terms (?:of|and) conditions|all rights reserved|recommended by|shopping links|buying guide|follow us|more about|contact me with news/i;
const nonNewsPattern = /(?:\bhow to\b|\bwalkthrough\b|\bbeginner(?:'|’)?s guide\b|\bachievement guide\b|\bwhere to (?:find|get|catch|buy|unlock|open)\b|\bbest .{0,90}\bof all time\b|^\s*(?:the\s+)?\d+\s+best\b|\b(?:all|every) .{0,65}\b(?:locations?|collectibles?)\b|\b(?:tips?|guide) to help you\b|\b(?:best|top) (?:skills?|abilities|builds?|weapons?|armor|classes)\b|\b(?:gameplay )?tips?\b|\btips? and tricks?\b|\bwhat you need to know\b)/i;
const nonNewsUrlPattern = /(?:^|[\/_-])(?:guides?|walkthroughs?|tips)(?:[\/_-]|$)/i;
const literalMachinePattern = /(?:переоснащ(?:ен|ена|ение)|исключ(?:ен(?:а|о)?|ени[ея]) из списка)/iu;
// Do not use JS \b around Cyrillic phrases: \b is ASCII-centric and silently let real broken Russian pass.
const awkwardRussianPattern = /(?:леверед|бай[- ]?аут|крупн\w* купл[ие]-продаж|факт подтверждает (?:лишь )?теори|вызвал[аи]? спрос на возможн|оста[её]тся вероятн\w+ налич|удал[её]нн(?:ая|ую|ой) игр[ау]|микроперекуп|генеративн\w+\s+(?:аи|AI)|целый другой мир|не будут единственн\w+ в насилии|мать в хаосе|действие на PS5 начн[её]тся|полувещ|полувозмож|инфицированност|демоническ\w+ инфицир|продемонстрировал[аи]? \d+[\s\S]{0,30}копи[йи] продано|достиг(?:ла|ло|ли)?\s+консол\w*|собаком|постапокалипсисн\w+\s+действи\w*|уменьшен\w+\s+метр\w*\s+(?:враг|противник)\w*|уменьшения\s+метров|управля(?:йте|ет|ют|я)\s+(?:день|ночь)|распадаясь\s+на\s+групп\w*|система\s+wanted|сниз\w+\s+уровень\s+внимания|действие\s+в\s+постапокалиптическ\w+|правомерност\w+\s+поступк\w*|появляющ\w+\s+ангел\w+\s+и\s+демон\w+)/iu;
const metaPattern = /(?:я как ии|искусственный интеллект|как модель|перевод статьи|в статье говорится|по данным материала)/iu;
const authorCommentPattern = /\b(?:i think|i'm|i am|we think|we're|my bet|i bet|i'm just glad)\b/i;
const truncatedBriefPattern = /(?:\.\.\.|…)/u;

const stableEntities = [
  'Ubisoft', 'EA', 'Electronic Arts', 'Steam', 'Xbox', 'PlayStation', 'Nintendo', 'NVIDIA', 'AMD',
  'Konami', 'Capcom', 'SEGA', 'Bethesda', 'Valve', 'Rockstar', 'Activision', 'miHoYo', 'HoYoverse',
  'Pearl Abyss', 'CD Projekt Red', 'Gamescom', 'QuakeCon', 'Epic Games', 'Bandai Namco'
];

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
    .replace(/(?<![\p{L}\p{N}])Nvidia(?![\p{L}\p{N}])/gu, 'NVIDIA');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsEntity(value = '', entity = '') {
  const text = canonical(value);
  const needle = canonical(entity);
  if (!needle) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function countLetters(value = '', pattern) {
  return (String(value).match(pattern) || []).length;
}

function mixedScriptTokens(value = '') {
  return (String(value).match(/[\p{L}\p{N}'’.-]+/gu) || [])
    .filter(token => /[A-Za-z]/.test(token) && /[А-Яа-яЁё]/.test(token));
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

export function isLikelyNewsSource(input = {}) {
  const title = String(input?.title || input?.titleEn || '').replace(/\s+/g, ' ').trim();
  const url = String(input?.url || input?.primaryUrl || '').trim();
  if (!title && !url) return true;
  return !nonNewsPattern.test(title) && !nonNewsUrlPattern.test(url);
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
  if ((briefRu.match(/[.!?](?:\s|$)/g) || []).length < 2) reasons.push('brief has fewer than 2 sentences');
  if (truncatedBriefPattern.test(briefRu)) reasons.push('brief looks truncated');

  if (titleLat > 28 && titleLat > titleCyr * 2.4) reasons.push('title is dominated by untranslated English');
  if (briefLat > 45 && briefLat > briefCyr * 0.65) reasons.push('brief is dominated by untranslated English');
  if (looksLikeUntranslatedClause(titleRu) && titleCyr < 35) reasons.push('untranslated English clause');
  if (looksLikeUntranslatedClause(briefRu) && briefLat > 35) reasons.push('untranslated English clause');

  if (metaPattern.test(`${titleRu} ${briefRu}`)) reasons.push('meta language');
  if (boilerplatePattern.test(briefRu)) reasons.push('site boilerplate leaked into brief');
  if (literalMachinePattern.test(`${titleRu} ${briefRu}`)) reasons.push('literal machine translation');
  if (awkwardRussianPattern.test(`${titleRu} ${briefRu}`)) reasons.push('awkward machine-like Russian');
  if (authorCommentPattern.test(`${titleRu} ${briefRu}`)) reasons.push('source-author commentary leaked');
  if (mixedScriptTokens(`${titleRu} ${briefRu}`).length) reasons.push('mixed Latin/Cyrillic token');
  if (/(?:^|\s)спустя(?:\s+\S+){0,7}\s+спустя(?:\s|$)/iu.test(titleRu) || /(?:^|\s)после(?:\s+\S+){0,7}\s+после(?:\s|$)/iu.test(titleRu)) {
    reasons.push('repeated connector in title');
  }

  const sentences = normalizedSentences(briefRu);
  if (sentences.length >= 2 && new Set(sentences).size !== sentences.length) reasons.push('duplicate sentence');

  const newNumbers = unsupportedNumbers(`${titleRu} ${briefRu}`, input);
  if (newNumbers.length) reasons.push(`unsupported number: ${newNumbers.join(', ')}`);

  for (const entity of requiredStableEntities(input)) {
    if (!containsEntity(`${titleRu} ${briefRu}`, entity)) reasons.push(`stable entity missing: ${entity}`);
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
  const maxNewTokens = Math.max(120, Math.min(165, Number(options.maxNewTokens || 150)));
  const first = await generateRussianDraft(input, { maxAttempts: 1, maxNewTokens });
  const firstValidation = validateProductionNews(first, input);
  if (firstValidation.ok) return finalize(first, firstValidation);

  // Give the local editor one explicit rewrite opportunity before dropping a fresh story.
  // Include the production rejection reasons in the machine-draft context so Qwen knows
  // exactly what failed instead of blindly paraphrasing the same broken wording again.
  const rejectionFeedback = `Редакционный контроль забраковал этот вариант: ${firstValidation.reasons.join('; ') || 'неестественный русский или формат'}. Перепиши его полностью естественным русским и не повторяй эти ошибки.`;
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
