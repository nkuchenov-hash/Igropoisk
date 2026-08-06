# News Content API

This service is the shadow relational content layer for the news module.

It does not replace the current Object Storage manifest in Phase B2. The public site continues to read the validated immutable snapshot through `features/news/content-api/index.js`. The service imports the same snapshot into PostgreSQL, records immutable revisions and exposes a read-only API for validation.

## Commands

```bash
export DATABASE_URL=postgres://user:password@host:5432/igropoisk
npm install
npm run migrate
npm run import:snapshot -- --file ../../data/news-events.json --snapshot-version local-check
npm run verify
npm start
```

Public read-only routes:

- `GET /health`
- `GET /v1/news?limit=30&offset=0`
- `GET /v1/news/<id>`
- `GET /v1/publications/current?channel=news`

The service accepts no write methods. Parser writes will be connected only after the shadow import remains consistent with Object Storage on staging.

## Database TLS

Use `PGSSL_MODE=verify-full` and provide `PGSSL_CA` or `PGSSL_CA_FILE` in production. `PGSSL_MODE=disable` is intended only for local and CI PostgreSQL.
