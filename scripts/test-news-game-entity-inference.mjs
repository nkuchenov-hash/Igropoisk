import assert from 'node:assert/strict';
import { applyInferredGames, inferHeadlineGame } from './infer-news-game-entities.mjs';

const demonsSouls = inferHeadlineGame({
  titleRu: 'Недавно обнаруженные кадры прототипа Demon’s Souls показывают убранный режим от первого лица'
});
assert.deepEqual(demonsSouls, {
  title: "Demon's Souls",
  slug: 'demons-souls',
  matchedBy: 'headline-latin-entity'
});

const quoted = inferHeadlineGame({
  titleRu: 'Разработчики показали «Смута» в новом трейлере'
});
assert.equal(quoted?.title, 'Смута');
assert.equal(quoted?.matchedBy, 'headline-quoted-entity');

const publisherOnly = inferHeadlineGame({
  titleRu: 'PC Gamer рассказал о новой технологии для PlayStation 5'
});
assert.equal(publisherOnly, null, 'Publisher/platform names must not become game hashtags.');

const existing = { id: 'known', games: [{ slug: 'known-game', title: 'Known Game' }] };
assert.equal(applyInferredGames([existing])[0], existing, 'Existing canonical game links must remain untouched.');

const inferred = applyInferredGames([{
  id: 'demons',
  titleRu: 'Недавно обнаруженные кадры прототипа Demon’s Souls показывают убранный режим от первого лица',
  games: [],
  gameIds: []
}])[0];
assert.equal(inferred.games[0].title, "Demon's Souls");
assert.equal(inferred.games[0].pageExists, false);
assert.equal(inferred.gameReviewStatus, 'needs-review');
assert.equal(inferred.gameReviewReasons.includes('inferred-game-not-in-registry'), true);

console.log('News headline game entity inference tests passed.');
