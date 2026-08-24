#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectMissingGamePageRequests } from './lib/news-publication-gate.mjs';

const root = process.cwd();
const productionRef = String(process.env.NEWS_PRODUCTION_GAME_REF || '').trim();
const payload = JSON.parse(fs.readFileSync(path.join(root, 'data/news-events.json'), 'utf8'));
const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
const requestsByGame = new Map(collectMissingGamePageRequests(items).map(request => [request.game_id || request.slug, request]));

function existsAtProduction(relative) {
  if (!productionRef) return true;
  const result = spawnSync('git', ['cat-file', '-e', `${productionRef}:${relative}`], { cwd: root, stdio: 'ignore' });
  return result.status === 0;
}

if (productionRef) {
  for (const item of items) {
    for (const game of Array.isArray(item?.games) ? item.games : []) {
      if (!game || typeof game !== 'object' || game.identityVerified !== true) continue;
      const gameId = String(game.gameId || game.game_id || '').trim();
      const slug = String(game.slug || '').trim().toLowerCase();
      const title = String(game.title || item.game || '').trim();
      if (!slug || !title || !gameId || gameId.startsWith('news_game_')) continue;
      const page = `game/${slug}/index.html`;
      const draft = `data/drafts/${slug}.json`;
      if (existsAtProduction(page) && existsAtProduction(draft)) continue;
      const key = gameId || slug;
      if (requestsByGame.has(key)) continue;
      requestsByGame.set(key, {
        news_id: item.id || null,
        game_id: gameId,
        title,
        slug,
        confidence: Number(game.resolutionConfidence || game.confidence || 1),
        verified_external: Boolean(game.verifiedExternal),
        identity_verified: true,
        verification_sources: Array.isArray(game.verificationSources) ? game.verificationSources : [],
        matched_by: game.matchedBy || 'canonical-production-audit',
        source_url: item.primaryUrl || item.url || null,
        published_at: item.publishedAt || null,
        production_missing: true
      });
    }
  }
}

const requests = [...requestsByGame.values()];
const requestsB64 = Buffer.from(JSON.stringify(requests), 'utf8').toString('base64');
const output = {
  schema_version: 3,
  generated_at: new Date().toISOString(),
  production_ref: productionRef || null,
  count: requests.length,
  requests,
  requests_b64: requestsB64
};
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(root, 'tmp/news-game-page-requests.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ count: requests.length, production_ref: productionRef || null, output: 'tmp/news-game-page-requests.json' }));
