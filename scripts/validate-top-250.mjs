#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'data/top-250/current.json');
const catalogFile = path.join(root, 'data/catalog-visible.json');
if (!fs.existsSync(file)) {
  console.error('Missing data/top-250/current.json');
  process.exit(2);
}
if (!fs.existsSync(catalogFile)) {
  console.error('Missing data/catalog-visible.json');
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const catalogBySlug = new Map(catalog.map(item => [item.slug, item]));
const ranking = Array.isArray(data.ranking) ? data.ranking : [];
const errors = [];
if (data.name !== 'Игропоиск Топ-250') errors.push('wrong ranking name');
if (Number(data.capacity) !== 250) errors.push('capacity must be 250');
if (ranking.length !== Number(data.count)) errors.push('count mismatch');
if (ranking.length > 250) errors.push('ranking exceeds 250');
if (data.source !== 'published canonical reviews only') errors.push('Top-250 must be derived only from published canonical reviews');

const ids = new Set();
const slugs = new Set();
let previousScore = Infinity;
for (let i = 0; i < ranking.length; i += 1) {
  const item = ranking[i];
  const gamePath = path.join(root, 'game', String(item.slug || ''), 'index.html');
  const articleData = path.join(root, 'data/articles', `${item.slug}.json`);
  const articlePage = path.join(root, 'article', String(item.slug || ''), 'index.html');
  const reviewData = path.join(root, 'data/reviews', `${item.slug}.json`);
  const expectedGameUrl = `/Igropoisk/game/${encodeURIComponent(item.slug)}/`;
  const expectedReviewUrl = `/Igropoisk/article/${encodeURIComponent(item.slug)}/`;
  const score = Number(item.score);
  const imageCandidates = [...new Set([item.image, ...(item.image_candidates || [])].filter(Boolean))];
  const summary = String(item.summary || '').trim();
  const catalogEntry = catalogBySlug.get(item.slug);

  if (Number(item.rank) !== i + 1) errors.push(`rank mismatch at index ${i}`);
  if (!item.game_id) errors.push(`missing game_id at rank ${i + 1}`);
  if (!item.slug) errors.push(`missing slug at rank ${i + 1}`);
  if (!item.title) errors.push(`missing title at rank ${i + 1}`);
  if (!catalogEntry) errors.push(`missing catalog entry for ${item.slug}`);
  else if (String(item.title || '').trim() !== String(catalogEntry.title || '').trim()) {
    errors.push(`non-canonical display title for ${item.slug}: ${item.title}`);
  }
  if (!imageCandidates.length) errors.push(`missing cover candidates for ${item.slug}`);
  if (!summary) errors.push(`missing short game summary for ${item.slug}`);
  if (!Number.isFinite(score) || score <= 0 || score > 10) errors.push(`invalid Игропоиск rating for ${item.slug}: ${item.score}`);
  if (score > previousScore) errors.push(`rating order is not descending at ${item.slug}`);
  previousScore = score;
  if (item.rating_source !== 'published_review') errors.push(`invalid canonical rating_source for ${item.slug}: ${item.rating_source}`);
  if (ids.has(item.game_id)) errors.push(`duplicate game_id ${item.game_id}`);
  if (slugs.has(item.slug)) errors.push(`duplicate slug ${item.slug}`);
  ids.add(item.game_id);
  slugs.add(item.slug);
  if (item.game_url !== expectedGameUrl) errors.push(`Top-250 item must lead to canonical game page: ${item.slug}`);
  if (!fs.existsSync(gamePath)) errors.push(`missing game page for ${item.slug}`);
  if (item.review?.status !== 'published') errors.push(`Top-250 review must be published for ${item.slug}`);
  if (item.review?.url !== expectedReviewUrl) errors.push(`non-canonical review url for ${item.slug}`);
  if (item.review?.pipeline !== 'canonical-review-score') errors.push(`non-canonical review pipeline for ${item.slug}: ${item.review?.pipeline}`);
  if (!fs.existsSync(articleData)) errors.push(`published review data missing for ${item.slug}`);
  if (!fs.existsSync(articlePage)) errors.push(`published review page missing for ${item.slug}`);
  if (!fs.existsSync(reviewData)) errors.push(`canonical review feed missing for ${item.slug}`);

  if (fs.existsSync(reviewData) && fs.existsSync(articleData)) {
    const review = JSON.parse(fs.readFileSync(reviewData, 'utf8'));
    const article = JSON.parse(fs.readFileSync(articleData, 'utf8'));
    const canonicalScore = Number(review?.review_score?.calculation?.score_10);
    if (review?.publication_gate?.status !== 'green') errors.push(`review corpus is not green for ${item.slug}`);
    if (review?.review_score?.status !== 'green') errors.push(`canonical review score is not green for ${item.slug}`);
    if (!Number.isFinite(canonicalScore) || canonicalScore !== score || Number(article.score) !== score) {
      errors.push(`Top-250 score is not identical to canonical review score for ${item.slug}`);
    }
  }
}

if (ranking.some(item => item.slug === 'grand-theft-auto-vi')) errors.push('Grand Theft Auto VI is unreleased and must not be present in Top-250');
if (errors.length) {
  console.error(JSON.stringify({ errors }, null, 2));
  process.exit(2);
}

console.log(JSON.stringify({
  valid: true,
  count: ranking.length,
  game_pages: ranking.filter(item => item.game_url).length,
  canonical_titles: ranking.filter(item => catalogBySlug.get(item.slug)?.title === item.title).length,
  covers: ranking.filter(item => item.image || item.image_candidates?.length).length,
  summaries: ranking.filter(item => String(item.summary || '').trim()).length,
  published_reviews: ranking.filter(item => item.review?.status === 'published').length,
  rating_source: 'published_review',
  review_pipeline: 'canonical-review-score'
}, null, 2));
