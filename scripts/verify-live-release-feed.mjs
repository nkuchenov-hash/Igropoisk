import fs from 'node:fs/promises';

const config = JSON.parse(await fs.readFile('config/home-feeds-storage.json', 'utf8'));
const local = JSON.parse(await fs.readFile('data/releases/public.json', 'utf8'));
const manifestUrl = process.env.RELEASE_FEED_MANIFEST_URL || config.runtime_manifest_url;
if (!manifestUrl) throw new Error('No runtime manifest URL configured for release feed verification');

async function fetchJson(url) {
  const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(20_000)});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
function releaseSignature(doc = {}) {
  return (doc.releases || []).map(release => ({
    id: release.id,
    game_id: release.game_id || null,
    global_notability: Boolean(release.global_notability?.eligible),
    events: (release.events || []).map(event => ({
      id: event.id, precision: event.precision || 'tbd', date: event.date || null,
      date_start: event.date_start || null, date_end: event.date_end || null,
      platforms: [...(event.platforms || [])].sort(),
    })).sort((a,b) => String(a.id).localeCompare(String(b.id))),
  })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
}

const manifest = await fetchJson(manifestUrl);
const liveUrl = manifest?.files?.['data/releases/public.json']?.url;
if (!liveUrl) throw new Error('Current home-feed manifest does not expose data/releases/public.json');
const live = await fetchJson(liveUrl);
const mismatches = [];
if (String(local.generated_at || '') !== String(live.generated_at || '')) mismatches.push(`generated_at local=${local.generated_at || 'none'} live=${live.generated_at || 'none'}`);
const localSignature = JSON.stringify(releaseSignature(local));
const liveSignature = JSON.stringify(releaseSignature(live));
if (localSignature !== liveSignature) mismatches.push('release IDs/game IDs/global gate/events differ between validated local materialization and live runtime feed');
if (mismatches.length) {
  console.error(mismatches.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Live release feed matches validated materialization: ${(local.releases || []).length} releases, generated_at=${local.generated_at}`);
