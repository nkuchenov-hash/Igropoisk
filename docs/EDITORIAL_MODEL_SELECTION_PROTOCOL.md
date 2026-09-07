# Editorial Model Selection Protocol

**Status:** CANONICAL TEST PLAN v4  
**Updated:** 2026-09-07

## Goal

Select models that can assemble an Igropoisk game page **end-to-end with one model per game**, while keeping Subtitle, Description, Features and Review as separate editorial skills and QC contracts.

The benchmark does **not** choose a different production model for each skill.

The production unit is a **Game Editorial Job**:

```text
one game + one evidence revision + one assigned model
→ Subtitle
→ Description
→ Features
→ Review when required
```

Different games may be assigned different approved models.

## Why skills remain separate

Subtitle, Description and Features are not three lengths of the same text.

- Subtitle compresses the identity of the game into a miniature portrait.
- Description explains premise, player activity and distinctive systems.
- Features selects 4–6 scannable characteristic traits.
- Review is a separate long-form editorial workflow.

They therefore keep separate prompts/contracts and separate QC.

But **separate skills do not imply separate models**. For one game-page revision, all model-generated editorial artifacts must share one `editorial_model_id`.

## Candidate model pool

The final benchmark starts from the full original 16-model Wolfenstein comparison pool.

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

A candidate must not be removed merely because:

- it returned 429/503/timeouts in one shared-provider session;
- it failed to answer one historical benchmark request;
- another model was easier or cheaper to call;
- a temporary free route disappeared;
- a partial test happened to leave fewer surviving outputs.

Temporary provider/API failures are availability data, not editorial disqualification.

A candidate may be removed only for an objectively documented reason that makes a fair comparison impossible. Such an exclusion must be explicit. The system must never silently shrink the pool.

## Frozen evidence rule

For every benchmark game:

1. Run the real Game Page source assembly.
2. Resolve exact game identity/version through Game Registry.
3. Store the complete readable source corpus used by production.
4. Materialize one immutable Evidence Package.
5. Compute and store SHA-256.
6. Give the same Evidence Package revision to every candidate model for that game.
7. Store `game_id`, evidence hash, model ID, skill versions and generation settings with every page-build attempt.

If evidence hashes differ between candidates, the comparison is invalid.

### No benchmark-only truncation

Do not take only the first N sources or first N characters of each source.

If the full package fits the context window, use it directly.

If it does not fit, process all source-aware chunks with the **same candidate model that owns the page build**, record 100% chunk coverage, then let that same model perform every editorial skill.

Do not put one summarizer model in front of another author model.

## Locked ten-game benchmark set

The page benchmark uses these 10 games:

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

The set deliberately contains famous and obscure games, several eras, action and non-action structures, sparse and rich source coverage, and titles where version confusion matters.

Once frozen evidence packages are created, games are not replaced mid-benchmark because a provider/model has trouble.

## End-to-end page benchmark matrix

For every candidate model:

- 10 games;
- 2 independent full page-build attempts per game;
- the same model performs Subtitle + Description + Features in each attempt;
- all three outputs share the same `game_id`, `evidence_hash` and `editorial_model_id`;
- identical production skill contracts and generation settings are used.

That is:

- **15 models × 10 games × 2 attempts = 300 complete page-build attempts**;
- each attempt contains three scored editorial outputs;
- therefore 300 Subtitle outputs + 300 Description outputs + 300 Features outputs = **900 block outputs total**.

The benchmark unit is the **complete page build**, not an isolated skill output.

Provider 429/503/timeouts are recorded separately from text-quality scores.

## Per-skill scoring — diagnostic, not routing

Each block is still scored independently so we can see *why* a page build is good or bad.

### Subtitle

Production contract: `config/parsers/game-page-subtitle-skill.json`.

- factual grounding/version discipline: 30
- miniature portrait completeness: 25
- specificity/recognizability: 20
- natural Russian: 15
- concision/page usefulness: 10

Hard failures include wrong game/version, invented material facts, generic genre-only wording, material loss of identity, source/process leakage and unusable text.

### Description

Production contract: `config/parsers/game-page-description-skill.json`.

- factual grounding/version discipline: 30
- completeness of premise/role/core activity: 25
- game-specific systems/details: 20
- natural Russian/readability: 15
- usefulness as game-page introduction: 10

Hard failures include wrong game/version, invented material facts, pure plot synopsis, generic marketing copy, review verdict instead of description, source/process leakage and unusable text.

### Features

Production contract: `config/parsers/game-page-features-skill.json`.

- factual grounding/version discipline: 30
- quality/distinctiveness of selected features: 25
- scannability and compact format: 20
- non-redundancy/coverage: 15
- natural Russian: 10

Hard failures include invented features, wrong game/version, long explanatory sentences, generic marketing labels, redundant features, source/process leakage and unusable lists.

## End-to-end page score

The final benchmark decision is based on the complete page-build attempt.

A page attempt receives:

- Subtitle quality: 20
- Description quality: 25
- Features quality: 15
- factual/version consistency across the entire page: 15
- coherence/non-contradiction between the three blocks: 10
- ability to complete all required blocks under one model assignment: 10
- page usefulness/editorial consistency: 5

Total: 100.

A model that produces a brilliant Subtitle but repeatedly fails Description or Features is **not** a good page-builder model.

A model that is slightly weaker in one isolated skill but consistently produces a strong complete page may rank higher overall.

## Selecting production page models

The benchmark does not select `Subtitle winner`, `Description winner` and `Features winner` for production routing.

Instead it produces an **approved page-builder pool**.

A model may enter this pool only if it:

