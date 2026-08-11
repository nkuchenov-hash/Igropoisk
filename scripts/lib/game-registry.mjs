import crypto from 'node:crypto';

export const GAME_STATUSES = Object.freeze([
  'discovered','identified','enriching','ready_for_page','page_draft','published',
  'needs_review','rejected','merged_into_another_game'
]);
export const REVIEW_STATUSES = Object.freeze(['researching','draft','editorial_review','approved','published','update_required']);
export const ARTICLE_TYPES = Object.freeze([
  'igropoisk_review','professional_review','news','guide','mechanics_analysis',
  'development_history','technical','update_or_dlc'
]);
export const GAME_KINDS = Object.freeze(['game','remake','remaster','dlc','expansion','edition','collection','unknown']);
export const EMBEDDED_GAME_KINDS = Object.freeze(['edition','remaster','dlc','expansion']);
export const SOURCE_TRUST = Object.freeze({
  official_site: 100,
  official_platform_store: 90,
  official_press_release: 85,
  structured_database: 75,
  professional_publication: 65,
  platform_store: 60,
  automated_inference: 20,
  manual: 110
});

const EDITION_SUFFIX = /\b(?:deluxe|ultimate|gold|complete|collector'?s|digital deluxe|goty|game of the year)\s+edition\b/giu;
const REMASTER_WORD = /\b(remaster(?:ed)?|definitive edition|hd collection|anniversary edition)\b/iu;
const REMAKE_WORD = /\b(remake|reimagined)\b/iu;
const DLC_WORD = /\b(dlc|expansion|season pass|story pack|add[- ]?on)\b/iu;

export function isoNow(clock = Date) {
  return new clock().toISOString();
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[™®©]/gu, '')
    .normalize('NFKD')
    .replace(/[’‘]/gu, "'")
    .replace(/[–—]/gu, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

export function normalizeAlias(value, {stripCommercialEdition = false} = {}) {
  const text = stripCommercialEdition ? String(value ?? '').replace(EDITION_SUFFIX, '') : value;
  return normalizeText(text);
}

export function slugify(value) {
  const ascii = String(value ?? '').replace(/[™®©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function inferKind(candidate = {}) {
  const explicit = String(candidate.kind ?? candidate.type ?? '').toLowerCase();
  if (GAME_KINDS.includes(explicit)) return explicit;
  const title = `${candidate.title ?? candidate.name ?? ''} ${candidate.subtitle ?? ''}`;
  if (DLC_WORD.test(title)) return /expansion/iu.test(title) ? 'expansion' : 'dlc';
  if (REMAKE_WORD.test(title)) return 'remake';
  if (REMASTER_WORD.test(title)) return 'remaster';
  if (/\b(deluxe|ultimate|gold|complete|collector'?s)\b/iu.test(title)) return 'edition';
  return 'game';
}

export function isEmbeddedGameKind(value) {
  const kind = typeof value === 'string' ? value : inferKind(value ?? {});
  return EMBEDDED_GAME_KINDS.includes(kind);
}

export function stableGameId(candidate = {}) {
  const external = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  const strongest = [
    ['igdb', external.igdbId], ['rawg', external.rawgId], ['steam', external.steamAppId],
    ['playstation', external.playstation], ['xbox', external.xbox], ['nintendo', external.nintendo]
  ].find(([, value]) => Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '');
  const strongestValue = Array.isArray(strongest?.[1]) ? strongest[1].join(',') : strongest?.[1];
  const basis = strongest
    ? `${strongest[0]}:${strongestValue}`
    : `${normalizeAlias(candidate.canonicalTitle ?? candidate.title ?? candidate.name)}:${candidate.releaseYear ?? candidate.year ?? ''}:${inferKind(candidate)}`;
  return `game_${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 20)}`;
}

function explicitCanonicalGameId(candidate = {}) {
  const raw = candidate.raw ?? {};
  const value = candidate.gameId ?? candidate.game_id ?? raw.gameId ?? raw.game_id ?? (String(candidate.id ?? '').startsWith('game_') ? candidate.id : null);
  return value ? String(value) : null;
}

export function normalizeExternalIds(input = {}) {
  const steam = input.steamAppId ?? input.steam_appid ?? input.steam ?? input.appid ?? null;
  const igdb = input.igdbId ?? input.igdb_id ?? input.igdb ?? null;
  const rawg = input.rawgId ?? input.rawg_id ?? input.rawg ?? null;
  return {
    steamAppId: steam === null || steam === '' ? null : String(steam),
    igdbId: igdb === null || igdb === '' ? null : String(igdb),
    rawgId: rawg === null || rawg === '' ? null : String(rawg),
    playstation: normalizeIdentifierSet(input.playstation ?? input.playStation ?? input.psn),
    xbox: normalizeIdentifierSet(input.xbox ?? input.microsoft),
    nintendo: normalizeIdentifierSet(input.nintendo)
  };
}

function normalizeIdentifierSet(value) {
  if (value === null || value === undefined || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : [value]).map(String).map(item => item.trim()).filter(Boolean))].sort();
}

export function sourceDescriptor(source = {}) {
  const type = source.type && SOURCE_TRUST[source.type] ? source.type : 'automated_inference';
  return {
    type,
    name: source.name ?? null,
    url: source.url ?? null,
    externalId: source.externalId ?? source.external_id ?? null
  };
}

export function fieldValue(value, source = {}, options = {}) {
  const now = options.now ?? isoNow();
  return {
    value,
    source: sourceDescriptor(source),
    fetchedAt: options.fetchedAt ?? options.fetched_at ?? now,
    lastCheckedAt: options.lastCheckedAt ?? options.last_checked_at ?? now,
    confidence: Math.max(0, Math.min(1, Number(options.confidence ?? source.confidence ?? 0.5))),
    editorialLock: Boolean(options.editorialLock ?? options.editorial_lock ?? false)
  };
}

export function isFieldEnvelope(value) {
  return Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'value') && value.source);
}

export function trustScore(envelope) {
  if (!isFieldEnvelope(envelope)) return 0;
  return (SOURCE_TRUST[envelope.source?.type] ?? 0) * (Number(envelope.confidence) || 0);
}

export function mergeField(current, incoming) {
  if (!incoming) return current ?? null;
  if (!current) return incoming;
  if (current.editorialLock) return current;
  if (incoming.editorialLock) return incoming;
  return trustScore(incoming) > trustScore(current) ? incoming : current;
}

export function createGameEntity(candidate = {}, options = {}) {
  const now = options.now ?? isoNow();
  const title = candidate.canonicalTitle ?? candidate.title ?? candidate.name ?? candidate.slug ?? 'Untitled game';
  const slug = candidate.slug ?? slugify(title);
  const aliases = new Set([title, ...(candidate.aliases ?? []), ...(candidate.alternativeTitles ?? [])].filter(Boolean));
  const source = candidate.source ?? {type: 'automated_inference', name: candidate.discoverySource ?? 'unknown'};
  const status = GAME_STATUSES.includes(candidate.status) ? candidate.status : 'discovered';
  const kind = inferKind(candidate);
  return {
    schemaVersion: 'game-entity/v1',
    id: explicitCanonicalGameId(candidate) ?? stableGameId(candidate),
    identity: {
      canonicalTitle: fieldValue(title, source, {now, confidence: candidate.confidence ?? 0.5}),
      slug: fieldValue(slug, source, {now, confidence: candidate.confidence ?? 0.5}),
      aliases: fieldValue([...aliases], source, {now, confidence: candidate.confidence ?? 0.5}),
      abbreviations: fieldValue(candidate.abbreviations ?? [], source, {now, confidence: candidate.confidence ?? 0.5}),
      originalTitle: fieldValue(candidate.originalTitle ?? candidate.original_title ?? null, source, {now, confidence: candidate.confidence ?? 0.5}),
      series: fieldValue(candidate.series ?? null, source, {now, confidence: candidate.confidence ?? 0.5}),
      kind: fieldValue(kind, source, {now, confidence: candidate.confidence ?? 0.7})
    },
    externalIds: normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate),
    fields: {},
    releases: normalizeReleases(candidate.releases ?? candidate.releaseEvents ?? (candidate.releaseYear ?? candidate.year ? [{date: String(candidate.releaseYear ?? candidate.year), precision: 'year', status: 'released'}] : []), source, now),
    media: normalizeMedia(candidate.media ?? {}, source, now),
    relations: {
      series: candidate.relations?.series ?? [],
      baseGameId: candidate.relations?.baseGameId ?? null,
      relatedGameIds: candidate.relations?.relatedGameIds ?? []
    },
    variants: [],
    presentation: {
      standalonePage: candidate.standalonePage === true || !isEmbeddedGameKind(kind),
      embeddedTab: isEmbeddedGameKind(kind) ? 'editions' : null
    },
    discovery: [{
      source: sourceDescriptor(source),
      discoveredAt: candidate.discoveredAt ?? now,
      reason: candidate.discoveryReason ?? candidate.reason ?? 'candidate_registered',
      sourceRecordId: candidate.sourceRecordId ?? null
    }],
    workflow: {
      status,
      statusReason: candidate.statusReason ?? candidate.status_reason ?? 'registered as candidate',
      pageStatus: candidate.pageStatus ?? 'not_started',
      researchStatus: candidate.researchStatus ?? 'not_started',
      articleStatus: candidate.articleStatus ?? 'not_started',
      igropoiskReviewStatus: REVIEW_STATUSES.includes(candidate.igropoiskReviewStatus) ? candidate.igropoiskReviewStatus : 'researching'
    },
    priority: {score: 0, reasons: [], calculatedAt: now},
    editorial: {fieldLocks: {}, notes: []},
    conflicts: [],
    possibleDuplicates: [],
    articles: [],
    revisions: [],
    auditLog: [{at: now, action: 'created', actor: options.actor ?? 'system', reason: candidate.discoveryReason ?? 'candidate_registered'}],
    mergedIntoGameId: null,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeReleases(releases, source, now) {
  return (Array.isArray(releases) ? releases : [releases]).filter(Boolean).map((release, index) => ({
    id: release.id ?? `release_${index}_${crypto.createHash('sha1').update(JSON.stringify(release)).digest('hex').slice(0, 8)}`,
    platform: fieldValue(release.platform ?? null, release.source ?? source, {now, confidence: release.confidence ?? 0.5}),
    region: fieldValue(release.region ?? 'global', release.source ?? source, {now, confidence: release.confidence ?? 0.5}),
    date: fieldValue(release.date ?? release.date_start ?? release.release_date ?? null, release.source ?? source, {now, confidence: release.confidence ?? 0.5}),
    precision: release.precision ?? (release.date ? 'day' : 'unknown'),
    status: release.status ?? 'announced'
  }));
}

function normalizeMedia(media, source, now) {
  const entries = [];
  for (const [kind, raw] of Object.entries(media ?? {})) {
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (!item) continue;
      const value = typeof item === 'string' ? {url: item} : item;
      entries.push({
        id: value.id ?? `media_${crypto.createHash('sha1').update(`${kind}:${value.url ?? value.objectKey ?? JSON.stringify(value)}`).digest('hex').slice(0, 12)}`,
        kind,
        url: value.url ?? null,
        objectKey: value.objectKey ?? value.object_key ?? null,
        checksum: value.checksum ?? null,
        source: sourceDescriptor(value.source ?? source),
        fetchedAt: value.fetchedAt ?? now,
        revisions: value.revisions ?? []
      });
    }
  }
  return entries;
}

export function entityAliases(entity) {
  return [
    entity.identity?.canonicalTitle?.value,
    entity.identity?.originalTitle?.value,
    ...(entity.identity?.aliases?.value ?? []),
    ...(entity.identity?.abbreviations?.value ?? [])
  ].filter(Boolean);
}

export function exactExternalMatches(entity, candidate) {
  const incoming = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  const existing = entity.externalIds ?? {};
  const scalarKeys = ['steamAppId','igdbId','rawgId'];
  for (const key of scalarKeys) if (incoming[key] && existing[key] && String(incoming[key]) === String(existing[key])) return true;
  for (const key of ['playstation','xbox','nintendo']) {
    if ((incoming[key] ?? []).some(value => (existing[key] ?? []).includes(value))) return true;
  }
  return false;
}

export function compareIdentity(entity, candidate) {
  if (entity.workflow?.status === 'merged_into_another_game') return {decision: 'none', reasons: ['entity_merged']};
  if (exactExternalMatches(entity, candidate)) return {decision: 'match', confidence: 1, reasons: ['exact_external_id']};
  const incomingKind = inferKind(candidate);
  const existingKind = entity.identity?.kind?.value ?? 'unknown';
  const incomingTitle = normalizeAlias(candidate.canonicalTitle ?? candidate.title ?? candidate.name);
  const incomingCommercial = normalizeAlias(candidate.canonicalTitle ?? candidate.title ?? candidate.name, {stripCommercialEdition: true});
  const aliases = entityAliases(entity).map(normalizeAlias);
  const commercialAliases = entityAliases(entity).map(value => normalizeAlias(value, {stripCommercialEdition: true}));
  const exact = aliases.includes(incomingTitle);
  const commercialExact = commercialAliases.includes(incomingCommercial);
  const existingYear = Number(String(entity.releases?.[0]?.date?.value ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0);
  const incomingYear = Number(candidate.releaseYear ?? candidate.year ?? String(candidate.releaseDate ?? candidate.release_date ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0);
  if ((exact || commercialExact) && existingYear && incomingYear && existingYear !== incomingYear) {
    return {decision: 'none', confidence: 0, reasons: [`release_year_diff:${existingYear}:${incomingYear}`]};
  }
  if (exact && incomingKind === existingKind) return {decision: 'match', confidence: 0.98, reasons: ['exact_alias_and_kind']};
  if (exact && ['game','edition'].includes(incomingKind) && ['game','edition'].includes(existingKind)) {
    return {decision: 'match', confidence: 0.9, reasons: ['exact_alias_commercial_edition']};
  }
  if (commercialExact && ['game','edition'].includes(incomingKind) && ['game','edition'].includes(existingKind)) {
    return {decision: 'match', confidence: 0.84, reasons: ['commercial_edition_variant']};
  }
  if ((exact || commercialExact) && incomingKind !== existingKind) {
    return {decision: 'ambiguous', confidence: 0.7, reasons: [`kind_conflict:${existingKind}:${incomingKind}`]};
  }
  return {decision: 'none', confidence: 0, reasons: []};
}

export function createRegistry(seed = {}) {
  return {
    schemaVersion: 'game-registry/v1',
    generatedAt: seed.generatedAt ?? isoNow(),
    games: seed.games ?? {},
    indexes: seed.indexes ?? {slug: {}, external: {}, alias: {}},
    reviewQueue: seed.reviewQueue ?? [],
    auditLog: seed.auditLog ?? []
  };
}

export function rebuildIndexes(registry) {
  const indexes = {slug: {}, external: {}, alias: {}};
  for (const entity of Object.values(registry.games ?? {})) {
    if (entity.workflow?.status === 'merged_into_another_game') continue;
    const slug = entity.identity?.slug?.value;
    if (slug) indexes.slug[slug] = entity.id;
    for (const [key, raw] of Object.entries(entity.externalIds ?? {})) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value !== null && value !== undefined && value !== '') indexes.external[`${key}:${value}`] = entity.id;
      }
    }
    for (const alias of entityAliases(entity)) {
      const key = normalizeAlias(alias);
      if (!key) continue;
      indexes.alias[key] ??= [];
      if (!indexes.alias[key].includes(entity.id)) indexes.alias[key].push(entity.id);
    }
  }
  for (const ids of Object.values(indexes.alias)) ids.sort();
  registry.indexes = indexes;
  registry.generatedAt = isoNow();
  return registry;
}

function mergeEntityCandidate(entity, candidate, options = {}) {
  const now = options.now ?? isoNow();
  const source = candidate.source ?? {type: 'automated_inference', name: candidate.discoverySource ?? 'unknown'};
  const incomingTitle = fieldValue(candidate.canonicalTitle ?? candidate.title ?? candidate.name ?? entity.identity.canonicalTitle.value, source, {now, confidence: candidate.confidence ?? 0.5});
  entity.identity.canonicalTitle = mergeField(entity.identity.canonicalTitle, incomingTitle);
  if (candidate.slug) entity.identity.slug = mergeField(entity.identity.slug, fieldValue(candidate.slug, source, {now, confidence: candidate.confidence ?? 0.5}));
  const aliases = new Set([...(entity.identity.aliases?.value ?? []), ...(candidate.aliases ?? []), candidate.title, candidate.name].filter(Boolean));
  entity.identity.aliases = mergeField(entity.identity.aliases, fieldValue([...aliases], source, {now, confidence: candidate.confidence ?? 0.5}));
  const external = normalizeExternalIds(candidate.externalIds ?? candidate.external_ids ?? candidate);
  for (const [key, value] of Object.entries(external)) {
    if (Array.isArray(value)) entity.externalIds[key] = [...new Set([...(entity.externalIds[key] ?? []), ...value])].sort();
    else if (!entity.externalIds[key] && value) entity.externalIds[key] = value;
    else if (value && entity.externalIds[key] && String(value) !== String(entity.externalIds[key])) {
      entity.conflicts.push({at: now, field: `externalIds.${key}`, current: entity.externalIds[key], incoming: value, source: sourceDescriptor(source)});
    }
  }
  entity.discovery.push({source: sourceDescriptor(source), discoveredAt: candidate.discoveredAt ?? now, reason: candidate.discoveryReason ?? 'candidate_enriched', sourceRecordId: candidate.sourceRecordId ?? null});
  entity.updatedAt = now;
  entity.auditLog.push({at: now, action: 'candidate_upserted', actor: options.actor ?? 'system', reason: candidate.discoveryReason ?? 'candidate_enriched'});
  return entity;
}

export class GameRegistryApi {
  constructor(registry = createRegistry(), options = {}) {
    this.registry = rebuildIndexes(registry);
    this.publicBaseUrl = String(options.publicBaseUrl ?? '/game').replace(/\/$/, '');
  }

  findById(id) { return this.registry.games?.[id] ?? null; }
  findBySlug(slug) { return this.findById(this.registry.indexes.slug?.[slug]); }
  findByExternalId(kind, value) { return this.findById(this.registry.indexes.external?.[`${kind}:${value}`]); }
  findByExactAlias(alias) {
    const ids = this.registry.indexes.alias?.[normalizeAlias(alias)] ?? [];
    return ids.map(id => this.findById(id)).filter(Boolean);
  }
  publicUrl(gameOrId) {
    const entity = typeof gameOrId === 'string' ? this.findById(gameOrId) : gameOrId;
    return entity?.identity?.slug?.value ? `${this.publicBaseUrl}/${entity.identity.slug.value}/` : null;
  }
  isPublished(gameOrId) {
    const entity = typeof gameOrId === 'string' ? this.findById(gameOrId) : gameOrId;
    return entity?.workflow?.status === 'published' && entity.workflow?.pageStatus === 'published';
  }
  releaseEvents(gameOrId) {
    const entity = typeof gameOrId === 'string' ? this.findById(gameOrId) : gameOrId;
    return [...(entity?.releases ?? [])];
  }
  relatedContent(gameOrId) {
    const entity = typeof gameOrId === 'string' ? this.findById(gameOrId) : gameOrId;
    return [...(entity?.articles ?? [])].sort((a,b) => Number(b.type === 'igropoisk_review') - Number(a.type === 'igropoisk_review'));
  }
  registerCandidate(candidate, options = {}) {
    const explicitId = explicitCanonicalGameId(candidate);
    if (explicitId) {
      const existing = this.findById(String(explicitId));
      if (existing) {
        const entity = mergeEntityCandidate(existing, candidate, options);
        rebuildIndexes(this.registry);
        return {decision: 'matched', entity, reasons: ['canonical_game_id']};
      }
    }
    const comparisons = Object.values(this.registry.games).map(entity => ({entity, ...compareIdentity(entity, candidate)}));
    const matches = comparisons.filter(item => item.decision === 'match').sort((a,b) => b.confidence - a.confidence);
    const ambiguous = comparisons.filter(item => item.decision === 'ambiguous');
    if (matches.length === 1 && !ambiguous.length) {
      const entity = mergeEntityCandidate(matches[0].entity, candidate, options);
      rebuildIndexes(this.registry);
      return {decision: 'matched', entity, reasons: matches[0].reasons};
    }
    if (matches.length > 1 || ambiguous.length) {
      const candidateId = stableGameId({...candidate, title: `${candidate.title ?? candidate.name}:${isoNow()}`});
      const review = {
        id: `review_${crypto.randomUUID()}`,
        candidateId,
        candidate,
        possibleGameIds: [...new Set([...matches, ...ambiguous].map(item => item.entity.id))],
        reasons: [...new Set([...matches, ...ambiguous].flatMap(item => item.reasons))],
        status: 'open', createdAt: options.now ?? isoNow()
      };
      this.registry.reviewQueue.push(review);
      return {decision: 'needs_review', review};
    }
    const entity = createGameEntity(candidate, options);
    while (this.registry.games[entity.id]) entity.id = `${entity.id}_${crypto.randomBytes(2).toString('hex')}`;
    this.registry.games[entity.id] = entity;
    rebuildIndexes(this.registry);
    return {decision: 'created', entity};
  }
  mergeGames(sourceId, targetId, options = {}) {
    const source = this.findById(sourceId); const target = this.findById(targetId);
    if (!source || !target || sourceId === targetId) throw new Error('Invalid merge');
    const now = options.now ?? isoNow();
    target.identity.aliases.value = [...new Set([...entityAliases(target), ...entityAliases(source)])];
    for (const [key, value] of Object.entries(source.externalIds ?? {})) {
      if (Array.isArray(value)) target.externalIds[key] = [...new Set([...(target.externalIds[key] ?? []), ...value])];
      else if (!target.externalIds[key]) target.externalIds[key] = value;
    }
    target.discovery.push(...(source.discovery ?? []));
    target.auditLog.push({at: now, action: 'game_merged_in', actor: options.actor ?? 'editor', sourceGameId: sourceId, reason: options.reason ?? 'manual_merge'});
    source.workflow.status = 'merged_into_another_game'; source.workflow.statusReason = options.reason ?? 'manual_merge';
    source.mergedIntoGameId = targetId; source.updatedAt = now;
    source.auditLog.push({at: now, action: 'merged_into_game', actor: options.actor ?? 'editor', targetGameId: targetId, reason: options.reason ?? 'manual_merge'});
    rebuildIndexes(this.registry); return target;
  }
  undoMerge(sourceId, options = {}) {
    const source = this.findById(sourceId);
    if (!source || source.workflow.status !== 'merged_into_another_game') throw new Error('Game is not merged');
    source.workflow.status = 'needs_review'; source.workflow.statusReason = options.reason ?? 'merge_undone';
    source.mergedIntoGameId = null; source.updatedAt = options.now ?? isoNow();
    source.auditLog.push({at: source.updatedAt, action: 'merge_undone', actor: options.actor ?? 'editor', reason: source.workflow.statusReason});
    rebuildIndexes(this.registry); return source;
  }
  lockField(gameId, fieldPath, options = {}) {
    const entity = this.findById(gameId); if (!entity) throw new Error('Game not found');
    entity.editorial.fieldLocks[fieldPath] = {locked: true, at: options.now ?? isoNow(), actor: options.actor ?? 'editor', reason: options.reason ?? 'manual_lock'};
    entity.auditLog.push({at: entity.editorial.fieldLocks[fieldPath].at, action: 'field_locked', fieldPath, actor: options.actor ?? 'editor'});
    return entity;
  }
  setStatus(gameId, status, reason, options = {}) {
    if (!GAME_STATUSES.includes(status)) throw new Error(`Unsupported status: ${status}`);
    const entity = this.findById(gameId); if (!entity) throw new Error('Game not found');
    const now = options.now ?? isoNow();
    entity.workflow.status = status; entity.workflow.statusReason = reason || 'status_updated'; entity.updatedAt = now;
    entity.auditLog.push({at: now, action: 'status_changed', actor: options.actor ?? 'system', status, reason: entity.workflow.statusReason});
    return entity;
  }
}

export function calculatePriority(entity, signals = {}, options = {}) {
  const weights = {
    publicationMentions: 18,
    igropoiskNewsMentions: 25,
    releaseWithin180Days: 22,
    releaseWithin30Days: 18,
    popularityRankTop100: 20,
    professionalReviewCount: 2,
    knownCompany: 12,
    explicitRequest: 35,
    partialPage: 15,
    ...options.weights
  };
  const reasons = [];
  let score = 0;
  const add = (key, multiplier = 1, detail = null) => { const points = weights[key] * multiplier; score += points; reasons.push({signal: key, points, detail}); };
  if (signals.publicationMentions > 0) add('publicationMentions', Math.min(3, signals.publicationMentions));
  if (signals.igropoiskNewsMentions > 0) add('igropoiskNewsMentions', Math.min(2, signals.igropoiskNewsMentions));
  if (signals.daysUntilRelease !== null && signals.daysUntilRelease !== undefined && signals.daysUntilRelease >= 0 && signals.daysUntilRelease <= 180) add('releaseWithin180Days');
  if (signals.daysUntilRelease !== null && signals.daysUntilRelease !== undefined && signals.daysUntilRelease >= 0 && signals.daysUntilRelease <= 30) add('releaseWithin30Days');
  if (signals.popularityRank && signals.popularityRank <= 100) add('popularityRankTop100', Math.max(0.2, (101 - signals.popularityRank) / 100), signals.popularityRank);
  if (signals.professionalReviewCount > 0) add('professionalReviewCount', Math.min(10, signals.professionalReviewCount));
  if (signals.knownCompany) add('knownCompany');
  if (signals.explicitRequest) add('explicitRequest');
  if (signals.partialPage) add('partialPage');
  entity.priority = {score: Math.round(score), reasons, calculatedAt: options.now ?? isoNow()};
  return entity.priority;
}

export function aggregateProfessionalScores(entries = [], options = {}) {
  const accepted = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.professional === false || entry.kind === 'user' || entry.sponsored === true) continue;
    const score = Number(entry.score);
    const scale = Number(entry.scale ?? entry.maxScore ?? 100);
    if (!Number.isFinite(score) || !Number.isFinite(scale) || scale <= 0) continue;
    const normalized = Math.max(0, Math.min(100, (score / scale) * 100));
    const weight = Math.max(0.1, Number(entry.weight ?? 1));
    accepted.push({source: entry.source ?? entry.publication ?? null, normalized, weight, originalScore: score, originalScale: scale});
  }
  if (!accepted.length) return {score: null, count: 0, method: 'weighted_mean_100', entries: []};
  const totalWeight = accepted.reduce((sum, item) => sum + item.weight, 0);
  const score = accepted.reduce((sum, item) => sum + item.normalized * item.weight, 0) / totalWeight;
  return {
    score: Number(score.toFixed(options.precision ?? 1)),
    count: accepted.length,
    method: 'weighted_mean_100',
    entries: accepted
  };
}

