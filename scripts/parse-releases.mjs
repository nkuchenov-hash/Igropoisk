import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const readJSON = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};
const writeJSON = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const config = readJSON('config/parsers/releases.json', {});
const previousPayload = readJSON('data/releases/current.json', { releases: [] });
const previousBySlug = new Map((previousPayload.releases || []).map(item => [item.slug, item]));
const checkedAt = new Date().toISOString();
const now = Date.now();
const timeout = 25_000;
const horizonDays = Number(config.horizon_days || 540);
const horizonEnd = new Date(now + horizonDays * 86_400_000);

const canonical = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/&amp;/g, ' and ').replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
const slugify = value => canonical(value).replace(/\s+/g, '-').slice(0, 90);
const htmlDecode = value => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set((values || []).filter(Boolean))];

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
    headers: {
      'user-agent': 'Mozilla/5.0 IgropoiskReleaseParser/1.0',
      'accept-language': 'en-US,en;q=0.9',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
const fetchJSON = async (url, options = {}) => JSON.parse(await fetchText(url, options));

function isoDate(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString().slice(0, 10);
}
function monthEnd(year, monthIndex) {
  return isoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
}
function parseDateClaim(rawValue) {
  const raw = String(rawValue || '').trim();
  const lower = raw.toLowerCase();
  if (!raw || /coming soon|to be announced|tba|tbd|date.*unknown/.test(lower)) {
    return { precision: 'tbd', date: null, date_start: null, date_end: null, raw };
  }

  const quarter = lower.match(/\bq([1-4])\s*(20\d{2})\b|\b(20\d{2})\s*q([1-4])\b/);
  if (quarter) {
    const q = Number(quarter[1] || quarter[4]);
    const year = Number(quarter[2] || quarter[3]);
    const startMonth = (q - 1) * 3;
    return {
      precision: 'quarter', date: null,
      date_start: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
      date_end: monthEnd(year, startMonth + 2), raw
    };
  }

  const monthNames = 'january|february|march|april|may|june|july|august|september|october|november|december';
  const monthOnly = lower.match(new RegExp(`^(${monthNames})\\s+(20\\d{2})$`, 'i'));
  if (monthOnly) {
    const month = new Date(`${monthOnly[1]} 1, ${monthOnly[2]} 00:00:00 UTC`).getUTCMonth();
    const year = Number(monthOnly[2]);
    return {
      precision: 'month', date: null,
      date_start: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      date_end: monthEnd(year, month), raw
    };
  }

  const yearOnly = lower.match(/^(20\d{2})$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return { precision: 'year', date: null, date_start: `${year}-01-01`, date_end: `${year}-12-31`, raw };
  }

  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    const date = isoDate(new Date(timestamp));
    return { precision: 'exact', date, date_start: date, date_end: date, raw };
  }
  return { precision: 'tbd', date: null, date_start: null, date_end: null, raw };
}

function parseSteamSearch(html) {
  const rows = html.match(/<a[^>]+data-ds-appid="[^"]+"[\s\S]*?<\/a>/gi) || [];
  return rows.map(row => ({
    appid: Number((row.match(/data-ds-appid="([^"]+)"/i)?.[1] || '').split(',')[0]),
    title: htmlDecode(row.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || ''),
    image: row.match(/<img[^>]+src="([^"]+)"/i)?.[1] || ''
  })).filter(item => item.appid && item.title);
}

function releaseEvent(record, claim, platforms, sourceId) {
  const dateKey = claim.date || claim.date_start || 'tbd';
  return {
    id: `${record.slug}:worldwide:${dateKey}`,
    date: claim.date,
    date_start: claim.date_start,
    date_end: claim.date_end,
    precision: claim.precision,
    raw_date: claim.raw,
    region: 'worldwide',
    platforms: unique(platforms.length ? platforms : ['PC']),
    status: claim.precision === 'tbd' ? 'announced' : 'confirmed',
    confidence: claim.precision === 'exact' ? 0.97 : 0.88,
    source_ids: [sourceId]
  };
}

