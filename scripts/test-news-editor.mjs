import assert from 'node:assert/strict';
import { extractArticleText, normalizeEditorialNames, validateEditedNews } from './lib/news-editor-qwen.mjs';

assert.equal(normalizeEditorialNames('Убисофт вернула автора в команду'), 'Ubisoft вернула автора в команду');
assert.equal(normalizeEditorialNames('Стим и Иксбокс получили обновление'), 'Steam и Xbox получили обновление');

const clean = validateEditedNews({
  titleRu: 'EA может сократить сотрудников после роста долговой нагрузки',
  briefRu: 'EA планирует сократить ежегодные расходы на 700 миллионов долларов, включая организационные издержки. Компания ожидает значительные процентные платежи после сделки, поэтому аналитики допускают новые сокращения персонала.'
}, {
  title: "Mass layoffs may be in EA's near future after leveraged buyout raises company debt"
});
assert.equal(clean.ok, true, clean.reasons.join('; '));

const repeated = validateEditedNews({
  titleRu: 'EA готовит сокращения после кризиса после сделки',
  briefRu: 'Компания планирует сократить расходы на сотни миллионов долларов в год. Изменения могут затронуть сотрудников, хотя точный масштаб сокращений пока не подтвержден.'
}, { title: 'EA layoffs after buyout' });
assert.equal(repeated.ok, false);
assert.ok(repeated.reasons.includes('repeated connector in title'));

const literal = validateEditedNews({
  titleRu: 'Wolfenstein 2009 может вернуться после исключения из списка',
  briefRu: 'Страница Wolfenstein 2009 в Steam неожиданно изменилась спустя много лет. Фанаты связывают обновление с возможным ремастером, но официального подтверждения пока нет.'
}, { title: 'Wolfenstein 2009 could return after being delisted from Steam' });
assert.equal(literal.ok, false);
assert.ok(literal.reasons.includes('literal machine translation'));

const html = `<html><body><article>
<p>When you buy through links on our site, we may earn an affiliate commission.</p>
<p>Ubisoft has appointed a veteran developer to a senior role on the Assassin's Creed series.</p>
<p>The developer previously worked on Black Flag and Valhalla before leaving the company.</p>
<p>The move is part of a wider attempt to stabilize future Assassin's Creed projects.</p>
</article></body></html>`;
const extracted = extractArticleText(html, "Ubisoft Assassin's Creed veteran");
assert.ok(extracted.includes('Ubisoft has appointed'));
assert.ok(!extracted.includes('affiliate commission'));

console.log('News editor regression tests passed.');
