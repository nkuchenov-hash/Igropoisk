#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DNA_PROFILE_AXES, DNA_STATUSES, normalizeTagList, profileQuality } from './lib/game-dna.mjs';

const root = process.cwd();
const requested = new Set(process.argv.slice(2).map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; }
};
const taxonomy = read('config/game-dna-taxonomy.json', {});
const axes = taxonomy.axes || {};
const dir = path.join(root, 'data/game-dna');
if (!fs.existsSync(dir)) {
  console.log('Game DNA directory does not exist yet; nothing to validate.');
  process.exit(0);
}

const errors = [];
const gameIds = new Map();
const slugs = new Set();
const allFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'index.json');
const files = requested.size ? allFiles.filter(name => requested.has(name.replace(/\.json$/,''))) : allFiles;
for (const slug of requested) if (!allFiles.includes(`${slug}.json`)) errors.push(`data/game-dna/${slug}.json: requested DNA entity is missing`);
for (const file of files) {
  const relative = `data/game-dna/${file}`;
  const dna = read(relative);
  if (!dna || typeof dna !== 'object') { errors.push(`${relative}: invalid JSON entity`); continue; }
  if (Number(dna.schema_version) !== 1) errors.push(`${relative}: schema_version must be 1`);
  if (!String(dna.game_id || '').trim()) errors.push(`${relative}: game_id is required`);
  if (!String(dna.slug || '').trim()) errors.push(`${relative}: slug is required`);
  if (dna.slug && `${dna.slug}.json` !== file) errors.push(`${relative}: filename must match slug`);
  if (!DNA_STATUSES.has(dna.status)) errors.push(`${relative}: unsupported status ${dna.status}`);
  if (!dna.profile || typeof dna.profile !== 'object') errors.push(`${relative}: profile is required`);
  if (slugs.has(dna.slug)) errors.push(`${relative}: duplicate slug ${dna.slug}`);
  slugs.add(dna.slug);
  if (dna.game_id) {
    if (gameIds.has(dna.game_id) && gameIds.get(dna.game_id) !== dna.slug) errors.push(`${relative}: duplicate game_id ${dna.game_id}`);
    gameIds.set(dna.game_id, dna.slug);
  }
  for (const axis of DNA_PROFILE_AXES) {
    const values = dna.profile?.[axis];
    if (!Array.isArray(values)) { errors.push(`${relative}: profile.${axis} must be an array`); continue; }
    const normalized = normalizeTagList(values);
    if (normalized.length !== values.length || normalized.some((value, index) => value !== values[index])) errors.push(`${relative}: profile.${axis} must contain unique normalized tags`);
    const rule = axes[axis] || {};
    const allowed = new Set(rule.options || []);
    if (!rule.allow_custom && allowed.size) {
      for (const value of values) if (!allowed.has(value)) errors.push(`${relative}: profile.${axis} has unsupported value ${value}`);
    }
  }
  for (const axis of dna.locked_axes || []) if (!DNA_PROFILE_AXES.includes(axis)) errors.push(`${relative}: locked_axes contains unknown axis ${axis}`);
  const expectedQuality = profileQuality(dna.profile || {});
  if (JSON.stringify(dna.quality || null) !== JSON.stringify(expectedQuality)) errors.push(`${relative}: quality snapshot is stale; run build-game-dna.mjs`);
  if (requested.size && !expectedQuality.ready_for_similarity) {
    errors.push(`${relative}: targeted post-create DNA is not similarity-ready (${expectedQuality.populated_axes}/${expectedQuality.total_axes} axes, ${expectedQuality.core_axes}/${expectedQuality.total_core_axes} core axes); requires at least 6 populated axes and 3 core axes`);
  }
  if (requested.size && expectedQuality.needs_enrichment) {
    errors.push(`${relative}: targeted post-create DNA is below the commercial enrichment gate (${expectedQuality.populated_axes}/${expectedQuality.total_axes} axes, ${expectedQuality.core_axes}/${expectedQuality.total_core_axes} core axes); requires >=9 populated axes and >=4 core axes`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(2);
}
console.log(`Game DNA validation passed for ${slugs.size} ${requested.size ? 'targeted commercial-quality' : 'catalog'} entities.`);
