# Editorial Model Selection Protocol

**Status:** CANONICAL TEST PLAN v3  
**Updated:** 2026-09-07

## Goal

Select the production model independently for each Igropoisk editorial skill using a repeatable benchmark that separates text quality from provider/API availability.

There are now **four different editorial tasks**:

1. Game Page Subtitle Skill.
2. Game Page Description Skill.
3. Game Page Features Skill.
4. Full Review Skill.

Each task gets exactly one approved production model after testing. The same model may win several tasks, but this is never assumed in advance.

There is no silent cross-model fallback. Technical failure causes retry of the same assigned model; if it cannot produce an accepted artifact, that artifact waits.

## Why the old “short description” benchmark is retired

Subtitle, Description and Features are not three lengths of the same text.

- Subtitle compresses the identity of the game into a miniature portrait.
- Description explains premise, player activity and distinctive systems.
- Features selects 4–6 scannable characteristic traits.

A model that is best at one can be mediocre at another. Therefore a combined “short text” winner is methodologically invalid.

Previous Wolfenstein/five-game benchmarks remain historical experiments only. They cannot be final evidence because participant availability, effective input size and source truncation changed between runs.

## Candidate model pool

The final benchmark starts from the **full original 16-model Wolfenstein comparison pool**, not an arbitrarily narrowed convenience shortlist.

The original 16 were:

1. GigaChat 3 Ultra
2. Gemini 3.8 Flash
3. Gemini 3.7 Flash
4. Qwen 3.8 27B
5. Qwen 3.6 27B
6. GPT-OSS 120B
7. GPT-OSS 20B
8. GLM 5.2 Free
9. Nemotron 3 Ultra Free
10. Nemotron 3 Super Free
11. MiniMax M2.7 Free
12. MiniMax M3 Free
13. Dots3-Note Preview Free
14. Gemma 4 31B Free
15. Gemma 4 26B A4B Free
16. Qwen 2.5 3B Local

For the final comparable benchmark, only **Qwen 2.5 3B Local** is excluded because it is objectively in a different capability class and did not produce comparable outputs in the original stand.

Therefore the locked candidate pool is **15 models**:

1. GigaChat 3 Ultra
2. Gemini 3.8 Flash
3. Gemini 3.7 Flash
4. Qwen 3.8 27B
5. Qwen 3.6 27B
6. GPT-OSS 120B
7. GPT-OSS 20B
8. GLM 5.2 Free
9. Nemotron 3 Ultra Free
10. Nemotron 3 Super Free
11. MiniMax M2.7 Free
12. MiniMax M3 Free
13. Dots3-Note Preview Free
14. Gemma 4 31B Free
15. Gemma 4 26B A4B Free

### Candidate-retention rule

A candidate must **not** be removed merely because:

- it returned 429/503/timeouts in one shared-provider session;
- it failed to answer one historical benchmark request;
- another model was easier or cheaper to call;
- a temporary free route disappeared;
- a partial test happened to leave fewer surviving outputs.

Temporary provider/API failures are availability data, not editorial disqualification.

A candidate may be removed only for an objectively documented reason that makes a fair production comparison impossible, such as a fundamentally incomparable capability class, permanently unavailable model identity, or inability to execute the required task after a clean same-model retry procedure. Such an exclusion must be explicit in the benchmark record; the system must never silently shrink the pool.

A newly discovered candidate may be added intentionally, but it must run the complete comparable matrix. The locked 15-model pool cannot be narrowed automatically.

## Frozen evidence rule

For every benchmark game:

1. Run the real Game Page source assembly.
2. Resolve exact game identity/version through Game Registry.
3. Store the complete readable source corpus used by production.
4. Materialize one immutable Evidence Package.
5. Compute and store SHA-256.
6. Give the same Evidence Package revision to every candidate model for that game.
7. Store `game_id`, evidence hash, skill version, model ID and generation settings with every sample.

If evidence hashes differ between candidates, the comparison is invalid.

### No benchmark-only truncation

