import { normalizeGameIdentity } from './home-feed-identity.mjs';

const STORE_FAMILIES = new Set(['official_store', 'store', 'steam']);

export function evaluateHomeReleaseQuality(game, options = {}) {
  const popularIdentities = options.popularIdentities || new Set();
  const significantGenres = options.significantGenres || new Set();
  const minimumQuality = Math.max(1, Number(options.minimumQuality || 7));
  const event = Array.isArray(game?.events) ? game.events[0] : null;
  const editorial = game?.editorial || {};
  const sources = (game?.sources || []).filter(source => source?.status !== 'error');
  const sourceFamilies = new Set(sources.map(source => String(source?.family || '').trim()).filter(Boolean));
  const independentSources = sources.filter(source => !STORE_FAMILIES.has(String(source?.family || '').trim()));
  const identity = normalizeGameIdentity(game?.title, options.duplicateSuffixPatterns || []);

  const publishedPage = Boolean(editorial.has_page || editorial.status === 'published');
  const popularSignal = Boolean(identity && popularIdentities.has(identity));
  const independentSignal = independentSources.length > 0;
  const manualFeature = editorial.featured === true;
  const editorialReady = !editorial.needs_review && editorial.status !== 'needs_review' && Number(editorial.readiness || 0) >= 85;
  const hasVerifiedCover = Boolean(
    (game?.image?.verified || game?.image?.status === 'downloaded_verified' || game?.image?.status === 'deployment_cached') &&
    (game?.image?.local_url || game?.image?.source_url || (game?.image_candidates || []).length)
  );

  const signals = [];
  if (publishedPage) signals.push('published_page');
  if (popularSignal) signals.push('current_popular');
  if (independentSignal) signals.push('independent_source');
  if (manualFeature) signals.push('manual_feature');

  let score = 0;
  if (event?.precision === 'exact') score += 2;
  else if (event?.precision && event.precision !== 'tbd') score += 1;
  if ((game?.genres || []).some(genre => significantGenres.has(genre))) score += 1;
  if (game?.developer) score += 1;
  if (game?.publisher) score += 1;
  if (publishedPage) score += 4;
  if (popularSignal) score += 4;
  if (independentSignal) score += 3;
  if (manualFeature) score += 6;
  if (editorialReady) score += 1;

  const reasons = [];
  if (game?.release_type && game.release_type !== 'full') reasons.push('non_full_release');
  if (!event) reasons.push('missing_event');
  if (editorial.needs_review || editorial.status === 'needs_review') reasons.push('needs_review');
  if (!hasVerifiedCover) reasons.push('unverified_cover');
  if (!signals.length) reasons.push('no_homepage_relevance_signal');
  if (score < minimumQuality) reasons.push(`quality_below_${minimumQuality}`);

  return {
    homepage_eligible: reasons.length === 0,
    quality_score: score,
    reasons,
    signals,
    source_families: [...sourceFamilies].sort(),
    independent_source_count: independentSources.length,
    checked_at: options.checkedAt || null
  };
}
