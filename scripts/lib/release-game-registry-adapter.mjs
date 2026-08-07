import { compareIdentity } from './game-registry.mjs';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set((values || []).filter(Boolean))];

function releaseKind(candidate = {}) {
  const type = String(candidate.release_type || 'full').toLowerCase();
  if (type === 'expansion') return 'expansion';
  if (type === 'dlc') return 'dlc';
  return 'game';
}

function firstReleaseDate(candidate = {}) {
  const event = (candidate.events || []).find(item => item?.date || item?.date_start);
  return event?.date || event?.date_start || null;
}

export function releaseCandidateAsRegistryCandidate(candidate = {}) {
  return {
    title: candidate.title,
    slug: candidate.slug,
    aliases: candidate.aliases || [],
    kind: releaseKind(candidate),
    externalIds: candidate.external_ids || {},
    releaseDate: firstReleaseDate(candidate),
  };
}

export function resolveReleaseCandidateGame(candidate, registry) {
  const registryCandidate = releaseCandidateAsRegistryCandidate(candidate);
  const comparisons = Object.values(registry?.games || {}).map(entity => ({
    entity,
    ...compareIdentity(entity, registryCandidate),
  }));
  const matches = comparisons
    .filter(item => item.decision === 'match')
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  const ambiguous = comparisons.filter(item => item.decision === 'ambiguous');

  if (matches.length === 1 && ambiguous.length === 0) {
    return {
      status: 'matched',
      game_id: matches[0].entity.id,
      confidence: Number(matches[0].confidence || 0),
      reasons: uniq(matches[0].reasons),
      possible_game_ids: [matches[0].entity.id],
    };
  }

  if (matches.length > 1 || ambiguous.length) {
    return {
      status: 'needs_review',
      game_id: null,
      confidence: Math.max(0, ...matches.map(item => Number(item.confidence || 0)), ...ambiguous.map(item => Number(item.confidence || 0))),
      reasons: uniq([...matches, ...ambiguous].flatMap(item => item.reasons || [])),
      possible_game_ids: uniq([...matches, ...ambiguous].map(item => item.entity.id)),
    };
  }

  return {
    status: 'unresolved',
    game_id: null,
    confidence: 0,
    reasons: [],
    possible_game_ids: [],
  };
}

export function linkReleaseCandidatesToRegistry(candidates, registry) {
  const statistics = {matched: 0, needs_review: 0, unresolved: 0};
  const linkedCandidates = (candidates || []).map(candidate => {
    const resolution = resolveReleaseCandidateGame(candidate, registry);
    statistics[resolution.status] = (statistics[resolution.status] || 0) + 1;
    const linked = {...clone(candidate), game_resolution: resolution};
    if (resolution.status === 'matched') linked.game_id = resolution.game_id;
    return linked;
  });
  return {candidates: linkedCandidates, statistics};
}

export function attachCanonicalGameIdsToPublicCalendar(publicCalendar, linkedCandidates) {
  const byReleaseId = new Map((linkedCandidates || []).map(candidate => [candidate.id, candidate]));
  const output = clone(publicCalendar) || {};
  output.releases = (output.releases || []).map(release => {
    const candidate = byReleaseId.get(release.id);
    if (!candidate?.game_id || candidate.game_resolution?.status !== 'matched') return release;
    return {...release, game_id: candidate.game_id};
  });
  return output;
}
