import assert from 'node:assert/strict';
import {
  decodeNewsSourceText,
  publicationSemanticReasons,
  sourceEntityCandidates,
  sourceLooksTruncated
} from './lib/news-publication-quality.mjs';
import { refineNewsPrimaryGame } from './lib/news-primary-game-refiner.mjs';
import { newsGameTitleLooksGeneric, sourceContextGameHasStrongIdentity } from './lib/news-game-title-cleanup.mjs';

const carcassInput = {
  titleEn: '"A game for everyone is a game for no one": Don\'t expect an easy ride in Carcass Clad, the co-op tank horror game from the makers of Mouthwashing',
  summaryEn: 'On my final day of Gamescom, strolling (running) around the indie area to make sure I don\'t miss anything good, I stumble upon Wrong Organ&rsquo;s upcoming Carcass Clad. Set in a wartorn Soviet city, empty of people but littered with tanks wearing coats of Frankensteined cattle c',
  primaryUrl: 'https://www.rockpapershotgun.com/a-game-for-everyone-is-a-game-for-no-one-dont-expect-an-easy-ride-in-carcass-clad-the-co-op-tank-horror-game-from-the-makers-of-mouthwashing',
  games: [{ title: 'Carcass Clad' }]
};

const broken = publicationSemanticReasons(carcassInput, {
  titleRu: '"Игра для всех - это игра для всех": не ожидайте лёгкой поездки в Carcass Clad, кооп-танковой жуткой игре от создателей Moutwashing',
  summaryRu: 'В мой последний день в Gamescom, прогулки (прогулки) по индейской местности, чтобы убедиться, что я не пропустил ничего хорошего, я наткнулся на Неправильный Орган ирску; надвигается Carcass Clad. Расположился в разрушенном войной советском городе, пустой народ, но заброшенный танками с халатами Франкенштейнского скота c'
});
assert.ok(broken.some(reason => reason.includes('no one/nobody')));
assert.ok(broken.some(reason => reason.includes('Wrong Organ')));
assert.ok(broken.some(reason => reason.includes('Mouthwashing')));
assert.ok(broken.some(reason => reason.includes('parentheses')));
assert.ok(broken.some(reason => reason.includes('orphan Latin')));

const entities = sourceEntityCandidates(carcassInput);
assert.ok(entities.includes('Carcass Clad'));
assert.ok(entities.includes('Wrong Organ'));
assert.ok(entities.includes('Mouthwashing'));
assert.ok(entities.includes('Gamescom'));
assert.ok(!entities.includes('Mouthwashing Set'));
assert.equal(sourceLooksTruncated(carcassInput), true);
assert.equal(decodeNewsSourceText('Wrong Organ&rsquo;s game'), "Wrong Organ's game");

const clean = publicationSemanticReasons(carcassInput, {
  titleRu: '«Игра для всех — игра ни для кого»: Carcass Clad не обещает лёгкой прогулки',
  summaryRu: 'На Gamescom автор познакомился с Carcass Clad — новой игрой Wrong Organ, студии, создавшей Mouthwashing. Действие разворачивается в разрушенном войной советском городе, где экипажу танка предстоит столкнуться с жуткими машинами.'
});
assert.deepEqual(clean, []);

const disneyInput = {
  titleEn: "The official Disney 'RollerCoaster Tycoon' might be real",
  summaryEn: 'The team behind Planet Coaster, Planet Zoo and Jurassic World Evolution is making a new Disney game as the theme park sim prepares for a return.',
  primaryUrl: 'https://www.polygon.com/gaming/disney-rollercoaster-tycoon-frontier-new-game'
};
const brokenDisney = publicationSemanticReasons(disneyInput, {
  titleRu: "The Официальный Дисней 'RollerCoaster Tycoon' может быть правдой",
  summaryRu: 'The за планетой Побережье, Планетой Зооо и Юрской эволюционной компанией делает новую игру Дисней как тематический парк, готовящийся к возвращению.'
});
assert.ok(brokenDisney.some(reason => reason.includes('untranslated English grammar fragment')));
assert.ok(brokenDisney.some(reason => reason.includes('Planet Coaster')));
assert.ok(sourceEntityCandidates(disneyInput).includes('Planet Coaster'));
assert.equal(newsGameTitleLooksGeneric('the'), true);
assert.equal(newsGameTitleLooksGeneric('The Witcher'), false);

const bogusTheIdentity = {
  gameId: 'game_52651675bf5dda52d41b',
  slug: 'the',
  title: 'the',
  matchedBy: 'context-evidence-resolver',
  resolutionConfidence: 0.99,
  resolutionEvidence: { title: true, summary: true, url: true }
};
assert.equal(sourceContextGameHasStrongIdentity(bogusTheIdentity), false);
assert.equal(refineNewsPrimaryGame(disneyInput, bogusTheIdentity), null);

const cleanDisney = publicationSemanticReasons(disneyInput, {
  titleRu: 'Disney может получить собственный симулятор парка от авторов Planet Coaster',
  summaryRu: 'Команда, создавшая Planet Coaster, разрабатывает новую игру по лицензии Disney. Проект использует опыт студии в жанре симуляторов управления тематическими парками.'
});
assert.deepEqual(cleanDisney, []);

const ordinary = publicationSemanticReasons({
  titleEn: 'Valve updates Steam families',
  summaryEn: 'Valve has updated Steam Families with new account controls.',
  primaryUrl: 'https://example.com/valve-steam-families'
}, {
  titleRu: 'Valve обновила семейные функции Steam',
  summaryRu: 'Valve обновила Steam Families и добавила новые настройки управления аккаунтами. Изменения уже доступны пользователям сервиса.'
});
assert.deepEqual(ordinary, []);

const godOfWar = publicationSemanticReasons({
  titleEn: 'God of War gets a new update',
  summaryEn: 'Sony has released a new update for God of War on PC.',
  primaryUrl: 'https://example.com/god-of-war-update',
  games: [{ title: 'God of War' }]
}, {
  titleRu: 'God of War получила новое обновление',
  summaryRu: 'Sony выпустила новое обновление для God of War на PC. Патч уже доступен игрокам.'
});
assert.deepEqual(godOfWar, []);

const witcherMixedName = publicationSemanticReasons({
  titleEn: 'The Witcher 4 gets a development update',
  summaryEn: 'CD Projekt Red shared new details about The Witcher 4.',
  primaryUrl: 'https://example.com/the-witcher-4-update',
  games: [{ title: 'The Witcher 4' }]
}, {
  titleRu: 'The Witcher 4 получила новое обновление разработки',
  summaryRu: 'CD Projekt Red рассказала новые подробности о The Witcher 4.'
});
assert.deepEqual(witcherMixedName, []);

const sentenceBoundaryInput = {
  titleEn: 'A real-life romance inspired a classic NES remake',
  summaryEn: 'The game keeps the spirit of the Classic NES remake. But this story focuses on the people behind it.',
  primaryUrl: 'https://example.com/classic-nes-remake'
};
const sentenceBoundaryEntities = sourceEntityCandidates(sentenceBoundaryInput);
assert.ok(!sentenceBoundaryEntities.some(entity => /Classic NES Remake But/i.test(entity)));
assert.ok(!sentenceBoundaryEntities.some(entity => /More Games Members/i.test(entity)));

console.log('News publication quality regressions passed.');
