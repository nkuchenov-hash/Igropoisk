import assert from 'node:assert/strict';
import {
  candidateIsPersonInContext,
  sanitizeNewsGameHint,
  stripGenericGameDescriptor
} from './lib/news-game-candidate-safety.mjs';

const samBarlow = {
  titleEn: 'Immortality creator Sam Barlow reveals his next game after years of experimentation',
  summaryEn: 'The designer says the new project will be announced later.',
  primaryUrl: 'https://example.com/sam-barlow-next-game'
};
assert.equal(candidateIsPersonInContext(samBarlow, 'Sam Barlow'), true, 'A named creator must be recognized as a person in article context.');
assert.equal(sanitizeNewsGameHint(samBarlow, { gameId: 'bad-person-id', slug: 'sam-barlow', title: 'Sam Barlow' }), null, 'A person must never become a canonical game hint.');

const lotrTitle = 'RPG The Lord of the Rings: War in the North';
assert.equal(stripGenericGameDescriptor(lotrTitle), 'The Lord of the Rings: War in the North');
const sanitizedLotr = sanitizeNewsGameHint({
  titleEn: '2011 action RPG The Lord of the Rings: War in the North gets a new Legacy Edition',
  summaryEn: 'The Lord of the Rings: War in the North originally launched in 2011.'
}, {
  gameId: 'poisoned-id',
  slug: 'rpg-the-lord-of-the-rings-war',
  title: lotrTitle
});
assert.equal(sanitizedLotr.title, 'The Lord of the Rings: War in the North');
assert.equal('gameId' in sanitizedLotr, false, 'A corrected headline descriptor must not retain a poisoned canonical id.');
assert.equal('slug' in sanitizedLotr, false, 'A corrected headline descriptor must be resolved again under its real title.');

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

console.log('News game candidate safety tests passed.');
