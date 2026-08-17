#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, isEmbeddedGameKind } from './lib/game-registry.mjs';

const root = process.cwd();
const slugOrId = process.argv[2];
if (!slugOrId) throw new Error('Usage: ensure-game-page <slug-or-id>');

const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
  catch { return fallback; }
};
const write = (relative, value) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = relative => fs.existsSync(path.join(root, relative));
const field = (entity, key, fallback = null) => entity?.fields?.[key]?.value ?? fallback;
const entityMedia = (entity, kinds) => (entity?.media || []).filter(item => kinds.includes(item.kind) && item.url).map(item => item.url);
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '') ?? '';
const unique = values => [...new Set((values || []).filter(Boolean))];
const strip = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const creatorSource = String(process.env.GAME_CREATOR_SOURCE || 'generic').trim().toLowerCase() || 'generic';
const creatorSourceUrl = String(process.env.GAME_SOURCE_URL || '').trim();
const registry = read('data/game-registry/registry.transition.json');
if (!registry) throw new Error('Canonical Game Registry is missing.');
const api = new GameRegistryApi(registry);
const entity = api.findById(slugOrId) ?? api.findBySlug(slugOrId);
if (!entity) throw new Error(`Game not found: ${slugOrId}`);
const kind = entity.identity?.kind?.value ?? 'unknown';
if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false) throw new Error(`Embedded game cannot receive standalone page: ${entity.id}`);
if (entity.workflow?.status === 'needs_review' || (entity.conflicts || []).length) throw new Error(`Game identity requires review: ${entity.id}`);

const slug = String(entity.identity?.slug?.value || '').trim().toLowerCase();
const canonicalTitle = String(entity.identity?.canonicalTitle?.value || '').trim();
if (!slug || !canonicalTitle) throw new Error(`Game identity incomplete: ${entity.id}`);

