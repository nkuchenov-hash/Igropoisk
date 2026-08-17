import assert from 'node:assert/strict';
import {
  candidateIsPersonInContext,
  collectPersonCandidateKeys,
  sanitizeNewsGameHint,
  stripGenericGameDescriptor
} from './lib/news-game-candidate-safety.mjs';

const samBarlowDirect = {
  titleEn: "Immortality creator Sam Barlow reveals his next game: A sci-fi horror collaboration",
  summaryEn: 'The designer says the new project will be announced later.',
  games: [{ gameId: 'bad-person-id', slug: 'sam-barlow', title: 'sam-barlow' }]
};
const samBarlowIndirect = {
  titleEn: 'Kinetic Publishing Showcase Recap: Every Reveal, Including the New Sam Barlow Game',
  summaryEn: 'The showcase included several upcoming titles.',
  games: [{ gameId: 'bad-person-id', slug: 'sam-barlow', title: 'sam-barlow' }]
};
assert.equal(candidateIsPersonInContext(samBarlowDirect, 'Sam Barlow'), true, 'A named creator must be recognized as a person in article context.');
const knownPeople = collectPersonCandidateKeys([samBarlowDirect, samBarlowIndirect]);
assert.equal(knownPeople.has('sam barlow'), true, 'A person identified anywhere in hydrated history must poison-clean the same old slug everywhere.');
assert.equal(
  sanitizeNewsGameHint(samBarlowIndirect, samBarlowIndirect.games[0], { knownPersonCandidates: knownPeople }),
  null,
  'A historical slug copied into title must not survive as a game just because another article omits the creator role.'
);

assert.equal(stripGenericGameDescriptor('RPG The Lord of the Rings: War in the North'), 'The Lord of the Rings: War in the North');
const sanitizedLotr = sanitizeNewsGameHint({
  titleEn: '2011 action RPG The Lord of the Rings: War in the North gets a new Legacy Edition',
  summaryEn: 'Aspyr says it will bring more Lord of the Rings games to current systems.'
}, {
  gameId: 'poisoned-id',
  slug: 'rpg-the-lord-of-the-rings-war',
  title: 'rpg-the-lord-of-the-rings-war'
});
assert.equal(sanitizedLotr.title, 'the lord of the rings war');
assert.equal('gameId' in sanitizedLotr, false, 'A descriptor-prefixed historical slug must not retain a poisoned canonical id.');
assert.equal('slug' in sanitizedLotr, false, 'A descriptor-prefixed historical slug must be re-verified instead of materialized directly.');

const realGame = sanitizeNewsGameHint({
  titleEn: "Marvel's Wolverine gets a new gameplay trailer",
  summaryEn: "Marvel's Wolverine is coming to PlayStation 5."
}, {
  gameId: 'wolverine-id',
  slug: 'wolverine',
  title: "Marvel's Wolverine"
});
assert.equal(realGame.gameId, 'wolverine-id');
assert.equal(realGame.title, "Marvel's Wolverine");

console.log('News game candidate safety tests passed, including hydrated poisoned-slug cleanup.');
