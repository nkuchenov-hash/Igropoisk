#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'parser/build_pages_safe.py'


def run_builder(repo: Path):
    subprocess.run(
        [sys.executable, str(repo / 'parser/build_pages_safe.py')],
        cwd=repo,
        check=True,
    )


def main():
    with tempfile.TemporaryDirectory(prefix='igropoisk-safe-builder-') as directory:
        repo = Path(directory)
        (repo / 'parser').mkdir()
        (repo / 'data/public').mkdir(parents=True)
        (repo / 'game/_shared').mkdir(parents=True)
        (repo / 'game/existing').mkdir(parents=True)
        shutil.copy2(SOURCE, repo / 'parser/build_pages_safe.py')
        (repo / 'parser/build_pages.py').write_text(
            "def page(game):\n    return '<html>' + game['identity']['slug'] + '</html>'\n",
            encoding='utf-8',
        )
        (repo / 'game/_shared/runtime.js').write_text('shared', encoding='utf-8')
        (repo / 'game/existing/index.html').write_text('existing', encoding='utf-8')
        (repo / 'data/public/catalog.json').write_text(
            json.dumps([
                {'slug': 'existing', 'title': 'Existing', 'url': 'game/existing/'},
            ], ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        (repo / 'data/public/games.json').write_text('[]', encoding='utf-8')

        run_builder(repo)
        assert (repo / 'game/_shared/runtime.js').read_text(encoding='utf-8') == 'shared'
        assert (repo / 'game/existing/index.html').read_text(encoding='utf-8') == 'existing'

        (repo / 'data/public/games.json').write_text(
            json.dumps([
                {
                    'identity': {'slug': 'new-game', 'title': 'New Game'},
                    'publication': {'gate_passed': True},
                    'media': {},
                    'ratings': {},
                    'release': {},
                    'classification': {},
                    'editorial': {},
                },
            ], ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        run_builder(repo)

        assert (repo / 'game/_shared/runtime.js').read_text(encoding='utf-8') == 'shared'
        assert (repo / 'game/existing/index.html').read_text(encoding='utf-8') == 'existing'
        assert 'new-game' in (repo / 'game/new-game/index.html').read_text(encoding='utf-8')
        catalog = json.loads((repo / 'data/public/catalog.json').read_text(encoding='utf-8'))
        assert [row['slug'] for row in catalog] == ['existing', 'new-game']

    print('Safe game page builder tests passed.')


if __name__ == '__main__':
    main()
