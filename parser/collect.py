#!/usr/bin/env python3
"""Igropoisk multi-source collector.

Collects factual metadata and media, discovers 10-20 source pages, stores evidence,
then publishes only records that pass the hard gate from PROJECT_RULES.md.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import requests
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parents[1]
UA = "IgropoiskBot/1.0 (+https://github.com/nkuchenov-hash/Igropoisk; editorial research)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.8,ru;q=0.6"})
TIMEOUT = 20
TRUST = {
    "official": 1.0, "store": .95, "database": .85, "editorial": .8,
    "community": .55, "unknown": .4,
}
EDITORIAL_DOMAINS = [
    "ign.com", "gamespot.com", "pcgamer.com", "eurogamer.net",
    "rockpapershotgun.com", "gamesradar.com", "polygon.com",
    "igromania.ru", "stopgame.ru", "gamemag.ru", "dtf.ru",
    "metacritic.com", "opencritic.com",
]
STORE_DOMAINS = ["store.steampowered.com", "playstation.com", "xbox.com", "nintendo.com", "epicgames.com", "gog.com"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(text: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", text.lower())
    return text.strip("-")


def clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", BeautifulSoup(html.unescape(text), "html.parser").get_text(" ")).strip()


def get_json(url: str, params: dict[str, Any] | None = None) -> Any:
    r = SESSION.get(url, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def source_type(url: str) -> str:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    if host in STORE_DOMAINS or any(host.endswith("." + d) for d in STORE_DOMAINS):
        return "store"
    if host in EDITORIAL_DOMAINS or any(host.endswith("." + d) for d in EDITORIAL_DOMAINS):
        return "editorial"
    if host.endswith("wikipedia.org") or host.endswith("wikidata.org") or host.endswith("rawg.io"):
        return "database"
    return "unknown"


def evidence(url: str, title: str, description: str = "", published: str = "", fields: list[str] | None = None) -> dict[str, Any]:
    kind = source_type(url)
    return {
        "url": url,
        "domain": urlparse(url).netloc.lower(),
        "title": clean(title),
        "description": clean(description)[:1200],
        "published_at": published,
        "checked_at": now(),
        "type": kind,
        "trust": TRUST[kind],
        "supports": fields or [],
        "fingerprint": hashlib.sha256(url.encode()).hexdigest()[:16],
    }


def resolve_steam(query: str) -> int | None:
    data = get_json("https://store.steampowered.com/api/storesearch/", {"term": query, "l": "english", "cc": "us"})
    best: tuple[int, int] | None = None
    for item in data.get("items", []):
        score = fuzz.token_set_ratio(query, item.get("name", ""))
        if score >= 72 and (best is None or score > best[0]):
            best = (score, int(item["id"]))
    return best[1] if best else None


def steam_record(appid: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = get_json("https://store.steampowered.com/api/appdetails", {"appids": appid, "l": "english", "cc": "us"})
    node = payload.get(str(appid), {})
    if not node.get("success"):
        return {}, []
    d = node["data"]
    url = f"https://store.steampowered.com/app/{appid}/"
    src = evidence(url, d.get("name", "Steam"), d.get("short_description", ""), fields=["identity", "release", "companies", "classification", "media", "description"])
    platforms = [k.title() for k, v in d.get("platforms", {}).items() if v]
    screenshots = [x.get("path_full") for x in d.get("screenshots", []) if x.get("path_full")]
    videos = []
    for movie in d.get("movies") or []:
        mp4 = (movie.get("mp4") or {}).get("max") or (movie.get("webm") or {}).get("max")
        if mp4:
            videos.append({"title": movie.get("name", "Official video"), "url": mp4, "source": url})
    release = (d.get("release_date") or {}).get("date", "")
    return {
        "steam_appid": appid,
        "title": d.get("name", ""),
        "short_description": clean(d.get("short_description")),
        "about": clean(d.get("about_the_game")),
        "release_date": release,
        "developers": d.get("developers") or [],
        "publishers": d.get("publishers") or [],
        "genres": [x.get("description") for x in d.get("genres") or [] if x.get("description")],
        "categories": [x.get("description") for x in d.get("categories") or [] if x.get("description")],
        "platforms": platforms,
        "cover": d.get("header_image", ""),
        "hero": d.get("background_raw") or d.get("background", ""),
        "screenshots": screenshots,
        "videos": videos,
        "metacritic": (d.get("metacritic") or {}).get("score"),
        "official_site": d.get("website", ""),
        "store_url": url,
    }, [src]


def wikipedia(query: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    search = get_json("https://en.wikipedia.org/w/api.php", {"action": "query", "list": "search", "srsearch": query + " video game", "format": "json", "utf8": 1})
    hits = search.get("query", {}).get("search", [])
    if not hits:
        return {}, []
    title = hits[0]["title"]
    page = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + quote_plus(title.replace(" ", "_")))
    url = ((page.get("content_urls") or {}).get("desktop") or {}).get("page", "")
    src = evidence(url, page.get("title", title), page.get("extract", ""), fields=["identity", "description", "context"])
    return {"title": page.get("title", title), "extract": clean(page.get("extract")), "thumbnail": ((page.get("thumbnail") or {}).get("source", ""))}, [src]


def ddg_links(query: str, limit: int = 20) -> list[str]:
    try:
        r = SESSION.get("https://html.duckduckgo.com/html/", params={"q": query}, timeout=TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        out: list[str] = []
        for a in soup.select("a.result__a"):
            href = a.get("href", "")
            if "uddg=" in href:
                href = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
            if href.startswith("http") and href not in out:
                out.append(href)
            if len(out) >= limit:
                break
        return out
    except Exception:
        return []


def discover_sources(title: str) -> list[str]:
    queries = [
        f'"{title}" official game',
        f'"{title}" review IGN GameSpot PC Gamer Eurogamer',
        f'"{title}" review Игромания StopGame GameMAG',
        f'"{title}" guide news',
    ]
    urls: list[str] = []
    for q in queries:
        for url in ddg_links(q, 12):
            if url not in urls:
                urls.append(url)
        time.sleep(.8)
    return urls[:30]


def probe(url: str) -> dict[str, Any] | None:
    try:
        r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True)
        if r.status_code >= 400 or "text/html" not in r.headers.get("content-type", ""):
            return None
        soup = BeautifulSoup(r.text[:1_500_000], "html.parser")
        title = (soup.title.string if soup.title and soup.title.string else "")
        desc = ""
        for selector in [('meta', {'property': 'og:description'}), ('meta', {'name': 'description'})]:
            tag = soup.find(selector[0], selector[1])
            if tag and tag.get("content"):
                desc = tag["content"]
                break
        published = ""
        for attrs in ({"property": "article:published_time"}, {"name": "date"}, {"itemprop": "datePublished"}):
            tag = soup.find("meta", attrs)
            if tag and tag.get("content"):
                published = tag["content"]
                break
        return evidence(r.url, title, desc, published, ["editorial_reference"])
    except Exception:
        return None


def merge_game(seed: str) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    steam: dict[str, Any] = {}
    try:
        appid = resolve_steam(seed)
        if appid:
            steam, src = steam_record(appid)
            sources.extend(src)
    except Exception as exc:
        steam = {"error": f"steam: {exc}"}
    try:
        wiki, src = wikipedia(seed)
        sources.extend(src)
    except Exception as exc:
        wiki = {"error": f"wikipedia: {exc}"}
    for url in discover_sources(seed):
        item = probe(url)
        if item and item["fingerprint"] not in {x["fingerprint"] for x in sources}:
            sources.append(item)
        if len(sources) >= 20:
            break
        time.sleep(.4)
    title = steam.get("title") or wiki.get("title") or seed
    description = steam.get("short_description") or wiki.get("extract", "")
    integrated = steam.get("about") or wiki.get("extract", "")
    record = {
        "publication": {"status": "collecting", "gate_passed": False, "checked_at": now(), "errors": []},
        "identity": {"slug": slugify(title), "title": title, "seed_title": seed, "steam_appid": steam.get("steam_appid")},
        "release": {"date_text": steam.get("release_date", "")},
        "companies": {"developers": steam.get("developers", []), "publishers": steam.get("publishers", [])},
        "classification": {"genres": steam.get("genres", []), "categories": steam.get("categories", []), "platforms": steam.get("platforms", [])},
        "editorial": {"short_description": description, "integrated_description": integrated, "features": (steam.get("categories") or [])[:8]},
        "media": {"cover": steam.get("cover", "") or wiki.get("thumbnail", ""), "hero": steam.get("hero", ""), "screenshots": steam.get("screenshots", []), "videos": steam.get("videos", [])},
        "ratings": {"igropoisk": round(steam["metacritic"] / 10, 1) if steam.get("metacritic") else None, "users": None, "user_votes": 0},
        "links": {"official": steam.get("official_site", ""), "store": steam.get("store_url", "")},
        "materials": {"reviews": [x for x in sources if x["type"] == "editorial"][:8], "news": [], "guides": []},
        "sources": sorted(sources, key=lambda x: x["trust"], reverse=True),
    }
    validate(record)
    return record


def validate(g: dict[str, Any]) -> None:
    errors: list[str] = []
    req = [
        (g["identity"].get("title"), "title"),
        (g["release"].get("date_text"), "release date"),
        (g["companies"].get("developers"), "developer"),
        (g["companies"].get("publishers"), "publisher"),
        (g["classification"].get("genres"), "genres"),
        (g["classification"].get("platforms"), "platforms"),
        (g["editorial"].get("short_description"), "short description"),
        (g["editorial"].get("integrated_description"), "integrated description"),
        (g["media"].get("cover"), "cover"),
        (g["media"].get("hero"), "hero"),
    ]
    for value, label in req:
        if not value:
            errors.append("missing " + label)
    if len(g["sources"]) < 10:
        errors.append(f"only {len(g['sources'])} sources; minimum 10")
    if len(g["media"].get("screenshots", [])) < 6:
        errors.append("fewer than 6 screenshots")
    if len(g["editorial"].get("features", [])) < 4:
        errors.append("fewer than 4 features")
    official_or_store = sum(1 for x in g["sources"] if x["type"] in {"official", "store"})
    editorial = sum(1 for x in g["sources"] if x["type"] == "editorial")
    if official_or_store < 1:
        errors.append("no official/store evidence")
    if editorial < 3:
        errors.append("fewer than 3 editorial sources")
    g["publication"]["errors"] = errors
    g["publication"]["gate_passed"] = not errors
    g["publication"]["status"] = "published" if not errors else "review"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--only", help="one exact seed title")
    args = ap.parse_args()
    seeds = json.loads((ROOT / "parser" / "seeds.json").read_text(encoding="utf-8"))
    if args.only:
        seeds = [x for x in seeds if x.lower() == args.only.lower()]
    seeds = seeds[: args.limit]
    drafts_dir = ROOT / "data" / "drafts"
    public_dir = ROOT / "data" / "public"
    drafts_dir.mkdir(parents=True, exist_ok=True)
    public_dir.mkdir(parents=True, exist_ok=True)
    published: list[dict[str, Any]] = []
    report = {"started_at": now(), "processed": 0, "published": 0, "review": 0, "items": []}
    for seed in seeds:
        print(f"Collecting {seed}", flush=True)
        game = merge_game(seed)
        slug = game["identity"]["slug"]
        (drafts_dir / f"{slug}.json").write_text(json.dumps(game, ensure_ascii=False, indent=2), encoding="utf-8")
        report["processed"] += 1
        if game["publication"]["gate_passed"]:
            published.append(game)
            report["published"] += 1
        else:
            report["review"] += 1
        report["items"].append({"slug": slug, "status": game["publication"]["status"], "errors": game["publication"]["errors"]})
    (public_dir / "games.json").write_text(json.dumps(published, ensure_ascii=False, indent=2), encoding="utf-8")
    report["finished_at"] = now()
    (ROOT / "data" / "parser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