function applyEditorialLocks(next, previous) {
  if (!previous) return next;
  const editorial = previous.editorial || {};
  const locked = new Set(editorial.locked_fields || []);
  next.editorial = {
    status: editorial.status || next.editorial.status,
    readiness: Number.isFinite(editorial.readiness) ? editorial.readiness : next.editorial.readiness,
    needs_review: Boolean(editorial.needs_review || next.editorial.needs_review),
    has_page: Boolean(editorial.has_page),
    draft_path: editorial.draft_path || next.editorial.draft_path,
    locked_fields: [...locked],
    notes: editorial.notes || []
  };
  for (const field of locked) {
    if (Object.prototype.hasOwnProperty.call(previous, field)) next[field] = previous[field];
  }
  next.first_seen_at = previous.first_seen_at || next.first_seen_at;
  return next;
}

async function downloadCover(record) {
  if (!config.download_images || !record.image?.source_url) return record.image;
  const rules = config.image_rules || {};
  try {
    const response = await fetch(record.image.source_url, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskReleaseParser/1.0' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!(rules.allowed_content_types || []).includes(contentType)) throw new Error(`Unsupported type ${contentType}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < Number(rules.minimum_bytes || 15000)) throw new Error(`Image too small: ${bytes.length} bytes`);
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/avif' ? 'avif' : 'jpg';
    const file = `assets/covers/releases/${record.slug}.${ext}`;
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return {
      ...record.image,
      local_url: file,
      content_type: contentType,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      status: 'downloaded_verified'
    };
  } catch (error) {
    return { ...record.image, status: 'remote_fallback', error: error.message };
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error }; }
    }
  });
  await Promise.all(runners);
  return results;
}

const sourceStatuses = [];
const candidates = new Map();

async function collectSteam() {
  const started = Date.now();
  const searchUrl = `https://store.steampowered.com/search/results/?query&start=0&count=${Number(config.steam_discovery_limit || 100)}&dynamic_data=&sort_by=Released_ASC&filter=comingsoon&infinite=1&cc=us&l=english&json=1`;
  try {
    const payload = await fetchJSON(searchUrl);
    const discovered = parseSteamSearch(payload.results_html || '');
    for (const item of discovered) candidates.set(item.appid, item);
    for (const appid of config.seed_steam_appids || []) {
      if (!candidates.has(Number(appid))) candidates.set(Number(appid), { appid: Number(appid), title: '', image: '' });
    }

    const ids = [...candidates.keys()];
    const results = await mapPool(ids, 5, async appid => {
      const data = await fetchJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
      return { appid, result: data?.[appid] };
    });

    const records = [];
    let errors = 0;
    for (const outcome of results) {
      if (!outcome || outcome.error || !outcome.result?.success || !outcome.result?.data) { errors++; continue; }
      const data = outcome.result.data;
      if (data.type && data.type !== 'game') continue;
      const title = String(data.name || candidates.get(outcome.appid)?.title || '').trim();
      if (!title) continue;
      const claim = parseDateClaim(data.release_date?.date);
      const sourceId = `steam:${outcome.appid}`;
      const slug = slugify(title);
      const platforms = data.platforms?.windows || data.platforms?.mac || data.platforms?.linux ? ['PC'] : ['PC'];
      const record = {
        id: sourceId,
        slug,
        title,
        aliases: [],
        release_type: 'full',
        genres: unique((data.genres || []).map(item => item.description)),
        developer: (data.developers || [])[0] || '',
        publisher: (data.publishers || [])[0] || '',
        external_ids: { steam: outcome.appid, igdb: null, rawg: null },
        image: {
          source_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${outcome.appid}/library_600x900.jpg`,
          local_url: null,
          kind: 'official_store_cover',
          width: 600,
          height: 900,
          verified: true,
          source_id: sourceId,
          status: 'remote_verified'
        },
        events: [],
        sources: [{
          id: sourceId,
          family: 'official_store',
          priority: Number(config.source_priorities?.official_store || 90),
          title: 'Steam',
          url: `https://store.steampowered.com/app/${outcome.appid}/`,
          checked_at: checkedAt,
          date_claim: claim.raw,
          status: 'success'
        }],
        editorial: {
          status: 'draft', readiness: 45, needs_review: claim.precision === 'tbd', has_page: false,
          draft_path: `data/release-drafts/${slug}.json`, locked_fields: [], notes: []
        },
        first_seen_at: checkedAt,
        last_seen_at: checkedAt
      };
      record.events = [releaseEvent(record, claim, platforms, sourceId)];
      records.push(applyEditorialLocks(record, previousBySlug.get(slug)));
    }
    sourceStatuses.push({ id: 'steam-upcoming', status: errors ? 'partial' : 'success', items: records.length, errors, duration_ms: Date.now() - started, url: searchUrl });
    return records;
  } catch (error) {
    sourceStatuses.push({ id: 'steam-upcoming', status: 'error', error: error.message, duration_ms: Date.now() - started, url: searchUrl });
    return [];
  }
}

