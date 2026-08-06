# News Content API

The service stores the normalized news ledger in PostgreSQL and exposes a read-only HTTP API. It is deliberately isolated from the static production reader: production continues to consume the Yandex Object Storage snapshot until a separate canary cutover is approved.

## Commands

```bash
npm install --ignore-scripts --no-package-lock
npm run sync:shadow -- --file ../../data/news-events.json
npm start
```

Required runtime configuration:

- `DATABASE_URL` — PostgreSQL connection string;
- `CONTENT_RUNTIME_MODE` — `shadow` by default, then optionally `canary` or `live`;
- `CONTENT_READ_SOURCE` — `object_storage` by default; shadow mode forbids `content_api`;
- `ALLOWED_ORIGINS` — comma-separated browser origins;
- `PORT`, `HOST`, `SHUTDOWN_GRACE_MS`, `MAX_SYNC_AGE_SECONDS`, `SHADOW_WRITE_ENABLED`, `SERVICE_VERSION` — optional runtime controls.

## Endpoints

- `GET /live`
- `GET /ready`
- `GET /health`
- `GET /v1/news`
- `GET /v1/news/:id`
- `GET /v1/publications/current`

The service rejects every HTTP write method. `/ready` is successful only after a publication exists and the latest independently computed shadow comparison is exact. Canary/live startup is additionally blocked when the latest exact sync is stale or a newer drift result exists. Migrations run before the server starts. SIGTERM and SIGINT stop the listener, close idle connections, drain active requests, and close the PostgreSQL pool.

See `docs/news-shadow-runtime.md` for synchronization, cutover, and rollback rules.
