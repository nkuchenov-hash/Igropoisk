const PERSON_ROLE_BEFORE = /\b(?:creator|director|designer|writer|producer|developer|actor|actress|founder|ceo|president|composer|artist|author|journalist|streamer|youtuber|modder)\s*$/i;
const PERSON_ACTION_AFTER = /^(?:reveals?|says?|explains?|announces?|talks?|discusses?|confirms?|teases?|wants?|calls?|thinks?|believes?|joins?|leaves?|returns?)\b/i;
const GENERIC_GAME_PREFIX = /^(?:(?:\d{4}|new|upcoming|classic|cult|indie)\s+)?(?:(?:action|tactical|turn[ -]?based|open[ -]?world|co[ -]?op|horror|dark fantasy|sci[ -]?fi|fantasy)\s+)*(?:rpg|jrpg|crpg|fps|mmo|mmorpg|shooter|fighter|roguelite|roguelike|adventure game)\s+/i;

export function normalizeNewsGameSafety(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function newsGameHintCandidateTitle(hint = {}) {
  const raw = String(hint?.title || hint?.slug || '').trim();
  if (!raw) return '';
  // Old poisoned Registry entries may have copied the slug into `title`.
  // Humanize only for safety analysis; valid untouched hints keep their original identity.
  if (!/\s/u.test(raw) && raw.includes('-')) return raw.replace(/-+/g, ' ').trim();
  return raw;
}

export function stripGenericGameDescriptor(value = '') {
  let result = String(value || '').trim();
  let previous = '';
  while (result && result !== previous) {
    previous = result;
    result = result.replace(GENERIC_GAME_PREFIX, '').trim();
  }
  return result;
}

function articleRawText(item = {}) {
  return [item.titleEn, item.title, item.titleRu, item.summaryEn, item.summary, item.summaryRu]
    .filter(Boolean)
    .join(' · ');
}

export function candidateIsPersonInContext(item = {}, candidateTitle = '') {
  const candidate = normalizeNewsGameSafety(candidateTitle);
  if (!candidate || candidate.split(' ').length < 2) return false;
  const article = normalizeNewsGameSafety(articleRawText(item));
  if (!article) return false;

  let from = 0;
  while (from < article.length) {
    const index = article.indexOf(candidate, from);
    if (index < 0) break;
    const before = article.slice(Math.max(0, index - 55), index).trim();
    const after = article.slice(index + candidate.length, index + candidate.length + 35).trim();
    if (PERSON_ROLE_BEFORE.test(before) || PERSON_ACTION_AFTER.test(after)) return true;
    from = index + candidate.length;
  }
  return false;
}

export function collectPersonCandidateKeys(items = []) {
  const keys = new Set();
  for (const item of items || []) {
    for (const hint of Array.isArray(item?.games) ? item.games : []) {
      const candidate = newsGameHintCandidateTitle(hint);
      if (candidate && candidateIsPersonInContext(item, candidate)) keys.add(normalizeNewsGameSafety(candidate));
    }
  }
  return keys;
}

export function sanitizeNewsGameHint(item = {}, hint = {}, { knownPersonCandidates = new Set() } = {}) {
  const rawTitle = String(hint?.title || hint?.slug || '').trim();
  const safetyTitle = newsGameHintCandidateTitle(hint);
  if (!rawTitle || !safetyTitle) return null;
  const safetyKey = normalizeNewsGameSafety(safetyTitle);
  if (knownPersonCandidates.has(safetyKey) || candidateIsPersonInContext(item, safetyTitle)) return null;

  const strippedTitle = stripGenericGameDescriptor(safetyTitle);
  if (!strippedTitle || knownPersonCandidates.has(normalizeNewsGameSafety(strippedTitle)) || candidateIsPersonInContext(item, strippedTitle)) return null;

  const descriptorChanged = normalizeNewsGameSafety(strippedTitle) !== safetyKey;
  if (!descriptorChanged) return hint;

  // A generic article descriptor such as "RPG" is not part of a game identity.
  // Drop old canonical identifiers so a malformed historical Registry record cannot
  // be reused merely because the hydrated archive still contains its old gameId.
  const sanitized = { ...hint, title: strippedTitle };
  delete sanitized.gameId;
  delete sanitized.game_id;
  delete sanitized.slug;
  delete sanitized.pageUrl;
  delete sanitized.page_url;
  delete sanitized.externalIds;
  return sanitized;
}
