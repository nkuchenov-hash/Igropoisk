# Canonical Game Registry

## Scope and transition rule

This branch finishes the existing game-content contour without introducing another parser. The canonical registry is a transition layer over the repository's current discovery, page, review and publishing mechanisms. Production switching is explicitly disabled. Existing source files and published pages remain the recovery source and are never deleted by migration.

The branch starts from `98ac2cac48abe4b7bcdd4816c5114ce15d802534`. After PR #57 is merged, this branch must be rebased or synchronized with current `staging`; no commits belong in PR #57, #58 or #59.

## Existing mechanisms reused

- `scripts/orchestrate-content.mjs`: remains the scheduler and queue materializer, now projected from canonical IDs rather than slug-only identities.
- `scripts/run-content-pipeline.mjs`: remains the per-game runner with failure isolation.
- `scripts/parse-game-data.mjs`: remains the current Steam-backed enrichment step; it is not treated as proof for non-Steam platforms.
- `scripts/build-game-page.mjs`: remains the page renderer. The canonical wrapper adds identity lookup, validation and `game/_shared/**` integrity protection.
- `game/_shared/`: remains the single protected runtime and visual component system. No redesign is introduced.
- research, score aggregation, review synthesis, media enrichment and review validation scripts remain separate specialist stages.
- the existing non-destructive publishing guard and object-storage adapter remain authoritative boundaries.
- the existing administrative area is extended with one game-management entrypoint instead of replaced.

## What is unified

Identity, field provenance, discovery records, lifecycle state, priority, releases, media metadata, articles, conflicts, possible duplicates, editorial locks, audit events and revisions are unified in one `GameEntity`. All discovery streams register candidates through `GameRegistryApi.registerCandidate()`.

## What remains separate

Parsers and source adapters remain independent collectors. Page rendering, research, professional score calculation, review synthesis, media storage and publication remain distinct pipeline stages. News and release PRs are not modified; they can later consume the registry through small adapters.

## Canonical Game Entity

```text
GameEntity
├── schemaVersion
├── id                         permanent game_* identifier
├── identity
│   ├── canonicalTitle         FieldValue
│   ├── slug                   FieldValue
│   ├── aliases                FieldValue
│   ├── abbreviations          FieldValue
│   ├── originalTitle          FieldValue
│   ├── series                 FieldValue
│   └── kind                   game/remake/remaster/dlc/expansion/edition/collection
├── externalIds
│   ├── steamAppId
│   ├── igdbId
│   ├── rawgId
│   ├── playstation[]
│   ├── xbox[]
│   └── nintendo[]
├── fields
│   ├── developers / publishers
│   ├── platforms
│   ├── genres / subgenres
│   ├── technicalModes
│   ├── description / shortDescription
│   ├── ageRatings
│   ├── systemRequirements
│   └── officialLinks
├── releases[]                 platform + region + date + precision + status
├── media[]                    kind + URL/object key + checksum + provenance + revisions
├── relations                  series/base/related game IDs
├── discovery[]                source, time, reason, source record
├── workflow                   game/page/research/article/review states and reasons
├── priority                   score, explainable reasons, calculation time
├── editorial                  field locks and notes
├── conflicts[]
├── possibleDuplicates[]
├── articles[]
├── revisions[]
├── auditLog[]
└── mergedIntoGameId
```

Every `FieldValue` contains the value, source descriptor, fetched time, last verification time, confidence and editorial lock. Manual locks always win. Source trust order is official site, official platform store, official press release, structured database, professional publication, platform store for its own platform, then automated inference.

## Identity rules

Exact external IDs are the strongest match. Trademark symbols, punctuation and localized aliases do not create a second game. Commercial Deluxe/Ultimate variants may resolve to the base entity. Explicitly different release years, remake/remaster/DLC kind conflicts and multiple exact alias candidates are not silently merged; the candidate enters `reviewQueue`.

Original, remake, remaster, DLC and collection distinctions are structural, not title heuristics used to force a merge. Manual merge and undo merge are audit-logged.

## Lifecycle

```text
discovery adapter
  → register candidate
  → discovered
  → identified or needs_review
  → enriching
  → ready_for_page
  → page_draft
  → validation gate
  → published
  → scheduled refresh / update_required
```

A rejected candidate remains recorded with its reason. A merged record remains as `merged_into_another_game` and can be restored. Incomplete games remain internal and do not receive a public page.

## Priority

Priority is explainable and recalculated from publication mentions, Игропоиск news mentions, release proximity, popularity rank, professional review corpus, known company, explicit editorial/user request and an existing partial page. It does not force equal enrichment of all discovered games.

## Articles and reviews

Canonical types are: Игропоиск review, professional external review, news, guide, mechanics analysis, development history, technical material, and update/DLC. Игропоиск review states are `researching`, `draft`, `editorial_review`, `approved`, `published`, and `update_required`. Automatic output begins as a draft. The existing research and review scripts remain responsible for sourced dossier creation and professional score calculation; the registry stores links and workflow state.

The page content order remains unchanged by this branch. Empty sections are omitted by the existing shared renderer. No achievements section, separate game-modes section or platform badges over the cover are introduced. The primary action remains “Оценить игру”; Игропоиск review is first when present.

## Registry API for later adapters

`GameRegistryApi` provides:

- `findById(id)`
- `findBySlug(slug)`
- `findByExternalId(kind, value)`
- `findByExactAlias(alias)`
- `publicUrl(gameOrId)`
- `isPublished(gameOrId)`
- `releaseEvents(gameOrId)`
- `relatedContent(gameOrId)`
- `registerCandidate(candidate)`
- `mergeGames(sourceId, targetId)`
- `undoMerge(sourceId)`
- `lockField(gameId, fieldPath)`
- `setStatus(gameId, status, reason)`

PR #58 and PR #59 should later call this API through small news/release adapters. Their files are deliberately untouched here.

## Storage boundaries

GitHub stores code, small configuration, workflow definitions and temporary transition reports. PostgreSQL is the target for canonical entities, provenance, workflow state, conflicts, audit and revisions. Object Storage is the target for images, checksums, replacement history, research attachments and publication artifacts. Transition JSON snapshots allow the current static site to continue without requiring an immediate production database.

## Safe publication and rollback

- non-destructive upsert only;
- no automatic game deletion;
- empty import is a no-op;
- partial import preserves unrelated games;
- `game/_shared/**` is checksum-protected around page generation;
- manual field values and locks are preserved;
- validation is required before page generation;
- one failed game does not stop later tasks;
- audit records and per-game revisions support targeted rollback;
- migration writes new artifacts and never modifies or deletes source data.

## Administrative boundary

`admin/games/` reads the same canonical model. It shows status, reason, page/research/article states, completeness, priority, sources, conflicts, duplicates, locks and history. Write controls call Content API endpoints only. Without Content API/PostgreSQL it remains explicitly read-only, preventing fake persistence or destructive static-file edits.

## Migration

`scripts/migrate-game-registry.mjs` scans the current visible/public catalogs, legacy content-pipeline registry, game content, drafts, parser outputs, release and popular entities, research, reviews, articles and published `game/<slug>/` directories. It is deterministic and idempotent. It writes a new registry and report only when `--write` is supplied. Source fingerprint and base commit form the recovery point.
