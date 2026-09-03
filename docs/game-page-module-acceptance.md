# Game Page module acceptance

A Game Page is publishable only when the universal page module completes the same bounded cycle for a requested canonical game identity without hand-written per-game data.

The module must:

1. resolve and persist canonical game identity;
2. collect structured page data and media;
3. collect the complete professional source corpus;
4. calculate the rating from every discovered verified professional score;
5. require at least the configured rating minimum; the higher rating target is aspirational once exhaustive discovery is complete;
6. produce natural Russian page editorial from verified page facts, using the free local editor when available and the deterministic verified structured fallback when it is not;
7. pass content, media and shell quality gates;
8. materialize one immutable canonical green page package;
9. publish that exact green package to staging and production;
10. verify the resulting live page in a real browser.

The Review subsystem remains separate. A review may be embedded in a Game Page, but review generation is not owned by the Game Page module.

News, Popular Now, Top-250, Releases and Search are external consumers/triggers and are not parts of the Game Page module.
