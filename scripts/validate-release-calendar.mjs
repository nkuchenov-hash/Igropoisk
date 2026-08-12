import fs from 'node:fs/promises';
import { validateCalendar } from './lib/release-calendar-policy.mjs';
import { validateGlobalNotability } from './lib/release-notability.mjs';
import { validatePersonalizedReleases } from './lib/release-audience-relevance.mjs';
import { validateVisibleReleaseCovers } from './lib/release-cover-resolver.mjs';

const [candidateDoc,publicCalendar,policy]=await Promise.all([
  fs.readFile('data/release-candidates/current.json','utf8').then(JSON.parse),
  fs.readFile('data/releases/public.json','utf8').then(JSON.parse),
  fs.readFile('config/release-calendar.json','utf8').then(JSON.parse),
]);
const candidates=candidateDoc.candidates||[];
const errors=[
  ...validateCalendar({candidates,publicCalendar,policy}),
  ...validateGlobalNotability({candidates,publicCalendar}),
  ...validatePersonalizedReleases({candidates,publicCalendar,policy}),
  ...validateVisibleReleaseCovers(publicCalendar),
];
const stats=publicCalendar.statistics||{};
console.log(`Release calendar: raw=${stats.raw_candidates||0}, published=${stats.published||0}, review=${stats.review||0}, rejected=${stats.rejected||0}, max/day=${stats.max_exact_releases_in_one_day||0}`);
for(const day of stats.dense_days||[])console.log(`  ${day.date}: ${day.count}`);
if(errors.length){console.error(errors.map(error=>`- ${error}`).join('\n'));process.exit(1)}
