import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { canonicalGameIsPrimary } from './lib/news-primary-game-evidence.mjs';

for (const item of [
  {
    title: 'Разработчики Valor Mortis — о геймплее, источниках вдохновения и основном посыле игры: интервью VGTimes на gamescom 2026',
    summary: 'Авторы игры ответили на вопросы редакции.',
    url: 'https://vgtimes.ru/articles/interview-valor-mortis.html'
  },
  {
    title: '«Отправная точка для чего-то большего» — пресса оценила The Blood of Dawnwalker',
    summary: 'Критики поделились впечатлениями и оценками новой RPG.',
    url: 'https://stopgame.ru/news/blood-of-dawnwalker-press'
  },
  {
    title: 'Отличная RPG, которая могла стать великой: критики вынесли вердикт The Blood of Dawnwalker',
    summary: 'Издания опубликовали рецензии и оценки игры.',
    url: 'https://3dnews.ru/blood-of-dawnwalker-verdict'
  },
  {
    title: '«Ведьмы Маэбаси» отправятся на большой экран 23 октября',
    summary: 'Полнометражное аниме выйдет в кинотеатрах; опубликованы трейлер и постер.',
    url: 'https://kanobu.ru/news/maebashi-witches-anime-film'
  }
]) {
  assert.equal(isLikelyNewsContent(item), false, `must reject non-news homepage material: ${item.title}`);
}

const hauntedItem = {
  title: '«Качество превыше скорости» — ConcernedApe о разработке Haunted Chocolatier',
  summary: 'Автор Stardew Valley продолжает работу над новой игрой Haunted Chocolatier.',
  url: 'https://stopgame.ru/news/haunted-chocolatier-quality-over-speed'
};
assert.equal(canonicalGameIsPrimary(hauntedItem, { title: 'stardew-valley', slug: 'stardew-valley' }), false, 'secondary Stardew Valley mention must not own Haunted Chocolatier news');
assert.equal(canonicalGameIsPrimary(hauntedItem, { title: 'Haunted Chocolatier', slug: 'haunted-chocolatier' }), true, 'headline game must be accepted');

const gtaItem = {
  title: 'Take-Two отчиталась о «бурном развитии» расследования по поиску виновника утечек GTA VI',
  summary: 'Расследование утечки материалов GTA VI продолжается.',
  url: 'https://example.test/news/gta-vi-leak-investigation'
};
assert.equal(canonicalGameIsPrimary(gtaItem, { title: 'grand-theft-auto-vi', slug: 'grand-theft-auto-vi' }), true, 'canonical Grand Theft Auto VI must recognize GTA VI headline abbreviation');

const dawnwalkerItem = {
  title: 'Критики вынесли вердикт The Blood of Dawnwalker',
  summary: 'В материале также сравнивают игру с Cyberpunk 2077 и The Witcher 3.',
  url: 'https://example.test/blood-of-dawnwalker'
};
assert.equal(canonicalGameIsPrimary(dawnwalkerItem, { title: 'the-blood-of-dawnwalker', slug: 'the-blood-of-dawnwalker' }), true);
assert.equal(canonicalGameIsPrimary(dawnwalkerItem, { title: 'cyberpunk-2077', slug: 'cyberpunk-2077' }), false, 'comparison game in summary must not become primary');
assert.equal(canonicalGameIsPrimary(dawnwalkerItem, { title: 'the-witcher-3-wild-hunt', slug: 'the-witcher-3-wild-hunt' }), false, 'comparison game in summary must not become primary');

console.log('Final commercial news regressions passed.');
