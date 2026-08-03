# Game Review Synthesizer

## Purpose

Create an original, comprehensive Игропоиск review by integrating a broad verified body of professional criticism, official game data and semantically relevant official screenshots. The output is not a collage of summaries and must not imitate the wording or structure of any one publication.

## Publication gate

A finished Игропоиск review requires:

- at least **20 unique professional editorial reviews** from 20 independent publications;
- a canonical direct review URL, publication, author or editorial desk, date and platform/version context for every review where available;
- at least **8 substantive thematic sections**;
- at least **2,000 words** of useful article text, excluding source lists and metadata;
- official facts from the developer, publisher or store as a separate evidence class;
- a verified media set with hero, cover and at least six distinct relevant screenshots;
- a completed rating-parser result;
- a separate visual relevance audit for every screenshot inserted into the article.

Official pages, Metacritic/OpenCritic, user reviews and store ratings do **not** replace the 20 professional editorial reviews. They may be used only as supplementary evidence.

If any gate fails, the system may create a research matrix or internal draft, but publication status must remain `blocked`. It must not publish a finished Игропоиск article.

## Required inputs

- verified game identity and official facts;
- at least 20 independent editorial reviews with publication name and direct canonical URL;
- normalized rating calculation from `data/ratings/<slug>.json`;
- verified screenshots and media from `data/drafts/<slug>.json`;
- parser configuration from `config/parsers/review-synthesis.json`.

## Research workflow

1. Validate and deduplicate the 20 editorial sources by canonical URL and publication.
2. Reject review hubs when a direct game-specific review URL exists.
3. Extract each source's central praise, criticism, evidence, score, reviewed platform and version.
4. Build a private comparison matrix containing:
   - broad agreements;
   - substantial disagreements;
   - minority observations;
   - platform-specific or technical differences;
   - claims requiring an official source.
5. Cluster findings by the game's systems and player experience, not by publication name.
6. Choose an original Игропоиск thesis that is not copied from a headline or verdict.

## Article requirements

The article must give a reader a working understanding of the game, not merely explain why critics liked it. Cover, where applicable:

- what kind of game it is and its normal play rhythm;
- protagonist, central relationships and narrative premise without major spoilers;
- structure and character of the open world;
- side quests, investigations and consequences of choices;
- distinctive activity or profession at the center of the game;
- combat mechanics, strengths and concrete control problems;
- progression, equipment, economy and interface;
- presentation, sound and writing;
- technical state and meaningful platform differences;
- final verdict and who should or should not play it.

Use 8–10 thematic sections. Each section must contain a thesis, concrete explanation, meaningful criticism or limitation and a conclusion. The article must contain at least 2,000 words without padding, repeated claims or source-by-source narration.

## Screenshot selection and visual audit

1. Select images only from the verified media set.
2. Store `section_id`, URL, caption, image source and an explicit reason for selection.
3. The visible subject must match the section:
   - combat requires visible combat, an enemy encounter or a clearly identifiable combat mechanic;
   - exploration requires travel, landscape or environmental discovery;
   - characters and relationships may use portraits or dialogue scenes;
   - monster contracts require a visible monster, investigation or preparation context;
   - interface and progression should use interface, inventory, equipment or preparation imagery when available.
4. A portrait is forbidden as the main illustration of combat, interface or exploration unless the text is specifically analyzing that portrait scene.
5. After writing, run a separate multimodal audit that actually inspects each selected image alongside the section text.
6. Reject any section whose image is unrelated or whose relevance confidence is below 0.70.
7. Publication requires at least six distinct approved screenshots.

The model's own `reason` field is not proof of relevance. Only the separate image audit can pass the visual gate.

## Source and claim audit

- Map every major factual or evaluative claim to supporting direct source URLs.
- Every one of the 20 editorial sources must materially support at least one claim or comparison.
- Do not pad the source list with unused links.
- Syndicated copies, translated reposts and multiple URLs from one publication count once.
- Aggregators may audit score distribution but do not count toward the editorial gate.
- User reviews may inform a separately labeled player-reception section but never count as professional criticism.

## Output contract

Return strict JSON with:

- `slug`, `game_slug`, `title`, `dek`, `author`, `published_at`, `score`, `hero`, `lead`;
- `publication_status`, `reading_time_minutes` and `source_gate`;
- `sections[]` containing `id`, `heading`, at least three `paragraphs[]` and a verified `image` object;
- `sources[]` containing `name`, `publication`, `url`, `purpose` and `type`;
- `methodology` describing how the 20 sources were compared and integrated;
- `claim_sources[]` mapping major claims to source URLs;
- `source_coverage` with collected, accepted, rejected and materially used counts;
- `validation` with word count, section count, unique screenshot count and multimodal image-audit results.

## Forbidden

- publishing with fewer than 20 unique professional editorial reviews;
- publishing fewer than 8 substantive sections or fewer than 2,000 words;
- counting official pages, aggregators, stores or user reviews toward the 20-review gate;
- fabricated quotes, scores, dates, URLs or publication names;
- copying source paragraphs or more than 12 consecutive words from one source;
- presenting one source's opinion as consensus;
- treating syndicated or duplicated articles as independent sources;
- generating a final rating without rating-parser output;
- using publisher advertising language as editorial judgment;
- inserting generated images, unrelated screenshots or a character portrait into a combat section;
- trusting image captions without visually inspecting the actual image.
