#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'data/top-250/current.json');
if (!fs.existsSync(file)) {
  console.error('Missing data/top-250/current.json');
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const ranking = Array.isArray(data.ranking) ? data.ranking : [];
const errors = [];
if (data.name !== 'Игропоиск Топ-250') errors.push('wrong ranking name');
if (Number(data.capacity) !== 250) errors.push('capacity must be 250');
if (ranking.length !== Number(data.count)) errors.push('count mismatch');
if (ranking.length > 250) errors.push('ranking exceeds 250');
const ids = new Set();
const slugs = new Set();
for (let i = 0; i < ranking.length; i += 1) {
  const item = ranking[i];
  const gamePath = path.join(root, 'game', String(item.slug || ''), 'index.html');
  const articleData = path.join(root, 'data/articles', `${item.slug}.json`);
  const articlePage = path.join(root, 'article', String(item.slug || ''), 'index.html');
  const expectedGameUrl = `/Igropoisk/game/${encodeURIComponent(item.slug)}/`;
  const expectedReviewUrl = `/Igropoisk/article/${encodeURIComponent(item.slug)}/`;
  if (Number(item.rank) !== i + 1) errors.push(`rank mismatch at index ${i}`);
  if (!item.game_id) errors.push(`missing game_id at rank ${i + 1}`);
  if (!item.slug) errors.push(`missing slug at rank ${i + 1}`);
  if (!item.title) errors.push(`missing title at rank ${i + 1}`);
  if (ids.has(item.game_id)) errors.push(`duplicate game_id ${item.game_id}`);
  if (slugs.has(item.slug)) errors.push(`duplicate slug ${item.slug}`);
  ids.add(item.game_id);
  slugs.add(item.slug);
  if (item.game_url !== expectedGameUrl) errors.push(`Top-250 item must lead to canonical game page: ${item.slug}`);
  if (!fs.existsSync(gamePath)) errors.push(`missing game page for ${item.slug}`);
  if (!['published', 'ready_to_render', 'pending'].includes(item.review?.status)) errors.push(`invalid review status for ${item.slug}`);
  if (item.review?.pipeline && item.review.pipeline !== 'strict') errors.push(`non-strict review pipeline is forbidden for ${item.slug}`);
  if (item.review?.status === 'published') {
    if (item.review.url !== expectedReviewUrl) errors.push(`non-canonical review url for ${item.slug}`);
    if (item.review.pipeline !== 'strict') errors.push(`published review is not strict for ${item.slug}`);
    if (!fs.existsSync(articleData)) errors.push(`published review data missing for ${item.slug}`);
    if (!fs.existsSync(articlePage)) errors.push(`published review page missing for ${item.slug}`);
  } else if (item.review?.url) {
    errors.push(`unpublished review must not expose a URL for ${item.slug}`);
  }
}
if (errors.length) {
  console.error(JSON.stringify({ errors }, null, 2));
  process.exit(2);
}
console.log(JSON.stringify({
  valid: true,
  count: ranking.length,
  game_pages: ranking.filter(item => item.game_url).length,
  published_reviews: ranking.filter(item => item.review.status === 'published').length
}, null, 2));
