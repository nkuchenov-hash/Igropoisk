# Canonical Game Registry

## Scope and transition rule

The canonical Game Registry is the identity and lifecycle layer shared by the repository's discovery, page, review and publishing systems. It does not make those systems one module.

The registry unifies identity, provenance, discovery records, lifecycle state, releases, media metadata, relations, conflicts, duplicates, editorial locks, audit events and revisions in one `GameEntity`.

## Module boundaries

The project has separate concerns that may be coordinated by the same system scheduler:

### Game page module

Owns:

- game identity resolution through the registry;
- factual enrichment;
- game media and system requirements;
- relations and similarity data;
- page quality control;
- shared page rendering;
- game-page publication and refresh.

A game page must be publishable without an editorial review.

### Review/editorial subsystem

Owns:

- discovery of professional reviews;
- review research corpus;
- professional score aggregation;
- editorial review synthesis;
- review validation/QC;
- review publication and refresh.

A published review links back to the canonical game through `game_id` (and slug for routing). The game page may display that review, but does not own or generate it.

### Other independent modules

News, releases, Popular, guides and other content systems may discover games or produce content related to games. They resolve the game through the registry and link their output to the same canonical `game_id`.

## Existing mechanisms reused

- `scripts/orchestrate-content.mjs`: system-level scheduler/queue materializer. It may coordinate page work and review work in the same run, but those remain separate pipelines.
- `scripts/run-content-pipeline.mjs`: system-level per-game runner with failure isolation.
- `scripts/parse-game-data.mjs`: factual enrichment step.
- `scripts/build-game-page-basic.mjs` / page renderer: game-page creation. Page publication is independent of review readiness.
- `game/_shared/`: single protected runtime and visual component system for game pages.
- research, score aggregation, review synthesis and review validation scripts: review/editorial subsystem, not page-builder stages.
- non-destructive publishing guard and object-storage adapter remain authoritative boundaries.

## Canonical Game Entity

```text
GameEntity
├── schemaVersion
├── id                         permanent game_* identifier
├── identity
│   ├── canonicalTitle
│   ├── slug
│   ├── aliases
│   ├── abbreviations
│   ├── originalTitle
│   ├── series
│   └── kind                   game/remake/remaster/dlc/expansion/edition/collection
├── externalIds
├── fields                     developers, publishers, platforms, genres, description, requirements, links
├── releases[]
├── media[]
├── relations
├── discovery[]
├── workflow
├── priority
├── editorial
├── conflicts[]
├── possibleDuplicates[]
├── articles[]                 references to independently owned related materials
├── revisions[]
├── auditLog[]
└── mergedIntoGameId
```

Every field value keeps provenance, fetched/verified time, confidence and editorial lock. Manual locks win over automated updates.

## Identity rules

Exact external IDs are the strongest match. Trademark symbols, punctuation and localized aliases do not create a second game. Commercial Deluxe/Ultimate variants may resolve to the base entity.

Different release years, remake/remaster/DLC kind conflicts and ambiguous exact aliases are not silently merged; the candidate enters review/identity resolution.

Original, remake, remaster, DLC and collection distinctions are structural. Manual merge and undo merge are audit-logged.

## Game-page lifecycle

```text
discovery adapter
  → register candidate
  → discovered
  → identified or needs_review
  → enriching
  → ready_for_page
  → page_draft
  → page validation gate
  → page published
  → scheduled refresh / update_required
```

**No review state is required in this lifecycle.** A page may be published before an editorial review exists.

Incomplete or ambiguous games remain internal until the page's own requirements are satisfied.

## Review lifecycle

Review/editorial content has its own lifecycle:

```text
canonical game exists
  → review researching
  → review draft
  → editorial review / QC
  → approved
  → review published
  → update_required
```

The review subsystem may start before or after the page is public. Publishing or updating a review does not recreate the game entity or replace the page lifecycle.

## Priority

Priority is explainable and can be recalculated from publication mentions, Игропоиск news mentions, release proximity, popularity rank, known company, explicit editorial/user request and an existing partial page.

Page priority and review priority may use some of the same signals, but they are separate tasks. A missing review must not downgrade an otherwise valid game page to unpublished.

## Page integration with related content

The page renderer may display:

- an Игропоиск editorial review;
- external professional review cards;
- news;
- guides;
- other related materials.

These are **integrations**, not owned page-generation stages. Empty integrations are omitted/hidden according to the shared renderer contract.

The page content rules remain: no achievements section, no separate game-modes section, no platform badges over the cover, and the primary action remains “Оценить игру”.

## Registry API

`GameRegistryApi` provides identity and linking operations including:

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

News, releases, Popular and future modules should use this registry rather than inventing separate game identities.

## Storage boundaries

GitHub stores code, small configuration, workflow definitions and transition reports. PostgreSQL is the target for canonical entities, provenance, workflow state, conflicts, audit and revisions. Object Storage is the target for media and larger publication artifacts.

Review/article artifacts may have their own storage but must retain canonical game linkage.

## Safe publication and rollback

- non-destructive upsert only;
- no automatic game deletion;
- empty import is a no-op;
- partial import preserves unrelated games;
- `game/_shared/**` is protected around page generation;
- manual field values and locks are preserved;
- page validation is required before page generation/publication;
- **review publication is not required for page publication**;
- one failed game does not stop later tasks;
- audit records and per-game revisions support targeted rollback.

## Administrative boundary

`admin/games/` reads the canonical model and can show page state and related-content states separately. A future review administration area may manage review workflow independently while resolving the same canonical game IDs.

## Migration

`scripts/migrate-game-registry.mjs` scans current visible/public catalogs, legacy content-pipeline registry, game content, drafts, parser outputs, release and popular entities, research, reviews, articles and published `game/<slug>/` directories. Migration data can reference all of those sources without implying they belong to one runtime module.
