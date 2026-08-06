# News shadow runtime

## Safety invariant

Production continues to read the published news snapshot from Yandex Object Storage. The PostgreSQL Content API is a shadow copy until a separate, explicit canary or live cutover changes both `CONTENT_RUNTIME_MODE` and `CONTENT_READ_SOURCE`. Shadow mode rejects `CONTENT_READ_SOURCE=content_api` at process startup.

## Local runtime

```bash
cd services/content-api
docker compose -f docker-compose.shadow.yml up --build
```

The API exposes:

- `GET /live` — process liveness without a database query;
- `GET /ready` — database and content readiness;
- `GET /health` — backward-compatible readiness response;
- `GET /v1/news` and `GET /v1/news/:id` — published content;
- `GET /v1/publications/current` — current imported publication.

All non-GET/HEAD methods are rejected.

## Shadow synchronization

Run migrations, import the current immutable snapshot, then compare the content hashes stored in PostgreSQL with hashes computed independently from the source file:

```bash
npm run sync:shadow -- --file ../../data/news-events.json
```

The comparison exits with code `2` on missing, extra, or content-mismatched events and records the result in `shadow_sync_runs`. A successful result requires equal item counts, equal aggregate digests, and no per-item drift. `/ready` remains unavailable until this exact comparison exists. Canary/live startup also requires the latest run to remain exact and younger than `MAX_SYNC_AGE_SECONDS`.

## Cutover gates

A future canary is allowed only after all of the following are true:

1. A persistent PostgreSQL instance and API endpoint exist outside GitHub Pages.
2. Scheduled shadow imports have produced repeated `exact` sync results.
3. The API passes `/ready` and production browser smoke checks.
4. Object Storage remains available as the rollback source.
5. The read switch is made in a dedicated PR; it is never bundled with parser, UI, game, release, review, or design-system changes.

## Rollback

Set `CONTENT_READ_SOURCE=object_storage` and `CONTENT_RUNTIME_MODE=shadow`, redeploy the reader, and leave PostgreSQL online for diagnosis. Do not delete revisions or synchronization records during rollback.
