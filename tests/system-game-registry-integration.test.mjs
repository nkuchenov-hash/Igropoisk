import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEntity, createRegistry, rebuildIndexes } from '../scripts/lib/game-registry.mjs';
import { bindPopularSnapshot, projectPublicCatalog, registerPopularCandidates, resolveSystemGameIdentity } from '../scripts/lib/system-game-registry-adapter.mjs';

function fixtureRegistry() {
  const base = createGameEntity({
    id: 'game_mafia_ii',
    title: 'Mafia II',
    slug: 'mafia-ii',
    year: 2010,
    kind: 'game',
    source: {type: 'manual', name: 'test'}
  }, {now: '2026-08-07T00:00:00.000Z'});
  base.variants.push({
    schemaVersion: 'game-variant/v1',
    id: 'variant_mafia_ii_definitive',
    baseGameId: base.id,
    kind: 'remaster',
    title: 'Mafia II: Definitive Edition',
    slug: 'mafia-ii-definitive-edition',
    releases: [],
    platforms: ['PC'],
    articles: []
  });

  const remake = createGameEntity({
    id: 'game_mafia_remake',
    title: 'Mafia: Definitive Edition',
    slug: 'mafia-definitive-edition',
    year: 2020,
    kind: 'remake',
    source: {type: 'manual', name: 'test'}
  }, {now: '2026-08-07T00:00:00.000Z'});

  const registry = createRegistry({games: {[base.id]: base, [remake.id]: remake}});
  return rebuildIndexes(registry);
}

test('public catalog excludes embedded remaster while keeping true remake standalone', () => {
  const registry = fixtureRegistry();
  const source = [
    {title: 'Mafia II', year: 2010, slug: 'mafia-ii', game_id: 'game_mafia_ii'},
    {title: 'Mafia II: Definitive Edition', year: 2020, slug: 'mafia-ii-definitive-edition'},
    {title: 'Mafia: Definitive Edition', year: 2020, slug: 'mafia-definitive-edition', game_id: 'game_mafia_remake'}
  ];
  const projected = projectPublicCatalog(source, registry);
  assert.deepEqual(projected.records.map(item => item.slug), ['mafia-ii', 'mafia-definitive-edition']);
  assert.equal(projected.records[0].game_id, 'game_mafia_ii');
  assert.equal(projected.records[1].game_id, 'game_mafia_remake');
  assert.equal(projected.records[0].title, 'Mafia II');
  assert.equal(projected.records[0].year, 2010);
  assert.ok(projected.issues.some(item => item.slug === 'mafia-ii-definitive-edition' && item.status === 'embedded_variant'));
});

test('popular ranking keeps order and score while binding variant to base game', () => {
  const registry = fixtureRegistry();
  const source = {
    ranking: [
      {slug: 'mafia-ii-definitive-edition', title: 'Mafia II: Definitive Edition', score: 91.2},
      {slug: 'mafia-definitive-edition', title: 'Mafia: Definitive Edition', score: 87.4}
    ]
  };
  const bound = bindPopularSnapshot(source, registry).snapshot;
  assert.deepEqual(bound.ranking.map(item => item.title), source.ranking.map(item => item.title));
  assert.deepEqual(bound.ranking.map(item => item.score), source.ranking.map(item => item.score));
  assert.equal(bound.ranking[0].game_id, 'game_mafia_ii');
  assert.equal(bound.ranking[0].canonical_slug, 'mafia-ii');
  assert.equal(bound.ranking[0].variant_id, 'variant_mafia_ii_definitive');
  assert.equal(bound.ranking[1].game_id, 'game_mafia_remake');
  assert.equal(bound.ranking[1].canonical_slug, 'mafia-definitive-edition');
  assert.equal(bound.ranking[1].variant_id, undefined);
});

test('Popular-only game is registered by the canonical Registry API and keeps a stable id', () => {
  const first = registerPopularCandidates(createRegistry(), [{ranking: [
    {slug: 'fortnite', title: 'Fortnite', score: 99}
  ]}]);
  assert.equal(first.issues.length, 0);
  assert.equal(first.created, 1);
  const game = first.registry.games[first.registry.indexes.slug.fortnite];
  assert.ok(game);
  assert.match(game.id, /^game_[a-f0-9]{20}$/);

  const bound = bindPopularSnapshot({ranking: [{slug: 'fortnite', title: 'Fortnite', score: 99}]}, first.registry).snapshot;
  assert.equal(bound.ranking[0].game_id, game.id);
  assert.equal(bound.ranking[0].canonical_slug, 'fortnite');

  const second = registerPopularCandidates(createRegistry(), [bound]);
  const rediscovered = second.registry.games[second.registry.indexes.slug.fortnite];
  assert.equal(rediscovered.id, game.id, 'Committed Popular game_id must remain stable on the next Registry build');
});

test('Popular-only embedded content cannot create a standalone canonical game', () => {
  const discovery = registerPopularCandidates(createRegistry(), [{ranking: [
    {slug: 'unknown-game-definitive-edition', title: 'Unknown Game: Definitive Edition', score: 10}
  ]}]);
  assert.equal(discovery.created, 0);
  assert.equal(discovery.registry.indexes.slug['unknown-game-definitive-edition'], undefined);
  assert.ok(discovery.issues.some(issue => issue.reason === 'embedded_popular_candidate_requires_base_game'));
});

test('explicit game id cannot silently disagree with canonical slug', () => {
  const registry = fixtureRegistry();
  const resolution = resolveSystemGameIdentity({
    game_id: 'game_mafia_remake',
    slug: 'mafia-ii'
  }, registry);
  assert.equal(resolution.status, 'mismatch');
  assert.equal(resolution.game_id, 'game_mafia_ii');
  assert.equal(resolution.reason, 'game_id_slug_mismatch');
});