async function collectRawg() {
  const key = process.env.RAWG_API_KEY;
  const started = Date.now();
  if (!key) {
    sourceStatuses.push({ id: 'rawg-upcoming', status: 'skipped', error: 'RAWG_API_KEY is not configured' });
    return [];
  }
  const start = isoDate(new Date());
  const end = isoDate(horizonEnd);
  const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&dates=${start},${end}&ordering=released&page_size=40`;
  try {
    const data = await fetchJSON(url);
    const rows = (data.results || []).map(game => ({
      title: game.name,
      slug: slugify(game.name),
      rawg_id: game.id,
      date: game.released,
      image: game.background_image,
      platforms: unique((game.platforms || []).map(row => row.platform?.name))
    })).filter(item => item.title && item.date);
    sourceStatuses.push({ id: 'rawg-upcoming', status: 'success', items: rows.length, duration_ms: Date.now() - started, url });
    return rows;
  } catch (error) {
    sourceStatuses.push({ id: 'rawg-upcoming', status: 'error', error: error.message, duration_ms: Date.now() - started, url });
    return [];
  }
}

function mergeRawg(records, rawgRows) {
  const bySlug = new Map(records.map(item => [item.slug, item]));
  for (const raw of rawgRows) {
    const record = bySlug.get(raw.slug);
    if (!record) continue;
    record.external_ids.rawg = raw.rawg_id;
    const sourceId = `rawg:${raw.rawg_id}`;
    record.sources.push({
      id: sourceId, family: 'rawg', priority: Number(config.source_priorities?.rawg || 55),
      title: 'RAWG', url: `https://rawg.io/games/${raw.slug}`, checked_at: checkedAt,
      date_claim: raw.date, status: 'success'
    });
    const official = record.events[0];
    if (official?.precision === 'exact' && raw.date && official.date !== raw.date) {
      record.editorial.needs_review = true;
      record.editorial.status = record.editorial.status === 'published' ? 'published' : 'needs_review';
      record.editorial.notes = unique([...(record.editorial.notes || []), `Конфликт даты: Steam ${official.date}, RAWG ${raw.date}`]);
    }
  }
  return records;
}

function primaryDate(record) {
  const event = record.events?.[0];
  return event?.date || event?.date_start || '9999-12-31';
}
function shouldKeep(record) {
  const event = record.events?.[0];
  if (!event || event.precision === 'tbd') return true;
  const end = Date.parse(`${event.date_end || event.date || event.date_start}T23:59:59Z`);
  return !Number.isFinite(end) || end >= now - 7 * 86_400_000;
}

function detectChanges(records) {
  const changes = [];
  const nextBySlug = new Map(records.map(item => [item.slug, item]));
  for (const record of records) {
    const previous = previousBySlug.get(record.slug);
    if (!previous) {
      changes.push({ id:`${record.slug}:new:${checkedAt}`, type:'new_release', severity:'info', game_slug:record.slug, title:record.title, old_value:null, new_value:primaryDate(record), detected_at:checkedAt, requires_review:false });
      continue;
    }
    const oldEvent = previous.events?.[0] || {};
    const newEvent = record.events?.[0] || {};
    const oldValue = `${oldEvent.precision || 'tbd'}:${oldEvent.date || oldEvent.date_start || ''}`;
    const newValue = `${newEvent.precision || 'tbd'}:${newEvent.date || newEvent.date_start || ''}`;
    if (oldValue !== newValue) {
      const oldTime = Date.parse(oldEvent.date || oldEvent.date_start || '');
      const newTime = Date.parse(newEvent.date || newEvent.date_start || '');
      const delayed = Number.isFinite(oldTime) && Number.isFinite(newTime) && newTime > oldTime;
      changes.push({
        id:`${record.slug}:date:${checkedAt}`, type: delayed ? 'delayed' : 'date_changed', severity:'important',
        game_slug:record.slug, title:record.title, old_value:oldValue, new_value:newValue,
        detected_at:checkedAt, requires_review:true
      });
      record.editorial.needs_review = true;
      if (record.editorial.status !== 'published') record.editorial.status = 'needs_review';
    }
  }
  for (const previous of previousPayload.releases || []) {
    if (!nextBySlug.has(previous.slug) && shouldKeep(previous)) {
      changes.push({ id:`${previous.slug}:missing:${checkedAt}`, type:'missing_from_source', severity:'warning', game_slug:previous.slug, title:previous.title, old_value:primaryDate(previous), new_value:null, detected_at:checkedAt, requires_review:true });
      records.push({ ...previous, last_seen_at: previous.last_seen_at, editorial: { ...(previous.editorial || {}), needs_review:true, status: previous.editorial?.status === 'published' ? 'published' : 'needs_review', notes: unique([...(previous.editorial?.notes || []), 'Запись исчезла из текущей выдачи источника']) } });
    }
  }
  return changes;
}

