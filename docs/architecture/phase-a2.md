# Phase A2 — deployment and content separation

## Active branch model

- `main` is the confirmed production source.
- `staging` receives automated content snapshots and approved code changes before production.
- feature branches merge into `staging` or are validated before a controlled promotion.
- `production-stable-2026-08-05-before-a2` preserves the production state from before this migration.

## Production invariant

The Pages workflow is read-only. It may validate and package the exact commit, but it may not rewrite HTML, inject CSS or JavaScript, change authentication code, regenerate pages, or run parsers.

Production deployment begins only after a commit reaches `main`. Scheduled and manual parsers may not write to `main` and may not dispatch the Pages workflow.

## Interim content flow

Until the database and Content API are deployed, automated generators write only to `staging`:

`source collection → validation → staging commit → staging gate → promotion PR → main → production deployment`

This is transitional. Phase B will replace repository content snapshots with database records and object storage so normal content publication no longer requires a code deployment.

## Failure behavior

- Failed parsers do not modify `main`.
- Failed staging validation does not deploy production.
- A failed production validation leaves the previously deployed site active.
- Promotion is represented by a staging-to-main PR and therefore has an exact diff and rollback commit.

## Remaining infrastructure work

Repository branch protection cannot be configured from the current GitHub integration. Required repository settings are: block direct pushes to `main`, require the staging/production gate, and allow production changes only through pull requests.

A public staging URL also requires a second Pages project or an external preview host. Until that host is connected, each staging run produces an exact downloadable site artifact and browser smoke results.