export function validateForPublication(entity, options = {}) {
  const errors = [];
  const title = entity.identity?.canonicalTitle?.value;
  const slug = entity.identity?.slug?.value;
  const kind = entity.identity?.kind?.value ?? 'unknown';
  if (!title) errors.push('identity.canonicalTitle');
  if (!slug) errors.push('identity.slug');
  if (entity.workflow?.status === 'needs_review') errors.push('workflow.needs_review');
  if (entity.workflow?.status === 'merged_into_another_game') errors.push('workflow.merged');
  if (isEmbeddedGameKind(kind) && entity.presentation?.standalonePage !== true) errors.push('embedded_content_requires_base_game');
  if ((entity.conflicts ?? []).length) errors.push('unresolved_conflicts');
  if (!options.allowNoRelease && !(entity.releases ?? []).some(item => item.date?.value || item.status === 'released')) errors.push('release_confirmation');
  const hasDescription = Boolean(entity.fields?.description?.value || entity.fields?.shortDescription?.value);
  if (!hasDescription) errors.push('description');
  const hasMedia = (entity.media ?? []).some(item => ['cover','hero','keyArt'].includes(item.kind));
  if (!hasMedia) errors.push('cover_or_hero');
  return {passed: errors.length === 0, errors};
}

export function planSafeUpsert(existingRegistry, incomingRegistry) {
  const existing = existingRegistry ?? createRegistry();
  const incoming = incomingRegistry ?? createRegistry();
  const operations = [];
  for (const [id, game] of Object.entries(incoming.games ?? {})) operations.push({type: existing.games?.[id] ? 'update' : 'insert', gameId: id, game});
  return {mode: 'non_destructive_upsert', operations, deletions: [], protectedPaths: ['game/_shared/**'], emptyInputNoop: operations.length === 0};
}