1. passes the factual/version floor;
2. can complete all three page skills under one assignment;
3. meets the end-to-end page quality floor across multiple games;
4. has acceptable same-model availability for production.

There may be more than one approved page-builder model.

Production may therefore do this:

```text
Mafia       → approved Model A → whole page
Spore       → approved Model B → whole page
Far Cry     → approved Model A → whole page
Fallout 2   → approved Model C → whole page
```

But it may never do this:

```text
one page → Model A + Model B + Model C mixed by skill
```

## Production model assignment

Before each Game Editorial Job starts, the orchestrator chooses one model from the approved pool.

The choice is made **once per page-build attempt**, not once per skill.

Relevant routing inputs may include:

- end-to-end benchmark quality;
- context-window / corpus-size capability;
- whether the page requires a Review;
- current provider availability/quota;
- latency/cost as secondary factors.

After assignment, `editorial_model_id` is locked for that job.

If the model fails technically or editorially:

1. retry/correct with the same model;
2. if the job is finally abandoned, reject all its partial model outputs;
3. a different approved model may start a **new full page-build attempt from scratch**;
4. no outputs from the abandoned model may be mixed into the new page.

## Full Review benchmark

Review remains a separate module and a separate skill, but it no longer receives an unrelated review-only model for the same page.

A page that requires a review must be assigned a model that is qualified to do **both**:

- the complete Page Editorial Bundle;
- the Review Skill.

### Review qualification

All 15 candidates may be evaluated on full reviews for:

1. Mafia: The City of Lost Heaven
2. Spore

For each candidate/game, the same model does the full review workflow end-to-end:

1. full evidence coverage;
2. evidence extraction;
3. editorial angle/section map;
4. grounded section writing;
5. final synthesis/polish;
6. anti-generic/evergreen audit;
7. grounding validation.

Review quality is scored separately, but a model becomes **full-editorial qualified** only if it also meets the page-builder quality floor.

### Final review round

The strongest review-capable page-builder candidates then generate reviews for:

- Far Cry (2004)
- Jack Orlando: A Cinematic Adventure (1997 original)
- Mass Effect (2007 original)

The result is not one mandatory universal Review Model. It is an approved **full-editorial model pool** capable of owning a game page plus its review without model mixing.

Review scoring:

- factual grounding/version discipline: 30
- insight and synthesis: 20
- structure and pacing: 15
- natural Russian: 15
- atmosphere/charm: 10
- conclusion/final emotional landing: 10

Hard failures include invented material facts, cross-version contamination, source/process language, broken prose and material failure against the approved Review quality floor.

## GOLDEN MAFIA

Before final Review qualification, the existing Mafia review must be frozen as `GOLDEN MAFIA` quality reference:

- factual discipline preserved;
- strong readable structure;
- stronger atmospheric conclusion;
- restrained authorial charm, not theatrical prose;
- no unsupported atmosphere/facts.

`GOLDEN MAFIA` is required for Review qualification, not for the three short page skills.

## Pages without Review vs pages with Review

Two production pools are allowed:

### Page-builder pool

Models proven to create Subtitle + Description + Features as one complete page job.

Suitable for a page where Review is not currently required.

### Full-editorial pool

Models that pass both:

- full page benchmark;
- Review benchmark.

A game expected to receive a Review should be assigned from this pool from the start.

This avoids creating the page with one model and later discovering that the review requires another model.

## Availability and retries

Quality and provider availability are separate dimensions.

For every candidate record:

- successful complete page jobs / requested jobs;
- incomplete page jobs;
- 429/503/timeouts by class;
- attempts required for same-model success;
- latency;
- approximate cost where available.

Do not convert provider errors into zero editorial quality scores.

Do not silently remove a model because of a transient provider error.

## When we may run the next tests

### Page benchmark

The end-to-end page benchmark may start as soon as:

1. Subtitle/Description/Features skill contracts are frozen. **DONE.**
2. The 10-game set is locked. **DONE.**
3. All 10 Evidence Packages are freshly built by the real source pipeline, stored, hashed and validated for exact versions.
4. The 15 candidate routes/capacity are verified or any objectively impossible exclusion is explicitly documented before the run.

Then run **300 complete page-build attempts / 900 block outputs**.

### Review qualification

Review qualification can begin after:

- required review Evidence Packages are frozen;
- `GOLDEN MAFIA` is frozen;
- candidate capacity is sufficient;
- page-builder scores are available so Review results can be combined with full-page capability.

## Execution order from here

1. Keep the three editorial skill contracts frozen.
2. Rebuild/freeze complete Evidence Packages for all 10 benchmark games.
3. Confirm usable capacity for all 15 candidates.
4. Run 300 end-to-end page-build attempts.
5. Score individual blocks diagnostically and complete pages as the production decision unit.
6. Approve a page-builder model pool; do not assign models per skill.
7. Freeze exact model IDs/settings/retry rules for the approved pool.
8. Freeze `GOLDEN MAFIA` and Review evidence packages.
9. Run Review qualification using the same candidate models.
10. Approve the full-editorial pool: models capable of whole page + Review.
11. Integrate page-level model assignment into the Game Editorial Job orchestrator.
12. Run end-to-end acceptance with multiple games intentionally assigned to different models, while verifying that each individual page contains only one model ID.

## Decision rule

**One page revision = one model.**

Different games may use different approved models.

No model wins production ownership because it is best at only one isolated skill.

No candidate is silently removed because it is inconvenient or temporarily unavailable.

If no model can reliably produce a complete acceptable page under one assignment, approve none and improve the workflow before production rollout.
