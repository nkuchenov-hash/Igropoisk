from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus

@dataclass(frozen=True)
class SourceAdapter:
    name: str
    domain: str
    kind: str
    trust: float
    queries: tuple[str, ...]

    def search_queries(self, title: str) -> list[str]:
        return [q.format(title=title, encoded=quote_plus(title)) for q in self.queries]

# Registry order is intentional: official/store/database first, then editorial.
REGISTRY: tuple[SourceAdapter, ...] = (
    SourceAdapter("Official website", "", "official", 1.00, ('"{title}" official site game',)),
    SourceAdapter("Steam", "store.steampowered.com", "store", .98, ('site:store.steampowered.com/app "{title}"',)),
    SourceAdapter("GOG", "gog.com", "store", .96, ('site:gog.com/game "{title}"',)),
    SourceAdapter("PlayStation", "playstation.com", "store", .96, ('site:playstation.com "{title}"',)),
    SourceAdapter("Xbox", "xbox.com", "store", .96, ('site:xbox.com/games/store "{title}"',)),
    SourceAdapter("Nintendo", "nintendo.com", "store", .96, ('site:nintendo.com "{title}"',)),
    SourceAdapter("Epic Games", "store.epicgames.com", "store", .96, ('site:store.epicgames.com "{title}"',)),
    SourceAdapter("Metacritic", "metacritic.com", "database", .90, ('site:metacritic.com/game "{title}"',)),
    SourceAdapter("OpenCritic", "opencritic.com", "database", .90, ('site:opencritic.com/game "{title}"',)),
    SourceAdapter("IGDB", "igdb.com", "database", .88, ('site:igdb.com/games "{title}"',)),
    SourceAdapter("RAWG", "rawg.io", "database", .86, ('site:rawg.io/games "{title}"',)),
    SourceAdapter("IGN", "ign.com", "editorial", .86, ('site:ign.com/articles "{title}" review', 'site:ign.com/games "{title}"')),
    SourceAdapter("GameSpot", "gamespot.com", "editorial", .86, ('site:gamespot.com/reviews "{title}"', 'site:gamespot.com/games "{title}"')),
    SourceAdapter("PC Gamer", "pcgamer.com", "editorial", .86, ('site:pcgamer.com "{title}" review',)),
    SourceAdapter("Eurogamer", "eurogamer.net", "editorial", .86, ('site:eurogamer.net "{title}" review',)),
    SourceAdapter("Rock Paper Shotgun", "rockpapershotgun.com", "editorial", .84, ('site:rockpapershotgun.com "{title}"',)),
    SourceAdapter("GamesRadar+", "gamesradar.com", "editorial", .82, ('site:gamesradar.com "{title}" review',)),
    SourceAdapter("Polygon", "polygon.com", "editorial", .82, ('site:polygon.com "{title}" review',)),
    SourceAdapter("Игромания", "igromania.ru", "editorial", .82, ('site:igromania.ru "{title}"',)),
    SourceAdapter("StopGame", "stopgame.ru", "editorial", .82, ('site:stopgame.ru "{title}" обзор', 'site:stopgame.ru/game "{title}"')),
    SourceAdapter("GameMAG", "gamemag.ru", "editorial", .80, ('site:gamemag.ru "{title}"',)),
    SourceAdapter("DTF", "dtf.ru", "editorial", .72, ('site:dtf.ru "{title}" обзор',)),
)

EDITORIAL_DOMAINS = {a.domain for a in REGISTRY if a.kind == "editorial"}
STORE_DOMAINS = {a.domain for a in REGISTRY if a.kind == "store"}
DATABASE_DOMAINS = {a.domain for a in REGISTRY if a.kind == "database"}
