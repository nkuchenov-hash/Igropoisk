#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { compareGameDna, materializeGameDna, profileQuality } from './lib/game-dna.mjs';

const root = process.cwd();
const requested = String(process.argv[2] || '').trim();
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; }
};
const writeStable = (relative, value) => {
  const target = path.join(root, relative);
  const previous = read(relative);
  const stable = (payload) => { if (!payload) return null; const clone = structuredClone(payload); delete clone.generated_at; return clone; };
  if (previous && JSON.stringify(stable(previous)) === JSON.stringify(stable(value))) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return true;
};
const mediaUrl = (item) => typeof item === 'string' ? item : String(item?.url || item?.src || item?.image || item?.thumbnail || '');
const imageFor = (game) => {
  const appid = Number(game?.identity?.steam_appid || 0);
  return mediaUrl(game?.media?.hero) || mediaUrl(game?.media?.artwork?.[0]) || mediaUrl(game?.media?.cover) || (appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg` : '');
};
const merge = (base, next) => {
  if (!next) return base || {};
  return {
    ...(base || {}), ...(next || {}),
    identity: { ...(base?.identity || {}), ...(next?.identity || {}) },
    classification: { ...(base?.classification || {}), ...(next?.classification || {}) },
    editorial: { ...(base?.editorial || {}), ...(next?.editorial || {}) },
    relations: { ...(base?.relations || {}), ...(next?.relations || {}) },
  };
};

const config = read('config/game-page-quality-v2.json', {}).similarity || {};
const taxonomy = read('config/game-dna-taxonomy.json', {});
const catalog = read('data/catalog-visible.json', []).filter((item) => item?.slug);
const catalogBySlug = new Map(catalog.map((item) => [item.slug, item]));
const records = new Map();
const contentDir = path.join(root, 'data/game-content');
if (fs.existsSync(contentDir)) {
  for (const file of fs.readdirSync(contentDir).filter((name) => name.endsWith('.json'))) {
    const payload = read(`data/game-content/${file}`, {});
    for (const [slug, game] of Object.entries(payload?.games || {})) records.set(slug, game);
  }
}
for (const item of catalog) {
  const slug = item.slug;
  let game = records.get(slug) || {};
  game = merge(game, read(`data/parser-output/${slug}.json`));
  game = merge(game, read(`data/drafts/${slug}.json`));
  game.identity = {
    ...(game.identity || {}),
    slug,
    title: game.identity?.title || item.title || slug,
    game_id: game.identity?.game_id || item.game_id || '',
  };
  records.set(slug, game);
}

const dnaCache = new Map();
function dnaFor(slug) {
  if (dnaCache.has(slug)) return dnaCache.get(slug);
  const game = records.get(slug) || {};
  const catalogItem = catalogBySlug.get(slug) || { slug };
  const stored = read(`data/game-dna/${slug}.json`);
  const dna = stored || materializeGameDna({ game, catalogItem, existing: null, now: new Date(0).toISOString() });
  dnaCache.set(slug, dna);
  return dna;
}
function labelFor(axis) {
  if (axis === 'franchise') return 'та же серия';
  return taxonomy.axes?.[axis]?.label || axis;
}

const targets = requested ? [requested] : catalog.map((item) => item.slug);
let written = 0;
let profilesNeedingEnrichment = 0;
let gamesWithoutRecommendations = 0;
for (const slug of targets) {
  const source = records.get(slug);
  if (!source) continue;
  const sourceDna = dnaFor(slug);
  const sourceQuality = sourceDna.quality || profileQuality(sourceDna.profile || {});
  if (sourceQuality.needs_enrichment) profilesNeedingEnrichment += 1;
  const recommendations = [];
  if (!sourceQuality.ready_for_similarity) {
    gamesWithoutRecommendations += 1;
    writeStable(`data/similarity/${slug}.json`, {
      schema_version: 4,
      game_slug: slug,
      game_id: sourceDna.game_id || source?.identity?.game_id || '',
      generated_at: new Date().toISOString(),
      algorithm: 'game-dna-weighted-v1',
      year_proximity_used: false,
      series_alone_can_qualify: false,
      source_dna: { status: sourceDna.status || 'auto', revision: Number(sourceDna.revision || 0), quality: sourceQuality, ref: `../game-dna/${slug}.json` },
      profile: sourceDna.profile || {},
      recommendations: [],
    });
    written += 1;
    continue;
  }
  for (const item of catalog) {
    if (!item.slug || item.slug === slug) continue;
    const candidate = records.get(item.slug);
    if (!candidate) continue;
    const candidateDna = dnaFor(item.slug);
    const candidateQuality = candidateDna.quality || profileQuality(candidateDna.profile || {});
    if (!candidateQuality.ready_for_similarity) continue;
    const result = compareGameDna(sourceDna.profile || {}, candidateDna.profile || {}, config);
    if (!result.qualified) continue;
    recommendations.push({
      slug: item.slug,
      game_id: candidateDna.game_id || item.game_id || '',
      title: candidateDna.title || candidate?.identity?.title || item.title,
      year: item.year || Number(String(candidate?.release?.date || candidate?.release?.date_text || '').match(/\d{4}/)?.[0] || 0),
      score: result.score,
      base_score: result.base_score,
      penalty: result.penalty,
      core_matches: result.core_matches,
      compared_core_axes: result.compared_core_axes,
      dna_status: candidateDna.status || 'auto',
      image: imageFor(candidate),
      reasons: result.reasons.map((reason) => labelFor(reason.axis)),
      signals: result.reasons.map((reason) => ({ ...reason, label: labelFor(reason.axis) })),
    });
  }
  recommendations.sort((a, b) => b.score - a.score || b.core_matches - a.core_matches || String(a.title).localeCompare(String(b.title), 'ru'));
  if (!recommendations.length) gamesWithoutRecommendations += 1;
  writeStable(`data/similarity/${slug}.json`, {
    schema_version: 4,
    game_slug: slug,
    game_id: sourceDna.game_id || source?.identity?.game_id || '',
    generated_at: new Date().toISOString(),
    algorithm: 'game-dna-weighted-v1',
    year_proximity_used: false,
    series_alone_can_qualify: false,
    source_dna: {
      status: sourceDna.status || 'auto',
      revision: Number(sourceDna.revision || 0),
      quality: sourceQuality,
      ref: `../game-dna/${slug}.json`,
    },
    profile: sourceDna.profile || {},
    recommendations: recommendations.slice(0, Number(config.maximum_results || 12)),
  });
  written += 1;
}

console.log(JSON.stringify({
  catalog_games: catalog.length,
  dna_profiles: dnaCache.size,
  similarity_files_written: written,
  profiles_needing_enrichment: profilesNeedingEnrichment,
  games_without_recommendations: gamesWithoutRecommendations,
  algorithm: 'game-dna-weighted-v1',
  year_proximity_used: false,
}, null, 2));
