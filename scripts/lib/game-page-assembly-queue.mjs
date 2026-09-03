const clean = value => String(value ?? '').trim();
const comparable = value => clean(value)
  .normalize('NFKD')
  .replace(/[’‘]/gu, "'")
  .replace(/[–—]/gu, '-')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .toLocaleLowerCase('en-US');

export const GAME_PAGE_ASSEMBLY_QUEUE_PREFIX = 'queues/game-page-assembly/pending/';

const EXPLICIT_EDITION = /\b(?:deluxe|ultimate|gold|complete|collector'?s|digital deluxe|goty|game of the year)\s+edition\b/iu;
const REMASTER = /\b(remaster(?:ed)?|definitive edition|hd collection|anniversary edition)\b/iu;
const REMAKE = /\b(remake|reimagined)\b/iu;
const DLC = /\b(dlc|expansion|season pass|story pack|add[- ]?on)\b/iu;
const EMBEDDED_KINDS = new Set(['edition', 'remaster', 'dlc', 'expansion']);
const GENERIC_NON_TITLES = new Set(['a', 'an', 'the', 'game', 'games', 'gaming', 'video', 'play']);

export function isCredibleQueuedGameIdentity({title, slug} = {}) {
  const normalizedTitle = comparable(title);
  const normalizedSlug = comparable(String(slug || '').replace(/-/gu, ' '));
  if (!normalizedTitle || !normalizedSlug) return false;
  if (GENERIC_NON_TITLES.has(normalizedTitle)) return false;
  if (normalizedTitle.length < 2 || normalizedSlug.length < 2) return false;
  return true;
}

export function safeQueuedGameKind(title) {
  const value = clean(title);
  if (DLC.test(value)) return /expansion/iu.test(value) ? 'expansion' : 'dlc';
  if (REMAKE.test(value)) return 'remake';
  if (REMASTER.test(value)) return 'remaster';
  if (EXPLICIT_EDITION.test(value)) return 'edition';
  return 'game';
}

export function normalizeGamePageAssemblyRequest(input = {}, options = {}) {
  const gameId = clean(input.game_id ?? input.gameId);
  const slug = clean(input.slug).toLowerCase();
  const title = clean(input.title);
  const identityVerified = input.identity_verified === true || input.identityVerified === true;
  if (!gameId || gameId.startsWith('news_game_')) throw new Error('Queue request requires a canonical game_id.');
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid queue slug: ${slug || '(empty)'}`);
  if (!title) throw new Error(`Queue request ${gameId} requires a title.`);
  if (!isCredibleQueuedGameIdentity({title, slug})) throw new Error(`Queue request ${gameId} has a non-credible game identity.`);
  if (!identityVerified) throw new Error(`Queue request ${gameId} must be identity-verified.`);
  const now = options.now ?? new Date().toISOString();
  const newsId = clean(input.news_id ?? input.newsId);
  return {
    schema_version: 1,
    state: 'pending',
    request_id: gameId,
    game_id: gameId,
    slug,
    title,
    kind: safeQueuedGameKind(title),
    source: 'news',
    source_url: clean(input.source_url ?? input.sourceUrl) || null,
    news_ids: newsId ? [newsId] : [],
    published_at: clean(input.published_at ?? input.publishedAt) || null,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 1) || 0)),
    identity_verified: true,
    verified_external: input.verified_external === true || input.verifiedExternal === true,
    verification_sources: Array.isArray(input.verification_sources ?? input.verificationSources)
      ? (input.verification_sources ?? input.verificationSources)
      : [],
    matched_by: clean(input.matched_by ?? input.matchedBy) || null,
    first_seen_at: clean(input.first_seen_at) || now,
    last_seen_at: now
  };
}

export function mergeGamePageAssemblyRequests(previous = null, incoming) {
  if (!previous) return incoming;
  return {
    ...incoming,
    first_seen_at: clean(previous.first_seen_at) || incoming.first_seen_at,
    news_ids: [...new Set([...(Array.isArray(previous.news_ids) ? previous.news_ids : []), ...(incoming.news_ids ?? [])].filter(Boolean))]
  };
}

export function gamePageAssemblyObjectKey(request) {
  const normalized = normalizeGamePageAssemblyRequest(request, {now: request.last_seen_at ?? request.first_seen_at ?? new Date().toISOString()});
  return `${GAME_PAGE_ASSEMBLY_QUEUE_PREFIX}${normalized.game_id}.json`;
}

export function queueRequestToRegistryCandidate(request) {
  const item = normalizeGamePageAssemblyRequest(request, {now: request.last_seen_at ?? request.first_seen_at ?? new Date().toISOString()});
  return {
    game_id: item.game_id,
    title: item.title,
    slug: item.slug,
    kind: item.kind,
    confidence: Math.max(0.85, item.confidence),
    status: 'identified',
    statusReason: 'verified game queued for full page assembly',
    discoveryReason: 'verified news mentions a game without a production page',
    sourceRecordId: item.news_ids[0] ?? item.request_id,
    source: {
      type: item.verified_external ? 'structured_database' : 'professional_publication',
      name: 'game-page-assembly-queue:news',
      url: item.source_url
    }
  };
}

export function reconcileQueuedCandidateWithRegistry(api, request, options = {}) {
  const item = normalizeGamePageAssemblyRequest(request, {now: request.last_seen_at ?? request.first_seen_at ?? options.now ?? new Date().toISOString()});
  const candidate = queueRequestToRegistryCandidate(item);
  const byId = api?.findById?.(item.game_id) ?? null;
  const bySlug = api?.findBySlug?.(item.slug) ?? null;
  if (byId && bySlug && byId.id !== bySlug.id) return {candidate, entity: null, reconciled: false, reason: 'canonical_id_slug_conflict'};
  const target = byId ?? bySlug;
  if (!target) return {candidate, entity: null, reconciled: false, reason: 'new_queue_identity'};
  const targetTitle = comparable(target.identity?.canonicalTitle?.value);
  if (!targetTitle || targetTitle !== comparable(item.title)) return {candidate, entity: target, reconciled: false, reason: 'title_conflict'};

  candidate.game_id = target.id;
  const currentKind = clean(target.identity?.kind?.value) || 'unknown';
  const canRepairKind = target.workflow?.pageStatus !== 'published'
    && item.kind === 'game'
    && EMBEDDED_KINDS.has(currentKind);
  if (canRepairKind) {
    target.identity.kind.value = 'game';
    target.presentation ??= {};
    target.presentation.standalonePage = true;
    target.presentation.embeddedTab = null;
    target.updatedAt = options.now ?? new Date().toISOString();
    target.auditLog ??= [];
    target.auditLog.push({
      at: target.updatedAt,
      action: 'queue_identity_kind_repaired',
      actor: 'game-page-assembly-queue',
      from: currentKind,
      to: 'game',
      reason: 'verified exact title from temporary page-assembly queue'
    });
    return {candidate, entity: target, reconciled: true, reason: 'verified_queue_repaired_false_embedded_kind'};
  }
  return {candidate, entity: target, reconciled: candidate.game_id !== item.game_id, reason: 'verified_queue_reused_existing_identity'};
}
