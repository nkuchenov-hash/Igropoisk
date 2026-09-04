# Seven-game full-corpus editorial benchmark

This benchmark replaces the earlier quick drafts and the old five-game benchmark input truncation.

## What was actually read

For every game, the editorial pass uses the complete `text` field of every readable source stored by the Game Page source collector in `data/game-source-content/<slug>.json`. The benchmark adds **no second truncation** such as `slice(0, 1200)` or a six-source limit.

This wording is deliberate: the test guarantees complete use of the source material that the Igropoisk collector stored. It does not claim that an upstream website necessarily exposed unlimited page text to the collector.

| Game | Candidates scanned | Readable stored sources |
| --- | ---: | ---: |
| Dangerous Dave in the Haunted Mansion | 5 | 4 |
| Far Cry (2004) | 5 | 5 |
| Jack Orlando: A Cinematic Adventure | 5 | 4 |
| Mafia: The City of Lost Heaven | 25 | 17 |
| Mass Effect (2007) | 13 | 10 |
| Wolfenstein 3D | 6 | 6 |
| Spore | 10 | 7 |

## Editorial procedure

1. Read every readable stored source for the game.
2. Extract concrete game-specific evidence: mechanics, interface/feedback, unusual details, structure, strengths and limitations.
3. Discard facts that do not help explain what makes this particular game distinctive.
4. Write a new Subtitle, Description and Features block from that evidence.
5. Do not reuse the earlier quick drafts as source material.

## Block format

- **Subtitle** — a compact identifying essence of the game, usually around 6–12 words. It must contain at least one game-specific hook: distinctive fantasy, structure, mechanic, setting or tension. A generic genre label is not sufficient. It also must not expand into a miniature Description.
- **Description** — the full introductory block: premise, what the player actually does, major systems and the details that distinguish the game.
- **Features** — compact thesis-like feature labels. Each item should be scannable at a glance and should not become an explanatory sentence.

A useful Subtitle test: if the line could describe dozens of unrelated games after removing the title, it is too generic.

`results.json` contains the current source-grounded copy.
