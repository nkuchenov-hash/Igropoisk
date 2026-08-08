const boilerplatePatterns = [
  /\s+The post\s+[\s\S]*?\s+appeared first on\s+[\s\S]*$/i,
  /\s+(?:Сообщение|Публикация)\s+[\s\S]*?\s+впервые\s+появил(?:ось|ась)\s+на\s+[\s\S]*$/i,
  /\s+(?:Read|Learn) more\s*(?:[→»›]|\.\.\.)?[\s\S]*$/i,
  /\s+(?:Читать|Подробнее)\s*(?:далее)?\s*(?:[→»›]|\.\.\.)?[\s\S]*$/i,
  /\s+(?:Subscribe|Sign up|Подпишитесь)[\s\S]*$/i
];

const promotionalLead = /^(?:hi|hello|привет|hey\b|we(?:'re| are) (?:excited|thrilled|happy|pleased|delighted)|мы (?:очень )?(?:рады|счастливы)|today we(?:'re| are) (?:excited|thrilled|happy|pleased)|сегодня мы (?:рады|счастливы))/i;
const callToAction = /\b(?:stay tuned|wishlist|pre-order|preorder|subscribe|visit our|check out|don'?t miss|следите за|добавляйте? в желаемое|предзаказ|подписывайтесь|заходите)\b/i;
const keyAction = /\b(?:release|launch|arriv|announce|reveal|confirm|add|remove|delay|cancel|update|patch|expansion|dlc|beta|demo|sales?|sold|acquir|close|layoff|ship|available|выход|выйдет|вышел|вышла|релиз|анонс|представ|показа|подтверд|добав|убер|удал|перенес|отмен|обнов|патч|дополнен|бета|демо|продаж|тираж|закры|увольнен|доступ)/i;
const timeSignal = /\b(?:today|tomorrow|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december|сегодня|завтра|недел|месяц|год|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|\d{1,2}[./-]\d{1,2}|20\d{2})\b/i;
const platformSignal = /\b(?:pc|steam|playstation|ps5|xbox|switch|nintendo|game pass|epic games|gog)\b/i;
const weakPronounLead = /^(?:it|this|that|these|those|he|she|they|это|эта|этот|эти|он|она|они)\b/i;

function decode(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\[\s*(?:…|\.\.\.)\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeBoilerplate(value) {
  let text = value;
  for (const pattern of boilerplatePatterns) text = text.replace(pattern, '').trim();
  return text;
}

function sentenceList(value) {
  const matches = value.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [];
  return matches.map(sentence => sentence.replace(/\s+/g, ' ').trim()).filter(sentence => sentence.length >= 24);
}

function tokens(value = '') {
  return new Set(String(value).toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4));
}

function titleOverlap(sentence, title) {
  const titleTokens = tokens(title);
  if (!titleTokens.size) return 0;
  const sentenceTokens = tokens(sentence);
  let common = 0;
  for (const token of titleTokens) if (sentenceTokens.has(token)) common += 1;
  return common / titleTokens.size;
}

function scoreSentence(sentence, title, index) {
  let score = Math.max(0, 4 - index * 0.45);
  if (keyAction.test(sentence)) score += 5;
  if (timeSignal.test(sentence)) score += 2.2;
  if (platformSignal.test(sentence)) score += 1.4;
  if (/\d/.test(sentence)) score += 1.1;
  score += Math.min(3, titleOverlap(sentence, title) * 5);
  if (sentence.length >= 70 && sentence.length <= 260) score += 1.4;
  if (promotionalLead.test(sentence)) score -= 5;
  if (callToAction.test(sentence)) score -= 6;
  if (weakPronounLead.test(sentence)) score -= 1.5;
  return score;
}

function dePromote(sentence) {
  return sentence
    .replace(/^(?:today,?\s*)?we(?:'re| are) (?:excited|thrilled|happy|pleased|delighted) to (?:announce|share|reveal|confirm|show)(?: that)?\s+/i, '')
    .replace(/^(?:сегодня\s+)?мы (?:очень )?(?:рады|счастливы) (?:сообщить|поделиться|представить|показать|подтвердить)(?:,? что)?\s+/i, '')
    .replace(/^we (?:want|wanted|would like) to (?:share|announce|reveal|confirm)(?: that)?\s+/i, '')
    .replace(/^мы (?:хотим|хотели бы) (?:сообщить|поделиться|представить|подтвердить)(?:,? что)?\s+/i, '')
    .replace(/^([a-zа-яё])/iu, character => character.toLocaleUpperCase())
    .trim();
}

function truncateAtBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars - 1);
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (boundary >= Math.min(120, maxChars * 0.45)) return slice.slice(0, boundary + 1).trim();
  const word = slice.lastIndexOf(' ');
  return `${slice.slice(0, word > 80 ? word : slice.length).trim()}…`;
}

export function editorializeNewsSummary(value = '', { title = '', maxChars = 520 } = {}) {
  const cleaned = removeBoilerplate(decode(value));
  if (!cleaned) return '';

  const sentences = sentenceList(cleaned);
  if (!sentences.length) return truncateAtBoundary(cleaned, maxChars);

  const candidates = sentences
    .map((sentence, index) => ({ sentence: dePromote(sentence), index, score: scoreSentence(sentence, title, index) }))
    .filter(candidate => candidate.sentence.length >= 24 && !callToAction.test(candidate.sentence));

  if (!candidates.length) return truncateAtBoundary(cleaned, maxChars);

  const lead = [...candidates].sort((a, b) => b.score - a.score || a.index - b.index)[0];
  const remainder = candidates
    .filter(candidate => candidate !== lead && candidate.score > -1)
    .sort((a, b) => a.index - b.index);

  const selected = [lead];
  for (const candidate of remainder) {
    if (selected.length >= 3) break;
    const proposed = [...selected, candidate].map(item => item.sentence).join(' ');
    if (proposed.length > maxChars) continue;
    selected.push(candidate);
  }

  let result = selected.map(candidate => candidate.sentence).join(' ').replace(/\s+/g, ' ').trim();
  if (result.length < 80 && candidates.length > selected.length) {
    const next = candidates.find(candidate => !selected.includes(candidate));
    if (next && `${result} ${next.sentence}`.length <= maxChars) result = `${result} ${next.sentence}`;
  }
  return truncateAtBoundary(result || cleaned, maxChars);
}
