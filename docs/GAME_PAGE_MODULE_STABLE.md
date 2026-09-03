# Game Page Module — Stable Contract

**Status:** STABLE / CANONICAL

This document freezes the architecture of the Игропоиск Game Page module. Future model experiments, source-enrichment improvements and editorial tuning may improve output, but they must not silently change the module boundary or publication rules below.

## Canonical flow

`canonical identity → structured data/media → source discovery/corpus → professional ratings → internal Audience Profile → page editorial → universal QC → immutable green package → staging/production publication → live verification`

## Fixed invariants

- The module is universal. Per-game code, presentation hacks and hand-written acceptance exceptions are forbidden.
- Every discovered verified professional score that qualifies under the rating rules is used. An arbitrary count of professional reviews/ratings is not a page-publication quota.
- Professional-source discovery must complete its bounded discovery pass, but additional coverage may continue after publication as enrichment.
- The Игропоиск Review is a separate subsystem. Its presence, length, corpus target or generation status never determines whether the base Game Page exists.
- Audience Profile is a reusable internal game-level asset stored under `data/game-audience/<slug>.json` when materialized.
- Audience Profile is deterministic, evidence-backed, internal-only, AI-independent and fail-open. If it cannot be built, editorial work uses the neutral Игропоиск register.
- Age/content ratings are contextual signals only. Demographics may never be inferred from genre, art style, age rating or stereotypes; explicit aggregate demographics require an attributable aggregate source.
- Audience Profile may influence language and emphasis, never facts, publication state or public UI by itself.
- The editorial model/provider is replaceable configuration. No specific model name, provider availability, model benchmark or literary-quality result for a single fixture is part of the stable module contract.
- `spore` is a real structural fixture, not a quality benchmark. It proves the universal path without making Spore-specific behavior canonical.
- Only a green canonical page package may become public. Failed revisions do not invalidate an already published green package.

## Failure behavior

Audience evidence/profile failure is fail-open and degrades to neutral editorial style. Editorial generation or ordinary page QC may keep a new revision in revision state, but no optional Audience Profile failure and no missing Review article may block or destroy an otherwise valid existing publication.

## Protected boundary

News, Popular Now, Top-250, Releases and Search may request/consume Game Pages but do not own Game Page assembly. Model benchmarking is also outside this module. Changes that reintroduce a review-count quota, make Audience Profile public/mandatory, bind readiness to one model, or add per-game exceptions violate this stable contract.
