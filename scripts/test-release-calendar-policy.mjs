import assert from 'node:assert/strict';
import { buildCandidates, buildPublicCalendar, validateCalendar } from './lib/release-calendar-policy.mjs';

const steamSource = (id) => ({ id: `steam:${id}`, family: 'official_store', title: 'Steam', url: `https://store.steampowered.com/app/${id}/`, platforms: ['PC'] });
const event = (id, title, platforms = ['PC'], sourceIds = [`steam:${id}`], date = '2026-10-10') => ({
  id: `steam:${id}`, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, release_type: 'full',
  sources: [steamSource(id)], events: [{ id: `e:${id}`, date, date_start: date, date_end: date, precision: 'exact', region: 'worldwide', platforms, confidence: 0.97, source_ids: sourceIds }],
  editorial_quality: { homepage_eligible: true, quality_score: 10, signals: ['current_popular'] },
});
const raw = [
  event(1, 'Important Game'),
  event(2, 'Important Game Demo'),
  event(3, 'Important Game Playtest'),
  event(4, 'Important Game Deluxe Edition'),
  event(5, 'Console Leak', ['PlayStation 5']),
  ...Array.from({ length: 20 }, (_, index) => event(100 + index, `Notable ${index}`)),
];
const editorial = { decisions: {
  'steam:1': { decision: 'rejected', rejection_reason: 'editorial ban', publication_forbidden: true, locked_fields: ['decision'] },
  'steam:100': { decision: 'published', event_overrides: [{ event_id: 'e:100', date: '2026-10-11', date_start: '2026-10-11', date_end: '2026-10-11', precision: 'exact', platforms: ['PC'], source_ids: ['steam:100'] }] },
}};
const claims = [{ slug: 'console-leak', platforms: ['PlayStation 5'], date: '2026-10-12', source: { id: 'ps-store:5', family: 'platform_store', title: 'PlayStation Store', url: 'https://store.playstation.com/example', platforms: ['PlayStation 5'] }, confidence: 0.98 }];
const policy = { minimum_significance_score: 1, max_public_releases_per_day: 12 };
const candidates = buildCandidates({ rawReleases: raw, editorial, officialClaims: claims, policy });
const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
assert.equal(byId.get('steam:1').moderation.status, 'rejected', 'manual rejection must survive');
assert.equal(byId.get('steam:2').moderation.rejection_reason, 'demo');
assert.equal(byId.get('steam:3').moderation.rejection_reason, 'playtest');
assert.equal(byId.get('steam:4').moderation.rejection_reason, 'duplicate_edition');
assert.equal(byId.get('steam:5').events.some((item) => item.platform_confirmations['PlayStation 5']?.includes('ps-store:5')), true);
assert.equal(byId.get('steam:100').events.some((item) => item.date === '2026-10-11'), true, 'manual date correction must survive');
const publicCalendar = buildPublicCalendar(candidates, '2026-08-06T00:00:00Z');
assert.ok(publicCalendar.statistics.max_exact_releases_in_one_day <= 12, 'daily cap must prevent raw flood');
assert.deepEqual(validateCalendar({ candidates, publicCalendar, policy }), []);
console.log('release-calendar-policy tests passed');
