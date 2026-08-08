#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GameRegistryApi, isEmbeddedGameKind } from './lib/game-registry.mjs';

const root = process.cwd();
const topPath = path.join(root, 'data/top-250/current.json');
const registryPath = path.join(root, 'data/game-registry/registry.transition.json');
const catalogPath = path.join(root, 'data/catalog-visible.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const exists = file => fs.existsSync(file);

if (!exists(topPath)) throw new Error('Missing data/top-250/current.json');
if (!exists(registryPath)) throw new Error('Missing canonical Game Registry transition snapshot');
if (!exists(catalogPath)) throw new Error('Missing data/catalog-visible.json');

const top = readJson(topPath);
const registry = readJson(registryPath);
const api = new GameRegistryApi(registry);
const catalog = readJson(catalogPath);
const catalogById = new Map(catalog.map(item => [item.game_id, item]));
const catalogBySlug = new Map(catalog.map(item => [item.slug, item]));
const createdPages = [];
const repairedPages = [];
const createdDrafts = [];
const repairedDrafts = [];
const addedCatalog = [];
const repairedCatalog = [];
const skipped = [];

const field = (entity, key, fallback = null) => {
  const value = entity?.fields?.[key]?.value;
  return value === undefined || value === null ? fallback : value;
};
const array = value => Array.isArray(value) ? value : value ? [value] : [];
const mediaValue = (entity, kinds) => (entity?.media || []).find(item => kinds.includes(item.kind) && item.url)?.url || '';
const publicMedia = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw;
  return `/Igropoisk/${raw.replace(/^\.\//, '')}`;
};
const releaseValue = entity => (entity?.releases || []).find(item => item?.date?.value)?.date?.value || '';
const releaseYear = value => Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
const pageHtml = ({ slug, title, year, gameId }) => `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${String(title).replace(/[<&]/g, '')} — Игропоиск</title><link rel="stylesheet" href="../_shared/game-page.css"><link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" data-ig-shared-header="style"><link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" data-ig-layout-contract="style"></head><body data-title="${String(title).replace(/["<&]/g, '')}" data-year="${year || ''}" data-slug="${slug}" data-draft="${slug}" data-game-id="${gameId}"><script src="../_shared/game-shell.js"></script><script src="/Igropoisk/assets/site-header.js?v=20260803-2" data-ig-shared-header="script" defer></script><script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" data-ig-layout-contract="script" defer></script></body></html>\n`;

