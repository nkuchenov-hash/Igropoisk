import { normalizeGameIdentity } from './home-feed-identity.mjs';

const STORE_FAMILIES = new Set(['official_store', 'store', 'steam', 'steam_chart', 'rawg']);

function eventTime(event) {
  const value = event?.date || event?.date_start || null;
  return value ? Date.parse(`${value}T12:00:00Z`) : NaN;
}

export function evaluateHomeReleaseQuality(game, options = {}) {
  const popularIdentities = options.popularIdentities || new Set();
  const minimumQuality = Math.max(1, Number(options.minimumQuality || 7));
  const event = Array.isArray(game?.events) ? game.events[0] : null;
  const editorial = game?.editorial || {};
  const anticipation = game?.anticipation || {};
  const sources = (game?.sources || []).filter(source => source?.status !== 'error');
  const sourceFamilies = new Set(sources.map(source => String(source?.family || '').trim()).filter(Boolean));
  const independentSources = sources.filter(source => !STORE_FAMILIES.has(String(source?.family || '').trim().toLowerCase()));
  const identity = normalizeGameIdentity(game?.title, options.duplicateSuffixPatterns || []);
  const now = Number(options.now || Date.now());
  const releaseTime = eventTime(event);
  const upcoming = !Number.isFinite(releaseTime) || releaseTime >= now - 12 * 3_600_000;

  const popularSignal = Boolean(identity && popularIdentities.has(identity));
  const steamWishlistPosition = Number(anticipation.steam_popular_upcoming_position || 0);
  const maximumSteamPosition = Math.min(10, Math.max(1, Number(options.maximumSteamWishlistPosition || 10)));
  const wishlistSignal = steamWishlistPosition > 0 && steamWishlistPosition <= maximumSteamPosition;
  const coverageCount = Math.max(Number(anticipation.independent_publication_count || 0), independentSources.length);
  const coverageFamilies = new Set([
    ...(anticipation.evidence_families || []),
    ...(anticipation.independent_evidence_families || []),
    ...independentSources.map(source => source.family)
  ].filter(family => family && !STORE_FAMILIES.has(String(family).trim().toLowerCase())));
  const minimumIndependentCoverage = Math.max(2, Number(options.minimumIndependentCoverage || 2));
  const crossSiteSignal = coverageCount >= minimumIndependentCoverage && coverageFamilies.size >= 2;
  const popularIndex = Number(anticipation.popular_index || 0);
  const popularConfidence = Number(anticipation.popular_confidence || 0);
  const measuredPopularSignal = popularSignal || (popularIndex >= 8 && popularConfidence >= 0.45);
  const manualFeature = editorial.featured === true || editorial.manual_anticipated === true;
  const globalAnticipation = manualFeature || (crossSiteSignal && measuredPopularSignal) || (wishlistSignal && crossSiteSignal && measuredPopularSignal);
  const publishedPage = Boolean(editorial.has_page || editorial.status === 'published');
  const hasVerifiedCover = Boolean(
    (game?.image?.verified || game?.image?.status === 'downloaded_verified' || game?.image?.status === 'deployment_cached' || game?.image?.status === 'remote_verified') &&
    (game?.image?.local_url || game?.image?.source_url || (game?.image_candidates || []).length)
  );

  const signals = [];
  if (measuredPopularSignal) signals.push('current_popular');
  if (wishlistSignal) signals.push('steam_popular_upcoming');
  if (crossSiteSignal) signals.push('cross_site_coverage');
  if (manualFeature) signals.push('manual_feature');

  let score = 0;
  if (measuredPopularSignal) score += 10;
  if (wishlistSignal) score += Math.max(3, 8 - Math.floor((steamWishlistPosition - 1) / 3));
  if (crossSiteSignal) score += Math.min(10, 4 + coverageCount + coverageFamilies.size);
  if (manualFeature) score += 12;
  if (!upcoming && publishedPage) score += 2;
  if (event?.precision === 'exact') score += 1;

  const reasons = [];
  if (game?.release_type && game.release_type !== 'full') reasons.push('non_full_release');
  if (!event) reasons.push('missing_event');
  if (editorial.needs_review || editorial.status === 'needs_review') reasons.push('needs_review');
  if (!hasVerifiedCover) reasons.push('unverified_cover');
  if (!globalAnticipation) reasons.push('no_global_anticipation_signal');
  if (upcoming && !globalAnticipation) reasons.push('upcoming_without_measured_global_interest');
  if (score < minimumQuality) reasons.push(`anticipation_below_${minimumQuality}`);

  return {
    homepage_eligible: reasons.length === 0,
    quality_score: score,
    anticipation_score: score,
    upcoming,
    reasons,
    signals,
    source_families: [...sourceFamilies].sort(),
    independent_source_count: coverageCount,
    independent_evidence_families: [...coverageFamilies].sort(),
    steam_popular_upcoming_position: steamWishlistPosition || null,
    checked_at: options.checkedAt || null
  };
}
