#!/usr/bin/env python3
"""Inject and verify the mandatory Igropoisk layout and shared-header contracts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER_STYLE_TAG = (
    '<link rel="stylesheet" href="/Igropoisk/assets/site-header.css?v=20260803-2" '
    'data-ig-shared-header="style">'
)
STYLE_TAG = (
    '<link rel="stylesheet" href="/Igropoisk/assets/layout-contract.css?v=20260803-1" '
    'data-ig-layout-contract="style">'
)
HEADER_SCRIPT_TAG = (
    '<script src="/Igropoisk/assets/site-header.js?v=20260803-2" '
    'data-ig-shared-header="script" defer></script>'
)
SCRIPT_TAG = (
    '<script src="/Igropoisk/assets/layout-contract.js?v=20260803-1" '
    'data-ig-layout-contract="script" defer></script>'
)
HEADER_STYLE_PATTERN = re.compile(
    r"\s*<link\b[^>]*\bdata-ig-shared-header\s*=\s*(['\"])style\1[^>]*>\s*",
    re.IGNORECASE,
)
STYLE_PATTERN = re.compile(
    r"\s*<link\b[^>]*\bdata-ig-layout-contract\s*=\s*(['\"])style\1[^>]*>\s*",
    re.IGNORECASE,
)
HEADER_SCRIPT_PATTERN = re.compile(
    r"\s*<script\b[^>]*\bdata-ig-shared-header\s*=\s*(['\"])script\1[^>]*>\s*</script>\s*",
    re.IGNORECASE,
)
SCRIPT_PATTERN = re.compile(
    r"\s*<script\b[^>]*\bdata-ig-layout-contract\s*=\s*(['\"])script\1[^>]*>\s*</script>\s*",
    re.IGNORECASE,
)
EXCEPTION_PATTERN = re.compile(
    r"\bdata-ig-width-exception\s*=\s*(['\"])([^'\"]+)\1",
    re.IGNORECASE,
)
RESERVED_TOKENS = ("--ig-contract-max", "--ig-contract-gutter")
RESERVED_ALLOWED = {
    Path("assets/layout-contract.css"),
    Path("assets/layout-contract.js"),
    Path("scripts/enforce_layout_contract.py"),
}
TEXT_SUFFIXES = {".css", ".html", ".htm", ".js", ".mjs"}
SKIPPED_PARTS = {".git", "node_modules", "vendor"}


class ContractError(RuntimeError):
    pass


def relative(path: Path) -> Path:
    return path.resolve().relative_to(ROOT)


def public_html_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.html")
        if not any(part in SKIPPED_PARTS for part in relative(path).parts)
    )


def insert_before_closing(text: str, closing_tag: str, payload: str, path: Path) -> str:
    matches = list(re.finditer(re.escape(closing_tag), text, re.IGNORECASE))
    if not matches:
        raise ContractError(f"{relative(path)}: missing {closing_tag}")
    match = matches[-1]
    prefix = text[: match.start()].rstrip()
    suffix = text[match.start() :]
    return f"{prefix}\n  {payload}\n{suffix}"


def canonicalize_html(path: Path, write: bool) -> bool:
    original = path.read_text(encoding="utf-8")
    cleaned = HEADER_STYLE_PATTERN.sub("\n", original)
    cleaned = STYLE_PATTERN.sub("\n", cleaned)
    cleaned = HEADER_SCRIPT_PATTERN.sub("\n", cleaned)
    cleaned = SCRIPT_PATTERN.sub("\n", cleaned)
    cleaned = insert_before_closing(cleaned, "</head>", HEADER_STYLE_TAG, path)
    cleaned = insert_before_closing(cleaned, "</head>", STYLE_TAG, path)
    cleaned = insert_before_closing(cleaned, "</body>", HEADER_SCRIPT_TAG, path)
    cleaned = insert_before_closing(cleaned, "</body>", SCRIPT_TAG, path)
    changed = cleaned != original
    if write and changed:
        path.write_text(cleaned, encoding="utf-8")
    return changed


def verify_html(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    rel = relative(path)

    expected = (
        ('data-ig-shared-header="style"', HEADER_STYLE_TAG, "shared header stylesheet"),
        ('data-ig-layout-contract="style"', STYLE_TAG, "layout contract stylesheet"),
        ('data-ig-shared-header="script"', HEADER_SCRIPT_TAG, "shared header script"),
        ('data-ig-layout-contract="script"', SCRIPT_TAG, "layout contract script"),
    )
    for marker, canonical, label in expected:
        if text.count(marker) != 1:
            errors.append(f"{rel}: expected exactly one {label}")
        if canonical not in text:
            errors.append(f"{rel}: {label} is not canonical")

    header_style_pos = text.find(HEADER_STYLE_TAG)
    style_pos = text.find(STYLE_TAG)
    head_pos = text.lower().rfind("</head>")
    if header_style_pos >= 0 and style_pos >= 0 and header_style_pos > style_pos:
        errors.append(f"{rel}: shared header stylesheet must load before layout contract")
    if style_pos >= 0 and head_pos >= 0:
        after_style = text[style_pos + len(STYLE_TAG) : head_pos]
        if after_style.strip():
            errors.append(f"{rel}: layout contract stylesheet must be last in <head>")

    header_script_pos = text.find(HEADER_SCRIPT_TAG)
    script_pos = text.find(SCRIPT_TAG)
    body_pos = text.lower().rfind("</body>")
    if header_script_pos >= 0 and script_pos >= 0 and header_script_pos > script_pos:
        errors.append(f"{rel}: shared header script must load before layout contract guard")
    if script_pos >= 0 and body_pos >= 0:
        after_script = text[script_pos + len(SCRIPT_TAG) : body_pos]
        if after_script.strip():
            errors.append(f"{rel}: layout contract script must be last in <body>")

    return errors


def load_exceptions() -> dict[tuple[str, str], dict[str, str]]:
    registry_path = ROOT / "config/layout-width-exceptions.json"
    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"Invalid exception registry: {exc}") from exc

    entries = payload.get("exceptions")
    if not isinstance(entries, list):
        raise ContractError("config/layout-width-exceptions.json: exceptions must be an array")

    registry: dict[tuple[str, str], dict[str, str]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ContractError(f"Exception #{index + 1} must be an object")
        required = ("path", "token", "reason", "approved_by")
        missing = [key for key in required if not str(entry.get(key, "")).strip()]
        if missing:
            raise ContractError(
                f"Exception #{index + 1} is missing: {', '.join(missing)}"
            )
        key = (str(entry["path"]).replace("\\", "/"), str(entry["token"]))
        if key in registry:
            raise ContractError(f"Duplicate layout exception: {key[0]} / {key[1]}")
        registry[key] = entry
    return registry


def verify_exceptions(html_files: list[Path]) -> list[str]:
    registry = load_exceptions()
    used: set[tuple[str, str]] = set()
    errors: list[str] = []

    for path in html_files:
        rel = relative(path).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in EXCEPTION_PATTERN.finditer(text):
            token = match.group(2).strip()
            key = (rel, token)
            if key not in registry:
                errors.append(
                    f"{rel}: unapproved data-ig-width-exception token '{token}'"
                )
            else:
                used.add(key)

    for key in sorted(set(registry) - used):
        errors.append(f"Unused registered layout exception: {key[0]} / {key[1]}")

    return errors


def verify_reserved_tokens() -> list[str]:
    errors: list[str] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        rel = relative(path)
        if any(part in SKIPPED_PARTS for part in rel.parts) or rel in RESERVED_ALLOWED:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        found = [token for token in RESERVED_TOKENS if token in text]
        if found:
            errors.append(
                f"{rel}: reserved layout token override ({', '.join(found)})"
            )
    return errors


def verify_assets() -> list[str]:
    required = (
        Path("assets/site-header.css"),
        Path("assets/site-header.js"),
        Path("assets/layout-contract.css"),
        Path("assets/layout-contract.js"),
    )
    return [f"Missing mandatory asset: {path}" for path in required if not (ROOT / path).is_file()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write",
        action="store_true",
        help="inject or move canonical shared assets before validating",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate only; this is the default when --write is absent",
    )
    args = parser.parse_args()

    try:
        html_files = public_html_files()
        if not html_files:
            raise ContractError("No public HTML files found")

        changed = 0
        if args.write:
            for path in html_files:
                changed += int(canonicalize_html(path, write=True))

        errors: list[str] = []
        errors.extend(verify_assets())
        for path in html_files:
            errors.extend(verify_html(path))
        errors.extend(verify_exceptions(html_files))
        errors.extend(verify_reserved_tokens())

        if errors:
            print("Layout/header contract failed:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1

        mode = "updated and verified" if args.write else "verified"
        print(
            f"Layout/header contract {mode}: {len(html_files)} HTML files; "
            f"{changed} files changed; 0 unapproved exceptions."
        )
        return 0
    except ContractError as exc:
        print(f"Layout/header contract failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
