# Editorial Model Selection Protocol

**Status:** CANONICAL TEST PLAN v5  
**Updated:** 2026-09-07

## Goal

Run **two independent model selections**:

1. **Page Model Test** — one model creates Subtitle + Description + Features for a complete Game Page editorial bundle.
2. **Review Model Test** — one independently selected model creates a full Review end-to-end.

A Page Model and Review Model for the same game may be different. Page ranking does not gate Review participation, and Review ranking does not decide Page routing.

## Candidate pool

The benchmark starts from the full historical 16-model Wolfenstein pool. Only `Qwen 2.5 3B Local` is excluded as objectively non-comparable.

Locked 15-model pool:

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

Transient 429/503/timeouts, historical endpoint failures or temporary free-route loss are availability data, not automatic editorial disqualification. The pool must never silently shrink.

## Frozen evidence rule

For each benchmark game:

1. resolve exact `game_id` and version;
2. run the real Game Page source assembly;
3. store the complete readable source corpus used by production;
4. materialize one immutable Evidence Package;
5. compute SHA-256 and coverage manifest;
6. give every candidate the identical evidence revision;
7. record model ID, evidence hash, skill version and generation settings with every output.

No benchmark-only truncation to first N sources or first N characters is allowed.

If a corpus does not fit one context window, the **same candidate model assigned to that job** processes all source-aware chunks before writing. No hidden cross-model summarizer is allowed.

# TEST A — PAGE MODEL TEST

## What is being selected

A Page Model must be able to create the three model-generated Page blocks together:

```text
one game + one evidence revision + one Page Model
→ Subtitle
→ Description
→ Features
→ Page QC
```

The Page Test is intentionally independent from long-form Review capability. It is the easier editorial task, so more candidates may legitimately qualify.

Different games in production may use different approved Page Models, but one page may not mix models between Subtitle/Description/Features.

## Page benchmark games

Final target set:

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

A preliminary/qualification run may use the already frozen seven full-corpus games, but it must be labelled qualification rather than the final ten-game benchmark.

## Page matrix

Final comparable matrix:

- 15 models;
- 10 games;
- 2 independent complete Page attempts per model/game;
- one model performs all three blocks in each attempt.

Total:

- **300 complete Page builds**;
- 300 Subtitle outputs;
- 300 Description outputs;
- 300 Features outputs;
- **900 block outputs**.

For fast qualification on the already available seven frozen corpora, the same rules apply to a smaller labelled qualification matrix before the ten-game final.

## Page scoring

Individual skills are scored diagnostically.

### Subtitle

- factual/version discipline: 30
- miniature portrait completeness: 25
- specificity/recognizability: 20
- natural Russian: 15
- concision/page usefulness: 10

### Description

- factual/version discipline: 30
- premise/role/core activity completeness: 25
- game-specific systems/details: 20
- natural Russian/readability: 15
- usefulness as introduction: 10

### Features

- factual/version discipline: 30
- distinctiveness of selected features: 25
- scannability/compactness: 20
- non-redundancy/coverage: 15
- natural Russian: 10

### Complete Page score

- Subtitle quality: 20
- Description quality: 25
- Features quality: 15
- factual/version consistency across all blocks: 15
- coherence/non-contradiction: 10
- successful completion of all required blocks by one model: 10
- page usefulness/editorial consistency: 5

Total: 100.

Hard failures include wrong version/game, material hallucination, missing/unusable required block, source/process leakage or cross-model mixing within one Page build.

## Page result

The test produces an **approved Page Model pool**, not separate Subtitle/Description/Features winners.

A model qualifies only if it can reliably complete the whole Page bundle across multiple games above the quality floor.

# TEST B — REVIEW MODEL TEST

## Independent selection

Review is a separate module and receives a separate `review_model_id`.

A model does **not** need to qualify as a Page Model in order to enter or win the Review Test.

A Review Model does not force regeneration of Subtitle/Description/Features.

## Review qualification round

All 15 candidates generate full production-style reviews for two frozen games:

1. Mafia: The City of Lost Heaven
2. Spore

For every model/game, the same model performs the Review workflow end-to-end:

1. full evidence coverage;
2. evidence extraction;
3. editorial angle and section map;
4. grounded section writing;
5. synthesis/polish;
6. anti-generic/evergreen audit;
7. grounding validation.

The strongest Review candidates advance independently of Page scores.

## Review final round

Top 3 Review candidates then generate reviews for:

- Far Cry (2004)
- Jack Orlando: A Cinematic Adventure (1997 original)
- Mass Effect (2007 original)

Review scoring:

- factual grounding/version discipline: 30
- insight/synthesis: 20
- structure/pacing: 15
- natural Russian: 15
- atmosphere/charm: 10
- conclusion/final emotional landing: 10

Hard failures include material hallucinations, cross-version contamination, source/process language, broken prose or failure of the approved Review quality floor.

## GOLDEN MAFIA

`GOLDEN MAFIA` is a Review quality reference only. It is not needed to score Page Model outputs and does not gate Page Test execution.

## Availability

For both tests, record separately:

- successful jobs / requested jobs;
- 429/503/timeouts;
- same-model retry count;
- latency;
- approximate cost when available.

Provider failure is not converted into a zero editorial score, and a candidate is not silently removed because of a temporary endpoint problem.

## Execution order

1. Keep Page skill contracts frozen.
2. Freeze/verify full-corpus evidence packages and hashes.
3. Run Page Model qualification immediately on the available frozen corpora.
4. Complete the missing evidence packages and run the final ten-game Page matrix.
5. Approve Page Model pool.
6. Independently run 15-model Review qualification on Mafia + Spore.
7. Advance Review top 3 to Far Cry + Jack Orlando + Mass Effect.
8. Approve Review Model / Review Model pool independently.
9. Integrate Page routing and Review routing as separate jobs sharing the same canonical evidence layer.

## Final decision rule

**Inside one Page bundle:** one model for Subtitle + Description + Features.

**Inside one Review:** one model end-to-end.

**Between Page and Review:** models may differ.

**Between different games:** models may differ.
