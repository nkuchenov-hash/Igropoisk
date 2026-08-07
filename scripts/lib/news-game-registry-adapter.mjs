import fs from 'node:fs/promises';
import path from 'node:path';
import { entityAliases } from './game-registry.mjs';
import { migrateRepository } from './game-registry-migration.mjs';

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

function scalarExternalIds(entity = {}) {
  const ids = entity.externalIds || {};
  return Object.freeze(Object.fromEntries([
    ['steam', ids.steamAppId],
    ['igdb', ids.igdbId],
    ['rawg', ids.rawgId]
  ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => [key, String(value)])));
}

export async function loadCanonicalNewsCatalog({ root = process.cwd() } = {}) {
  const rules = await readJson(path.join(root, 'data/news-game-aliases.json'), { schemaVersion: 1, games: {}, series: {} });
  const { registry } = migrateRepository(root, { dryRun: true, publicBaseUrl: '/game' });
  const games = [];

  for (const entity of Object.values(registry.games || {})) {
    if (entity.workflow?.status === 'merged_into_another_game') continue;
    const slug = String(entity.identity?.slug?.value || '').trim();
    const title = String(entity.identity?.canonicalTitle?.value || '').trim();
    if (!slug || !title) continue;
    const rule = rules?.games?.[slug] || {};
    const pagePath = path.join(root, 'game', slug, 'index.html');
    const pageExists = await fs.access(pagePath).then(() => true).catch(() => false);
    const aliases = [...new Set([...entityAliases(entity), ...(rule.aliases || [])].map(String).filter(Boolean))];
    const abbreviations = [...new Set((rule.abbreviations || []).map(String).filter(Boolean))];
    games.push(Object.freeze({
      gameId: entity.id,
      slug,
      title,
      pageExists,
      pageUrl: pageExists ? `game/${slug}/` : '',
      aliases: Object.freeze(aliases),
      abbreviations: Object.freeze(abbreviations),
      externalIds: scalarExternalIds(entity)
    }));
  }

  return Object.freeze({
    games: Object.freeze(games),
    rules: Object.freeze(rules),
    canonicalRegistry: true,
    canonicalGameCount: games.length
  });
}
