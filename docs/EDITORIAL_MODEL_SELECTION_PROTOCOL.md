# Editorial Model Selection Protocol

Status: CANONICAL TEST PLAN
Date fixed: 2026-09-04

## Goal

Select the production model for each Igropoisk editorial task using a repeatable benchmark that separates text quality from provider/API availability.

A task has exactly one approved model. There is no fallback to another model for the same task.

If the approved model fails technically, that text is not published. The same model may be retried later. Another model must never silently replace it.

The two editorial tasks are evaluated separately:

1. Game-page short description.
2. Full game review.

A different model may win each task because these are different tasks, but each task must have one fixed production model after approval.

## Previous benchmarks

The previous Wolfenstein, five-game full-review, and five-game short-description benchmark pages are withdrawn and deleted from the production repository.

Reason: they mixed model quality with free/shared endpoint availability, changed the effective participant set between runs, and therefore cannot be used as final evidence for model selection.

Old results may inform which models deserve another test, but they must not be used as the final ranking.

## Shortlist for the final benchmark

Keep:

1. Gemini 3.7 Flash
2. Gemini 3.8 Flash
3. GLM 5.2
4. Qwen 3.8 27B
5. Qwen 3.6 27B
6. MiniMax M2.7

Do not continue testing for final selection:

- GigaChat 3 Ultra — artificial/performative prose, factual embellishment, format reliability issues.
- GPT-OSS 120B — reliable endpoint but long-form writing too shallow/short for the review standard.
- GPT-OSS 20B — materially weaker writing and factual errors.
- Nemotron 3 Ultra — unstable and hallucination-prone in observed runs.
- Nemotron 3 Super — source/process leakage and weaker editorial voice.
- Dots3-Note Preview — code-switching/garbled output and weak grounding discipline.
- MiniMax M3 — no convincing usable result from the tested route.
- Gemma 4 31B — no convincing usable result from the tested route.
- Gemma 4 26B A4B — no convincing usable result from the tested route.
- local Qwen 2.5 3B — clearly below the required editorial quality ceiling.

The shortlist can only be expanded later if a new model is intentionally nominated and tested under this exact protocol. It must not expand automatically because a provider happens to expose another free model.

## Golden standard

The existing Igropoisk Mafia: The City of Lost Heaven review becomes the provisional editorial reference.

Before the final benchmark, it will be polished into `GOLDEN MAFIA`:

- preserve the current factual discipline and readable structure;
- add a stronger atmospheric conclusion;
- add slightly more authorial charm and texture without theatrical over-writing;
- keep the article natural, concrete, engaging and recognizably editorial;
- do not add unsupported facts merely to create atmosphere.

The golden article is a quality floor and style reference, not text for models to imitate sentence-by-sentence.

## Frozen evidence rule

For every benchmark game:

1. Run the real Game Page / Review source assembly.
2. Freeze the resulting evidence package once.
3. Compute and store its SHA-256.
4. Give the exact same frozen package to every candidate model for that game.
5. Never rebuild or alter the package between candidate runs.
6. Exact-version filtering is mandatory. Ports, remasters, remakes, sequels and similarly named games must not contaminate the package unless explicitly relevant and tagged.

If the evidence hash differs between candidates, that game's comparison is invalid.

## Benchmark game set

Use a deliberately mixed set of 10 games for short descriptions. It must include:

- famous and obscure games;
- old and modern games;
- action and non-action genres;
- games with rich source coverage and games with sparse but sufficient coverage;
- at least one identity-sensitive title where version confusion is possible.

The first locked candidates include:

- Mafia: The City of Lost Heaven (2002)
- Dangerous Dave in the Haunted Mansion (1991)
- Far Cry (2004)
- Jack Orlando: A Cinematic Adventure (1997 original)
- Mass Effect (2007 original)

Five additional games must be selected before the final benchmark starts, then the set is frozen.

For full reviews, advance only the strongest 3 models from the short-description/source-discipline stage and test them on 5 representative games, including Mafia.

## Short-description test

Run each shortlisted model on all 10 frozen game packs.

