# News Content API

This isolated PostgreSQL service stores the normalized news ledger and exposes a read-only API. Production still reads Yandex Object Storage until a separate canary cutover is approved.

```bash
npm install --ignore-scripts --no-package-lock
npm run sync:shadow -- --file ../../data/news-events.json
npm run sync:remote -- --report ../../tmp/news-shadow-sync-report.json
npm start
```

`sync:remote` uses only the published `data/news-events.json` selected by the canonical current manifest. Before PostgreSQL is changed it verifies HTTPS, host allowlist, canonical bucket/key/version paths, GitHub commit and run provenance, exact bytes, SHA-256, JSON, and the news-event contract. Redirects, URL credentials/query strings/fragments, alternate hosts, mutable keys, oversized bodies, and digest drift fail closed. The temporary snapshot is mode `0600`, removed after synchronization, and the optional report records immutable provenance and parity.

Remote controls: `NEWS_MANIFEST_URL`, `SNAPSHOT_ALLOWED_HOSTS`, `SNAPSHOT_FETCH_TIMEOUT_MS`, `MANIFEST_MAX_BYTES`, `SNAPSHOT_MAX_BYTES`, and `NEWS_SHADOW_SYNC_REPORT`. PostgreSQL and runtime controls remain `DATABASE_URL`, `PGSSL_MODE`, `CONTENT_RUNTIME_MODE`, `CONTENT_READ_SOURCE`, `MAX_SYNC_AGE_SECONDS`, `ALLOWED_ORIGINS`, `PORT`, `HOST`, and `SHUTDOWN_GRACE_MS`.

Endpoints: `GET /live`, `/ready`, `/health`, `/v1/news`, `/v1/news/:id`, and `/v1/publications/current`. Every HTTP write method is rejected. Canary/live readiness requires a fresh exact shadow comparison. Object Storage remains the rollback source.
