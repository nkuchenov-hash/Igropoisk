const SUPPORTED_PLATFORMS = new Set([
  'PC', 'PlayStation 5', 'PlayStation 4', 'Xbox Series X|S', 'Xbox One', 'Nintendo Switch 2', 'Nintendo Switch',
]);
const OFFICIAL_CONSOLE_FAMILIES = new Set(['platform_store', 'publisher', 'developer', 'first_party_official', 'official_announcement', 'official_site']);
const EDITION_RE = /\b(deluxe|ultimate|gold|complete|collector'?s?|goty|game of the year|premium)\b/i;
const EXPANSION_RE = /\b(expansion|expansion pass|major expansion|add-on|addon)\b/i;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uniq = values => [...new Set((values || []).filter(Boolean))];
const normalizedTitle = value => String(value || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slugify = value => normalizedTitle(value).replace(/\s+/g, '-');
const isSteam = source => String(source?.id || '').startsWith('steam:') || /store\.steampowered\.com/i.test(String(source?.url || ''));
const isOfficialForConsole = source => source && !isSteam(source) && OFFICIAL_CONSOLE_FAMILIES.has(String(source.family || '').toLowerCase());
const claimMatchesDate = (claim, event) => !claim?.date || !event?.date_start || claim.date === event.date || claim.date === event.date_start;

function classifyExcluded(title, releaseType) {
  const t = normalizedTitle(title);
  if (/\bdemo\b/.test(t)) return 'demo';
  if (/\bprologue\b/.test(t)) return 'prologue';
  if (/\bplaytest\b|\bplay test\b|\bbeta test\b/.test(t)) return 'playtest';
  if (/\bsoundtrack\b|\boriginal soundtrack\b|\bost\b/.test(t)) return 'soundtrack';
  if (/\bwallpaper\b|\bartbook\b|\bart book\b|\bskin pack\b|\bcosmetic\b/.test(t)) return 'cosmetic';
  if (/\bdedicated server\b|\bbenchmark\b|\bsdk\b|\beditor\b|\btool\b/.test(t)) return 'technical_app';
  if ((releaseType === 'dlc' || /\bdlc\b/.test(t)) && !EXPANSION_RE.test(t)) return 'minor_dlc';
  return null;
}

function normalizeReleaseType(raw) {
  const type = String(raw?.release_type || 'full').toLowerCase();
  if (type === 'early_access') return 'early_access';
  if (type === 'expansion' || EXPANSION_RE.test(raw?.title || '')) return 'expansion';
  if (type === 'dlc') return 'dlc';
  return 'full';
}

function signalsFor(raw, policy) {
  const signals = new Set();
  const quality = raw?.editorial_quality || {};
  const editorial = raw?.editorial || {};
  for (const signal of quality.signals || []) signals.add(signal);
  if (quality.homepage_eligible) signals.add('home_quality_gate');
  if (editorial.has_page) signals.add('igropoisk_page');
  if (editorial.status === 'published') signals.add('published_page');
  if ((quality.independent_source_count || 0) > 0) signals.add('independent_coverage');
  const sourceFamilies = new Set((raw.sources || []).map(source => String(source.family || '').toLowerCase()));
  if (sourceFamilies.has('official_announcement')) signals.add('official_announcement');
  const known = (policy.known_organizations || []).map(normalizedTitle);
  const orgText = `${normalizedTitle(raw.developer)} ${normalizedTitle(raw.publisher)}`;
  if (known.some(name => name && orgText.includes(name))) signals.add('known_developer_or_publisher');
  let score = 0;
  for (const signal of signals) score += Number(policy.signal_weights?.[signal] || 0);
  return { score, signals: [...signals].sort() };
}

function sourceMap(sources) {
  return new Map((sources || []).map(source => [source.id, source]));
}

function makeEvent(event, sources, claims = []) {
  const out = clone(event || {});
  out.id ||= `event:${out.date_start || out.date || 'tbd'}`;
  out.date ??= out.precision === 'exact' ? out.date_start || null : null;
  out.date_start ??= out.date || null;
  out.date_end ??= out.date || out.date_start || null;
  out.precision ||= out.date ? 'exact' : 'tbd';
  out.region ||= 'worldwide';
  out.platforms = uniq(out.platforms || []);
  out.source_ids = uniq(out.source_ids || []);
  out.platform_confirmations = {};
  const byId = sourceMap(sources);
  for (const platform of out.platforms) {
    if (!SUPPORTED_PLATFORMS.has(platform)) continue;
    const confirmations = [];
    for (const sourceId of out.source_ids) {
      const source = byId.get(sourceId);
      if (platform === 'PC' && isSteam(source)) confirmations.push(sourceId);
      if (platform !== 'PC' && isOfficialForConsole(source) && (!source.platforms || source.platforms.includes(platform))) confirmations.push(sourceId);
    }
    for (const claim of claims) {
      if ((claim.platforms || []).includes(platform) && claimMatchesDate(claim, out) && claim.source?.id) confirmations.push(claim.source.id);
    }
    if (confirmations.length) out.platform_confirmations[platform] = uniq(confirmations);
  }
  return out;
}

function mergeEvents(events) {
  const grouped = new Map();
  for (const event of events || []) {
    const key = [event.date || '', event.date_start || '', event.date_end || '', event.precision || 'tbd', event.region || 'worldwide'].join('|');
    if (!grouped.has(key)) grouped.set(key, clone(event));
    else {
      const target = grouped.get(key);
      target.platforms = uniq([...(target.platforms || []), ...(event.platforms || [])]);
      target.source_ids = uniq([...(target.source_ids || []), ...(event.source_ids || [])]);
      target.confidence = Math.max(Number(target.confidence || 0), Number(event.confidence || 0));
      target.platform_confirmations ||= {};
      for (const [platform, ids] of Object.entries(event.platform_confirmations || {})) {
        target.platform_confirmations[platform] = uniq([...(target.platform_confirmations[platform] || []), ...ids]);
      }
    }
  }
  return [...grouped.values()];
}

function applyClaims(raw, sources, events, claims) {
  const nextSources = [...sources];
  const nextEvents = [...events];
  for (const claim of claims || []) {
    if (!claim?.source?.id) continue;
    if (!nextSources.some(source => source.id === claim.source.id)) nextSources.push(clone(claim.source));
    const platforms = uniq((claim.platforms || []).filter(platform => SUPPORTED_PLATFORMS.has(platform)));
    if (!platforms.length) continue;
    let target = nextEvents.find(event => claim.date && (event.date === claim.date || event.date_start === claim.date));
    if (!target && claim.date) {
      target = makeEvent({
        id: `claim:${claim.source.id}:${claim.date}`,
        date: claim.date,
        date_start: claim.date,
        date_end: claim.date,
        precision: 'exact',
        region: claim.region || 'worldwide',
        platforms,
        confidence: claim.confidence || 0.95,
        source_ids: [claim.source.id],
      }, nextSources, [claim]);
      nextEvents.push(target);
    } else if (target) {
      target.platforms = uniq([...(target.platforms || []), ...platforms]);
      target.source_ids = uniq([...(target.source_ids || []), claim.source.id]);
      target.platform_confirmations ||= {};
      for (const platform of platforms) target.platform_confirmations[platform] = uniq([...(target.platform_confirmations[platform] || []), claim.source.id]);
    }
  }
  return { sources: nextSources, events: mergeEvents(nextEvents) };
}

function applyDecision(candidate, decision) {
  if (!decision) return candidate;
  const out = clone(candidate);
  out.moderation.locked_fields = uniq(decision.locked_fields || []);
  if (typeof decision.publication_forbidden === 'boolean') out.moderation.publication_forbidden = decision.publication_forbidden;
  if (decision.rejection_reason) out.moderation.rejection_reason = decision.rejection_reason;
  if (decision.release_type) out.release_type = normalizeReleaseType({ release_type: decision.release_type, title: out.title });
  if (Array.isArray(decision.event_overrides)) {
    for (const override of decision.event_overrides) {
      const index = out.events.findIndex(event => event.id === override.event_id);
      const base = index >= 0 ? out.events[index] : { id: override.event_id || `manual:${out.slug}:${out.events.length}` };
      const merged = makeEvent({ ...base, ...clone(override) }, out.sources, []);
      if (index >= 0) out.events[index] = merged; else out.events.push(merged);
    }
    out.events = mergeEvents(out.events);
  }
  if (decision.decision === 'rejected' || out.moderation.publication_forbidden) out.moderation.status = 'rejected';
  else if (decision.decision === 'published') out.moderation.status = 'published';
  else if (decision.decision === 'review') out.moderation.status = 'review';
  out.moderation.manual_decision = decision.decision || null;
  return out;
}

function eventIsPublic(event) {
  const platforms = event.platforms || [];
  return platforms.length > 0 && platforms.every(platform => (event.platform_confirmations?.[platform] || []).length > 0);
}

export function buildCandidates({ rawReleases = [], editorial = {}, officialClaims = [], policy = {} }) {
  const claimsBySlug = new Map();
  for (const claim of officialClaims || []) {
    const slug = claim.slug || slugify(claim.title || '');
    if (!claimsBySlug.has(slug)) claimsBySlug.set(slug, []);
    claimsBySlug.get(slug).push(claim);
  }
  const baseNames = new Set(rawReleases.map(item => normalizedTitle(item.title).replace(EDITION_RE, '').replace(/\bedition\b/g, '').replace(/\s+/g, ' ').trim()));
  return rawReleases.map(raw => {
    const releaseType = normalizeReleaseType(raw);
    const excluded = classifyExcluded(raw.title, releaseType);
    let editionDuplicate = null;
    if (EDITION_RE.test(String(raw.title || ''))) {
      const base = normalizedTitle(raw.title).replace(EDITION_RE, '').replace(/\bedition\b/g, '').replace(/\s+/g, ' ').trim();
      if (base && baseNames.has(base)) editionDuplicate = 'duplicate_edition';
    }
    const sources = clone(raw.sources || []);
    const claims = claimsBySlug.get(raw.slug || slugify(raw.title)) || [];
    const events = (raw.events || []).map(event => makeEvent(event, sources, claims));
    const claimed = applyClaims(raw, sources, events, claims);
    const significance = signalsFor(raw, policy);
    const automaticReasons = [];
    if (!significance.signals.length) automaticReasons.push('no_significance_signal');
    if (significance.score < Number(policy.minimum_significance_score || 0)) automaticReasons.push('below_significance_threshold');
    let status = significance.score >= Number(policy.minimum_significance_score || 0) ? 'published' : 'review';
    const rejection = excluded || editionDuplicate;
    if (rejection) status = 'rejected';
    if (status === 'published' && !claimed.events.some(eventIsPublic)) {
      status = 'review';
      automaticReasons.push('no_confirmed_platform_event');
    }
    let candidate = {
      id: raw.id || raw.slug || slugify(raw.title),
      slug: raw.slug || slugify(raw.title),
      title: raw.title || raw.slug || 'Untitled',
      aliases: clone(raw.aliases || []),
      release_type: releaseType,
      genres: clone(raw.genres || []),
      developer: raw.developer || null,
      publisher: raw.publisher || null,
      external_ids: clone(raw.external_ids || {}),
      image: clone(raw.image || null),
      page_url: raw.page_url || (raw.editorial?.has_page ? `/Igropoisk/game/${raw.slug || slugify(raw.title)}/` : null),
      editorial: clone(raw.editorial || {}),
      sources: claimed.sources,
      events: claimed.events,
      significance,
      moderation: {
        status,
        rejection_reason: rejection,
        automatic_reasons: automaticReasons,
        publication_forbidden: false,
        locked_fields: [],
      },
      first_seen_at: raw.first_seen_at || null,
      last_seen_at: raw.last_seen_at || null,
    };
    candidate = applyDecision(candidate, editorial?.decisions?.[candidate.id] || editorial?.decisions?.[candidate.slug]);
    return candidate;
  });
}

function publicRelease(candidate) {
  const events = mergeEvents((candidate.events || []).filter(eventIsPublic).map(event => ({
    ...clone(event),
    platforms: (event.platforms || []).filter(platform => (event.platform_confirmations?.[platform] || []).length),
  })).filter(event => event.platforms.length));
  return {
    id: candidate.id, slug: candidate.slug, title: candidate.title, aliases: candidate.aliases || [],
    release_type: candidate.release_type, genres: candidate.genres || [], developer: candidate.developer, publisher: candidate.publisher,
    external_ids: candidate.external_ids || {}, image: candidate.image || null, page_url: candidate.page_url || null,
    events, sources: candidate.sources || [], editorial: { status: 'published', has_page: Boolean(candidate.editorial?.has_page || candidate.page_url) },
    significance: candidate.significance,
  };
}

export function buildPublicCalendar(candidates, generatedAt = new Date().toISOString()) {
  const releases = (candidates || []).filter(candidate => candidate.moderation?.status === 'published' && !candidate.moderation?.publication_forbidden).map(publicRelease).filter(item => item.events.length);
  const counts = new Map();
  for (const release of releases) for (const event of release.events || []) if (event.precision === 'exact' && event.date) counts.set(event.date, (counts.get(event.date) || 0) + 1);
  const denseDays = [...counts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,10).map(([date,count]) => ({date,count}));
  return {
    schema_version: 3,
    generated_at: generatedAt,
    releases,
    statistics: {
      raw_candidates: (candidates || []).length,
      published: (candidates || []).filter(item => item.moderation?.status === 'published').length,
      review: (candidates || []).filter(item => item.moderation?.status === 'review').length,
      rejected: (candidates || []).filter(item => item.moderation?.status === 'rejected').length,
      max_exact_releases_in_one_day: denseDays[0]?.count || 0,
      dense_days: denseDays,
      public_quantity_cap: null,
    },
  };
}

export function validateCalendar({ candidates = [], publicCalendar = {} }) {
  const errors = [];
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  for (const release of publicCalendar.releases || []) {
    const candidate = byId.get(release.id);
    if (!candidate) { errors.push(`Public release ${release.id} has no candidate`); continue; }
    if (candidate.moderation?.status !== 'published') errors.push(`Unapproved candidate published: ${release.id}`);
    if (candidate.moderation?.publication_forbidden) errors.push(`Publication-forbidden candidate published: ${release.id}`);
    if (candidate.moderation?.rejection_reason) errors.push(`Rejected content published: ${release.id}`);
    const sources = sourceMap(candidate.sources || []);
    for (const event of release.events || []) {
      if (event.precision === 'exact') {
        if (!event.date || event.date_start !== event.date || event.date_end !== event.date) errors.push(`Exact event mismatch: ${release.id}/${event.id}`);
      } else if (event.date && event.precision !== 'tbd') errors.push(`Approximate event exposes exact date: ${release.id}/${event.id}`);
      for (const platform of event.platforms || []) {
        if (!SUPPORTED_PLATFORMS.has(platform)) errors.push(`Unsupported platform ${platform}: ${release.id}`);
        const confirmations = event.platform_confirmations?.[platform] || [];
        if (!confirmations.length) errors.push(`Unconfirmed platform ${platform}: ${release.id}/${event.id}`);
        if (platform !== 'PC') {
          const official = confirmations.some(id => isOfficialForConsole(sources.get(id)));
          if (!official) errors.push(`Console date lacks official platform/publisher source: ${release.id}/${event.id}/${platform}`);
          if (confirmations.some(id => isSteam(sources.get(id))) && !official) errors.push(`Steam cannot confirm console date: ${release.id}/${event.id}/${platform}`);
        }
      }
    }
  }
  return uniq(errors);
}
