#!/usr/bin/env node
const slug=String(process.argv[2]||'').trim();
if(!slug)throw new Error('Usage: node scripts/synthesize-review-github-models.mjs <game-slug>');
console.error('Cross-model fallback is disabled by Review Skill v1. Retry the model assigned to this review through scripts/build-review-from-request.mjs.');
process.exit(2);
