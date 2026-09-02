import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { sanitizeCommercialNewsCopy, commercialNewsCopyIssues } from './lib/news-commercial-copy.mjs';
import { isSameNewsStory } from './lib/news-home-selector.mjs';
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
  },
  {
    title: 'Вышел новый трейлер экранизации Street Fighter — фильм выйдет 16 октября',
    summary: 'Paramount Pictures выпустила новый трейлер экранизации Street Fighter. В прокат фильм выходит 16 октября.',
    url: 'https://vgtimes.ru/movies-and-tv-series/street-fighter.html'
  },
  {
    title: 'Косплей на Ми Фу из Arknights: Endfield от Oichi — 5 фото',
    summary: 'Косплеерша представила новый фотосет в образе персонажа игры.',
    url: 'https://vgtimes.ru/cosplay/arknights-endfield.html'
  },
  {
    title: 'Новый 750-Вт блок питания взорвался при первом подключении из коробки',
    summary: 'Блок питания вышел из строя при подключении: произошли вспышка, искры и появилось пламя.',
    url: 'https://www.playground.ru/misc/news/power-supply.html'
  },
  {
    title: 'Новая система ChatGPT ASTRA нашла и использовала две zero-day уязвимости в тестах',
    summary: 'Система OpenAI автономно обнаружила уязвимости безопасности и подготовила программные эксплойты.',
    url: 'https://vgtimes.ru/news/145107-novaya-sistema-chatgpt-astra-nashla-i-ispolzovala-dve-zero-day-uyazvimosti-v-testah.html'
  }
]) {
  assert.equal(isLikelyNewsContent(item), false, `must reject non-news homepage material: ${item.title}`);
}

assert.equal(isLikelyNewsContent({
  title: 'Valve улучшила ИИ ботов в новом патче Deadlock',
  summary: 'Обновление игры уже доступно в Steam и меняет поведение ботов в матчах.',
  url: 'https://example.test/news/deadlock-bot-ai-patch'
}), true, 'AI terminology must remain allowed when the article has explicit video-game context');

const doomGame = { title: 'doom-the-dark-ages', slug: 'doom-the-dark-ages', gameId: 'game_doom_dark_ages' };
assert.equal(isSameNewsStory({
  titleRu: 'Экс-продюсер DOOM: авторы DLC для The Dark Ages столкнулись с беспрецедентными кранчами',
  games: [doomGame]
}, {
  titleRu: 'Бывший продюсер id Software рассказал о жестком кризисе при создании DLC для Doom',
  games: [doomGame]
}), true, 'same DOOM DLC crunch report from two publishers must dedupe');

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

const witcherRuItem = {
  titleRu: '12 минут геймплея из DLC «Баллады прошлого» для «Ведьмака 3»',
  summaryRu: 'Дополнение предназначено для The Witcher 3: Wild Hunt.',
  url: 'https://stopgame.ru/newsdata/72692/12_minut_geympleya_iz_dlc_ballady_proshlogo_dlya_vedmaka_3'
};
assert.equal(canonicalGameIsPrimary(witcherRuItem, { title: 'The Witcher 3: Wild Hunt', slug: 'the-witcher-3-wild-hunt' }), true, 'translated declined headline plus canonical numbered title in summary must resolve the same game');

const dirtyFable = 'Амбициозная Fable не станет игрой на сотни сотни часов. По словам разработчиков, сюжет займёт 15&minus;20 часов.';
const cleanFable = sanitizeCommercialNewsCopy(dirtyFable);
assert.equal(cleanFable, 'Амбициозная Fable не станет игрой на сотни часов. По словам разработчиков, сюжет займёт 15−20 часов.');
assert.deepEqual(commercialNewsCopyIssues(cleanFable), []);

const dirtyWitcher = 'Игроки увидели демоверсию «Баллад прошлого » — дополнения для The Witcher 3.';
assert.equal(sanitizeCommercialNewsCopy(dirtyWitcher), 'Игроки увидели демоверсию «Баллад прошлого» — дополнения для The Witcher 3.');

const brokenRequirements = 'Разработчики раскрыли требования. Для комфортного прохождения компьютеры должны соответствовать следующим характеристикам: Релиз Fable намечен на 23 февраля 2027-го.';
assert.equal(sanitizeCommercialNewsCopy(brokenRequirements), 'Разработчики раскрыли требования. Релиз Fable намечен на 23 февраля 2027-го.');

const duplicatedInflection = 'Проект выделяется процедурно генерируемыми подземельямии глубокой системой кастомизации.';
assert.equal(sanitizeCommercialNewsCopy(duplicatedInflection), 'Проект выделяется процедурно генерируемыми подземельями глубокой системой кастомизации.');

const truncatedAcronym = 'Новинка объединяет черты культовых игр вроде S. Проект выделяется пиксельной графикой.';
assert.ok(commercialNewsCopyIssues(truncatedAcronym).includes('truncated-dotted-game-acronym'));

const clickbaitPreorder = 'Видимо, дела совсем плохо: Microsoft вернет вам 5 баксов, если вы предзакажете Call of Duty: Modern Warfare 4 на Xbox';
assert.equal(sanitizeCommercialNewsCopy(clickbaitPreorder), 'Microsoft вернёт 5 долларов за предзаказ Call of Duty: Modern Warfare 4 на Xbox');
assert.deepEqual(commercialNewsCopyIssues(sanitizeCommercialNewsCopy(clickbaitPreorder)), []);

assert.equal(sanitizeCommercialNewsCopy('Поэтому игра выйдет из раннего доступа не в октябре, а в марте 2027-го.'), 'Игра выйдет из раннего доступа не в октябре, а в марте 2027-го.');
assert.equal(sanitizeCommercialNewsCopy('Dune: Awakening больше не заставляет тратить 100 часов - разработчики дают игрокам контроль'), 'Dune: Awakening больше не заставляет тратить 100 часов — разработчики дают игрокам контроль');

console.log('Final commercial news regressions passed.');