const parser = read(`data/parser-output/${slug}.json`, {});
const existing = read(`data/drafts/${slug}.json`, {});
const now = new Date();
const nowIso = now.toISOString();
const steamAppId = Number(parser?.identity?.steam_appid || entity.externalIds?.steamAppId) || null;
let russianSteam = null;
if (steamAppId) {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=russian&cc=ru`, {
      headers: { 'user-agent': 'IgropoiskGameCreator/1.0' },
      signal: AbortSignal.timeout(12000)
    });
    if (response.ok) {
      const payload = await response.json();
      russianSteam = payload?.[String(steamAppId)]?.success ? payload[String(steamAppId)].data : null;
    }
  } catch {}
}

const title = first(parser?.identity?.title, canonicalTitle, slug);
const releaseDate = first(parser?.release?.date_text, (entity.releases || []).find(item => item.date?.value)?.date?.value, 'Уточняется');
const year = Number(String(releaseDate).match(/(?:19|20)\d{2}/)?.[0]) || null;
const releaseStatus = String(parser?.release?.status || existing?.release?.status || '').toLowerCase();
const parsedDate = Date.parse(String(parser?.release?.date || releaseDate || ''));
const futureExact = Number.isFinite(parsedDate) && parsedDate > now.getTime();
const futureYear = year && year > now.getUTCFullYear();
const statusUpcoming = /(upcoming|expected|announced|coming|tba|pre[-_ ]?release|ожида)/i.test(releaseStatus);
const released = !(futureExact || futureYear || statusUpcoming);

const developers = unique([...(parser?.companies?.developers || []), ...(field(entity, 'developers', []) || [])]);
const publishers = unique([...(parser?.companies?.publishers || []), ...(field(entity, 'publishers', []) || [])]);
const genres = unique([...(russianSteam?.genres || []).map(item => item.description), ...(parser?.classification?.genres || []), ...(field(entity, 'genres', []) || [])]);
const platforms = unique([...(parser?.classification?.platforms || []), ...(field(entity, 'platforms', []) || [])]);
const categories = unique([...(russianSteam?.categories || []).map(item => item.description), ...(parser?.classification?.categories || [])]);
const screenshots = unique([...(parser?.media?.screenshots || []), ...entityMedia(entity, ['screenshots', 'screenshot'])]);
const videos = parser?.media?.videos || [];
const cover = first(parser?.media?.cover, ...entityMedia(entity, ['cover', 'keyArt']));
const hero = first(parser?.media?.hero, ...entityMedia(entity, ['hero', 'keyArt', 'cover']), cover);
const artwork = unique([...(parser?.media?.artwork || []), ...entityMedia(entity, ['keyArt', 'hero'])]);
const officialLinks = field(entity, 'officialLinks', {});
const store = first(parser?.links?.store, steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : null);
const official = first(parser?.links?.official, typeof officialLinks === 'string' ? officialLinks : officialLinks?.official);
const sourceUrl = first(parser?.source?.url, creatorSourceUrl, store, official);
const shortDescription = strip(first(
  russianSteam?.short_description,
  parser?.editorial?.short_description,
  field(entity, 'shortDescription', ''),
  field(entity, 'description', ''),
  existing?.editorial?.integrated_description,
  `${title} — игра, данные о которой собраны из проверяемых источников.`
));
const features = unique([...(russianSteam?.categories || []).map(item => item.description), ...(parser?.editorial?.features || []), ...categories]).slice(0, 8);
const sources = sourceUrl ? [{
  name: parser?.source?.name || (store && sourceUrl === store ? 'Steam Store API' : `Проверенный источник (${creatorSource})`),
  url: sourceUrl,
  type: store && sourceUrl === store ? 'store' : 'database',
  checked_at: parser?.source?.checked_at || nowIso
}] : [];

const missing = [];
if (!title) missing.push('identity.title');
if (!sourceUrl) missing.push('identity.source');
if (!hero && !cover && screenshots.length === 0) missing.push('media');
if (missing.length) throw new Error(`${slug}: insufficient structured data for a real page: ${missing.join(', ')}`);

// Optional modules are observed, but never gate the existence of the base game page.
const review = read(`data/reviews/${slug}.json`, {});
const article = read(`data/articles/${slug}.json`, {});
const canonicalScore = Number(review?.review_score?.calculation?.score_10);
const reviewReady = Boolean(article)
  && exists(`article/${slug}/index.html`)
  && String(article?.game_slug || article?.slug || '') === slug
  && String(article?.publication_status || '').toLowerCase() === 'published'
  && review?.publication_gate?.status === 'green'
  && review?.review_score?.status === 'green'
  && Number.isFinite(canonicalScore)
  && Number(article?.score) === canonicalScore;
const gameDnaReady = exists(`data/game-dna/${slug}.json`);
const similarityReady = exists(`data/similarity/${slug}.json`);
const guidesReady = exists(`data/guides/${slug}.json`);

const game = {
  schema_version: 5,
  publication: {
    status: 'published',
    gate_passed: true,
    page_available: true,
    public_ready: true,
    editorial_ready: reviewReady,
    review_ready: reviewReady,
    review_required: released,
    media_green: null,
    mode: 'game_creator_structured_sources',
    creator_source: creatorSource,
    updated_at: nowIso,
    gate: {
      canonical_game_id: entity.id,
      title: Boolean(title),
      media: Boolean(hero || cover || screenshots.length),
      source_count: sources.length,
      missing,
      passed: true
    }
  },
  modules: {
    page: 'ready',
    review: reviewReady ? 'ready' : 'pending',
    game_dna: gameDnaReady ? 'ready' : 'pending',
    similarity: similarityReady ? 'ready' : 'pending',
    guides: guidesReady ? 'ready' : 'missing'
  },
  game_id: entity.id,
  identity: {
    slug,
    title,
    steam_appid: steamAppId,
    aliases: entity.identity?.aliases?.value || [],
    excluded_versions: existing?.identity?.excluded_versions || []
  },
  release: {
    date_text: String(releaseDate),
    date: String(releaseDate),
    status: released ? 'released' : 'upcoming'
  },
  companies: { developers, publishers },
  classification: { genres, platforms, categories },
  editorial: {
    short_description: shortDescription,
    integrated_description: first(existing?.editorial?.integrated_description, shortDescription),
    campaign: existing?.editorial?.campaign || '',
    features
  },
  media: { hero, cover, screenshots, videos, artwork },
  requirements: parser?.requirements || existing?.requirements || { pc: { minimum: { raw: '' }, recommended: { raw: '' } }, platforms },
  links: {
    official,
    store,
    developer: existing?.links?.developer || '',
    publisher: existing?.links?.publisher || ''
  },
  sources: unique([...(existing?.sources || []), ...sources].map(item => typeof item === 'string' ? item : JSON.stringify(item))).map(item => {
    try { return JSON.parse(item); } catch { return item; }
  }),
  updated_at: nowIso
};
if (existing?.relations) game.relations = existing.relations;
write(`data/drafts/${slug}.json`, game);

const chunk = year && year <= 2015 ? '2002-2015'
  : year && year <= 2017 ? '2016-2017'
  : year && year <= 2019 ? '2018-2019'
  : year === 2020 ? '2020'
  : year && year <= 2022 ? '2021-2022'
  : '2023-2025';
const chunkPath = `data/game-content/${chunk}.json`;
const chunkData = read(chunkPath, { schema_version: 5, games: {} });
chunkData.schema_version = Math.max(Number(chunkData.schema_version || 1), 5);
chunkData.games = chunkData.games || {};
chunkData.games[slug] = game;
write(chunkPath, chunkData);

const catalog = read('data/catalog-visible.json', []);
const catalogIndex = catalog.findIndex(item => item.slug === slug);
const entry = { title, year, slug, game_id: entity.id, ...(steamAppId ? { steam_appid: steamAppId } : {}) };
if (catalogIndex >= 0) catalog[catalogIndex] = { ...catalog[catalogIndex], ...entry };
else catalog.push(entry);
write('data/catalog-visible.json', catalog);

const safeTitle = String(title).replace(/[&<>"']/g, '');
const safeYear = year || '';
const html = `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css">
  <link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style">
  <link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style">
</head><body data-title="${safeTitle}" data-year="${safeYear}" data-slug="${slug}" data-game-id="${entity.id}" data-draft="${slug}"><script src="../_shared/game-shell.js"></script>
  <script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script>
  <script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script>
</body></html>`;
const pagePath = path.join(root, 'game', slug, 'index.html');
fs.mkdirSync(path.dirname(pagePath), { recursive: true });
fs.writeFileSync(pagePath, `${html}\n`);
write(`data/parser-runs/game-creator-${slug}.json`, {
  parser: 'game-creator',
  status: 'green',
  creator_source: creatorSource,
  game_slug: slug,
  game_id: entity.id,
  checked_at: nowIso,
  page_available: true,
  modules: game.modules,
  output: [`data/drafts/${slug}.json`, chunkPath, `game/${slug}/index.html`]
});
console.log(JSON.stringify({ slug, game_id: entity.id, status: 'green', page_available: true, modules: game.modules }, null, 2));
