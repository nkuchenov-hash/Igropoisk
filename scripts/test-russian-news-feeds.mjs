import assert from 'node:assert/strict';
import { nativeRussianFeeds, parseNativeRussianFeed } from './merge-russian-news-feeds.mjs';

assert.ok(nativeRussianFeeds.length >= 7);
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'StopGame' && feed.url.includes('rss_news.xml')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'GoHa.Ru' && feed.url.includes('/rss/videogames')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === '3DNews' && feed.url.includes('/games/rss/')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'VGTimes' && feed.url.endsWith('/rss.xml')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'Kanobu' && feed.url.includes('/rss/news.full.xml')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'App2Top' && feed.url.endsWith('/rss')));
assert.ok(nativeRussianFeeds.some(feed => feed.source === 'Игромания'));

const now = Date.parse('2026-08-29T08:00:00.000Z');
const xml = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[Fable получила новый геймплейный трейлер]]></title>
<link>https://example.ru/news/fable</link>
<description><![CDATA[Разработчики показали новый фрагмент Fable и рассказали о боевой системе. Релиз игры запланирован на 2027 год.]]></description>
<pubDate>Sat, 29 Aug 2026 07:30:00 GMT</pubDate>
</item>
<item>
<title><![CDATA[Обзор новой ролевой игры]]></title>
<link>https://example.ru/review/game</link>
<description><![CDATA[Редакция подготовила большой обзор и поделилась мнением об игре.]]></description>
<pubDate>Sat, 29 Aug 2026 07:20:00 GMT</pubDate>
</item>
<item>
<title><![CDATA[Очень старая игровая новость]]></title>
<link>https://example.ru/news/old</link>
<description><![CDATA[Разработчики выпустили обновление игры и рассказали об изменениях.]]></description>
<pubDate>Mon, 10 Aug 2026 07:20:00 GMT</pubDate>
</item>
</channel></rss>`;

const parsed = parseNativeRussianFeed(xml, { source: 'Test RU', url: 'https://example.ru/rss', weight: 1 }, { now });
assert.equal(parsed.length, 1);
assert.equal(parsed[0].source, 'Test RU');
assert.equal(parsed[0].localizationStatus, 'source-ru');
assert.equal(parsed[0].globalEligible, true);
assert.match(parsed[0].titleRu, /Fable/);
assert.equal(parsed[0].selectionReason, 'native-russian-professional-feed');

console.log('Native Russian news feed regression tests passed.');
