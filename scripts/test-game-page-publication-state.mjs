#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isDeployableBaseShell, publicationProblems } from './validate-game-page-publication-state.mjs';

const baseDraft = {
  publication: {
    status: 'published',
    public_ready: true,
    page_available: true,
    gate_passed: true,
    editorial_ready: false,
    media_green: false,
    gate: { passed: true }
  },
  modules: {
    page: 'ready',
    media: 'pending',
    review: 'pending',
    game_dna: 'pending',
    similarity: 'pending'
  }
};

assert.equal(isDeployableBaseShell(baseDraft), true,
  'a published Game Creator base shell must be deployable while optional enrichment is pending');

assert.deepEqual(publicationProblems({
  slug: 'example-game',
  draft: baseDraft,
  editorial: null,
  pageQc: null,
  contentQc: null,
  mediaQc: null,
  corpus: null,
  shellExists: true,
  allowBaseShell: true
}), [], 'base shell mode must not require editorial/media/source enrichment before the page exists publicly');

const strictProblems = publicationProblems({
  slug: 'example-game',
  draft: baseDraft,
  editorial: null,
  pageQc: null,
  contentQc: null,
  mediaQc: null,
  corpus: null,
  shellExists: true,
  allowBaseShell: false
});
assert.ok(strictProblems.includes('canonical page editorial is missing/not green'),
  'strict editorial publication mode must keep the full quality gate');
assert.ok(strictProblems.includes('page QC is not green'),
  'strict editorial publication mode must still require page QC');

const missingShellProblems = publicationProblems({
  slug: 'example-game',
  draft: baseDraft,
  shellExists: false,
  allowBaseShell: true
});
assert.deepEqual(missingShellProblems, ['public game shell is missing'],
  'even a valid base draft must never deploy without its actual public shell');

const incompleteDraft = structuredClone(baseDraft);
incompleteDraft.publication.gate_passed = false;
assert.equal(isDeployableBaseShell(incompleteDraft), false,
  'base shell exception must fail closed when the Game Creator publication gate did not pass');

console.log('Game page base-shell vs full-editorial publication contract passed.');
