import assert from 'node:assert/strict';
import { isLikelyNewsContent } from './lib/news-content-policy.mjs';
import { validateProductionNews } from './lib/news-editor-production.mjs';

const rejectedLocalizedCards = [
  {
    title: '91,8% игроков MGS4 на ПК первым делом оторвали интимную часть статуи - достижение стало хитом после релиза',
    summary: '91,8% игроков уже успели получить достижение, связанное с отрыванием у статуи её «самой важной части». Достижение можно получить в одной из сцен Metal Gear Solid 4.'
  },
  {
    title: 'Пиратские гавани и королевская угроза: Градострой Corsair Cove получит крупное обновление Armada',
    summary: 'Авторы поблагодарили игровое сообщество за успешный запуск проекта. Игра бросает вызов любителям стратегий, предлагая строить без жёстких ограничений.'
  },
  {
    title: 'В The Long Dark развернули фокус на выживание, а не на сиквел Blackfrost',
    summary: 'Разработчики Hinterland сместили приоритеты в сторону улучшения режима выживания The Long Dark. Теперь основной акцент — на контенте из пятой эпизода Wintermute.'
  },
  {
    title: 'Mortal Shell 2 получил первый полноценный обновление',
    summary: 'В Mortal Shell 2 выпущен первый полноценный патч. Добавлены новые предметы, а также улучшены показатели уронов при отражении.'
  },
  {
    title: 'Наркотрафик и черный рынок в Ламанге: как обновление 0.5 превратит Gray Zone Warfare в настоящий симулятор криминала',
    summary: 'Грядущее обновление 0.5 обещает стать поворотным моментом для всей игры. Это отличные новости для поклонников тактических шутеров!'
  },
  {
    title: 'The Witcher 4 выйдет в физической версии даже без диск-поддержки PlayStation',
    summary: 'CD Projekt Red подтвердил, что The Witcher 4 будет выпускаться в физической версии с коробкой для коллекционеров. Команда не контролирует решения Sony.'
  },
  {
    title: 'JRPG с GACHA Atelier Resleriana официально все — японская версия тоже закроется уже 25 ноября',
    summary: 'Koei Tecmo и Gust объявили о закрытии японских серверов Atelier Resleriana 25 ноября 2026 года.'
  },
  {
    title: 'После анонса GTA VI из американской розницы исчезли Sony PlayStation 5 Pro, а спекулянты взвинтили цены',
    summary: 'После официальной демонстрации геймплея GTA VI на Netflix в США возникли сложности с наличием PS5 Pro.'
  }
];

for (const card of rejectedLocalizedCards) {
  assert.equal(
    isLikelyNewsContent({ ...card, url: 'https://example.test/news' }),
    false,
    `run #287 regression escaped policy: ${card.title}`
  );
}

for (const bad of [
  ['Mortal Shell 2 получил первый полноценный обновление', 'В Mortal Shell 2 выпущен первый полноценный патч. Добавлены предметы и улучшены показатели уронов при отражении.'],
  ['The Witcher 4 выйдет в коробке', 'CD Projekt Red готовит физическое издание The Witcher 4 даже без диск-поддержки PlayStation. Точная дата пока не объявлена.'],
  ['The Long Dark меняет приоритеты', 'Hinterland сосредоточилась на The Long Dark и добавит материалы из пятой эпизода Wintermute. Blackfrost продолжает разрабатываться.']
]) {
  const result = validateProductionNews(
    { titleRu: bad[0], briefRu: bad[1] },
    { title: 'Game update news', summary: 'The source reports a game update and development plans.' }
  );
  assert.equal(result.ok, false, `production validator accepted run #287 grammar: ${bad[0]} :: ${result.reasons.join('; ')}`);
}

console.log('Run #287 commercial-copy regressions passed.');
