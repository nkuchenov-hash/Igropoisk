import assert from 'node:assert/strict';
import {
  calculatePopularityIndex,
  createPopularEntityResolver,
  recomputePopularityIndices
} from '../scripts/lib/popular-entity-resolution.mjs';

const games = [
  { slug: 'mafia', title: 'Mafia', aliases: ['Mafia'] },
  { slug: 'mafia-definitive-edition', title: 'Mafia: Definitive Edition', aliases: ['Mafia Definitive Edition'] },
  { slug: 'doom', title: 'DOOM', aliases: ['DOOM', 'DOOM 2016'] },
  { slug: 'doom-eternal', title: 'DOOM Eternal', aliases: ['Doom Eternal'] },
  { slug: 'genshin-impact', title: 'Genshin Impact', aliases: ['Genshin'] },
  { slug: 'fortnite', title: 'Fortnite', aliases: ['Fortnite Battle Royale'] }
];

const resolver = createPopularEntityResolver(games);
const slug = text => resolver.resolve(text, { mode: 'editorial' })?.slug || null;

assert.equal(
  slug('Mafia: The Omertà Collection announced with every game in the series'),
  null,
  'A collection must not be credited to Mafia 2002'
);
assert.equal(
  slug('All Mafia games arrive in a new collection'),
  null,
  'A franchise collection mention must not be credited to Mafia 2002'
);
assert.equal(
  slug('Mafia: Definitive Edition gets a new update'),
  'mafia-definitive-edition',
  'A specific Mafia edition must beat the franchise-root alias'
);
assert.equal(
  slug('ICH HELFE AVIVE UND KÄMPFE GEGEN PAULBERGER MAFIA'),
  null,
  'A random trailing generic word Mafia must not resolve to the 2002 game'
);
assert.equal(
  slug('Mafia gets a surprise patch 24 years later'),
  'mafia',
  'A direct headline about the root-title game must still resolve'
);
assert.equal(
  slug('New RPG from creators of Genshin Impact revealed'),
  null,
  'A creator-context mention is not a Genshin Impact popularity signal'
);
assert.equal(
  slug('Genshin Impact gets a major 6.0 update'),
  'genshin-impact',
  'A direct Genshin Impact headline must resolve'
);
assert.equal(
  slug('DOOM: The Dark Ages receives a new trailer'),
  null,
  'An unknown specific DOOM subtitle must not be credited to DOOM 2016'
);
assert.equal(
  slug('DOOM Eternal gets a new update'),
  'doom-eternal',
  'A known DOOM sequel must resolve to itself'
);
assert.equal(
  slug('Genshin Impact vs Fortnite: which live service wins?'),
  null,
  'A multi-game comparison must not arbitrarily credit one game'
);
assert.equal(
  slug('A new shooter like DOOM Eternal launches this month'),
  null,
  'A comparison mention must not become a popularity signal'
);

const maxima = { news: 10, reddit: 10, youtube: 10, twitch: 10, steam_chart: 10 };
const index = calculatePopularityIndex({
  signals: { news: 10, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 },
  maxima,
  newsSources: 4
});
assert.equal(index.score, 33.1, 'The canonical index formula must remain deterministic');

const rescored = recomputePopularityIndices([
  {
    slug: 'a',
    score: 99,
    signals: { news: 10, reddit: 0, youtube: 0, twitch: 0, steam_chart: 0 },
    news_sources: 4
  },
  {
    slug: 'b',
    score: 1,
    signals: { news: 0, reddit: 0, youtube: 10, twitch: 0, steam_chart: 0 },
    news_sources: 0
  }
]);
assert.notEqual(rescored[0].score, 99, 'Previous scores must not survive as an alternate scoring scale');
assert.notEqual(rescored[1].score, 1, 'YouTube community candidates must use the same index formula');
assert.ok(rescored[0].score > rescored[1].score, 'Weights must be applied consistently after enrichment');

console.log('Popular entity resolution tests passed.');
