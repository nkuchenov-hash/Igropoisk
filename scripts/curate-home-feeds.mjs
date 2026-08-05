import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const config = read('config/home-feeds-quality.json');
const popular = read('data/popular/current.json');
const releases = read('data/releases/current.json');
const now = Date.now();

const familyCount = item => new Set((item.families || []).filter(family => family !== 'steam_chart')).size;
const hasSteam = item => (item.families || []).includes('steam_chart');
const independentEvidence = item => (item.evidence || []).filter(evidence => evidence.family !== 'steam_chart');

const popularAudit = [];
const popularSelected = [];
for (const item of popular.ranking || []) {
  const reasons = [];
  const independentFamilies = familyCount(item);
  if (Number(item.confidence || 0) < config.popular.minimum_confidence) reasons.push('low_confidence');
  if (Number(item.score || 0) < config.popular.minimum_score) reasons.push('low_score');
  const enoughIndependent = independentFamilies >= config.popular.minimum_independent_families;
  const steamPlusSignal = config.popular.allow_steam_plus_independent_signal && hasSteam(item) && independentEvidence(item).length > 0;
  if (!enoughIndependent && !steamPlusSignal) reasons.push('single_weak_signal');
  if (config.popular.evergreen_requires_fresh_non_steam_signal && item.in_catalog && independentEvidence(item).length === 0) reasons.push('evergreen_without_fresh_signal');
  const eligible = reasons.length === 0;
  popularAudit.push({ slug: item.slug, title: item.title, eligible, reasons, score: item.score, confidence: item.confidence, families: item.families || [], evidence_count: (item.evidence || []).length });
  if (eligible) popularSelected.push({ ...item, editorial_reason: `Подтверждено сигналами: ${(item.families || []).join(', ')}` });
}
if (popularSelected.length < config.popular.minimum_cards) {
  throw new Error(`Popular editorial gate failed: ${popularSelected.length}/${config.popular.minimum_cards} eligible cards.`);
}
popular.ranking = popularSelected.slice(0, Math.max(30, config.popular.minimum_cards));
popular.editorial_quality = {
  checked_at: new Date(now).toISOString(),
  eligible_count: popularSelected.length,
  rejected_count: popularAudit.filter(item => !item.eligible).length,
  rules: 'multi-signal-or-steam-plus-independent-signal'
};
write('data/popular/current.json', popular);

const titleKey = title => {
  let value = String(title || '').normalize('NFKC').toLowerCase();
  for (const pattern of config.releases.duplicate_suffix_patterns || []) value = value.replace(new RegExp(pattern, 'i'), '');
  return value.replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
};
const excludedPatterns = (config.releases.exclude_title_patterns || []).map(pattern => new RegExp(pattern, 'i'));
const significantGenres = new Set(config.releases.significant_genres || []);
const seen = new Map();
const releaseAudit = [];

for (const game of releases.releases || []) {
  const reasons = [];
  const title = String(game.title || '');
  if (excludedPatterns.some(pattern => pattern.test(title))) reasons.push('non_full_release');
  const key = titleKey(title);
  if (seen.has(key)) reasons.push(`duplicate_of:${seen.get(key)}`);
  else if (key) seen.set(key, game.slug);

  const event = (game.events || [])[0] || {};
  let quality = 0;
  if (event.precision === 'exact') quality += 2;
  else if (event.precision && event.precision !== 'tbd') quality += 1;
  if ((game.genres || []).some(genre => significantGenres.has(genre))) quality += 1;
  if (game.developer) quality += 1;
  if (game.publisher) quality += 1;
  if (game.editorial?.has_page || game.editorial?.status === 'published') quality += 3;
  if (game.editorial?.needs_review) quality -= 2;
  if (reasons.length) quality -= 4;

  const homepageEligible = reasons.length === 0 && quality >= config.releases.minimum_homepage_quality;
  game.editorial_quality = {
    homepage_eligible: homepageEligible,
    quality_score: quality,
    reasons,
    checked_at: new Date(now).toISOString()
  };
  releaseAudit.push({ slug: game.slug, title, homepage_eligible: homepageEligible, quality_score: quality, reasons });
}

releases.editorial_quality = {
  checked_at: new Date(now).toISOString(),
  homepage_eligible_count: releaseAudit.filter(item => item.homepage_eligible).length,
  excluded_count: releaseAudit.filter(item => !item.homepage_eligible).length,
  duplicate_groups: [...seen.entries()].length
};
write('data/releases/current.json', releases);
write('data/home-feeds-quality.json', {
  schema_version: 1,
  generated_at: new Date(now).toISOString(),
  popular: {
    snapshot_generated_at: popular.generated_at,
    stale: now - Date.parse(popular.generated_at) > config.popular.maximum_snapshot_age_hours * 3_600_000,
    selected: popular.ranking.slice(0, config.popular.minimum_cards).map(item => ({ slug: item.slug, title: item.title, score: item.score, confidence: item.confidence, families: item.families, reason: item.editorial_reason })),
    audit: popularAudit
  },
  releases: {
    snapshot_generated_at: releases.generated_at,
    homepage_limit: config.releases.homepage_limit,
    selected: releaseAudit.filter(item => item.homepage_eligible).slice(0, config.releases.homepage_limit),
    audit: releaseAudit
  }
});

console.log(JSON.stringify({ popular_eligible: popularSelected.length, releases_homepage_eligible: releaseAudit.filter(item => item.homepage_eligible).length }, null, 2));
