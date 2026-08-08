import assert from 'node:assert/strict';
import {
  applyResolvedExternalGame,
  extractNewsGameQueries,
  normalizeGameContext,
  resolveVerifiedExternalNewsGame
} from './lib/news-game-context-resolver.mjs';

function mockResolver(modelResult, openCriticRows = []) {
  return async (url, options = {}) => {
    if (String(url).includes('models.github.ai')) {
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: JSON.stringify(modelResult) } }] };
        }
      };
    }
    if (String(url).includes('opencritic.com/api/game/search')) {
      return { ok: true, async json() { return openCriticRows; } };
    }
    return { ok: false, async json() { return {}; } };
  };
}

async function semantic(item, modelResult, openCriticRows = []) {
  return resolveVerifiedExternalNewsGame(item, {
    githubToken: 'test-token',
    fetchImpl: mockResolver(modelResult, openCriticRows)
  });
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
const doom = await semantic(doomItem, { game_title: 'DOOM', relation: 'primary_game', confidence: 0.98 }, [{ id: 145, name: 'DOOM' }]);
assert.equal(doom?.title, 'DOOM');
assert.equal(doom?.matchedBy, 'github-model-opencritic');
const appliedDoom = applyResolvedExternalGame(doomItem, doom);
assert.equal(appliedDoom.games[0].title, 'DOOM');
assert.equal(appliedDoom.gameReviewStatus, 'resolved');

const falseCompany = {
  titleEn: 'THQ Nordic says it has 12 unannounced games in development',
  summaryEn: 'The publisher says it currently has 29 games in the works, but has only revealed 17 of them',
  primaryUrl: 'https://www.videogameschronicle.com/news/thq-nordic-says-it-has-12-unannounced-games-in-development/',
  publicEligible: true,
  games: []
};
assert.equal(await semantic(falseCompany, { game_title: null, relation: 'industry_or_platform', confidence: 0.99 }), null, 'THQ Nordic must never become a game hashtag.');

const reanimal = {
  titleEn: 'The first story addition REANIMAL - The Prisoner from the authors of Little Nightmares has been released',
  summaryEn: 'An expansion called REANIMAL - The Prisoner is available. Tarsier Studios and THQ Nordic released the first story expansion for the dark co-op horror game REANIMAL.',
  primaryUrl: 'https://www.playground.ru/reanimal/news/vyshlo_pervoe_syuzhetnoe_dopolnenie_reanimal_the_prisoner-1865177',
  publicEligible: true,
  games: []
};
const reanimalGame = await semantic(reanimal, { game_title: 'REANIMAL', relation: 'dlc_or_update', confidence: 0.97 });
assert.equal(reanimalGame?.title, 'REANIMAL', 'An expansion subtitle must resolve to its base game.');
assert.notEqual(reanimalGame?.title, 'The Prisoner');

const marvel = {
  titleEn: 'Marvel Tokon: Fighting Souls suffers from widespread PC issues at launch',
  summaryEn: 'Marvel Tokonn: Fighting Souls finally released, and PC players are reporting significant technical issues.',
  primaryUrl: 'https://www.eurogamer.net/marvel-tokon-fighting-souls-pc-problems-stuttering-lag',
  publicEligible: true,
  games: []
};
const marvelGame = await semantic(marvel, { game_title: 'Marvel Tokon: Fighting Souls', relation: 'primary_game', confidence: 0.99 }, [{ id: 2001, name: 'Marvel Tokon: Fighting Souls' }]);
assert.equal(marvelGame?.title, 'Marvel Tokon: Fighting Souls', 'The resolver must preserve the full colon subtitle.');
assert.notEqual(marvelGame?.title, 'Fighting Souls');

const halo = {
  titleEn: 'Halo Studios hit by layoffs after release of Halo: Campaign Evolved',
  summaryEn: 'Recent job cuts at Halo Studios affect contract workers after the release.',
  primaryUrl: 'https://www.eurogamer.net/halo-studios-layoffs-campaign-evolved',
  publicEligible: true,
  games: []
};
const haloGame = await semantic(halo, { game_title: 'Halo: Campaign Evolved', relation: 'primary_game', confidence: 0.91 });
assert.equal(haloGame?.title, 'Halo: Campaign Evolved');
assert.notEqual(haloGame?.title, 'Halo Studios');

const danchi = {
  titleEn: "Danchi Days, out this October, brings the Hamtaro: Ham-Ham Heartbreak vibes I've been desperately craving since childhood",
  summaryEn: 'The new life-sim Danchi Days is due in October and takes inspiration from Hamtaro: Ham-Ham Heartbreak.',
  primaryUrl: 'https://www.rockpapershotgun.com/danchi-days-out-this-october-brings-the-hamtaro-ham-ham-heartbreak-vibes',
  publicEligible: true,
  games: []
};
const danchiGame = await semantic(danchi, { game_title: 'Danchi Days', relation: 'primary_game', confidence: 0.98 });
assert.equal(danchiGame?.title, 'Danchi Days', 'Comparison games must not replace the article subject.');

const vholume = {
  titleEn: "The indie parkour game from one of the French brothers behind 2024's best FPS is coming out in just two weeks",
  summaryEn: "Mirror's Edge, Hot Lava, and surf map enjoyers may want to keep an eye on Vholume.",
  primaryUrl: 'https://www.pcgamer.com/games/action/the-indie-parkour-game-from-one-of-the-french-brothers-behind-2024s-best-fps-is-coming-out-in-just-two-weeks/',
  publicEligible: true,
  games: []
};
const vholumeGame = await semantic(vholume, { game_title: 'Vholume', relation: 'primary_game', confidence: 0.93 });
assert.equal(vholumeGame?.title, 'Vholume', 'A game named only in the supplied summary can still be resolved semantically.');

const death = {
  titleEn: 'How a Bucket Full of Pink Cow Dung Became an Item in The Immortal John Triptych',
  summaryEn: "I'm making a house interior for my Renaissance-paintings-come-to-life style adventure game, Death of the Reprobate (one of three titles in The Immortal John Triptych).",
  primaryUrl: 'https://news.xbox.com/en-us/2026/07/31/how-a-bucket-full-of-pink-cow-dung-became-an-item-in-the-immortal-john-triptych/',
  publicEligible: true,
  games: []
};
const deathGame = await semantic(death, { game_title: 'Death of the Reprobate', relation: 'primary_game', confidence: 0.96 });
assert.equal(deathGame?.title, 'Death of the Reprobate', 'A collection/series mentioned in the headline must not replace the specific game named in the article context.');

const controlItem = {
  titleEn: 'Developers improve control settings for console players',
  summaryEn: 'The update changes controller sensitivity and accessibility.',
  primaryUrl: 'https://example.com/control-settings-update',
  publicEligible: true,
  games: []
};
assert.equal(await semantic(controlItem, { game_title: null, relation: 'ambiguous', confidence: 0.99 }), null, 'Generic prose containing control must not become #Control.');

const ungrounded = {
  titleEn: 'A publisher announces its autumn plans',
  summaryEn: 'Several projects will arrive later this year.',
  primaryUrl: 'https://example.com/autumn-plans',
  publicEligible: true,
  games: []
};
assert.equal(await semantic(ungrounded, { game_title: 'Elden Ring', relation: 'primary_game', confidence: 0.99 }), null, 'Even the semantic resolver may not invent a game that is absent from the supplied article context.');

console.log('News semantic primary-game resolver tests passed.');
