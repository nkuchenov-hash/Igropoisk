import assert from 'node:assert/strict';
import { isSameNewsStory, newsTopicKey, selectCommercialHomeNews } from './lib/news-home-selector.mjs';

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
}), 'grand-theft-auto-vi');

const noGameTopicA = newsTopicKey({ titleEn: 'EA Motive Iron Man trailer leaked online', games: [] });
const noGameTopicB = newsTopicKey({ titleEn: 'Rust roadmap delays major features', games: [] });
assert.ok(noGameTopicA.startsWith('story:'), noGameTopicA);
assert.ok(noGameTopicB.startsWith('story:'), noGameTopicB);
assert.notEqual(noGameTopicA, noGameTopicB);

const gamescomTheftA = {
  titleEn: 'Indie Dev Posts Video Reporting Stolen Laptops at gamescom as CD Projekt Red and More Step in to Help'
};
const gamescomTheftB = {
  titleEn: 'CD Projekt Red Offers To Help Gamescom Theft Victim As Industry Shows Its Support'
};
assert.equal(isSameNewsStory(gamescomTheftA, gamescomTheftB), true, 'same Gamescom theft story must dedupe across publishers');
assert.equal(isSameNewsStory(gamescomTheftA, { titleEn: 'Xbox announces a new family of next-generation consoles' }), false);

const projectHelixA = {
  titleRu: 'Следующая Xbox будет не одной консолью — Microsoft готовит целое семейство',
  summaryRu: 'Microsoft работает сразу над несколькими решениями Project Helix. Игровая приставка окажется семейством устройств следующего поколения Xbox.'
};
const projectHelixB = {
  titleRu: 'Xbox подтверждает, что Project Helix будет семейным набором устройств',
  summaryRu: 'Project Helix выйдет в виде семьи устройств. Компания связывает это с доступностью следующего поколения консолей.'
};
assert.equal(isSameNewsStory(projectHelixA, projectHelixB), true, 'same Project Helix announcement must dedupe across languages and publishers');
assert.equal(isSameNewsStory(projectHelixA, {
  titleRu: 'Xbox представила обновление приложения для облачного гейминга',
  summaryRu: 'Microsoft изменила интерфейс приложения Xbox и добавила новые функции для игроков.'
}), false, 'different Xbox news must remain separate');

const steamDeckMilestoneA = {
  titleRu: 'Steam Deck получила поддержку более 30 тыс. игр из библиотеки Steam',
  summaryRu: 'На сегодняшний день платформа поддерживает более 30 000 различных игр.'
};
const steamDeckMilestoneB = {
  titleRu: 'Steam Deck преодолела отметку в 30 000 игр с рейтингами Verified и Playable',
  summaryRu: 'Valve продолжает тестировать игры для Steam Deck и SteamOS.'
};
assert.equal(isSameNewsStory(steamDeckMilestoneA, steamDeckMilestoneB), true, 'same numeric platform milestone must dedupe across publishers');
assert.equal(isSameNewsStory(steamDeckMilestoneA, {
  titleRu: 'Steam Deck получила обновление клиента с новым оверлеем',
  summaryRu: 'Valve изменила интерфейс портативной системы.'
}), false, 'different Steam Deck events must remain separate');

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
assert.equal(selection.items.filter(entry => newsTopicKey(entry) === 'grand-theft-auto-vi').length, 2);
assert.ok(selection.items.filter(entry => entry.primarySource === 'PC Gamer').length <= 3);
assert.equal(selection.items.some(entry => entry.id === 'stale'), false);
assert.equal(selection.items.some(entry => entry.id === 'expired'), false);
assert.ok(selection.diagnostics.recentCount >= 8);
assert.ok(selection.diagnostics.uniqueTopics >= 10, JSON.stringify(selection.diagnostics));

const noGameSelection = selectCommercialHomeNews([
  item('theft-a', 1, 'IGN', 'unused-a', { games: [], titleEn: gamescomTheftA.titleEn }),
  item('theft-b', 2, 'GameSpot', 'unused-b', { games: [], titleEn: gamescomTheftB.titleEn }),
  item('story-c', 3, 'Polygon', 'unused-c', { games: [], titleEn: 'Rust roadmap delays major features' })
], { now, limit: 2, minRecent: 2 });
assert.equal(noGameSelection.ok, true, JSON.stringify(noGameSelection.diagnostics));
assert.equal(noGameSelection.items.some(entry => entry.id === 'theft-a') && noGameSelection.items.some(entry => entry.id === 'theft-b'), false);
assert.equal(noGameSelection.diagnostics.rejected.duplicateStory, 1);

// Eight genuinely different stories must publish as eight; a display target is not a quota.
const quietDay = selectCommercialHomeNews(
  Array.from({ length: 8 }, (_, index) => item(
    `quiet-${index}`,
    index + 1,
    `Source ${index % 4}`,
    `quiet-topic-${index}`,
    {
      titleEn: `DistinctSignal${index} ProjectMark${index} ReleaseCode${index}`,
      titleRu: `Сигнал${index} Проект${index} Релиз${index}`
    }
  )),
  { now, limit: 12, minRecent: 8, maxPerSource: 4 }
);
assert.equal(quietDay.ok, true, JSON.stringify(quietDay.diagnostics));
assert.equal(quietDay.items.length, 8);
assert.equal(quietDay.diagnostics.targetFilled, false);

// Source diversity is preferred, but it must not prevent the twelfth valid card.
const concentrated = selectCommercialHomeNews([
  ...Array.from({ length: 8 }, (_, index) => item(
    `dominant-${index}`,
    index + 1,
    'Dominant Source',
    `dominant-topic-${index}`,
    {
      titleEn: `DominantSignal${index} Marker${index} EventCode${index}`,
      titleRu: `Доминанта${index} Маркер${index} Событие${index}`
    }
  )),
  item('other-a', 9, 'Source A', 'other-a', { titleEn: 'Amber Harbor Expansion', titleRu: 'Расширение Amber Harbor' }),
  item('other-b', 10, 'Source B', 'other-b', { titleEn: 'Crimson Valley Launch', titleRu: 'Релиз Crimson Valley' }),
  item('other-c', 11, 'Source C', 'other-c', { titleEn: 'Silver Forge Update', titleRu: 'Обновление Silver Forge' }),
  item('other-d', 12, 'Source D', 'other-d', { titleEn: 'Night Circuit Announcement', titleRu: 'Анонс Night Circuit' })
], { now, limit: 12, minRecent: 8, maxPerSource: 4 });
assert.equal(concentrated.ok, true, JSON.stringify(concentrated.diagnostics));
assert.equal(concentrated.items.length, 12);
assert.equal(concentrated.diagnostics.uniqueSources, 5);
assert.ok(concentrated.diagnostics.rejected.sourceCapFallbackAccepted > 0, JSON.stringify(concentrated.diagnostics));

const insufficientFresh = selectCommercialHomeNews([
  ...Array.from({ length: 7 }, (_, index) => item(`recent-${index}`, index + 1, `Fresh ${index}`)),
  ...Array.from({ length: 5 }, (_, index) => item(`old-${index}`, 100 + index, `Old ${index}`))
], { now, limit: 12, minRecent: 8 });
assert.equal(insufficientFresh.ok, false);

console.log('Commercial homepage freshness, variable-volume selection, diversity preference and semantic-story dedupe tests passed.');
