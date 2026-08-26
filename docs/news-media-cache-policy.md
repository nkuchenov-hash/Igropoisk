# News media cache policy

News images are an acceleration cache, not permanent editorial history and not a publication requirement.

## Canonical rules

- Fresh news images are copied to Yandex Object Storage when possible so public pages do not depend on third-party image hosts at render time.
- Cached media is retained for 7 days.
- Content-addressed first-party media URLs remain browser-cache friendly while they exist.
- Missing, expired, blocked, unsupported, or failed-to-cache images never block publication of the news item or the feed.
- The public UI replaces unavailable media with the branded Игропоиск news fallback.
- News text, source URLs, dates, game links, and archive records remain independent from image cache retention.
- Cache cleanup is housekeeping and is explicitly non-blocking for live news publication.
- A cleanup failure must be reported diagnostically, not converted into loss of the current news feed.

## Non-regression rule

Future changes must not reintroduce any gate that requires every news item to have a locally cached image before publication. Image availability may affect presentation quality only; it cannot decide whether valid text news is published.

The broader production contract is defined in `docs/news-production-contract.md`.
