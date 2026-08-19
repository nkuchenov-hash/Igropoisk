# Repository governance

This repository uses branches for different responsibilities. The branches must not be allowed to become a second content database.

## Branch roles

- `main` is the production code and production snapshot source of truth.
- `staging` is a short-lived integration branch. It must contain current `main` plus a small, reviewable set of pending changes.
- `agent/*`, `feature/*`, `fix/*`, `hotfix/*` and similar branches contain one scoped change.
- `production/*` branches are surgical promotions created from current `main` and must contain only the files intentionally promoted.
- `archive/*` branches are read-only recovery points. They are never merged wholesale.

## Mandatory rules

1. Never open a blanket `staging -> main` PR when staging contains unrelated work or generated history.
2. Before any destructive staging repair, create an immutable `archive/staging-before-reset-YYYY-MM-DD` branch at the exact old staging SHA.
3. Staging must never be behind `main`. When `main` advances, staging is fast-forwarded only while staging has no unique commits. If staging has unique commits, synchronization must stop instead of creating an automatic merge commit.
4. Staging should remain small. More than 20 commits ahead of `main` is a repository-health failure and requires consolidation before more work is added.
5. Scheduled automation must not create unnecessary staging history. Legacy scheduled workflows that duplicate the autonomous storage-backed pipeline must remain manual-only.
6. Generated data may be committed only by the owning pipeline and only inside its declared data/assets paths. It must not modify UI, shared shell, unrelated modules or production code.
7. Production promotion is always surgical: start from current `main`, copy the exact validated scope, run the relevant checks, and merge that dedicated PR. Do not use an accumulated staging snapshot as a production payload.
8. A PR whose base was replaced/reset must be closed and recreated from the current base rather than kept alive with a misleading diff.

## Canonical project documents

Two files are permanent top-level project records:

- `docs/PROJECT_ROADMAP.md` — canonical development path and milestone order;
- `docs/SYSTEM_ARCHITECTURE.md` — canonical system/module/page/data architecture.

They are registered in `config/canonical-project-docs.json` and validated by `scripts/validate-canonical-project-docs.mjs` inside the required `Staging and production gate`.

Accidental deletion, rename, replacement with a short stub, removal from the root README, duplicate canonical architecture records, or removal of the guard from the required gate is a CI failure.

A deliberate architecture change is allowed only as an explicit Git change. If it changes module ownership, source of truth, storage model, runtime boundaries, AI dependency, or migration order, the relevant canonical document must be updated in the same scoped PR. The previous version remains recoverable through Git history.

Do not create competing roadmap or top-level architecture files. Module-specific documents remain subordinate implementation records and must link back to the canonical architecture when they alter a system boundary.

## Current recovery point

The pre-cleanup staging history from 2026-08-10 is preserved at:

`archive/staging-before-reset-2026-08-10`

It contains the old staging tip `774ef4696b5781f0a472f3829e6a014a5b408245` and exists only for recovery or selective comparison/cherry-picking.

## Known temporary exception

The central popular/releases parser still publishes validated generated snapshots to `staging`. This is allowed temporarily because the current public feed materialization consumes those repository snapshots. It must remain isolated to declared generated paths and is monitored by the branch-hygiene gate. The long-term target is content storage/versioning outside the code integration history.
