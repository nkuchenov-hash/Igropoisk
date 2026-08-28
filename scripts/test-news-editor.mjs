import assert from 'node:assert/strict';
import { extractArticleText, normalizeEditorialNames } from './lib/news-editor-qwen.mjs';
import { isLikelyNewsSource, validateProductionNews } from './lib/news-editor-production.mjs';
import { NEWS_EDITORIAL_VERSION, editorialSourceHash, hasValidEditorialCache } from './lib/news-editor-policy.mjs';

assert.equal(normalizeEditorialNames('Убисофт вернула автора в команду'), 'Ubisoft вернула автора в команду');
assert.equal(normalizeEditorialNames('Стим и Иксбокс получили обновление'), 'Steam и Xbox получили обновление');
assert.equal(normalizeEditorialNames('Конами хочет выпускать Silent Hill ежегодно'), 'Konami хочет выпускать Silent Hill ежегодно');
assert.equal(normalizeEditorialNames('Mihoyo рассказала о новой игре'), 'miHoYo рассказала о новой игре');

assert.equal(isLikelyNewsSource({ title: 'How to catch and kill Fish Tuna' }), false);
assert.equal(isLikelyNewsSource({ title: 'The 10 best Metal Gear games of all time' }), false);
assert.equal(isLikelyNewsSource({ title: 'Star Wars Zero Company gameplay tips' }), false);
assert.equal(isLikelyNewsSource({ title: 'How NVIDIA plans to change its gaming business' }), true);

const clean = validateProductionNews({
  titleRu: 'EA может сократить сотрудников после роста долговой нагрузки',
  briefRu: 'EA планирует сократить ежегодные расходы на 700 миллионов долларов, включая организационные издержки. Компания ожидает значительные процентные платежи после сделки, поэтому аналитики допускают новые сокращения персонала.'
}, {
  title: "Mass layoffs may be in EA's near future after leveraged buyout raises company debt",
  summary: 'EA told investors that annual costs will be cut by 700 million dollars.'
});
assert.equal(clean.ok, true, clean.reasons.join('; '));

const badCases = [
  {
    titleRu: 'EA может сократить расходы после крупного купли-продажи',
    briefRu: 'Компания планирует снизить расходы после леверед бай-аута. Подробности программы экономии будут объявлены позднее.',
    input: { title: 'EA may cut costs after leveraged buyout' }
  },
  {
    titleRu: 'Удалённая игра Wolfenstein 2009 может получить ремастер',
    briefRu: 'Изменения на странице Steam вызвали спрос на возможный ремастер. Факт подтверждает лишь теорию, официального анонса пока не было.',
    input: { title: 'Wolfenstein 2009 could get a remaster after Steam page changes' }
  },
  {
    titleRu: 'В GTA 6 система поиска преступников будет улучшена',
    briefRu: 'В GTA 6 вернётся система wanted, где полиция отслеживает лицо, одежду и автомобиль героя. Игроки могут снизить уровень внимания, распадаясь на группы и уходя из поля зрения полиции.',
    input: { title: 'GTA 6 wanted system lets police track your face, clothes and car', summary: 'Players can split up to lower police perception.' }
  },
  {
    titleRu: 'Beast of Reincarnation: постапокалипсисное действие с мутантным собаком',
    briefRu: 'Героиня путешествует по разрушенной Японии вместе с мутантным собаком и сражается с чудовищами. Система боя включает парирование, уменьшения метров врагов и специальные навыки.',
    input: { title: 'Beast of Reincarnation is a post-apocalyptic action game with a mutant dog', summary: 'Combat includes parrying and lowering enemy meters.' }
  },
  {
    titleRu: 'Стойте за своим кладбищем: управляйте день и борьбой с зомби',
    briefRu: 'Днём игрок развивает кладбище и распределяет ресурсы, а ночью защищает территорию от зомби. Улучшения позволяют расширять хозяйство и открывать новые возможности.',
    input: { title: 'Run your graveyard by day and fight zombies at night' }
  },
  {
    titleRu: 'Русы против Ящеров 2 вышла на новых платформах',
    briefRu: 'Проект достиг консолей PlayStation и Xbox и получил бесплатное сюжетное дополнение. Разработчики также улучшили управление, освещение и интерфейс.',
    input: { title: 'Lizards Must Die 2 launches on PlayStation and Xbox' }
  },
  {
    titleRu: 'Мать в хаосе: история Дэви в 1998 году',
    briefRu: 'Игра рассказывает о женщине, которая пытается защитить ребёнка во время социальных потрясений в Индонезии. Сюжет опирается на реальные события и экономический кризис 1998 года.',
    input: { title: '1998: The Toll Keeper Story follows a mother during unrest', summary: 'The story is set during the 1998 Indonesian crisis.' }
  }
];
for (const value of badCases) {
  const result = validateProductionNews(value, value.input);
  assert.equal(result.ok, false, `${value.titleRu} unexpectedly passed`);
  assert.ok(result.reasons.includes('awkward machine-like Russian'), `${value.titleRu}: ${result.reasons.join('; ')}`);
}