function writeDraft(record) {
  const previous = readJSON(record.editorial.draft_path, null);
  const locked = new Set(record.editorial.locked_fields || []);
  const parserFields = {
    title: record.title,
    aliases: record.aliases,
    release_type: record.release_type,
    genres: record.genres,
    developer: record.developer,
    publisher: record.publisher,
    external_ids: record.external_ids,
    image: record.image,
    events: record.events,
    sources: record.sources
  };
  const existingEditor = previous?.editor_fields || {};
  const mergedParser = { ...(previous?.parser_fields || {}), ...parserFields };
  for (const field of locked) {
    if (previous?.parser_fields && Object.prototype.hasOwnProperty.call(previous.parser_fields, field)) {
      mergedParser[field] = previous.parser_fields[field];
    }
  }
  writeJSON(record.editorial.draft_path, {
    schema_version: 1,
    game_slug: record.slug,
    generated_at: checkedAt,
    ownership: Object.fromEntries(Object.keys(mergedParser).map(field => [field, locked.has(field) ? 'editor_locked' : 'parser'])),
    parser_fields: mergedParser,
    editor_fields: existingEditor,
    publication: {
      status: record.editorial.status,
      auto_publish: false,
      readiness: record.editorial.readiness,
      needs_review: record.editorial.needs_review
    }
  });
}

let records = await collectSteam();
const rawgRows = await collectRawg();
records = mergeRawg(records, rawgRows);

if (!records.length) {
  records = (previousPayload.releases || []).map(item => ({
    ...item,
    editorial: {
      ...(item.editorial || {}),
      needs_review: true,
      status: item.editorial?.status === 'published' ? 'published' : 'needs_review',
      notes: unique([...(item.editorial?.notes || []), 'Последний запуск не получил данные из основных источников'])
    }
  }));
}

records = records.filter(shouldKeep);
const changes = detectChanges(records);
records.sort((a, b) => primaryDate(a).localeCompare(primaryDate(b)) || a.title.localeCompare(b.title, 'ru'));

let downloaded = 0;
let remoteFallbacks = 0;
for (const record of records) {
  record.image = await downloadCover(record);
  if (record.image?.status === 'downloaded_verified') downloaded++;
  else remoteFallbacks++;
  record.last_seen_at = checkedAt;
  writeDraft(record);
}

const sourceFailed = sourceStatuses.filter(item => item.status === 'error').length;
const sourceSucceeded = sourceStatuses.filter(item => item.status === 'success').length;
const sourcePartial = sourceStatuses.filter(item => item.status === 'partial').length;
const status = records.length && sourceFailed === 0 ? 'success' : records.length ? 'partial' : 'error';

writeJSON('data/releases/current.json', {
  schema_version: 1,
  generated_at: checkedAt,
  timezone: 'UTC',
  source_summary: { successful: sourceSucceeded, partial: sourcePartial, failed: sourceFailed },
  releases: records
});
writeJSON('data/releases/changes.json', { schema_version: 1, generated_at: checkedAt, changes });
writeJSON('data/parser-runs/releases.json', {
  schema_version: 1,
  parser_id: 'releases',
  status,
  checked_at: checkedAt,
  generated_at: checkedAt,
  output: 'data/releases/current.json',
  games_found: records.length,
  changes_found: changes.length,
  drafts_created: records.length,
  images_downloaded: downloaded,
  images_remote_verified: remoteFallbacks,
  conflicts: records.filter(item => item.editorial?.notes?.some(note => note.startsWith('Конфликт даты'))).length,
  note: status === 'success' ? 'Календарь обновлён.' : 'Календарь обновлён частично; требуется проверка источников.',
  sources: sourceStatuses
});

console.log(`releases: ${status}; ${records.length} games; ${changes.length} changes; ${downloaded} covers downloaded`);
