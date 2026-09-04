#!/usr/bin/env node
// Compatibility entry point. Review Skill v1 uses the complete available canonical source pack
// and retries the same assigned model; it never rewrites source quotas or switches models.
await import('./build-review-from-request.mjs');
