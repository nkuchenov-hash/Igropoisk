import crypto from 'node:crypto';

const SOURCE_CONTEXT_METHODS = new Set([
  'primary-game-context-v1',
  'context-evidence-resolver',
  'github-model-context'
]);
const HEADLINE_AUXILIARY_SUFFIX = /\s+(?:Is|Are|Was|Were|Has|Have|Will|Would|Can|Could|May|Might)(?:\s+(?:Getting|Coming|Still|Now|Finally|Reportedly|Expected|Planned|Delayed|Launching|Releasing|Returning|Adding|Receiving|Being|Already|Apparently|Set|Years?|Months?|Weeks?|Days?))*$/i;

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slugify(value = '') {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export function cleanResolvedNewsGameTitle(value = '') {
  const original = String(value || '').replace(/\s+/g, ' ').trim();
  if (!original) return '';
  const cleaned = original.replace(HEADLINE_AUXILIARY_SUFFIX, '').trim();
  if (!cleaned || cleaned === original) return original;
  const originalWords = normalize(original).split(' ').filter(Boolean);
  const cleanedWords = normalize(cleaned).split(' ').filter(Boolean);
  if (originalWords.length >= 2 && cleanedWords.length < 2) return original;
  return cleaned;
}

function repairedTempId(game, title) {
  const current = String(game?.gameId || game?.game_id || '').trim();
  if (!current.startsWith('news_game_')) return current;
  if (game?.externalIds?.opencritic) return current;
  const method = String(game?.matchedBy || '');
  const prefix = method === 'primary-game-context-v1' ? 'news-primary:' : 'news-game:';
  return `news_game_${crypto.createHash('sha1').update(`${prefix}${normalize(title)}`).digest('hex').slice(0, 16)}`;
}

export function cleanResolvedNewsGame(game = null) {
  if (!game || typeof game !== 'object') return game;
  const title = cleanResolvedNewsGameTitle(game.title || '');
  if (!title || title === String(game.title || '').trim()) return game;
  const gameId = repairedTempId(game, title);
  return {
    ...game,
    ...(gameId ? { gameId } : {}),
    slug: slugify(title) || game.slug,
    title,
    titleCleanupApplied: true
  };
}

export function sourceContextGameHasStrongIdentity(game = {}) {
  const method = String(game?.matchedBy || '').trim();
  if (!SOURCE_CONTEXT_METHODS.has(method)) return false;
  const confidence = Number(game?.resolutionConfidence || 0);
  const evidence = game?.resolutionEvidence || {};
  return confidence >= 0.86 && evidence.title === true && (evidence.summary === true || evidence.url === true);
}
