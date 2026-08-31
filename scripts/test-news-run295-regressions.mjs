import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';

const filmLeak = {
  title: 'Блестящий хирург берётся за невозможное в трейлере драмы «Особый пациент»',
  summary: 'Кинокомпания выпустила дебютный трейлер и постер драмы. Главные роли исполнили известные актёры, широкий прокат ленты стартует 1 октября.',
  url: 'https://kanobu.ru/news/example/'
};
assert.equal(isLikelyNewsContent(filmLeak), false, 'Mixed entertainment feeds must never leak film stories into the game-news homepage.');

const machineBoilerplate = {
  title: 'Моделирование эволюции с открытыми исходными кодами',
  summary: 'Вся эволюция имеет новый релиз, который привносит новые игровые механики. Прочтите полную статью о GamingOnLinux.',
  url: 'https://gamingonlinux.com/example/'
};
assert.equal(isLikelyNewsContent(machineBoilerplate), false, 'Machine-translated publisher boilerplate must never be accepted as editorial copy.');

console.log('Run #295 film-leak and machine-copy regressions passed.');
