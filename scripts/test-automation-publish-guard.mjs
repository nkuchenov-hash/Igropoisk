import assert from 'node:assert/strict';
import { validateEntries } from './validate-automation-publish-diff.mjs';

assert.deepEqual(validateEntries('parser-50', [
  'M\tdata/public/games.json',
  'A\tdata/drafts/example.json',
  'M\tgame/example/index.html',
]), []);

assert.match(
  validateEntries('parser-50', ['D\tgame/example/index.html'])[0],
  /only add or modify/,
);
assert.match(
  validateEntries('parser-50', ['M\tgame\/_shared/game-page.js'])[0],
  /Protected game runtime path/,
);
assert.match(
  validateEntries('parser-50', ['M\tindex.html'])[0],
  /outside the parser-50 automation allowlist/,
);
assert.deepEqual(validateEntries('content-pipeline', [
  'M\tdata/reviews/example.json',
  'A\tarticle/example/index.html',
  'M\tgame/example/index.html',
]), []);
assert.match(
  validateEntries('content-pipeline', ['D\tarticle/example/index.html'])[0],
  /only add or modify/,
);
assert.match(
  validateEntries('missing-profile', [])[0],
  /Unknown automation diff profile/,
);

console.log('Automation publish diff guard tests passed.');
