# News media cache policy

News images are an acceleration cache, not permanent editorial history.

- Fresh news images are copied to Yandex Object Storage so public pages never wait on third-party image hosts.
- Cached media is retained for 7 days.
- Content-addressed media URLs remain browser-cache friendly while they exist.
- Missing, expired, blocked, or unsupported images never block publication of the news item or the feed.
- The public UI replaces unavailable media with the branded Игропоиск news fallback.
- News text, source URLs, dates, game links, and archive records remain independent from image cache retention.
- Cache cleanup is housekeeping and is explicitly non-blocking for live news publication.
