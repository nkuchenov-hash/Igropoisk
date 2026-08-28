import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { validateProductionNews } from './lib/news-editor-production.mjs';
import { promoteBalancedSelection } from './preserve-news-history.mjs';

const rejectTitles = [
  'Saw: Genesis has a gnarly vision for asymmetrical multiplayer games, but the execution needs work – pun intended',
  'It’s Time I Let Go Of My Favorite Alien Isolation 2 Theory',
  'Turn-Based-Tactics Fans Are Suddenly Eating Very Well',
  'I have modded many dogs, several cows, 2 lions, and a chimpanzee into Grand Theft Auto 5, and they are all my friends',
  'Every GTA 6 song confirmed so far',
  'Game of the Week – Star Wars Zero Company has stolen my strategy-loving heart',
  'What Console Should You Buy for GTA 6? We Break Down PS5 vs. Xbox Pricing, Deals, and More',
  'Pokémon is coming to Disney as The Misadventures of Sirfetch’d & Pichu debuts on Disney+'
];
for (const title of rejectTitles) {
  assert.equal(isLikelyNewsContent({ title, summary: 'A gaming article.', url: 'https://example.test/article' }), false, title);
}

const acceptItems = [
  ['EA Motive’s Iron Man Game Trailer Seemingly Leaked With Early Look at Gameplay', 'Gameplay footage from what appears to be EA Motive Studio’s Iron Man game has leaked online.'],
  ['Rockstar says GTA 6 runs at 30 FPS', 'Rockstar confirmed the current console frame rate target for GTA 6.'],
  ['Авторы Project ZETA объявили второе глобальное тестирование', 'Публичный плейтест в Steam пройдёт в сентябре.']
];
for (const [title, summary] of acceptItems) {
  assert.equal(isLikelyNewsContent({ title, summary, url: 'https://example.test/news' }), true, title);
}

const notPromoted = promoteBalancedSelection([
  { id: 'real', publicEligible: true },
  { id: 'low-confidence', publicEligible: false, globalEligible: false }
], 12);
assert.equal(notPromoted[1].publicEligible, false, 'Low-confidence content must never be promoted to public just to fill the homepage.');
assert.notEqual(notPromoted[1].selectionReason, 'editorial-balance-floor');

const viceInput = {
  title: 'GTA 6 Looks Like It Features This Popular TV Show Apartment',
  summary: "GTA 6 takes place in Vice City, which is a stand-in for Miami. Fans noticed that Dexter Morgan's apartment from Dexter appears in the game."
};
const brokenVice = validateProductionNews({
  titleRu: 'В GTA 6 заметили квартиру из сериала Dexter',
  briefRu: 'Действие GTA 6 происходит в городе, который заменяет Майами. Фанаты заметили сходство одного из интерьеров с квартирой Dexter Morgan из сериала Dexter.'
}, viceInput);
assert.equal(brokenVice.ok, false);
assert.ok(brokenVice.reasons.some(reason => reason.includes('Vice City')), brokenVice.reasons.join('; '));

const cleanVice = validateProductionNews({
  titleRu: 'В GTA 6 заметили интерьер, похожий на квартиру Декстера',
  briefRu: 'Действие GTA 6 происходит в Vice City — игровой версии Майами. Фанаты заметили, что один из интерьеров напоминает квартиру Dexter Morgan из сериала Dexter, однако Rockstar не подтверждала намеренную отсылку.'
}, { ...viceInput, articleText: 'Rockstar has not confirmed whether the similarity is intentional.' });
assert.equal(cleanVice.ok, true, cleanVice.reasons.join('; '));

const badGrammar = validateProductionNews({
  titleRu: 'Новая теория появилась вокруг Alien Isolation 2',
  briefRu: 'Автор рассказал о главном герою Alien Isolation 2 и признал, что прежняя теория не подтверждается. Creative Assembly ранее указывала, что персонаж не относится к официальному сюжету.'
}, { title: 'Alien Isolation 2 theory about the protagonist', summary: 'Creative Assembly says the character is not canon.' });
assert.equal(badGrammar.ok, false);
assert.ok(badGrammar.reasons.includes('awkward machine-like Russian'));

const duplicateLead = validateProductionNews({
  titleRu: 'Project ZETA проведёт второй глобальный тест в сентябре',
  briefRu: 'Project ZETA проведёт второй глобальный тест в сентябре. Публичный плейтест в Steam будет доступен игрокам из нескольких регионов.'
}, { title: 'Project ZETA second global test in September', summary: 'The public Steam playtest will be available in several regions.' });
assert.equal(duplicateLead.ok, false);
assert.ok(duplicateLead.reasons.includes('lead repeats headline'));

const unbalancedQuote = validateProductionNews({
  titleRu: 'Актёр отказался участвовать в неофициальной озвучке The Witcher',
  briefRu: 'Всеволод Кузнецов заявил, что не будет участвовать в неофициальной озвучке. Он добавил: «Я не буду участвовать в пиратских версиях озвучки.'
}, { title: 'Всеволод Кузнецов отказался от неофициальной озвучки The Witcher', summary: 'Актёр объяснил свою позицию.' });
assert.equal(unbalancedQuote.ok, false);
assert.ok(unbalancedQuote.reasons.includes('unbalanced quotation marks'));

console.log('Commercial news content and Russian-copy regressions passed.');
