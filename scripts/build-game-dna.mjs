#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DNA_PROFILE_AXES, materializeGameDna, profileQuality } from './lib/game-dna.mjs';

const root = process.cwd();
const requested = String(process.argv[2] || '').trim();
const read = (relative, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch { return fallback; }
};
const writeIfChanged = (relative, value) => {
  const target = path.join(root, relative);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let previous = '';
  try { previous = fs.readFileSync(target, 'utf8'); } catch {}
  if (previous === content) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return true;
};
const merge = (base, next) => {
  if (!next) return base || {};
  return {
    ...(base || {}), ...(next || {}),
    identity: { ...(base?.identity || {}), ...(next?.identity || {}) },
    classification: { ...(base?.classification || {}), ...(next?.classification || {}) },
    editorial: { ...(base?.editorial || {}), ...(next?.editorial || {}) },
    relations: { ...(base?.relations || {}), ...(next?.relations || {}) },
  };
};
const evidenceValue = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.text || value.summary || value.quote || value.label || '';
};
const cleanEvidence = (value) => String(evidenceValue(value) || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const acceptedProfessionalReview = (review) => {
  const status = String(review?.validation?.status || '');
  const scope = String(review?.score_evidence?.scope || '');
  return review?.source_kind === 'review'
    && review?.canonical_score_eligible !== false
    && scope !== 'user_review'
    && (status === 'accepted' || status.startsWith('accepted-'));
};
const buildReviewEvidenceBundle = (corpus = {}) => {
  const reviews = Array.isArray(corpus?.reviews) ? corpus.reviews.filter(acceptedProfessionalReview) : [];
  const snippets = [];
  for (const review of reviews) {
    const values = [
      review?.title,
      ...(Array.isArray(review?.evidence_points) ? review.evidence_points : []),
      ...(Array.isArray(review?.praise) ? review.praise : []),
      ...(Array.isArray(review?.criticism) ? review.criticism : []),
      ...(Array.isArray(review?.mechanics) ? review.mechanics : []),
    ];
    for (const value of values) {
      const text = cleanEvidence(value);
      if (text.length >= 20) snippets.push(text.slice(0, 2200));
      if (snippets.length >= 60) break;
    }
    if (snippets.length >= 60) break;
  }
  const text = snippets.join(' ').slice(0, 48000);
  const lower = text.toLowerCase();
  const hints = [];
  if (/\baction points?\b/.test(lower) && /\b(combat|weapon|attack|ranged|sniper)\b/.test(lower)) hints.push('turn-based combat');
  if (/\bcharacter creation\b|\bcreate (?:your|a|his or her|her or his) character\b|\bcharacters? (?:that )?can be created\b/.test(lower)) hints.push('create your character');
  if (/\bquests?\b/.test(lower) && /\b(side quest|karma|reputation|towns?|optional quest)\b/.test(lower)) hints.push('side quest');
  if (/\bnpcs?\b.{0,140}\b(?:join|party|with you)\b/.test(lower) || /\bcompanions?\b/.test(lower)) hints.push('companions');
  if (/\bpost[- ]apocalyptic\b|\bwastelands?\b/.test(lower)) hints.push('post-apocalyptic');
  if (/\bgood plot\b|\bstory line\b|\bstoryline\b|\bnarrative-driven\b|\bstory-rich\b/.test(lower)) hints.push('story-rich');
  const sources = [...new Set(reviews.map((review) => review?.configured_source_id || review?.publication || review?.domain || '').filter(Boolean))];
  return { text, hints: [...new Set(hints)], source_count: sources.length, sources, snippet_count: snippets.length };
};
const strongFastPacingEvidence = (text) => /\bfast[- ]paced\b|\bhigh[- ]speed action\b|\bfast action\b|быстр(?:ый|ого|ом)?\s+темп|высок(?:ий|ого|ом)?\s+темп/i.test(String(text || ''));

const catalog = read('data/catalog-visible.json', []).filter((item) => item?.slug);
const records = new Map();
const contentDir = path.join(root, 'data/game-content');
if (fs.existsSync(contentDir)) {
  for (const file of fs.readdirSync(contentDir).filter((name) => name.endsWith('.json'))) {
    const payload = read(`data/game-content/${file}`, {});
    for (const [slug, game] of Object.entries(payload?.games || {})) records.set(slug, game);
  }
}
for (const item of catalog) {
  const slug = String(item.slug || '');
  let game = records.get(slug) || {};
  game = merge(game, read(`data/parser-output/${slug}.json`));
  game = merge(game, read(`data/drafts/${slug}.json`));
  game.identity = {
    ...(game.identity || {}),
    slug,
    title: game.identity?.title || item.title || slug,
    game_id: game.identity?.game_id || item.game_id || '',
  };
  records.set(slug, game);
}

const targets = requested ? catalog.filter((item) => item.slug === requested) : catalog;
const now = new Date().toISOString();
let created = 0;
let updated = 0;
let unchanged = 0;
const entries = [];

for (const item of targets) {
  const slug = item.slug;
  const game = records.get(slug);
  if (!game) continue;
  const existing = read(`data/game-dna/${slug}.json`);
  const reviewCorpus = read(`data/reviews/${slug}.json`, {});
  const reviewEvidence = buildReviewEvidenceBundle(reviewCorpus);
  const baseEntity = materializeGameDna({ game, catalogItem: item, existing, now });
  const sourceText = [
    game?.editorial?.short_description,
    game?.editorial?.integrated_description,
    ...(game?.editorial?.features || []),
    reviewEvidence.text,
    ...reviewEvidence.hints,
  ].filter(Boolean).join(' ');
  const evidenceGame = reviewEvidence.text ? {
    ...game,
    editorial: {
      ...(game?.editorial || {}),
      integrated_description: sourceText,
    },
  } : game;
  const entity = materializeGameDna({ game: evidenceGame, catalogItem: item, existing, now });
  const locked = new Set(entity.locked_axes || []);
  if (reviewEvidence.text && entity.status === 'auto') {
    for (const axis of DNA_PROFILE_AXES) {
      if (locked.has(axis)) continue;
      if (JSON.stringify(baseEntity.profile?.[axis] || []) === JSON.stringify(entity.profile?.[axis] || [])) continue;
      entity.provenance[axis] = {
        mode: 'professional_review_evidence',
        confidence: 0.8,
        source_count: reviewEvidence.source_count,
      };
    }
    const previousEvidence = Array.isArray(existing?.evidence) ? existing.evidence.filter((entry) => entry?.kind !== 'professional_review_corpus') : [];
    entity.evidence = [
      ...previousEvidence,
      {
        kind: 'professional_review_corpus',
        source_count: reviewEvidence.source_count,
        sources: reviewEvidence.sources.slice(0, 20),
        snippet_count: reviewEvidence.snippet_count,
        corpus_updated_at: reviewCorpus?.updated_at || null,
      },
    ];
  }
  if (entity.status === 'auto' && !locked.has('pacing') && entity.profile?.pacing?.includes('fast_action') && !strongFastPacingEvidence(sourceText)) {
    entity.profile.pacing = entity.profile.pacing.filter((value) => value !== 'fast_action');
    entity.provenance.pacing = { mode: 'insufficient_evidence', confidence: 0.2 };
  }
  entity.quality = profileQuality(entity.profile || {});
  const changed = writeIfChanged(`data/game-dna/${slug}.json`, entity);
  if (!existing && changed) created += 1;
  else if (changed) updated += 1;
  else unchanged += 1;
}

for (const item of catalog) {
  const dna = read(`data/game-dna/${item.slug}.json`);
  if (!dna) continue;
  entries.push({
    game_id: dna.game_id || item.game_id || '',
    slug: item.slug,
    title: dna.title || item.title || item.slug,
    status: dna.status || 'auto',
    revision: Number(dna.revision || 0),
    updated_at: dna.updated_at || null,
    quality: dna.quality || null,
    public_url: `/game/${item.slug}/`,
  });
}
entries.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru'));
const previousIndex = read('data/game-dna/index.json');
const stableIndex = { schema_version: 1, entity: 'game_dna', count: entries.length, entries };
const previousStableIndex = previousIndex ? { schema_version: previousIndex.schema_version, entity: previousIndex.entity, count: previousIndex.count, entries: previousIndex.entries } : null;
writeIfChanged('data/game-dna/index.json', {
  ...stableIndex,
  generated_at: previousStableIndex && JSON.stringify(previousStableIndex) === JSON.stringify(stableIndex) ? previousIndex.generated_at : now,
});

console.log(JSON.stringify({ catalog_games: catalog.length, targeted: targets.length, created, updated, unchanged, indexed: entries.length }, null, 2));