Generate two independent samples per model/game under the same production prompt and settings. This tests consistency without changing the evidence.

Requirements:

- roughly 100-320 characters;
- sentence count is not fixed;
- clear, natural Russian;
- immediately communicates the central fantasy, player role/goal and main action where supported;
- no review verdict or numeric score;
- no source/process language;
- no facts outside the frozen evidence package.

Scoring per sample:

- factual grounding: 30
- natural Russian/readability: 25
- captures game essence: 20
- editorial voice/charm: 15
- concision/usefulness on the page: 10

Hard failures:

- wrong game/version;
- invented material fact;
- source/process leakage;
- unusable or empty text.

A provider 429/503/timeout is not a quality score. It is recorded under availability and retried using the same model.

## Full-review test

Only the top 3 candidates from the first stage advance.

The production review workflow must use ONE model end-to-end. No cross-model co-authoring and no fallback model.

Recommended production-realistic generation sequence:

1. One frozen evidence package.
2. Same model creates the review plan/section map.
3. Same model writes all sections in grounded passes.
4. Same model performs the final editorial synthesis/polish.
5. Synthesis is not allowed to introduce new facts.
6. Grounding validation runs before publication.

This avoids one-shot output limits while preserving one author/model for the entire assignment.

Target: approximately 2,000-2,600 words unless the final Review Module contract sets a different editorial target.

Scoring:

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
- review materially below the `GOLDEN MAFIA` quality floor.

## Availability and retries

Quality and availability are separate dimensions.

For each candidate record:

- successful generations / attempts;
- number and class of 429/503/timeouts;
- attempts needed for successful same-model generation;
- latency;
- approximate cost where applicable.

Production rule after selection:

- the approved model is retried according to the Review/Page module retry policy;
- if it still cannot produce a valid result, publication of that text waits;
- another model does not substitute for it.

The final model must therefore satisfy BOTH:

1. editorial quality at or above the accepted floor;
2. sufficient same-model availability for production use.

## Free/shared endpoints

Do not use free/shared endpoint failures as evidence that a model is low quality.

A final benchmark should preferably use paid/dedicated or otherwise sufficiently provisioned routes so every candidate receives the intended number of attempts.

If a free route is used, the run must be delayed/throttled enough to stay inside documented limits and must preserve provider errors separately from model-quality scoring.

## When the next test may run

Do not run another mass benchmark on 2026-09-04 after the exhausted free-tier tests.

Gemini daily request quotas reset at midnight Pacific time. The earliest clean next Gemini daily window is 2026-09-05 09:00 Europe/Berlin.

However, the final benchmark should start only when all six shortlisted candidates have routes with enough quota/capacity to complete the locked test matrix. If that condition is not met, do not start a partial benchmark.

For Groq, per-minute/per-day limits must be checked before the run and requests must be serialized/throttled. For OpenRouter free routes, the small daily request allowance and shared-provider availability make them unsuitable as the sole basis for the final production decision.

## Execution order

1. Delete/retire old benchmark pages. DONE when this protocol lands.
2. Polish the existing Mafia review into `GOLDEN MAFIA` and freeze its editorial criteria.
3. Lock five additional benchmark games, bringing the short-description set to 10.
4. Confirm usable API route/quota for all 6 shortlisted models.
5. Freeze evidence packages and hashes for all games.
6. Run short-description benchmark: 6 models x 10 games x 2 samples.
7. Human/editorial review plus factual-grounding checks; select top 3.
8. Run full-review benchmark on 5 games using the production section-by-section workflow, one model per entire review.
9. Compare against `GOLDEN MAFIA` and the fixed scoring rubric.
10. Approve exactly one production model for short descriptions and exactly one production model for reviews.
11. Freeze model IDs, prompts, generation settings, retry policy, and acceptance gates in the relevant module documentation.

## Decision rule

No winner is chosen merely because it returned more responses during one API session.

No candidate receives zero quality points for provider 429/503 failures.

No candidate is approved because it wins only one game.

If no model meets the golden quality floor and availability requirement, approve none and revise the tool/prompt/workflow before testing again.
