# Game Review Synthesizer

## Purpose

Create an original Игропоиск review by integrating a broad, verified body of criticism and official game data. The output is not a collage of summaries and must not imitate the wording or structure of any one publication.

## Publication gate

A finished Игропоиск review requires:

- at least **20 unique professional editorial reviews** from 20 independent publications;
- canonical URL, publication, author or editorial desk, date and platform/version context for every review where available;
- official facts from the developer, publisher or store as a separate evidence class;
- a verified media set containing hero, cover and at least four relevant screenshots;
- a completed rating-parser result.

Official pages, Metacritic/OpenCritic, user reviews and store ratings do **not** replace the 20 professional editorial reviews. They may be used as supplementary evidence only.

If fewer than 20 valid editorial reviews are available, the system may create a research matrix or internal draft, but publication status must remain `blocked`. It must not publish a finished Игропоиск article.

## Required inputs

- verified game identity and official facts;
- at least 20 independent editorial reviews with publication name and canonical URL;
- normalized rating calculation from `data/ratings/<slug>.json`;
- verified screenshots and media from `data/drafts/<slug>.json`;
- parser configuration from `config/parsers/review-synthesis.json`.

## Workflow

1. Validate and deduplicate the 20 editorial sources by canonical URL and publication.
2. Extract each source's central praise, criticism, evidence, score, reviewed platform and version.
3. Build a private comparison matrix containing:
   - points of broad agreement;
   - substantial disagreements;
   - minority observations;
   - platform-specific or technical differences;
   - claims requiring an official source.
4. Cluster findings by the game's actual systems and player experience, not by publication name.
5. Choose an original Игропоиск thesis that is not copied from a headline or verdict.
6. Build 4–7 thematic sections. Each major section must have a clear thesis, supporting evidence, limitations and conclusion.
7. Select a relevant verified screenshot for each major section. The image must visually support that section, not merely decorate it.
8. Store `section_id`, caption, image source and reason for selection for every inserted image.
9. Include meaningful criticism and minority views even when the aggregate score is high.
10. Map every major factual or evaluative claim to supporting source URLs.
11. List every source materially used in the article at the end. Do not pad the list with unused links.
12. Verify that no sentence copies more than 12 consecutive words from an input source.
13. Keep the mechanical rating calculation separate from the editorial verdict.

## Source balance

The 20-source set should cover different platforms, regions and editorial perspectives when available. The synthesizer must not allow several publications owned by one group, syndicated copies or translated reposts to create false consensus.

Aggregators are used only to audit broad score distribution. User reviews can inform a separately labeled player-reception section but never count toward the professional-source gate.

## Output contract

Return strict JSON with:

- `slug`, `game_slug`, `title`, `dek`, `author`, `published_at`, `score`, `hero`, `lead`;
- `publication_status` and `source_gate`;
- `sections[]` containing `id`, `heading`, `paragraphs[]` and a verified `image` object;
- `sources[]` containing `name`, `url`, `purpose` and `type`;
- `methodology` describing how the 20 sources were compared and integrated;
- `claim_sources[]` mapping major claims to source URLs;
- `source_coverage` with collected, accepted, rejected and materially used counts.

## Forbidden

- publishing with fewer than 20 unique professional editorial reviews;
- counting official pages, aggregators, stores or user reviews toward the 20-review gate;
- fabricated quotes, scores, dates, URLs or publication names;
- copying source paragraphs;
- presenting one source's opinion as consensus;
- treating syndicated or duplicated articles as independent sources;
- generating a final rating without rating-parser output;
- using publisher advertising language as editorial judgment;
- inserting unrelated screenshots or generated images.
