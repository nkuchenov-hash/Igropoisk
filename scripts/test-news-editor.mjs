import assert from 'node:assert/strict';
import { extractArticleText, normalizeEditorialNames } from './lib/news-editor-qwen.mjs';
import { isLikelyNewsSource, validateProductionNews } from './lib/news-editor-production.mjs';

assert.equal(normalizeEditorialNames('Убисофт вернула автора в команду'), 'Ubisoft вернула автора в команду');
assert.equal(normalizeEditorialNames('Стим и Иксбокс получили обновление'), 'Steam и Xbox получили обновление');
assert.equal(normalizeEditorialNames('Конами хочет выпускать Silent Hill ежегодно'), 'Konami хочет выпускать Silent Hill ежегодно');
assert.equal(normalizeEditorialNames('Mihoyo рассказала о новой игре'), 'miHoYo рассказала о новой игре');

assert.equal(isLikelyNewsSource({ title: 'How to catch and kill Fish Tuna' }), false);
assert.equal(isLikelyNewsSource({ title: 'The Sinking City 2: How to open the salt storage lock' }), false);
assert.equal(isLikelyNewsSource({ title: "The Witcher 3 Remastered: Here’s How to Upgrade" }), false);
assert.equal(isLikelyNewsSource({ title: 'The 10 best Metal Gear games of all time' }), false);
assert.equal(isLikelyNewsSource({ title: 'How NVIDIA plans to change its gaming business' }), true);
assert.equal(isLikelyNewsSource({ title: 'Konami wants annual Silent Hill games and is working on many unannounced projects' }), true);

const clean = validateProductionNews({
  titleRu: 'EA может сократить сотрудников после роста долговой нагрузки',
  briefRu: 'EA планирует сократить ежегодные расходы на 700 миллионов долларов, включая организационные издержки. Компания ожидает значительные процентные платежи после сделки, поэтому аналитики допускают новые сокращения персонала.'
}, {
  title: "Mass layoffs may be in EA's near future after leveraged buyout raises company debt"
});
assert.equal(clean.ok, true, clean.reasons.join('; '));

const repeated = validateProductionNews({
  titleRu: 'EA готовит сокращения после кризиса после сделки',
  briefRu: 'Компания планирует сократить расходы на сотни миллионов долларов в год. Изменения могут затронуть сотрудников, хотя точный масштаб сокращений пока не подтвержден.'
}, { title: 'EA layoffs after buyout' });
assert.equal(repeated.ok, false);
assert.ok(repeated.reasons.includes('repeated connector in title'));

const literal = validateProductionNews({
  titleRu: 'Wolfenstein 2009 может вернуться после исключения из списка',
  briefRu: 'Страница Wolfenstein 2009 в Steam неожиданно изменилась спустя много лет. Фанаты связывают обновление с возможным ремастером, но официального подтверждения пока нет.'
}, { title: 'Wolfenstein 2009 could return after being delisted from Steam' });
assert.equal(literal.ok, false);
assert.ok(literal.reasons.includes('literal machine translation'));

const englishTail = validateProductionNews({
  titleRu: "Final Fantasy 7 может получить более взрослый рейтинг, and I'm betting Cid's swearing has something to do with it",
  briefRu: 'Следующая часть проекта может получить более высокий возрастной рейтинг, чем предыдущие игры. Окончательное решение рейтинговой комиссии пока не объявлено.'
}, { title: "Final Fantasy 7 may get a more mature rating, and I'm betting Cid's swearing has something to do with it" });
assert.equal(englishTail.ok, false);
assert.ok(englishTail.reasons.includes('untranslated English clause') || englishTail.reasons.includes('source-author commentary leaked'));

const mixedScript = validateProductionNews({
  titleRu: 'В Total War погибших бойцов можно помещать в Dreadноуты',
  briefRu: 'Механика позволяет использовать павших бойцов в тяжёлых боевых машинах. Разработчики показали её в новой демонстрации игры.'
}, { title: 'Total War lets dead Space Marines become Dreadnoughts' });
assert.equal(mixedScript.ok, false);
assert.ok(mixedScript.reasons.includes('mixed Latin/Cyrillic token'));

const contractionHeadline = validateProductionNews({
  titleRu: 'Разработчики Stalker 2 готовят мультиплеер без коротких сессионных матчей',
  briefRu: 'Команда работает над многопользовательским режимом для Stalker 2 и не планирует строить его по схеме коротких матчей. Подробности режима разработчики обещают раскрыть позднее.'
}, { title: '"We\'re not doing something that everyone would do": After Cost of Hope, Stalker 2 devs are working on multiplayer' });
assert.equal(contractionHeadline.ok, true, contractionHeadline.reasons.join('; '));

const genericTitleCase = validateProductionNews({
  titleRu: 'Участники Xbox Insider получили новые настройки для записей и сохранений',
  briefRu: 'В тестовой версии Xbox появились дополнительные элементы управления записями, сохранениями и списками желаемого. Функции пока доступны участникам программы предварительного тестирования.'
}, { title: 'Available for XBOX Insiders: More Control Over Captures, Saves, and Wishlists' });
assert.equal(genericTitleCase.ok, true, genericTitleCase.reasons.join('; '));

const missingStableEntity = validateProductionNews({
  titleRu: 'Издатель хочет выпускать новую Silent Hill каждый год',
  briefRu: 'Компания рассчитывает ускорить выпуск игр серии и параллельно ведёт несколько неанонсированных проектов. Конкретные даты следующих релизов пока не названы.'
}, { title: 'Konami wants annual Silent Hill games and is working on many unannounced projects' });
assert.equal(missingStableEntity.ok, false);
assert.ok(missingStableEntity.reasons.includes('stable entity missing: Konami'));

const unrelatedArticleChrome = validateProductionNews({
  titleRu: 'The Witcher 3 Remastered получит модификации сообщества',
  briefRu: 'Разработчики рассказали, что ремастер The Witcher 3 включает часть созданных сообществом модификаций. Один из авторов модов также поделился опытом работы над обновлённой версией игры.'
}, {
  title: 'The Witcher 3 Remastered features community-made mods',
  summary: 'A modder explains how community work became part of the remaster.',
  articleText: 'Related stories: Xbox at Gamescom. PlayStation announcements. Ubisoft showcase. CD Projekt Red interview.'
});
assert.equal(unrelatedArticleChrome.ok, true, unrelatedArticleChrome.reasons.join('; '));

const html = `<html><body><article>
<p>When you buy through links on our site, we may earn an affiliate commission.</p>
<p>Ubisoft has appointed a veteran developer to a senior role on the Assassin's Creed series.</p>
<p>The developer previously worked on Black Flag and Valhalla before leaving the company.</p>
<p>The move is part of a wider attempt to stabilize future Assassin's Creed projects.</p>
</article></body></html>`;
const extracted = extractArticleText(html, "Ubisoft Assassin's Creed veteran");
assert.ok(extracted.includes('Ubisoft has appointed'));
assert.ok(!extracted.includes('affiliate commission'));

console.log('News editor production regression tests passed.');
