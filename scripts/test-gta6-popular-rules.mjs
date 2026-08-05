import fs from 'node:fs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = read('config/parsers/popular.json');
const overrides = read('data/popular/cover-overrides.json');
const parser = fs.readFileSync('scripts/parse-popular.mjs', 'utf8');
const curator = fs.readFileSync('scripts/curate-home-feeds.mjs', 'utf8');

const gta6 = (config.global_candidates || []).find(item => item.slug === 'grand-theft-auto-vi');
if (!gta6 || !(gta6.aliases || []).includes('GTA 6')) throw new Error('GTA VI is not in the global candidate universe.');
const gta5 = (config.aliases || []).find(item => item.slug === 'grand-theft-auto-v');
if ((gta5?.aliases || []).includes('GTA Online')) throw new Error('GTA Online is still merged into GTA V aliases.');
const priority = (config.disambiguation || []).find(item => item.prefer_slug === 'grand-theft-auto-vi');
if (!priority || !(priority.prefer_aliases || []).includes('GTA 6')) throw new Error('GTA VI sequel disambiguation is missing.');
if (!parser.includes('for (const rule of config.disambiguation || [])')) throw new Error('Popular parser does not apply sequel disambiguation.');
const gta6Art = overrides['grand-theft-auto-vi'] || [];
if (!gta6Art.some(url => /rockstargames\.com\/VI\//i.test(url))) throw new Error('Official Rockstar GTA VI artwork override is missing.');
if (!curator.includes('const relevanceTier = confirmed') || curator.includes('const tier = !verifiedCover')) throw new Error('Cover verification still determines popularity relevance.');
if (!curator.includes('eligible: Boolean(relevanceTier)') || !curator.includes('publishable: Boolean(tier)')) throw new Error('Editorial audit does not separate relevance from presentation readiness.');

console.log('GTA VI popular-ranking rules are valid.');
