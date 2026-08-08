import assert from 'node:assert/strict';
import {
  applyResolvedExternalGame,
  extractNewsGameQueries,
  normalizeGameContext,
  resolveVerifiedExternalNewsGame
} from './lib/news-game-context-resolver.mjs';

function mockOpenCritic(rowsByQuery) {
  return async url => {
    const query = new URL(url).searchParams.get('criteria') || '';
    const rows = rowsByQuery[normalizeGameContext(query)] || [];
    return {
      ok: true,
      async json() { return rows; }
    };
  };
}

const doomItem = {
  id: 'doom-story',
  titleRu: '«Они принципиально не понимают искусство» — разработчики Doom раскритиковали Xbox после увольнений',
  titleEn: 'Doom developers criticize Xbox after Microsoft layoffs',
  summaryRu: 'После увольнений среди разработчиков Doom сотрудники id Software раскритиковали решения Microsoft.',
  primaryUrl: 'https://www.ign.com/articles/doom-developers-criticize-xbox-after-microsoft-layoffs',
  publicEligible: true,
  games: []
};
const doomQueries = extractNewsGameQueries(doomItem).map(normalizeGameContext);
assert.ok(doomQueries.includes('doom'), 'Doom must be extracted as a game candidate.');
assert.equal(doomQueries.some(value => value.includes('они принципиально')), false, 'Quoted Russian prose must never become a game query.');
const doom = await resolveVerifiedExternalNewsGame(doomItem, {
  fetchImpl: mockOpenCritic({ doom: [{ id: 145, name: 'DOOM' }] })
});
assert.equal(doom?.title, 'DOOM');
assert.equal(doom?.matchedBy, 'context-opencritic-verified');
assert.ok(doom?.resolutionConfidence >= 0.8);
const appliedDoom = applyResolvedExternalGame(doomItem, doom);
assert.equal(appliedDoom.games.length, 1);
assert.equal(appliedDoom.games[0].title, 'DOOM');
assert.equal(appliedDoom.gameReviewStatus, 'resolved');

const crimsonItem = {
  id: 'crimson-story',
  titleEn: 'Crimson Moon battles demonic corruption on September 1',
  titleRu: 'Crimson Moon сразится с демонической порчей 1 сентября',
  summaryEn: 'Earlier this year we introduced Crimson Moon, our gothic high renaissance action RPG.',
  primaryUrl: 'https://blog.playstation.com/2026/08/04/crimson-moon-battles-demonic-corruption-on-september-1/',
  publicEligible: true,
  games: []
};
const crimson = await resolveVerifiedExternalNewsGame(crimsonItem, {
  fetchImpl: mockOpenCritic({ 'crimson moon': [{ id: 9911, name: 'Crimson Moon' }] })
});
assert.equal(crimson?.title, 'Crimson Moon');
assert.equal(crimson?.externalIds?.opencritic, '9911');

const corroborated = await resolveVerifiedExternalNewsGame(crimsonItem, {
  fetchImpl: mockOpenCritic({}),
  maxQueries: 0
});
assert.equal(corroborated?.title, 'Crimson Moon', 'A multiword game repeated in headline and article context should still resolve when an external catalogue is temporarily unavailable.');
assert.equal(corroborated?.matchedBy, 'context-corroborated');

const microsoftItem = {
  id: 'industry-story',
  titleEn: 'Microsoft restructures Xbox teams after layoffs',
  titleRu: 'Microsoft реструктурирует команды Xbox после увольнений',
  summaryEn: 'The company described changes to several internal teams.',
  primaryUrl: 'https://example.com/microsoft-xbox-layoffs',
  publicEligible: true,
  games: []
};
const notAGame = await resolveVerifiedExternalNewsGame(microsoftItem, {
  fetchImpl: mockOpenCritic({ microsoft: [{ id: 500, name: 'Microsoft Flight Simulator' }] })
});
assert.equal(notAGame, null, 'Company/platform language must not be converted into a game hashtag.');

const controlItem = {
  id: 'control-word',
  titleEn: 'Developers improve control settings for console players',
  summaryEn: 'The update changes controller sensitivity and accessibility.',
  primaryUrl: 'https://example.com/control-settings-update',
  publicEligible: true,
  games: []
};
const control = await resolveVerifiedExternalNewsGame(controlItem, {
  fetchImpl: mockOpenCritic({ control: [{ id: 824, name: 'Control' }] })
});
assert.equal(control, null, 'Generic prose containing the word control must not become #Control.');

console.log('News verified context game resolver tests passed.');
