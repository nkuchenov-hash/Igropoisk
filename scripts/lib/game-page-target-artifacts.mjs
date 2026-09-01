export function parserRunBelongsToSlug(filename, slug) {
  const name = String(filename || '').trim().toLowerCase();
  const target = String(slug || '').trim().toLowerCase();
  if (!target || !name.endsWith('.json')) return false;
  const stem = name.slice(0, -5);
  return stem === target || stem.endsWith(`-${target}`);
}
