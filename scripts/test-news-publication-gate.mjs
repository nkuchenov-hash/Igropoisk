import assert from 'node:assert/strict';
import { filterNewsPayload, hasMissingGamePage } from './lib/news-publication-gate.mjs';

const ready = { id: 'ready', games: [{ slug: 'ready-game', pageExists: true, pageUrl: 'game/ready-game/' }], gameReviewReasons: [] };
const missingByReason = { id: 'reason', games: [{ slug: 'future-game' }], gameReviewReasons: ['missing-game-page'] };
const missingByGame = { id: 'game', games: [{ slug: 'future-game', pageExists: false, pageUrl: '' }], gameReviewReasons: [] };
const ambiguousOnly = { id: 'ambiguous', games: [], gameReviewReasons: ['ambiguous-explicit-name'] };

assert.equal(hasMissingGamePage(ready), false);
assert.equal(hasMissingGamePage(missingByReason), true);
assert.equal(hasMissingGamePage(missingByGame), true);
assert.equal(hasMissingGamePage(ambiguousOnly), false, 'Ambiguous unresolved names expose no broken game hashtag and do not block unrelated news.');

const objectPayload = filterNewsPayload({ generatedAt: '2026-08-12T00:00:00Z', items: [ready, missingByReason, missingByGame, ambiguousOnly] });
assert.deepEqual(objectPayload.items.map(item => item.id), ['ready', 'ambiguous']);
const arrayPayload = filterNewsPayload([missingByGame, ready]);
assert.deepEqual(arrayPayload.map(item => item.id), ['ready']);

console.log('News publication game-page gate tests passed.');
