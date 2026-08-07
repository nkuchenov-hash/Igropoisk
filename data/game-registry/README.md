# Game Registry transition artifacts

This directory is reserved for generated transition snapshots and migration reports. The migration is dry-run by default:

```bash
node scripts/migrate-game-registry.mjs --root .
```

Materialize transition artifacts without changing source data:

```bash
node scripts/migrate-game-registry.mjs --root . --write
node scripts/build-game-admin-snapshot.mjs
```

Do not commit large production catalogs, research bodies or images here. Canonical production data belongs in PostgreSQL and media belongs in Object Storage. Production switching is disabled in `config/game-registry.json`.
