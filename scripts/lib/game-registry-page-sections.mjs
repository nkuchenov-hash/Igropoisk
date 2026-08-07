import fs from 'node:fs';
import path from 'node:path';

const EMBEDDED_LABELS = Object.freeze({
  edition: 'Издание',
  remaster: 'Ремастер',
  dlc: 'DLC',
  expansion: 'Дополнение'
});

function articleView(article = {}) {
  return {
    id: article.id ?? null,
    type: article.type ?? null,
    status: article.status ?? 'draft',
    title: article.title ?? null,
    url: article.url ?? null,
    source_name: article.source?.name ?? null
  };
}

function variantView(variant = {}) {
  return {
    variant_id: variant.id,
    kind: variant.kind,
    kind_label: EMBEDDED_LABELS[variant.kind] ?? variant.kind,
    title: variant.title,
    slug: variant.slug,
    release: variant.release ?? null,
    description: variant.description ?? '',
    articles: (variant.articles ?? []).filter(article => article.status === 'published').map(articleView)
  };
}

function yearOf(game = {}) {
  return Number(String(game.releases?.[0]?.date?.value ?? '').match(/(?:19|20)\d{2}/)?.[0] ?? 0) || null;
}

function imageOf(game = {}) {
  const preferred = ['cover','hero','keyArt'];
  for (const kind of preferred) {
    const item = (game.media ?? []).find(media => media?.kind === kind && media?.url);
    if (item?.url) return item.url;
  }
  return null;
}

function entitySeriesDescriptor(game = {}) {
  const value = game.identity?.series?.value;
  if (!value) return null;
  if (typeof value === 'string') return {id: value, title: value, order: null, relation: null};
  if (typeof value !== 'object') return null;
  const id = String(value.id ?? value.series_id ?? value.slug ?? '').trim();
  const title = String(value.title ?? value.name ?? id).trim();
  if (!id || !title) return null;
  return {
    id,
    title,
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : null,
    relation: value.relation ?? null
  };
}

function loadSeriesCatalog(options = {}) {
  if (options.seriesCatalog) return options.seriesCatalog;
  const root = path.resolve(options.root ?? process.cwd());
  const file = path.join(root, 'data/game-series.json');
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && Array.isArray(value.series) ? value : {series: []};
  } catch {
    return {series: []};
  }
}

function memberView(game, descriptor = {}) {
  const slug = String(game.identity?.slug?.value ?? '').trim();
  return {
    game_id: game.id,
    slug,
    title: String(game.identity?.canonicalTitle?.value ?? slug),
    year: yearOf(game),
    kind: game.identity?.kind?.value ?? 'game',
    relation: descriptor.relation ?? null,
    order: Number.isFinite(Number(descriptor.order)) ? Number(descriptor.order) : null,
    image: imageOf(game)
  };
}

function buildSeries(registry = {}, options = {}) {
  const groups = new Map();
  const assigned = new Set();
  const catalog = loadSeriesCatalog(options);

  for (const definition of catalog.series ?? []) {
    const id = String(definition?.id ?? '').trim();
    const title = String(definition?.title ?? definition?.name ?? id).trim();
    if (!id || !title) continue;
    const group = {id, title, members: []};
    for (const member of definition.members ?? []) {
      const slug = String(member?.slug ?? '').trim();
      const gameId = registry.indexes?.slug?.[slug];
      const game = gameId ? registry.games?.[gameId] : null;
      if (!game || game.workflow?.status === 'merged_into_another_game' || game.presentation?.standalonePage === false) continue;
      group.members.push(memberView(game, member));
      assigned.add(game.id);
    }
    if (group.members.length) groups.set(id, group);
  }

  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game' || game.presentation?.standalonePage === false || assigned.has(game.id)) continue;
    const descriptor = entitySeriesDescriptor(game);
    if (!descriptor) continue;
    const group = groups.get(descriptor.id) ?? {id: descriptor.id, title: descriptor.title, members: []};
    group.members.push(memberView(game, descriptor));
    groups.set(descriptor.id, group);
  }

  for (const group of groups.values()) {
    group.members = [...new Map(group.members.map(member => [member.game_id, member])).values()];
    group.members.sort((a,b) => {
      if (a.order !== null || b.order !== null) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);
      return (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);
    });
  }
  return groups;
}

export function buildGamePageSections(registry = {}, options = {}) {
  const games = {};
  const redirects = {};
  const series = buildSeries(registry, options);
  const seriesByGameId = new Map();
  for (const group of series.values()) for (const member of group.members) seriesByGameId.set(member.game_id, group);

  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game') continue;
    const slug = String(game.identity?.slug?.value ?? '').trim();
    if (!slug) continue;
    const variants = (game.variants ?? []).filter(variant => variant?.slug && variant?.id).map(variantView);
    const seriesGroup = seriesByGameId.get(game.id) ?? null;
    if (!variants.length && !seriesGroup) continue;
    games[slug] = {
      game_id: game.id,
      variants,
      series: seriesGroup ? {
        series_id: seriesGroup.id,
        title: seriesGroup.title,
        members: seriesGroup.members.map(member => ({...member, current: member.game_id === game.id}))
      } : null
    };
    for (const variant of variants) {
      redirects[variant.slug] = {
        game_id: game.id,
        variant_id: variant.variant_id,
        target_slug: slug,
        target_hash: 'editions'
      };
    }
  }
  return {
    schema_version: 2,
    generated_at: registry.generatedAt ?? null,
    games,
    redirects
  };
}
