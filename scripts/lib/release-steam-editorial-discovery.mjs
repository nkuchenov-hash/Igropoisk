const DAY_MS = 86_400_000;
const DEFAULT_TIMEOUT = 15_000;

const uniq = values => [...new Set((values || []).filter(Boolean))];
const canonical = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9а-яё]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const slugify = value => canonical(value).replace(/\s+/g, '-').slice(0, 90);

async function fetchJSON(url, timeout = DEFAULT_TIMEOUT) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskReleaseEditorialDiscovery/1.0',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error }; }
    }
  });
  await Promise.all(runners);
  return results;
}

function parseSearchAppIds(html = '') {
  return uniq([...String(html).matchAll(/data-ds-appid="([^"]+)"/gi)]
    .flatMap(match => String(match[1]).split(','))
    .map(value => Number(value.trim()))
    .filter(Number.isFinite));
}

function exactDate(rawValue) {
  const timestamp = Date.parse(String(rawValue || '').trim());
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function mergeSignal(release, signal) {
  const quality = release?.editorial_quality || {};
  return {
    ...release,
    editorial_quality: {
      ...quality,
      signals: uniq([...(quality.signals || []), signal]),
    },
  };
}

function rawReleaseFromSteam(data, appid, signals, checkedAt) {
  if (!data || (data.type && data.type !== 'game')) return null;
  const title = String(data.name || '').trim();
  const date = exactDate(data.release_date?.date);
  if (!title || !date) return null;

  const slug = slugify(title);
  const sourceId = `steam:${appid}`;
  return {
    id: sourceId,
    slug,
    title,
    aliases: [],
    release_type: 'full',
    genres: uniq((data.genres || []).map(item => item?.description)),
    developer: (data.developers || [])[0] || '',
    publisher: (data.publishers || [])[0] || '',
    external_ids: { steam: appid, igdb: null, rawg: null },
    image: {
      source_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
      local_url: null,
      kind: 'official_store_cover',
      width: 600,
      height: 900,
      verified: true,
      source_id: sourceId,
      status: 'remote_verified',
    },
    events: [{
      id: `${slug}:worldwide:${date}`,
      date,
      date_start: date,
      date_end: date,
      precision: 'exact',
      raw_date: data.release_date?.date || date,
      region: 'worldwide',
      platforms: ['PC'],
      status: 'confirmed',
      confidence: 0.97,
      source_ids: [sourceId],
    }],
    sources: [{
      id: sourceId,
      family: 'official_store',
      priority: 90,
      title: 'Steam',
      url: `https://store.steampowered.com/app/${appid}/`,
      checked_at: checkedAt,
      date_claim: data.release_date?.date || date,
      status: 'success',
    }],
    editorial: {
      status: 'draft',
      readiness: 45,
      needs_review: false,
      has_page: false,
      draft_path: `data/release-drafts/${slug}.json`,
      locked_fields: [],
      notes: [],
    },
    editorial_quality: { signals: uniq(signals) },
    first_seen_at: checkedAt,
    last_seen_at: checkedAt,
  };
}

async function fetchSearchSignal({ filter, sortBy, limit, signal }) {
  const url = `https://store.steampowered.com/search/results/?query&start=0&count=${limit}&dynamic_data=&sort_by=${encodeURIComponent(sortBy)}&filter=${encodeURIComponent(filter)}&ignore_preferences=1&os=win&infinite=1&cc=us&l=english&json=1`;
  const started = Date.now();
  try {
    const payload = await fetchJSON(url);
    const ids = parseSearchAppIds(payload?.results_html || '');
    return { signal, ids, status: 'success', url, duration_ms: Date.now() - started };
  } catch (error) {
    return { signal, ids: [], status: 'error', error: error.message, url, duration_ms: Date.now() - started };
  }
}

export async function enrichRawReleasesFromSteamEditorial(rawReleases = [], policy = {}, generatedAt = new Date().toISOString()) {
  const upcomingLimit = Math.max(1, Number(policy.steam_popular_upcoming_limit || 80));
  const recentLimit = Math.max(1, Number(policy.steam_popular_new_limit || 80));
  const recentDays = Math.max(1, Number(policy.steam_popular_new_recent_days || 21));
  const horizonDays = Math.max(30, Number(policy.steam_editorial_horizon_days || 540));
  const now = Date.parse(generatedAt);
  const lowerBound = now - recentDays * DAY_MS;
  const upperBound = now + horizonDays * DAY_MS;

  const signals = await Promise.all([
    fetchSearchSignal({ filter: 'popularcomingsoon', sortBy: 'Released_ASC', limit: upcomingLimit, signal: 'steam_popular_upcoming' }),
    fetchSearchSignal({ filter: 'popularnew', sortBy: 'Released_DESC', limit: recentLimit, signal: 'steam_popular_new' }),
  ]);

  const signalByAppId = new Map();
  for (const source of signals) {
    for (const appid of source.ids) {
      if (!signalByAppId.has(appid)) signalByAppId.set(appid, new Set());
      signalByAppId.get(appid).add(source.signal);
    }
  }

  const releases = (rawReleases || []).map(item => ({ ...item }));
  const bySteamId = new Map();
  releases.forEach((release, index) => {
    const appid = Number(release?.external_ids?.steam);
    if (Number.isFinite(appid)) bySteamId.set(appid, index);
  });

  const missing = [];
  for (const [appid, appSignals] of signalByAppId) {
    const existingIndex = bySteamId.get(appid);
    if (Number.isInteger(existingIndex)) {
      let updated = releases[existingIndex];
      for (const signal of appSignals) updated = mergeSignal(updated, signal);
      releases[existingIndex] = updated;
    } else {
      missing.push({ appid, signals: [...appSignals] });
    }
  }

  const discovered = await mapPool(missing, 8, async item => {
    const payload = await fetchJSON(`https://store.steampowered.com/api/appdetails?appids=${item.appid}&cc=us&l=english`);
    const result = payload?.[item.appid];
    if (!result?.success || !result?.data) return null;
    const release = rawReleaseFromSteam(result.data, item.appid, item.signals, generatedAt);
    if (!release) return null;
    const releaseTime = Date.parse(`${release.events[0].date}T12:00:00Z`);
    if (!Number.isFinite(releaseTime) || releaseTime < lowerBound || releaseTime > upperBound) return null;
    return release;
  });

  for (const release of discovered.filter(Boolean)) {
    const appid = Number(release.external_ids?.steam);
    if (!Number.isFinite(appid) || bySteamId.has(appid)) continue;
    bySteamId.set(appid, releases.length);
    releases.push(release);
  }

  return {
    releases,
    sources: signals.map(source => ({
      signal: source.signal,
      status: source.status,
      items: source.ids.length,
      url: source.url,
      duration_ms: source.duration_ms,
      ...(source.error ? { error: source.error } : {}),
    })),
    discovered: Math.max(0, releases.length - (rawReleases || []).length),
  };
}
