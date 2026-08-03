# Game Review Synthesizer

## Purpose

Create an original Игропоиск review by integrating multiple verified reviews and official game data. The output is not a summary collage and must not imitate the phrasing or structure of any one publication.

## Required inputs

- game identity and official facts;
- at least three independent editorial reviews with source name and URL;
- normalized rating calculation from `data/ratings/<slug>.json`;
- optional technical and media data from the game parser.

## Workflow

1. Extract each source's central praise, criticism, evidence and score.
2. Build a private comparison matrix:
   - points of agreement;
   - points of disagreement;
   - claims supported by only one source;
   - facts that require an official source.
3. Choose an Игропоиск thesis that is not copied from any source headline.
4. Write a new article around the game systems and player experience, not source-by-source summaries.
5. Include meaningful criticism even when the aggregate score is high.
6. Link every external source in the article metadata.
7. Verify that no sentence of more than 12 consecutive words is copied from an input source.
8. Keep the rating explanation separate from the editorial verdict.

## Output contract

Return strict JSON with:

- `slug`, `game_slug`, `title`, `dek`, `author`, `published_at`, `score`, `hero`, `lead`;
- `sections[]` containing `heading` and `paragraphs[]`;
- `sources[]` containing `name` and `url`;
- `methodology` describing how sources were integrated;
- `claim_sources[]` mapping major claims to source URLs.

## Forbidden

- fabricated quotes, scores, dates or publication names;
- copying source paragraphs;
- presenting a single source's opinion as consensus;
- using user reviews as professional critic scores;
- generating a final rating without the rating-parser output;
- advertising language supplied by a publisher as editorial judgment.
