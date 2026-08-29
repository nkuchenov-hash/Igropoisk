import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { editorializeNewsSummary } from './lib/news-editorial-summary.mjs';
import { validateProductionNews } from './lib/news-editor-production.mjs';

const rejectTitles = [
  'Saw: Genesis has a gnarly vision for asymmetrical multiplayer games, but the execution needs work – pun intended',
  'It’s Time I Let Go Of My Favorite Alien Isolation 2 Theory',
  'Turn-Based-Tactics Fans Are Suddenly Eating Very Well',
  'I have modded many dogs, several cows, 2 lions, and a chimpanzee into Grand Theft Auto 5, and they are all my friends',
  'Every GTA 6 song confirmed so far',
  'Game of the Week – Star Wars Zero Company has stolen my strategy-loving heart',
  'What Console Should You Buy for GTA 6? We Break Down PS5 vs. Xbox Pricing, Deals, and More',
  'Pokémon is coming to Disney as The Misadventures of Sirfetch’d & Pichu debuts on Disney+',
  'Блогер Антон Логвинов жестко раскритиковал скептиков DLSS 5 на фоне утечки технологии и первых модификаций',
  'Никаких микротранзакций в раннем доступе: как WARDOGS бросает вызов жадности Activision и EA',
  'Кадр из SPINE стал популярным мемом: разработчики пояснили, что это отсылка к "Джону Уику", а не то, что вы подумали',
  'Crymelight станет самой эмоциональной игрой серии Cry',
  'Стартовала публичная бета Call of Duty: Modern Warfare 4 — возможно, худшей части франшизы',
  'Насмотрелись "Одиссеи" Нолана? В Resonance: A Plague Tale Legacy греки стали африканцами, а мужчины-герои - женщинами',
  'Были демоны, но они самоликвидировались: история серии Onimusha',
  'Наконец-то живой геймплей State of Decay 3'
];
for (const title of rejectTitles) {
  assert.equal(isLikelyNewsContent({ title, summary: 'A gaming article.', url: 'https://example.test/article' }), false, title);
}

const rejectItems = [
  {
    title: 'Debian Linux developers vote to allow Responsible Use of Generative AI',
    summary: 'Debian developers voted on generative AI use in software development.'
  },
  {
    title: 'ASUS выпускает обновления BIOS для AM4 и AM5, устраняющие критические уязвимости TPM AMD',
    summary: 'Обновление прошивки закрывает уязвимости CVE-2026-6726 и CVE-2026-6727.'
  },
  {
    title: "Marvel Star's Forgotten 100-Minute Action Thriller Is About to Disappear From Streaming",
    summary: 'The film Legion is leaving Netflix.'
  },
  {
    title: 'Разработчики Expedition: Into Darkness выпустили видео про крафт и снаряжение',
    summary: 'Авторы выпустили новый обучающий ролик и подробно разобрали систему крафта в игре.'
  },
  {
    title: 'Столкнулся с кражей ноутбуков — разработчик игры Mimic сообщил о потере оборудования на Gamescom',
    summary: 'Разработчик сообщил, что его и других разработчиков похитили ноутбуки на Gamescom.'
  },
  {
    title: 'Valve выпустила SteamOS 3.9 для Steam Deck',
    summary: 'Обновление переводит ядро Linux до версии 7. 2 и KDE Plasma с 6.'
  },
  {
    title: 'Facepunch обновил дорожную карту Rust',
    summary: 'Rust Premium доступна игрокам, собравшим более $15 товаров.'
  }
];
for (const item of rejectItems) {
  assert.equal(isLikelyNewsContent({ ...item, url: 'https://example.test/news' }), false, item.title);
}

const acceptItems = [
  ['EA Motive’s Iron Man Game Trailer Seemingly Leaked With Early Look at Gameplay', 'Gameplay footage from what appears to be EA Motive Studio’s Iron Man game has leaked online.'],
  ['Rockstar says GTA 6 runs at 30 FPS', 'Rockstar confirmed the current console frame rate target for GTA 6.'],
  ['Авторы Project ZETA объявили второе глобальное тестирование', 'Публичный плейтест в Steam пройдёт в сентябре.'],
  ['Direct3D 8/9/10/11 to Vulkan translation layer DXVK 3.1 brings improvements for game launchers, older Frostbite engine and more', 'DXVK 3.1 improves game launchers and older Frostbite games.']
];
for (const [title, summary] of acceptItems) {
  assert.equal(isLikelyNewsContent({ title, summary, url: 'https://example.test/news' }), true, title);
}

const decimalSummary = editorializeNewsSummary(
  'Разработчики продолжают улучшать систему материалов. С выходом обновления 1.61 технология станет доступна ещё на трёх грузовиках. SteamOS обновляет ядро Linux до версии 7.2 и KDE Plasma с 6.4.3 до 6.7.3.',
  { title: 'Обновление симулятора и SteamOS' }
);
assert.match(decimalSummary, /1\.61/);
assert.match(decimalSummary, /7\.2/);
assert.match(decimalSummary, /6\.4\.3/);
assert.doesNotMatch(decimalSummary, /1\.\s+61|7\.\s+2|6\.\s+4/);

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

for (const [titleRu, briefRu] of [
  ['В сети появился трейлер', 'В сети появился трейлер неофициального видеоигры Iron Man. Разработчики публикацию пока не комментировали.'],
  ['Bethesda обсуждает The Elder Scrolls 6', 'Каждый платформа нуждается в эксклюзивных контентах. Microsoft пока не уточнила статус релиза The Elder Scrolls 6.'],
  ['DXVK 3.1 обновился', 'DXVK 3.1 улучшает работу игровых запускаторов и старых версий Frostbite. Обновление ориентировано на совместимость игр в Linux.']
]) {
  const result = validateProductionNews({ titleRu, briefRu }, { title: 'Game news', summary: 'A game-related source summary.' });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('awkward machine-like Russian'), result.reasons.join('; '));
}

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
