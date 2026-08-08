import assert from 'node:assert/strict';
import { refineNewsPrimaryGame } from './lib/news-primary-game-refiner.mjs';

const contextGame = title => ({ title, matchedBy: 'context-evidence-resolver', pageExists: false, pageUrl: '' });
const detect = (item, proposed = null) => refineNewsPrimaryGame({ publicEligible: true, games: [], ...item }, proposed)?.title || null;

assert.equal(detect({
  titleEn: 'THQ Nordic says it has 12 unannounced games in development',
  summaryEn: 'The publisher says it currently has 29 games in the works, but has only revealed 17 of them',
  primaryUrl: 'https://www.videogameschronicle.com/news/thq-nordic-says-it-has-12-unannounced-games-in-development/'
}), null);

assert.equal(detect({
  titleEn: 'Keep Your Cemetery Running (and the Zombies Out) in Zombie Graveyard Simulator',
  summaryEn: 'If you’re just starting your journey in Zombie Graveyard Simulator, here’s our first piece of advice. We’re excited that you can jump into Zombie Graveyard Simulator today. The post Keep Your Cemetery Running appeared first on',
  primaryUrl: 'https://news.xbox.com/en-us/2026/08/03/keep-your-cemetery-running-and-the-zombies-out/'
}, contextGame('Keep Your Cemetery Running')), 'Zombie Graveyard Simulator');

assert.equal(detect({
  titleEn: 'How to Smash, Slash, and Shoot Your Way to Victory in Kusan: City of Wolves',
  summaryEn: 'Our first game – the high-octane hardcore top-down shooter, Kusan: City of Wolves. You play as Jin in Kusan: City of Wolves. The post How to Smash appeared first on',
  primaryUrl: 'https://news.xbox.com/en-us/2026/07/31/how-to-smash-slash-and-shoot-your-way-to-victory/'
}, contextGame('How to Smash')), 'Kusan: City of Wolves');

assert.equal(detect({
  titleEn: 'Indie Selects for August 2026: Adventure is Calling This Summer',
  summaryEn: 'Every Wednesday, dive into the Indie Select Hub — your gateway to a fresh, curated indie collection. The post Indie Selects for August 2026: Adventure is Calling This Summer appeared first on',
  primaryUrl: 'https://news.xbox.com/en-us/2026/08/05/indie-selects-august/'
}, contextGame('Indie Selects for August 2026: Adventure')), null);

assert.equal(detect({
  titleEn: 'Available for XBOX Insiders: More Control Over Captures, Saves, and Wishlists',
  summaryEn: 'Starting today, XBOX Insiders can try out new XBOX console updates. The post Available for XBOX Insiders: More Control Over Captures appeared first on',
  primaryUrl: 'https://news.xbox.com/en-us/2026/08/05/xbox-insiders-october-2026-console-features/'
}, contextGame('Available for XBOX Insiders: More Control Over Captures')), null);

assert.equal(detect({
  titleEn: "Danchi Days, out this October, brings the Hamtaro: Ham-Ham Heartbreak vibes I've been desperately craving since childhood",
  summaryEn: 'I think about Hamtaro: Ham-Ham Heartbreak, a GBA game, probably more than I should.',
  primaryUrl: 'https://www.rockpapershotgun.com/danchi-days-out-this-october-brings-the-hamtaro-ham-ham-heartbreak-vibes-ive-been-desperately-craving-since-childhood'
}, contextGame('Danchi Days')), 'Danchi Days');

assert.equal(detect({
  titleEn: "Marvel Tokon's Roster Should Add These 10 Characters You Forgot About",
  summaryEn: 'Marvel Tokon Fighting Souls will add more playable characters as future DLC.',
  primaryUrl: 'https://www.polygon.com/marvel-tokon-fighting-souls-dlc-characters-wishlist/'
}, contextGame('Marvel Tokon')), 'Marvel Tokon Fighting Souls');

assert.equal(detect({
  titleEn: 'The indie parkour game from one of the French brothers behind 2024’s best FPS is coming out in just two weeks',
  summaryEn: "Mirror's Edge, Hot Lava, and surf map enjoyers may want to keep an eye on Vholume.",
  primaryUrl: 'https://www.pcgamer.com/games/action/the-indie-parkour-game-from-one-of-the-french-brothers-behind-2024s-best-fps-is-coming-out-in-just-two-weeks/'
}), 'Vholume');

assert.equal(detect({
  titleEn: 'The release date for the horror shooter Milo in Steam Early Access is set for October 29, 2026',
  summaryEn: 'The developer has officially set the release date for the cooperative horror shooter Milo in Steam Early Access.',
  primaryUrl: 'https://www.playground.ru/milo/news/data_vyhoda_horror_shutera_milo_v_rannem_dostupe_steam-1865332'
}), 'Milo');

assert.equal(detect({
  titleEn: 'Halo Studios hit by layoffs after release of Halo: Campaign Evolved',
  summaryEn: 'Recent job cuts at Halo Studios affect contract workers after the release.',
  primaryUrl: 'https://www.eurogamer.net/halo-studios-layoffs-campaign-evolved'
}), 'Halo: Campaign Evolved');

assert.equal(detect({
  titleEn: 'How a Bucket Full of Pink Cow Dung Became an Item in The Immortal John Triptych',
  summaryEn: 'I’m making a house interior for my Renaissance-paintings-come-to-life style adventure game, Death of the Reprobate (one of three titles in The Immortal John Triptych).',
  primaryUrl: 'https://news.xbox.com/en-us/2026/07/31/how-a-bucket-full-of-pink-cow-dung-became-an-item-in-the-immortal-john-triptych/'
}), 'Death of the Reprobate');

assert.equal(detect({
  titleEn: 'Ball x Pit final update The Naturalist arrives August 6',
  summaryEn: 'I’m back to share what to expect in the latest and final, free Ball x Pit update. Titled The Naturalist Update, players can expect more.',
  primaryUrl: 'https://blog.playstation.com/2026/07/28/ball-x-pit-final-update-the-naturalist-arrives-august-6/'
}, contextGame('Ball x Pit')), 'Ball x Pit');

assert.equal(detect({
  titleEn: 'Flamecraft is coming to PS5 this year, demo available today',
  summaryEn: 'Flamecraft is coming to PlayStation 5 later this year. In the meantime, see what awaits you in Flamecraft.',
  primaryUrl: 'https://blog.playstation.com/2026/07/28/flamecraft-is-coming-to-ps5-this-year-demo-available-today/'
}), 'Flamecraft');

assert.equal(detect({
  titleEn: 'Magic Designer Wants to Resurrect a Forgotten Card That Tells a Perfect Miniature Horror Story',
  summaryEn: 'One Magic designer hopes the forgotten card rises again. Vengeful Pharaoh tells a mummy story through its mechanics.',
  primaryUrl: 'https://www.polygon.com/mtg-vengeful-pharaoh-card-mummy-horror-story-magic-2012/'
}), null);

console.log('News primary-game hashtag refinement regressions passed.');
