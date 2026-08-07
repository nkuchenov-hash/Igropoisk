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

function seriesDescriptor(game = {}) {
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

function buildSeries(registry = {}) {
  const groups = new Map();
  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game') continue;
    if (game.presentation?.standalonePage === false) continue;
    const descriptor = seriesDescriptor(game);
    const slug = String(game.identity?.slug?.value ?? '').trim();
    if (!descriptor || !slug) continue;
    const group = groups.get(descriptor.id) ?? {id: descriptor.id, title: descriptor.title, members: []};
    group.members.push({
      game_id: game.id,
      slug,
      title: String(game.identity?.canonicalTitle?.value ?? slug),
      year: yearOf(game),
      kind: game.identity?.kind?.value ?? 'game',
      relation: descriptor.relation,
      order: descriptor.order,
      image: imageOf(game)
    });
    groups.set(descriptor.id, group);
  }
  for (const group of groups.values()) {
    group.members.sort((a,b) => {
      if (a.order !== null || b.order !== null) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);
      return (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title);
    });
  }
  return groups;
}

export function buildGamePageSections(registry = {}) {
  const games = {};
  const redirects = {};
  const series = buildSeries(registry);
  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game') continue;
    const slug = String(game.identity?.slug?.value ?? '').trim();
    if (!slug) continue;
    const variants = (game.variants ?? []).filter(variant => variant?.slug && variant?.id).map(variantView);
    const descriptor = seriesDescriptor(game);
    const seriesGroup = descriptor ? series.get(descriptor.id) ?? null : null;
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