export function applySafeUpsert(existingRegistry, incomingRegistry) {
  const target = structuredClone(existingRegistry ?? createRegistry());
  const plan = planSafeUpsert(target, incomingRegistry);
  for (const operation of plan.operations) target.games[operation.gameId] = structuredClone(operation.game);
  target.auditLog.push({at: isoNow(), action: 'safe_upsert_applied', inserted: plan.operations.filter(item => item.type === 'insert').length, updated: plan.operations.filter(item => item.type === 'update').length, deleted: 0});
  return rebuildIndexes(target);
}

export function createRevision(entity, options = {}) {
  const snapshot = structuredClone(entity);
  delete snapshot.revisions;
  const revision = {id: `rev_${crypto.randomUUID()}`, at: options.now ?? isoNow(), actor: options.actor ?? 'system', reason: options.reason ?? 'snapshot', snapshot};
  entity.revisions.push(revision); return revision;
}

export function rollbackRevision(entity, revisionId, options = {}) {
  const revision = (entity.revisions ?? []).find(item => item.id === revisionId);
  if (!revision) throw new Error('Revision not found');
  const revisions = entity.revisions;
  const restored = structuredClone(revision.snapshot);
  Object.assign(entity, restored);
  entity.revisions = revisions;
  entity.updatedAt = options.now ?? isoNow();
  entity.auditLog.push({at: entity.updatedAt, action: 'revision_rolled_back', revisionId, actor: options.actor ?? 'editor'});
  return entity;
}
