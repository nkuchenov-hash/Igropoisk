import fs from 'node:fs';
import { ageHours } from './home-feeds-quality-lib.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = read('config/home-feeds-quality.json');
const popular = read('data/popular/current.json');
const releases = read('data/releases/current.json');
const popularRun = read('data/parser-runs/popular.json');
const releaseRun = read('data/parser-runs/releases.json');
const now = Date.now();
const popularAge = ageHours(popular.generated_at, now);
const releaseAge = ageHours(releases.generated_at, now);
const staleAfter = Number(config.popular?.stale_after_hours || 12);
const popularRows = (popular.ranking || []).slice(0, Number(config.popular?.required_cards || 20));
const releaseRows = releases.releases || [];
const selected = releaseRows.filter(item => item.home?.selected);
const categoryCounts = releaseRows.reduce((acc, item) => {
  const key = item.home?.category || 'unclassified';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const excluded = releaseRows.filter(item => item.home && !item.home.eligible);
const duplicates = excluded.filter(item => item.home?.duplicate_of);
const blocking = [];
const warnings = [];
if (popularRows.length < Number(config.popular?.required_cards || 20)) blocking.push('Недостаточно качественных карточек «Сейчас популярно».');
if (selected.length < Number(config.releases?.minimum_home_cards || 6)) blocking.push('Недостаточно значимых релизов для главной.');
if (popularAge > staleAfter) warnings.push(`Рейтинг популярности старше ${staleAfter} часов.`);
if (releaseAge > Number(config.releases?.stale_after_hours || 12)) warnings.push('Календарь релизов устарел.');
const status = blocking.length ? 'error' : warnings.length ? 'degraded' : 'healthy';
const generatedAt = [popular.generated_at, releases.generated_at].filter(Boolean).sort().at(-1) || null;
const health = {
  schema_version: 1,
  generated_at: generatedAt,
  checked_at: generatedAt,
  status,
  thresholds: {
    stale_after_hours: staleAfter,
    popular_required_cards: Number(config.popular?.required_cards || 20),
    release_minimum_cards: Number(config.releases?.minimum_home_cards || 6),
    release_maximum_cards: Number(config.releases?.maximum_home_cards || 12)
  },
  popular: {
    generated_at: popular.generated_at || null,
    age_hours: Number(popularAge.toFixed(2)),
    parser_status: popularRun.status || null,
    selected: popularRows.length,
    rejected: Number(popular.quality?.rejected || 0),
    items: popularRows.map((item, index) => ({
      rank: index + 1,
      slug: item.slug,
      title: item.title,
      score: item.score,
      confidence: item.confidence,
      reason: item.quality?.reason || 'Нет объяснения.',
      families: item.quality?.evidence_families || item.families || [],
      independent_news_sources: item.quality?.independent_news_sources ?? item.news_sources ?? 0
    }))
  },
  releases: {
    generated_at: releases.generated_at || null,
    age_hours: Number(releaseAge.toFixed(2)),
    parser_status: releaseRun.status || null,
    total_calendar: releaseRows.length,
    selected_home: selected.length,
    excluded_home: excluded.length,
    duplicates: duplicates.length,
    categories: categoryCounts,
    selected: selected.map(item => ({
      slug: item.slug,
      title: item.title,
      score: item.home.score,
      category: item.home.category,
      reason: item.home.reason
    })),
    exclusions: excluded.slice(0, 40).map(item => ({
      slug: item.slug,
      title: item.title,
      category: item.home.category,
      reason: item.home.exclusion_reason,
      duplicate_of: item.home.duplicate_of
    }))
  },
  warnings,
  blocking_errors: blocking,
  read_only: true
};
fs.writeFileSync('data/home-feeds-health.json', `${JSON.stringify(health, null, 2)}\n`);
console.log(JSON.stringify({ status, popular: popularRows.length, releases: selected.length, calendar: releaseRows.length }, null, 2));
if (blocking.length) process.exitCode = 1;
