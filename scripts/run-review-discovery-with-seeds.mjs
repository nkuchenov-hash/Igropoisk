#!/usr/bin/env node
// Legacy compatibility entry point. Review-local discovery and seed merging are disabled.
// Source discovery belongs to the canonical Game Page source pipeline.
await import('./prepare-review-research.mjs');