Do not take only the first N sources or first N characters of each source.

If the full package fits the context window, use it directly.

If it does not fit, process all source-aware chunks with the **same candidate model that performs the skill**, record 100% chunk coverage, then generate the result from its task-specific evidence notes. Do not put an untested summarizer model in front of every candidate.

## Locked ten-game page benchmark set

The page-skills benchmark uses these 10 games:

1. Dangerous Dave in the Haunted Mansion (1991)
2. Far Cry (2004)
3. Jack Orlando: A Cinematic Adventure (1997 original)
4. Mafia: The City of Lost Heaven (2002)
5. Mass Effect (2007 original)
6. Wolfenstein 3D (1992)
7. Spore (2008)
8. Fallout 2 (1998)
9. The Witcher 3: Wild Hunt (2015)
10. Elden Ring (2022)

This set deliberately contains famous and obscure games, several eras, action and non-action structures, sparse and rich source coverage, and titles where version confusion matters.

Once frozen evidence packages are created, do not replace games during a benchmark because one model/provider has trouble.

## Page benchmark matrix

For each of the three page skills:

- 15 models;
- 10 games;
- 2 independent samples per model/game;
- identical production skill contract and generation settings;
- identical evidence hash per game.

That is:

- 300 Subtitle samples;
- 300 Description samples;
- 300 Features samples;
- **900 page-editorial generations total**.

Provider 429/503/timeouts are recorded separately and are not quality scores.

## Subtitle benchmark

Production contract: `config/parsers/game-page-subtitle-skill.json`.

Scoring per sample:

- factual grounding/version discipline: 30
- miniature portrait completeness: 25
- specificity/recognizability: 20
- natural Russian: 15
- concision/page usefulness: 10

Hard failures:

- wrong game/version;
- invented material fact;
- generic genre line that does not identify the game;
- omission of a major identity-bearing element when that omission materially distorts the game portrait;
- source/process leakage;
- unusable/empty text.

## Description benchmark

Production contract: `config/parsers/game-page-description-skill.json`.

Scoring per sample:

- factual grounding/version discipline: 30
- completeness of premise/role/core activity: 25
- game-specific systems/details: 20
- natural Russian/readability: 15
- usefulness as game-page introduction: 10

Hard failures:

- wrong game/version;
- invented material fact;
- pure plot synopsis with no real player activity;
- generic marketing copy;
- review verdict/score instead of description;
- source/process leakage;
- unusable/empty text.

## Features benchmark

Production contract: `config/parsers/game-page-features-skill.json`.

Scoring per sample:

- factual grounding/version discipline: 30
- quality/distinctiveness of selected features: 25
- scannability and compact format: 20
- non-redundancy/coverage of different aspects: 15
- natural Russian: 10

Hard failures:

- invented feature;
- wrong game/version;
- long explanatory sentences instead of feature theses;
- mostly generic marketing labels (`красивый мир`, `увлекательный сюжет` etc.);
- repeated variants of the same feature;
- source/process leakage;
- unusable/empty list.

## Selecting page models

Scores are calculated independently for Subtitle, Description and Features.

There is no required combined page-model winner.

Example valid production outcome:

```text
Subtitle    → Model A
Description → Model B
Features    → Model A
Review      → Model C
```

Operational simplicity may be considered only after quality. A slightly worse model does not win merely because it already won another skill.

## Full Review benchmark

Review uses `config/parsers/review-synthesis.json` and `docs/REVIEW_MODULE_WORKING.md`.

Review selection is **not** derived from page-skill ranking. Short-copy performance is not a reliable proxy for long-form editorial writing.

### Review qualification

All **15 candidates** first generate full production-style reviews for two very different frozen games:

1. Mafia: The City of Lost Heaven
2. Spore

Use one model end-to-end for each review:

1. full evidence coverage;
2. evidence extraction;
3. editorial angle/section map;
4. grounded section writing;
5. final synthesis/polish;
6. anti-generic/evergreen audit;
7. grounding validation.

