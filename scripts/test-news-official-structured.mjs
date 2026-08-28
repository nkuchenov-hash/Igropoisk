import assert from 'node:assert/strict';
import { parseStructuredOfficialNews } from './lib/news-official-structured.mjs';

const source = {
  id: 'riot',
  name: 'Riot Games News',
  organization: 'Riot Games',
  kind: 'publisher',
  siteUrl: 'https://www.riotgames.com/en/news',
  language: 'en'
};
const now = Date.parse('2026-08-28T20:00:00Z');
const html = `<!doctype html><html><head>
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@graph":[
    {"@type":"Organization","name":"Riot Games"},
    {"@type":"NewsArticle","headline":"2XKO Active Development Will End in December 2026","description":"Servers remain online while active development winds down.","datePublished":"2026-08-20T15:00:00Z","url":"https://www.riotgames.com/en/news/2xko-development-update"},
    {"@type":"Article","headline":"Fresh official game update","description":"A current game update.","datePublished":"2026-08-28T10:00:00Z","mainEntityOfPage":{"@id":"/en/news/fresh-update"}},
    {"@type":"NewsArticle","headline":"Missing publication date must never be guessed","url":"https://www.riotgames.com/en/news/no-date"},
    {"@type":"NewsArticle","headline":"Old article","datePublished":"2026-07-01T10:00:00Z","url":"https://www.riotgames.com/en/news/old"},
    {"@type":"NewsArticle","headline":"Offsite article","datePublished":"2026-08-28T10:00:00Z","url":"https://example.com/copied"}
  ]
}</script>
<script type="application/ld+json">not valid json</script>
</head><body></body></html>`;

const items = parseStructuredOfficialNews(html, source, source.siteUrl, { now, maxAgeDays: 14 });
assert.equal(items.length, 2);
assert.equal(items[0].title, 'Fresh official game update');
assert.equal(items[0].url, 'https://www.riotgames.com/en/news/fresh-update');
assert.equal(items[0].publishedAt, '2026-08-28T10:00:00.000Z');
assert.equal(items[0].discoveryMode, 'jsonld');
assert.equal(items[1].title, '2XKO Active Development Will End in December 2026');
assert.equal(items.some(item => item.url.includes('no-date')), false, 'Missing datePublished must not be accepted.');
assert.equal(items.some(item => item.url.includes('/old')), false, 'Items outside the live window must not be accepted.');
assert.equal(items.some(item => item.url.includes('example.com')), false, 'Structured data must not escape the official host.');

const future = parseStructuredOfficialNews(`<script type="application/ld+json">{"@type":"NewsArticle","headline":"Impossible future article","datePublished":"2026-08-29T10:00:00Z","url":"https://www.riotgames.com/en/news/future"}</script>`, source, source.siteUrl, { now });
assert.equal(future.length, 0, 'Future-dated structured records beyond clock skew must be rejected.');

console.log('Official JSON-LD news fallback tests passed.');
