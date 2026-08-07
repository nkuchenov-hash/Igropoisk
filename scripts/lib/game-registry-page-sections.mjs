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

export function buildGamePageSections(registry = {}) {
  const games = {};
  const redirects = {};
  for (const game of Object.values(registry.games ?? {})) {
    if (game.workflow?.status === 'merged_into_another_game') continue;
    const slug = String(game.identity?.slug?.value ?? '').trim();
    if (!slug) continue;
    const variants = (game.variants ?? []).filter(variant => variant?.slug && variant?.id).map(variantView);
    if (!variants.length) continue;
    games[slug] = {
      game_id: game.id,
      variants
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
    schema_version: 1,
    generated_at: registry.generatedAt ?? null,
    games,
    redirects
  };
}