Select the strongest 3 review candidates from these two-game results.

### Final review round

The top 3 then generate reviews for three more games:

- Far Cry (2004)
- Jack Orlando: A Cinematic Adventure (1997 original)
- Mass Effect (2007 original)

The final review decision therefore uses five genres/structures across the two stages rather than using page-copy scores as a gate.

Target length follows the current Review Skill contract (normally around 2,000–2,600 words unless updated there).

Review scoring:

- factual grounding/version discipline: 30
- insight and synthesis: 20
- structure and pacing: 15
- natural Russian: 15
- atmosphere/charm: 10
- conclusion/final emotional landing: 10

Hard failures:

- invented material facts;
- cross-version contamination;
- source/process language in the article;
- broken/garbled prose;
- materially below the approved Review quality floor.

## GOLDEN MAFIA

Before final Review selection, the existing Mafia review must be frozen as `GOLDEN MAFIA` quality reference:

- factual discipline preserved;
- strong readable structure;
- stronger atmospheric conclusion;
- restrained authorial charm, not theatrical prose;
- no unsupported atmosphere/facts.

`GOLDEN MAFIA` is required for the Review benchmark, **not** for the three page-skills benchmark.

## Availability and retries

Quality and provider availability are separate dimensions.

For every candidate record:

- successful generations / requested generations;
- 429/503/timeouts by class;
- attempts required for same-model success;
- latency;
- approximate cost where available.

A final production model must meet both:

1. editorial quality floor;
2. sufficient same-model availability for production.

Do not convert provider errors into zero editorial scores.

Do not delete a model from the comparison because of a transient provider error. Restore/provision a comparable route or leave that model's matrix explicitly incomplete until the route is available; never replace the 15-model benchmark with a smaller convenience test and call it final.

## When we may run the next tests

### Page skills

The three page-skills benchmark may start as soon as all four conditions are true:

1. Subtitle/Description/Features skill contracts are frozen. **DONE.**
2. The 10-game set is locked. **DONE.**
3. All 10 Evidence Packages are freshly built by the real source pipeline, stored, hashed and validated for exact versions.
4. All **15 candidate models** have usable routes/capacity sufficient to complete the same locked matrix, or any objectively impossible candidate has been explicitly documented and approved for exclusion before the run.

The earlier exhausted free-tier session on 2026-09-04 must not be reused as a final test. If only unstable/free shared endpoints are available, wait or provision capacity; do not run a partial “final” benchmark.

### Review

Review benchmarking can begin after:

- the five review evidence packages are frozen;
- `GOLDEN MAFIA` is frozen;
- the same **15-model candidate pool** has enough capacity for the qualification round, subject only to explicitly documented objective exclusions.

The page benchmark does not need to wait for this.

## Execution order from here

1. Keep the three Game Page skill contracts and editorial architecture frozen.
2. Rebuild/freeze complete Evidence Packages for all 10 page games; store hashes and coverage manifests.
3. Confirm usable capacity for the full 15-model candidate pool.
4. Run the **900-sample** page benchmark.
5. Score Subtitle, Description and Features independently; approve one model per skill.
6. Freeze each winner's exact model ID, prompt/skill version, generation settings and retry policy.
7. Integrate the three approved models into the parallel Page Editorial Bundle pipeline.
8. Freeze `GOLDEN MAFIA` and five Review evidence packages.
9. Run **15-model** Review qualification on Mafia + Spore.
10. Advance top 3 to Far Cry + Jack Orlando + Mass Effect.
11. Approve exactly one Review model and freeze Review production settings.
12. Run an end-to-end game-page creation acceptance test including a page with review and a page without review.

## Decision rule

No winner is chosen because it happened to return more responses in one provider session.

No model wins a task because it won a different task.

No candidate is approved because it wins only one benchmark game.

No candidate is silently removed because it was inconvenient or temporarily unavailable.

If no model reaches the quality and availability floor for a skill, approve none for that skill and improve the skill/workflow before testing again.
