import assert from 'node:assert/strict';
import { newsTopicKey, selectCommercialHomeNews } from './lib/news-home-selector.mjs';

const now = Date.parse('2026-08-28T10:00:00Z');
const hoursAgo = hours => new Date(now - hours * 60 * 60 * 1000).toISOString();
const game = (slug, title) => ({ slug, title, gameId: `game_${slug}` });

assert.equal(newsTopicKey({
  titleEn: 'GTA 6 could overhaul police chases after Red Dead Redemption 2',
  titleRu: 'GTA 6 может изменить полицейские погони',
  games: [
    game('grand-theft-auto-vi', 'Grand Theft Auto VI'),
    game('red-dead-redemption-2', 'Red Dead Redemption 2')
  ]
}), 'grand-theft-auto-vi', 'Primary topic must be GTA 6, not a comparison game mentioned later in the headline.');

function item(id, ageHours, source, topic = id, extra = {}) {
  return {
    id,
    publicEligible: true,
    titleEn: `News about ${topic}`,
    titleRu: `Новости об игре ${topic}`,
    publishedAt: hoursAgo(ageHours),
    homeUntil: hoursAgo(-24),
    primarySource: source,
    primaryUrl: `https://example.test/${id}`,
    games: [game(topic, topic)],
    ...extra
  };
}

const candidates = [
  item('gta-a', 1, 'PC Gamer', 'grand-theft-auto-vi', { titleEn: 'GTA 6 story one', games: [game('grand-theft-auto-vi', 'Grand Theft Auto VI')] }),
  item('gta-b', 2, 'IGN', 'grand-theft-auto-vi', { titleEn: 'Grand Theft Auto 6 story two', games: [game('grand-theft-auto-vi', 'Grand Theft Auto VI')] }),
  item('gta-c', 3, 'VGC', 'grand-theft-auto-vi', { titleEn: 'GTA 6 story three', games: [game('grand-theft-auto-vi', 'Grand Theft Auto VI')] }),
  item('fresh-1', 4, 'PC Gamer'),
  item('fresh-2', 5, 'PC Gamer'),
  item('fresh-3', 6, 'PC Gamer'),
  item('fresh-4', 7, 'Eurogamer'),
  item('fresh-5', 8, 'Polygon'),
  item('fresh-6', 9, 'GameSpot'),
  item('fresh-7', 10, 'Rock Paper Shotgun'),
  item('fresh-8', 11, 'PlayStation Blog'),
  item('fresh-9', 12, 'Xbox Wire'),
  item('fresh-10', 13, 'Nintendo Life'),
  item('fresh-11', 20, 'Steam News'),
  item('older-ok', 80, 'Gematsu'),
  item('stale', 190, 'Old Source'),
  item('expired', 24, 'Expired Source', 'expired', { homeUntil: hoursAgo(1) })
];

const selection = selectCommercialHomeNews(candidates, { now, limit: 12, minRecent: 8 });
assert.equal(selection.ok, true, JSON.stringify(selection.diagnostics));
assert.equal(selection.items.length, 12);
assert.equal(selection.items.filter(entry => newsTopicKey(entry) === 'grand-theft-auto-vi').length, 2, 'Homepage must cap one game/topic at two cards.');
assert.ok(selection.items.filter(entry => entry.primarySource === 'PC Gamer').length <= 3, 'Homepage must cap one source at three cards.');
assert.equal(selection.items.some(entry => entry.id === 'stale'), false, 'Stories older than seven days must not reach the homepage.');
assert.equal(selection.items.some(entry => entry.id === 'expired'), false, 'Expired homeUntil stories must not reach the homepage.');
assert.ok(selection.diagnostics.recentCount >= 8);

const insufficientFresh = selectCommercialHomeNews([
  ...Array.from({ length: 7 }, (_, index) => item(`recent-${index}`, index + 1, `Fresh ${index}`)),
  ...Array.from({ length: 5 }, (_, index) => item(`old-${index}`, 100 + index, `Old ${index}`))
], { now, limit: 12, minRecent: 8 });
assert.equal(insufficientFresh.ok, false, 'Twelve cards are not commercially acceptable when fewer than eight are recent.');

console.log('Commercial homepage freshness, diversity and primary-topic tests passed.');
