#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pageSrc = process.env.PAGE_RESULTS || '/tmp/page/results.json';
const reviewSrc = process.env.REVIEW_RESULTS || '/tmp/review/results.json';
const outDir = path.join(root, 'benchmarks/model-qualification-20260907');
fs.mkdirSync(outDir, { recursive: true });

const pageRaw = JSON.parse(fs.readFileSync(pageSrc, 'utf8'));
const reviewRaw = JSON.parse(fs.readFileSync(reviewSrc, 'utf8'));

function shortError(err='') {
  if (!err) return '';
  if (err.includes('429')) return 'Ошибка API / лимит запросов (429)';
  if (err.includes('402')) return 'Ошибка API / недостаточно кредита (402)';
  if (err.includes('404')) return 'Маршрут модели недоступен (404)';
  return String(err).replace(/\s+/g,' ').slice(0,240);
}

const pageRecords = pageRaw.map(x => ({
  game_slug: x.game_slug,
  game_title: x.game_title,
  year: x.year,
  model_id: x.id,
  model_label: x.label,
  status: x.status,
  subtitle: x.subtitle || '',
  description: x.description || '',
  features: x.features || [],
  structural_ok: Boolean(x.structural_contract_ok),
  subtitle_words: x.subtitle_words || 0,
  description_words: x.description_words || 0,
  features_count: x.features_count || 0,
  error: shortError(x.error),
  source_run: 'Corrected full-corpus Page run v2'
}));

const reviewRecords = reviewRaw
  .filter(x => x.status === 'ok' && String(x.review || '').trim())
  .map(x => ({
    game_slug: x.game_slug,
    game_title: x.game_title,
    year: x.year,
    model_id: x.id,
    model_label: x.label,
    status: 'ok',
    review: x.review,
    review_words: x.review_words || 0,
    section_count: x.section_count || 0,
    structural_ok: Boolean(x.structural_contract_ok),
    source_run: '15-model Review qualification run'
  }));

fs.writeFileSync(path.join(outDir, 'page-results.json'), JSON.stringify({records: pageRecords}), 'utf8');
fs.writeFileSync(path.join(outDir, 'review-results.json'), JSON.stringify({records: reviewRecords}), 'utf8');
console.log(`Wrote ${pageRecords.length} Page records and ${reviewRecords.length} Review texts`);
