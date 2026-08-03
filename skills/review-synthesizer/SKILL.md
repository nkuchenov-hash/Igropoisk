# Game Review Synthesizer

## Purpose

Produce a comprehensive Игропоиск review through a repeatable research and editorial pipeline. The system must explain the actual game, not merely summarize critic sentiment, and must refuse publication when evidence, length, visual relevance or editorial quality is insufficient.

## Pipeline

1. **Identity lock**
   - Resolve exact title, year, developer, platform and store/app identifiers.
   - Record excluded versions such as remakes, remasters, sequels and DLC.
   - Reject a source when it concerns a different release unless it is explicitly classified as a port review used only for platform comparison.

2. **Source research**
   - Discover at least 30 candidates to retain 20 independent professional sources after validation.
   - Store direct game-specific URLs, not review hubs or aggregator snippets.
   - Validate the live URL. For historical publications, resolve an Internet Archive snapshot of the original review when the live page is gone.
   - Deduplicate by canonical URL, publication and syndicated origin.
   - For games released before 2010, require at least 12 contemporary reviews; professional retrospectives and port reviews may supply the remaining historical context.
   - Official pages, stores, Metacritic/OpenCritic, user reviews, forums and videos never count toward the 20-source editorial gate.

3. **Evidence matrix**
   - Extract publication, author, date, platform/version, visible score, praise, criticism and concrete evidence points.
   - Map every source to a stable `source_id`.
   - The writing model may cite only these IDs. Code expands them to validated URLs so the model cannot invent or substitute links.

4. **Dynamic article plan**
   - Build 8–10 sections from the game’s actual genre, systems, pacing and source evidence.
   - Do not reuse a Witcher-, shooter-, RPG- or open-world template when it does not fit.
   - The plan must make the reader understand what they do during normal play, how missions or sessions are structured, what the game expects, what succeeds and what fails.

5. **Writing gate**
   - Minimum 2,000 useful words excluding metadata and source lists.
   - Each section needs a thesis, concrete explanation, limitation or criticism, and a conclusion.
   - Organize by systems and player experience, never publication-by-publication.
   - Avoid large spoilers and copied wording. No sentence may reproduce more than 12 consecutive words from a source.
   - Include a clear verdict and separate notes for readers who are and are not a good fit.

6. **Media selection**
   - Use only the verified media catalog from the game-data parser.
   - Every selected image has a stable `media_id`, source URL and caption.
   - The visible subject must literally match the section: combat shows combat, driving shows driving, a character section may use a portrait, interface discussion requires interface or preparation imagery.

7. **Multimodal visual audit and repair**
   - A separate vision call inspects each selected image beside the full section text.
   - The model’s own caption or reason is not evidence.
   - Reject matches below 0.75 confidence.
   - Automatically attempt up to two replacements from unused verified screenshots and re-audit them.
   - Publication requires at least six distinct approved screenshots.

8. **Editorial quality audit**
   - Independently score coverage, specificity, balance, clarity, redundancy and spoiler control.
   - Every dimension must reach 0.75.
   - A failed source, length, visual or quality gate saves the result to `data/article-drafts/` with explicit reasons. It must not appear as a finished Игропоиск review.

## Required files

- `data/drafts/<slug>.json` — verified game facts and media;
- `data/ratings/<slug>.json` — transparent score calculation;
- `data/research/<slug>-source-matrix.json` — validated source corpus;
- `data/reviews/<slug>.json` — selected twenty professional sources;
- `config/parsers/review-synthesis.json` — editable methodology and publication starting points.

## Published output

A published `data/articles/<slug>.json` contains:

- title, dek, lead, score and reading time;
- 8–10 thematic sections with verified images;
- verdict with `best_for` and `not_for`;
- validated source list at the end;
- claim-to-URL mappings;
- source, word-count, image and quality audit results.

## Forbidden

- publishing with fewer than 20 independent professional sources;
- counting an aggregator, store page or user review toward the source gate;
- using several articles from one publication as several independent sources;
- mixing an original game with its remake or sequel;
- invented URLs, scores, quotations or dates;
- source padding that does not materially affect the article;
- generated images or unrelated screenshots;
- short review summaries that do not explain how the game actually plays;
- promotional language presented as editorial judgment.
