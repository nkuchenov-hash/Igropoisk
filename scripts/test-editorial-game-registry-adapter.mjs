import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyCanonicalGameIdentity, loadEditorialRegistry, resolveEditorialGame } from './lib/editorial-game-registry-adapter.mjs';

const root = process.cwd();
const loaded = loadEditorialRegistry(root);
const expectedSlugs = ['mafia', 'elden-ring', 'the-witcher-3-wild-hunt'];

for (const slug of expectedSlugs) {
  const identity = resolveEditorialGame({ slug }, { root, loaded });
  assert.match(identity.game_id, /^game_[a-f0-9]{20}(?:_[a-f0-9]+)?$/);
  assert.equal(identity.slug, slug);
  const reviewFile = path.join(root, 'data/reviews', `${slug}.json`);
  if (!fs.existsSync(reviewFile)) continue;
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  const fromReview = resolveEditorialGame(review, { root, loaded });
  assert.equal(fromReview.game_id, identity.game_id, `${slug} review must resolve to the same canonical game`);
  const canonicalized = applyCanonicalGameIdentity(review, identity);
  assert.equal(canonicalized.game_id, identity.game_id);
  assert.equal(canonicalized.game_slug, slug);
}

const mafiaByExternal = resolveEditorialGame({ steam_appid: 40990 }, { root, loaded });
const mafiaBySlug = resolveEditorialGame({ slug: 'mafia' }, { root, loaded });
assert.equal(mafiaByExternal.game_id, mafiaBySlug.game_id, 'Steam ID and slug must resolve to the same Mafia entity');
assert.throws(() => resolveEditorialGame({ slug: '__definitely-not-a-real-game__' }, { root, loaded }), /Cannot resolve editorial game/);

console.log(JSON.stringify({ status: 'passed', canonical_games_checked: expectedSlugs.length, mafia_game_id: mafiaBySlug.game_id }, null, 2));