const truncatedRussian = validateProductionNews({
  titleRu: 'Разработчики показали новый трейлер игры',
  briefRu: 'Студия опубликовала новый трейлер и рассказала о ключевых особенностях проекта... Подробности релиза обещают раскрыть позднее.'
}, { title: 'Разработчики показали новый трейлер игры' });
assert.equal(truncatedRussian.ok, false);
assert.ok(truncatedRussian.reasons.includes('brief looks truncated'));

const inventedNumber = validateProductionNews({
  titleRu: 'Ubisoft обновила планы по Assassin’s Creed',
  briefRu: 'Компания рассказала о дальнейшей работе над серией. В проекте якобы участвуют 970 сотрудников, хотя источник такой цифры не приводит.'
}, { title: 'Ubisoft updates its Assassin’s Creed plans', summary: 'The company discussed future work on the series.' });
assert.equal(inventedNumber.ok, false);
assert.ok(inventedNumber.reasons.some(reason => reason.startsWith('unsupported number:')));

const html = `<html><body><article>
<p>When you buy through links on our site, we may earn an affiliate commission.</p>
<p>Ubisoft has appointed a veteran developer to a senior role on the Assassin's Creed series.</p>
<p>The developer previously worked on Black Flag and Valhalla before leaving the company.</p>
<p>The move is part of a wider attempt to stabilize future Assassin's Creed projects.</p>
</article></body></html>`;
const extracted = extractArticleText(html, "Ubisoft Assassin's Creed veteran");
assert.ok(extracted.includes('Ubisoft has appointed'));
assert.ok(!extracted.includes('affiliate commission'));

const cacheItem = {
  editorialStatus: 'approved',
  editorialVersion: NEWS_EDITORIAL_VERSION,
  primaryUrl: 'https://example.com/news/test?utm_source=x',
  titleEn: 'Example game gets a major update',
  summaryEn: 'The studio announced a major update for the game.',
  titleRu: 'Разработчики Example Game анонсировали крупное обновление игры',
  summaryRu: 'Студия анонсировала крупное обновление Example Game и рассказала о ключевых изменениях. Дополнительные подробности разработчики обещают раскрыть ближе к выпуску.'
};
cacheItem.editorialSourceHash = editorialSourceHash(cacheItem);
assert.equal(hasValidEditorialCache(cacheItem), true);
assert.equal(hasValidEditorialCache({ ...cacheItem, editorialVersion: NEWS_EDITORIAL_VERSION - 1 }), false, 'stale editorial version must never pass');
assert.equal(hasValidEditorialCache({ ...cacheItem, titleEn: 'Source title changed' }), false, 'changed source hash must never pass');
assert.equal(hasValidEditorialCache({ ...cacheItem, editorialStatus: 'rejected' }), false, 'rejected item must never pass');

console.log('News editor production regression tests passed.');
