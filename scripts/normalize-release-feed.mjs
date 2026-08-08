import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const currentPath = path.join(root, 'data/releases/current.json');
const rulesPath = path.join(root, 'features/home-releases/rules.json');
const disappearanceNote = 'Запись исчезла из текущей выдачи источника';

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function previousReleaseSnapshot() {
  try {
    return JSON.parse(execSync('git show HEAD:data/releases/current.json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }));
  } catch {
    return { releases: [] };
  }
}

function eventEndTimestamp(game) {
  const event = Array.isArray(game?.events) ? game.events[0] : null;
  const value = event?.date_end || event?.date || event?.date_start;
  if (!value) return null;
  const timestamp = Date.parse(`${value}T23:59:59Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

const payload = readJson(currentPath, { releases: [] });
const previous = previousReleaseSnapshot();
const previousBySlug = new Map((previous.releases || []).filter(game => game?.slug).map(game => [game.slug, game]));
const rules = readJson(rulesPath, {});
const recentDays = Math.max(1, Number(rules.recent_release_days || 7));
const now = Date.now();
const recentWindowMs = recentDays * 86_400_000;
let fallbackSlugs = 0;
let expectedPostReleaseRestored = 0;

for (const game of payload.releases || []) {
  if (!game?.slug) {
    const steamId = Number(game?.external_ids?.steam || String(game?.id || '').replace(/^steam:/, ''));
    if (Number.isFinite(steamId) && steamId > 0) {
      game.slug = `steam-${steamId}`;
      if (game.editorial) game.editorial.draft_path = `data/release-drafts/${game.slug}.json`;
      for (const event of game.events || []) {
        if (String(event.id || '').startsWith(':worldwide:')) event.id = `${game.slug}${event.id}`;
      }
      fallbackSlugs += 1;
    }
  }

  const editorial = game?.editorial || {};
  const notes = Array.isArray(editorial.notes) ? editorial.notes : [];
  if (!game?.slug || !editorial.needs_review || !notes.includes(disappearanceNote)) continue;

  const end = eventEndTimestamp(game);
  const isExpectedPostReleaseDisappearance = Number.isFinite(end) && end < now && now - end <= recentWindowMs;
  if (!isExpectedPostReleaseDisappearance) continue;

  const previousGame = previousBySlug.get(game.slug);
  if (!previousGame?.editorial) continue;

  game.editorial = {
    ...editorial,
    status: previousGame.editorial.status || editorial.status,
    needs_review: Boolean(previousGame.editorial.needs_review),
    notes: Array.isArray(previousGame.editorial.notes) ? previousGame.editorial.notes : []
  };
  expectedPostReleaseRestored += 1;
}

fs.writeFileSync(currentPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ fallback_slugs: fallbackSlugs, expected_post_release_restored: expectedPostReleaseRestored }, null, 2));
