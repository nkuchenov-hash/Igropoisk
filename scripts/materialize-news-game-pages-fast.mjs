#!/usr/bin/env node

// Compatibility adapter: News keeps its established workflow/report names,
// while production materialization is shared by every Game Creator client.
if (!process.argv.includes('--report')) process.argv.push('--report', 'tmp/news-game-page-fast.json');
if (!process.argv.includes('--output')) process.argv.push('--output', 'tmp/news-game-page-fast-production.json');
await import('./materialize-game-creator-pages.mjs');
