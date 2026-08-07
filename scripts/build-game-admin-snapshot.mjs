#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {GameRegistryApi} from './lib/game-registry.mjs';

const root = process.cwd();
const registryPath = path.join(root, process.argv[2] ?? 'data/game-registry/registry.transition.json');
const outputPath = path.join(root, process.argv[3] ?? 'admin/games/data.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const api = new GameRegistryApi(registry);
const games = Object.values(registry.games).map(game => ({
  id: game.id,
  title: game.identity.canonicalTitle.value,
  slug: game.identity.slug.value,
  kind: game.identity.kind.value,
  status: game.workflow.status,
  statusReason: game.workflow.statusReason,
  pageStatus: game.workflow.pageStatus,
  researchStatus: game.workflow.researchStatus,
  articleStatus: game.workflow.articleStatus,
  reviewStatus: game.workflow.igropoiskReviewStatus,
  completeness: ['developers','publishers','platforms','genres','description'].filter(key => game.fields[key]?.value).length / 5,
  priority: game.priority,
  conflicts: game.conflicts.length,
  possibleDuplicates: game.possibleDuplicates.length,
  sourceCount: game.discovery.length,
  lockedFields: Object.keys(game.editorial.fieldLocks),
  releaseEvents: api.releaseEvents(game).length,
  articleCount: api.relatedContent(game).length,
  publicUrl: api.publicUrl(game),
  published: api.isPublished(game),
  mergedIntoGameId: game.mergedIntoGameId,
  auditLog: game.auditLog.slice(-20).reverse()
})).sort((a,b) => b.priority.score - a.priority.score || a.title.localeCompare(b.title));
const queue = games.filter(game => !game.published && !['rejected','merged_into_another_game'].includes(game.status));
const payload = {schemaVersion: 'game-admin-snapshot/v1', generatedAt: new Date().toISOString(), summary: {games: games.length, queue: queue.length, conflicts: games.filter(game => game.conflicts).length, ambiguous: registry.reviewQueue.length}, games, reviewQueue: registry.reviewQueue};
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload.summary, null, 2));
