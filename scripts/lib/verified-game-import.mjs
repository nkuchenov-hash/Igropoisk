import {GameRegistryApi} from './game-registry.mjs';

const strongTypes = new Set(['official_site','official_platform_store','official_press_release','structured_database','professional_publication']);
const officialTypes = new Set(['official_site','official_platform_store','official_press_release']);
const strongSource = source => strongTypes.has(String(source?.type || '')) && /^https?:\/\//i.test(String(source?.url || ''));
const sourceHost = url => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const independentSources = sources => {
  const seen = new Set();
  return sources.filter(source => {
    const key = sourceHost(source.url) || String(source.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const primarySource = sources => sources.find(source => officialTypes.has(String(source?.type || ''))) || sources[0] || null;

function requestReleased(request) {
  const releases = Array.isArray(request?.releases) ? request.releases : [];
  const now = Date.now();
  const yearNow = new Date().getUTCFullYear();
  return releases.some(release => {
    const status = String(release?.status || '').toLowerCase();
    if (/upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида/i.test(status)) return false;
    if (status && status !== 'released') return false;
    const parsed = Date.parse(String(release?.date || ''));
    if (Number.isFinite(parsed)) return parsed <= now;
    const year = Number(String(release?.date || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
    return year > 0 && year <= yearNow;
  });
}

export function registerVerifiedGameImports(registry = {}, requests = []) {
  const api = new GameRegistryApi(registry);
  const resolved = [];
  const issues = [];
  let created = 0;
  let matched = 0;

  for (const [index, request] of requests.entries()) {
    const title = String(request?.title || '').trim();
    const slug = String(request?.slug || '').trim();
    const intent = String(request?.publication_intent || 'full_page');
    const sources = independentSources((Array.isArray(request?.verification_sources) ? request.verification_sources : []).filter(strongSource));
    const primary = primarySource(sources);

    if (!title || !slug) { issues.push({index, status:'rejected', reason:'import_missing_identity'}); continue; }
    if (request.identity_verified !== true) { issues.push({index, title, slug, status:'rejected', reason:'import_identity_not_verified'}); continue; }
    if (!primary || (!officialTypes.has(primary.type) && sources.length < 2)) { issues.push({index, title, slug, status:'rejected', reason:'import_requires_official_or_two_independent_verification_sources'}); continue; }
    if (intent === 'full_page' && !requestReleased(request)) { issues.push({index, title, slug, status:'registry_only', reason:'full_page_import_requires_released_game'}); continue; }
    if (intent === 'full_page' && !request.steam_appid && !request.parser_seed) { issues.push({index, title, slug, status:'rejected', reason:'non_steam_full_page_import_requires_verified_parser_seed'}); continue; }

    const externalIds = {...(request.external_ids || {})};
    if (request.steam_appid) externalIds.steamAppId = String(request.steam_appid);
    const parserMedia = request.parser_seed?.media || {};
    const candidate = {
      title, slug,
      aliases: request.aliases || [],
      series: request.series || null,
      kind: request.kind || 'game',
      externalIds,
      releases: request.releases || [],
      media: {cover: parserMedia.cover || [], hero: parserMedia.hero || [], screenshot: parserMedia.screenshots || []},
      source: {type: primary.type, name: primary.name || 'verified import', url: primary.url},
      sourceRecordId: request.import_id || slug,
      discoveryReason: 'editor_verified_game_import',
      status: 'identified',
      statusReason: 'identity and release context verified for canonical lifecycle import',
      confidence: Number(request.confidence || 0.99)
    };

    const registration = api.registerCandidate(candidate, {actor:'verified-game-import'});
    const entity = registration.entity || null;
    const decision = registration.decision || '';
    if (!entity || ['ambiguous','needs_review'].includes(decision)) { issues.push({index, title, slug, status:decision || 'unresolved', reason:'import_identity_needs_review'}); continue; }
    if (decision === 'created') created += 1; else matched += 1;
    resolved.push({
      import_id: request.import_id || slug,
      game_id: entity.id,
      slug: String(entity.identity?.slug?.value || slug),
      title: String(entity.identity?.canonicalTitle?.value || title),
      steam_appid: entity.externalIds?.steamAppId ? Number(entity.externalIds.steamAppId) : null,
      verification_sources: sources,
      parser_seed: request.parser_seed || null,
      publication_intent: intent,
      decision
    });
  }
  return {registry: api.registry, resolved, issues, created, matched};
}
