#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/public/games.json'
CATALOG = ROOT / 'data/public/catalog.json'
GAME_ROOT = ROOT / 'game'
LEGACY_BUILDER = ROOT / 'parser/build_pages.py'


def load_legacy_builder():
    spec = importlib.util.spec_from_file_location('igropoisk_legacy_page_builder', LEGACY_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load page renderer: {LEGACY_BUILDER}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, 'page', None)):
        raise RuntimeError('Legacy page renderer does not expose page(game)')
    return module


def load_json_list(path: Path):
    if not path.exists():
        return []
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, list):
        raise ValueError(f'Expected JSON array in {path}')
    return value


def catalog_record(game):
    identity = game['identity']
    media = game.get('media', {})
    ratings = game.get('ratings', {})
    release = game.get('release', {})
    classification = game.get('classification', {})
    editorial = game.get('editorial', {})
    slug = identity['slug']
    return {
        'slug': slug,
        'title': identity['title'],
        'url': f'game/{slug}/',
        'cover': media.get('cover'),
        'hero': media.get('hero'),
        'score': ratings.get('igropoisk'),
        'year': release.get('date_text'),
        'genres': classification.get('genres', []),
        'description': editorial.get('short_description', ''),
    }


def main():
    games = load_json_list(DATA)
    publishable = [
        game for game in games
        if game.get('publication', {}).get('gate_passed')
    ]

    if not publishable:
        print('No publishable games; existing game pages and catalog remain unchanged')
        return

    renderer = load_legacy_builder()
    GAME_ROOT.mkdir(exist_ok=True)

    existing_catalog = load_json_list(CATALOG)
    catalog_by_slug = {
        row.get('slug'): row
        for row in existing_catalog
        if isinstance(row, dict) and row.get('slug')
    }
    order = [
        row['slug'] for row in existing_catalog
        if isinstance(row, dict) and row.get('slug')
    ]

    existing_slugs = set(catalog_by_slug)
    generated = []
    for game in publishable:
        slug = game['identity']['slug']
        if slug == '_shared' or '/' in slug or '\\' in slug:
            raise ValueError(f'Unsafe game slug: {slug!r}')
        output = GAME_ROOT / slug
        output.mkdir(parents=True, exist_ok=True)
        (output / 'index.html').write_text(renderer.page(game), encoding='utf-8')
        if slug not in catalog_by_slug:
            order.append(slug)
        catalog_by_slug[slug] = catalog_record(game)
        generated.append(slug)

    merged_catalog = [catalog_by_slug[slug] for slug in order if slug in catalog_by_slug]
    encoded_catalog = json.dumps(merged_catalog, ensure_ascii=False, indent=2)
    if not CATALOG.exists() or CATALOG.read_text(encoding='utf-8') != encoded_catalog:
        CATALOG.parent.mkdir(parents=True, exist_ok=True)
        CATALOG.write_text(encoded_catalog, encoding='utf-8')

    print(
        f'Upserted {len(generated)} public pages; '
        f'preserved {len(existing_slugs.difference(generated))} existing catalog entries'
    )


if __name__ == '__main__':
    main()
