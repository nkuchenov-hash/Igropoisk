import fs from 'node:fs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = read('config/parsers/popular.json');
const officialArt = read('config/parsers/official-popular-art.json');
const parser = fs.readFileSync('scripts/parse-popular.mjs', 'utf8');
const resolver = fs.readFileSync('scripts/lib/popular-entity-resolution.mjs', 'utf8');
const curator = fs.readFileSync('scripts/curate-home-feeds.mjs', 'utf8');
const schedule = read('config/parsers/schedule.json');

const gta6 = (config.global_candidates || []).find(item => item.slug === 'grand-theft-auto-vi');
if (!gta6 || !(gta6.aliases || []).includes('GTA 6')) throw new Error('GTA VI is not in the global candidate universe.');
const gta5 = (config.aliases || []).find(item => item.slug === 'grand-theft-auto-v');
if ((gta5?.aliases || []).includes('GTA Online')) throw new Error('GTA Online is still merged into GTA V aliases.');
const priority = (config.disambiguation || []).find(item => item.prefer_slug === 'grand-theft-auto-vi');
if (!priority || !(priority.prefer_aliases || []).includes('GTA 6')) throw new Error('GTA VI sequel disambiguation is missing.');
if (!parser.includes('createPopularEntityResolver(games, config)')) throw new Error('Popular parser is not wired to the canonical entity resolver.');
if (!resolver.includes('config.disambiguation || []') || !resolver.includes('rule.prefer_slug')) throw new Error('Canonical Popular resolver does not apply configured sequel disambiguation.');
const packageRule = (officialArt.packages || []).find(item => item.slug === 'grand-theft-auto-vi');
if (!packageRule || !/media\.rockstargames\.com/i.test(packageRule.package_url || '') || packageRule.member !== 'Official_Cover_Art/Official_Cover_Art_portrait.jpg') {
  throw new Error('Official Rockstar GTA VI artwork package is missing or incorrect.');
}
const popularCommand = (schedule.parsers || []).find(item => item.id === 'popular')?.command || '';
if (!popularCommand.includes('resolve-official-popular-packages.mjs')) throw new Error('Official artwork package resolver is not connected to the popular pipeline.');
if (!curator.includes('const relevanceTier = confirmed') || curator.includes('const tier = !verifiedCover')) throw new Error('Cover verification still determines popularity relevance.');
if (!curator.includes('eligible: Boolean(relevanceTier)') || !curator.includes('publishable: Boolean(tier)')) throw new Error('Editorial audit does not separate relevance from presentation readiness.');

console.log('GTA VI popular-ranking rules are valid.');