for (const item of top.ranking || []) {
  let entity = item.game_id ? api.findById(String(item.game_id)) : null;
  entity ||= api.findBySlug(String(item.slug || ''));
  if (!entity) {
    skipped.push({ slug: item.slug, reason: 'canonical_identity_missing' });
    continue;
  }
  const gameId = String(item.game_id || entity.id);
  const kind = entity.identity?.kind?.value || 'unknown';
  if (isEmbeddedGameKind(kind) || entity.presentation?.standalonePage === false || entity.workflow?.status === 'needs_review' || (entity.conflicts || []).length) {
    skipped.push({ slug: item.slug, game_id: gameId, reason: 'canonical_identity_not_publishable' });
    continue;
  }

  const slug = String(item.slug || entity.identity?.slug?.value || '');
  const title = item.title || entity.identity?.canonicalTitle?.value || slug;
  const release = releaseValue(entity);
  const year = Number(item.year) || releaseYear(release) || 0;
  const steamAppId = entity.externalIds?.steamAppId ? Number(entity.externalIds.steamAppId) : null;
  const platforms = array(field(entity, 'platforms', []));
  const officialLinks = field(entity, 'officialLinks', {});
  const itemImage = publicMedia(item.image);
  const cover = publicMedia(mediaValue(entity, ['cover', 'keyArt']) || itemImage);
  const hero = publicMedia(mediaValue(entity, ['hero', 'keyArt', 'cover']) || itemImage);

  const draftFile = path.join(root, 'data/drafts', `${slug}.json`);
  if (!exists(draftFile)) {
    writeJson(draftFile, {
      schema_version: 3,
      publication: {
        status: 'baseline',
        gate_passed: false,
        errors: ['editorial_research_pending'],
        checked_at: new Date().toISOString()
      },
      identity: { slug, title, seed_title: title, steam_appid: steamAppId },
      release: { date_text: String(release || year || '') },
      companies: {
        developers: array(field(entity, 'developers', [])),
        publishers: array(field(entity, 'publishers', []))
      },
      classification: {
        genres: array(field(entity, 'genres', [])),
        categories: [],
        platforms
      },
      editorial: {
        short_description: field(entity, 'shortDescription', field(entity, 'description', '')) || '',
        integrated_description: '',
        features: []
      },
      media: { cover, hero, screenshots: [], videos: [], artwork: [] },
      ratings: { igropoisk: null, users: null, user_votes: 0 },
      links: {
        official: typeof officialLinks === 'string' ? officialLinks : officialLinks?.official || '',
        store: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : ''
      },
      materials: { reviews: [], news: [], guides: [] },
      requirements: { platforms },
      sources: [],
      source: { type: 'canonical-game-registry', game_id: gameId }
    });
    createdDrafts.push(slug);
  } else {
    const draft = readJson(draftFile);
    if (draft?.publication?.status === 'baseline' && draft?.source?.type === 'canonical-game-registry' && draft.source.game_id !== gameId) {
      draft.source.game_id = gameId;
      writeJson(draftFile, draft);
      repairedDrafts.push(slug);
    }
  }

  const pageFile = path.join(root, 'game', slug, 'index.html');
  if (!exists(pageFile)) {
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(pageFile, pageHtml({ slug, title, year, gameId }));
    createdPages.push(slug);
  } else {
    const html = fs.readFileSync(pageFile, 'utf8');
    const match = html.match(/data-game-id="([^"]*)"/);
    const currentGameId = match?.[1] || '';
    if (currentGameId !== gameId) {
      const isBaselinePage = html.includes(`data-draft="${slug}"`) && html.includes('../_shared/game-shell.js');
      if (!isBaselinePage) {
        skipped.push({ slug, game_id: gameId, page_game_id: currentGameId || null, reason: 'existing_nonbaseline_page_identity_mismatch' });
        continue;
      }
      const repaired = match
        ? html.replace(/data-game-id="[^"]*"/, `data-game-id="${gameId}"`)
        : html.replace('<body ', `<body data-game-id="${gameId}" `);
      fs.writeFileSync(pageFile, repaired);
      repairedPages.push(slug);
    }
  }

  const catalogRecord = catalogBySlug.get(slug);
  if (catalogRecord && catalogRecord.game_id !== gameId) {
    catalogById.delete(catalogRecord.game_id);
    catalogRecord.game_id = gameId;
    catalogById.set(gameId, catalogRecord);
    repairedCatalog.push(slug);
  } else if (!catalogById.has(gameId) && !catalogRecord) {
    const record = { title, year: year || null, slug, game_id: gameId };
    catalog.push(record);
    catalogById.set(gameId, record);
    catalogBySlug.set(slug, record);
    addedCatalog.push(slug);
  }
}

writeJson(catalogPath, catalog);
writeJson(path.join(root, 'data/top-250/materialization.json'), {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  created_pages: createdPages,
  repaired_pages: repairedPages,
  created_drafts: createdDrafts,
  repaired_drafts: repairedDrafts,
  added_catalog: addedCatalog,
  repaired_catalog: repairedCatalog,
  skipped
});

console.log(JSON.stringify({
  created_pages: createdPages.length,
  repaired_pages: repairedPages.length,
  created_drafts: createdDrafts.length,
  repaired_drafts: repairedDrafts.length,
  added_catalog: addedCatalog.length,
  repaired_catalog: repairedCatalog.length,
  skipped: skipped.length
}, null, 2));
if (skipped.length) process.exitCode = 2;
