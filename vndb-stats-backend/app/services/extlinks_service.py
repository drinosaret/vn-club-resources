"""
URL construction module for VNDB external links.

Converts (site, value) pairs from VNDB's extlinks dump into full URLs.
URL templates sourced from VNDB's ExtLinks.pm.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PostgreSQL array literal helpers
# ---------------------------------------------------------------------------

def parse_pg_array(value: Optional[str]) -> list[str]:
    """Parse a PostgreSQL array literal like ``{val1,val2}`` into a Python list.

    Also handles plain text values (not wrapped in braces) — some VNDB wikidata
    columns (e.g. enwiki, jawiki) store single values without array syntax.

    Returns an empty list for ``None``, empty string, or the null marker ``\\N``.
    """
    if value is None or value == "" or value == "\\N":
        return []

    s = value.strip()
    if not s:
        return []

    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1]
        if not inner:
            return []
        # Simple split – VNDB values don't contain commas or quotes in these fields.
        return [v for v in inner.split(",") if v]

    # Plain text value (no array braces) — treat as single-element list
    return [s]


def first_pg_array(value: Optional[str]) -> Optional[str]:
    """Return the first element of a PG array literal, or ``None``."""
    items = parse_pg_array(value)
    return items[0] if items else None


# ---------------------------------------------------------------------------
# Standard URL templates  (site → URL with ``{v}`` placeholder)
# ---------------------------------------------------------------------------

_STANDARD_TEMPLATES: dict[str, str] = {
    "afdian":           "https://afdian.com/a/{v}",
    "anidb":            "https://anidb.net/cr{v}",
    "animateg":         "https://www.animategames.jp/home/detail/{v}",
    "anison":           "http://anison.info/data/person/{v}.html",
    "appstore":         "https://apps.apple.com/app/id{v}",
    "bgmtv":            "https://bgm.tv/person/{v}",
    "bilibili":         "https://space.bilibili.com/{v}",
    "boosty":           "https://boosty.to/{v}",
    "booth":            "https://booth.pm/en/items/{v}",
    "booth_pub":        "https://{v}.booth.pm/",
    "bsky":             "https://bsky.app/profile/{v}",
    "cien":             "https://ci-en.dlsite.com/creator/{v}",
    "denpa":            "https://denpasoft.com/product/{v}/",
    "deviantar":        "https://www.deviantart.com/{v}",
    "discogs":          "https://www.discogs.com/artist/{v}",
    "dlsiteen":         "https://www.dlsite.com/eng/work/=/product_id/{v}.html",
    "egs":              "https://erogamescape.dyndns.org/~ap2/ero/toukei_kaiseki/game.php?game={v}",
    "egs_creator":      "https://erogamescape.dyndns.org/~ap2/ero/toukei_kaiseki/creater.php?creater={v}",
    "encubed":          "http://novelnews.net/tag/{v}/",
    "erotrail":         "http://erogetrailers.com/soft/{v}",
    "facebook":         "https://www.facebook.com/{v}",
    "fakku":            "https://www.fakku.net/games/{v}",
    "fanbox":           "https://{v}.fanbox.cc/",
    "fantia":           "https://fantia.jp/fanclubs/{v}",
    "freegame":         "https://freegame-mugen.jp/{v}.html",
    "freem":            "https://www.freem.ne.jp/win/game/{v}",
    "gamefaqs_comp":    "https://gamefaqs.gamespot.com/company/{v}-",
    "gamejolt":         "https://gamejolt.com/games/vn/{v}",
    "getchu":           "http://www.getchu.com/soft.phtml?id={v}",
    "getchudl":         "http://dl.getchu.com/i/item{v}",
    "gog":              "https://www.gog.com/en/game/{v}",
    "googplay":         "https://play.google.com/store/apps/details?id={v}",
    "gyutto":           "https://gyutto.com/i/item{v}",
    "imdb":             "https://www.imdb.com/name/nm{v}",
    "instagram":        "https://www.instagram.com/{v}/",
    "itch_dev":         "https://{v}.itch.io/",
    "jlist":            "https://jlist.com/shop/product/{v}",
    "johren":           "https://www.johren.games/games/download/{v}/",
    "kagura":           "https://www.kaguragames.com/product/{v}/",
    "kofi":             "https://ko-fi.com/{v}",
    "mbrainz":          "https://musicbrainz.org/artist/{v}",
    "melonjp":          "https://www.melonbooks.co.jp/detail/detail.php?product_id={v}",
    "mg":               "https://www.mangagamer.com/detail.php?product_code={v}",
    "mobygames":        "https://www.mobygames.com/person/{v}",
    "mobygames_comp":   "https://www.mobygames.com/company/{v}",
    "nijie":            "https://nijie.info/members.php?id={v}",
    "nintendo":         "https://www.nintendo.com/store/products/{v}/",
    "nintendo_hk":      "https://store.nintendo.com.hk/{v}",
    "nintendo_jp":      "https://store-jp.nintendo.com/item/software/D{v}",
    "novelgam":         "https://novelgame.jp/games/show/{v}",
    "nutaku":           "https://www.nutaku.net/games/{v}/",
    "patreon":          "https://www.patreon.com/{v}",
    "patreonp":         "https://www.patreon.com/posts/{v}",
    "pixiv":            "https://www.pixiv.net/member.php?id={v}",
    "playstation_eu":   "https://store.playstation.com/en-gb/product/{v}",
    "playstation_hk":   "https://store.playstation.com/en-hk/product/{v}",
    "playstation_jp":   "https://store.playstation.com/ja-jp/product/{v}",
    "playstation_na":   "https://store.playstation.com/en-us/product/{v}",
    "renai":            "https://renai.us/game/{v}",
    "scloud":           "https://soundcloud.com/{v}",
    "steam":            "https://store.steampowered.com/app/{v}/",
    "steam_curator":    "https://store.steampowered.com/curator/{v}",
    "substar":          "https://subscribestar.{v}",
    "toranoana":        "https://ec.toranoana.shop/tora/ec/item/{v}/",
    "tumblr":           "https://{v}.tumblr.com/",
    "twitter":          "https://x.com/{v}",
    "vgmdb":            "https://vgmdb.net/artist/{v}",
    "vgmdb_org":        "https://vgmdb.net/org/{v}",
    "vk":               "https://vk.com/{v}",
    "vndb":             "https://vndb.org/{v}",
    "weibo":            "https://weibo.com/u/{v}",
    "wikidata":         "https://www.wikidata.org/wiki/Q{v}",
    "wp":               "https://en.wikipedia.org/wiki/{v}",
    "youtube":          "https://www.youtube.com/@{v}",
}


# ---------------------------------------------------------------------------
# build_extlink_url
# ---------------------------------------------------------------------------

def build_extlink_url(site: str, value: Optional[str]) -> Optional[str]:
    """Convert a ``(site, value)`` pair into a full URL.

    Returns ``None`` for unknown sites, missing values, or invalid input.
    """
    if not value or value == "\\N":
        return None

    # ------------------------------------------------------------------
    # Passthrough sites (value is already a URL or nearly so)
    # ------------------------------------------------------------------
    if site == "website":
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return f"https://{value}"

    if site == "dmm":
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return f"https://{value}"

    # ------------------------------------------------------------------
    # Split-value sites (value contains ``/``, needs splitting)
    # ------------------------------------------------------------------
    if site == "dlsite":
        if "/" in value:
            part1, part2 = value.split("/", 1)
            return f"https://www.dlsite.com/{part1}/work/=/product_id/{part2}.html"
        # Fallback: assume maniax category
        return f"https://www.dlsite.com/maniax/work/=/product_id/{value}.html"

    if site == "itch":
        if "/" in value:
            user, game = value.split("/", 1)
            return f"https://{user}.itch.io/{game}"
        return None

    if site == "jastusa":
        if "/" in value:
            part1, part2 = value.split("/", 1)
            return f"https://jastusa.com/games/{part1}/{part2}"
        return f"https://jastusa.com/games/{value}"

    if site == "playasia":
        if "/" in value:
            part1, part2 = value.split("/", 1)
            return f"https://www.play-asia.com/{part1}/13/70{part2}"
        return None

    # ------------------------------------------------------------------
    # Special handling: digiket (7-digit zero-padded)
    # ------------------------------------------------------------------
    if site == "digiket":
        try:
            num = int(value)
            return f"https://www.digiket.com/work/show/_data/ID=ITM{num:07d}/"
        except (ValueError, TypeError):
            return None

    # ------------------------------------------------------------------
    # Standard template sites
    # ------------------------------------------------------------------
    template = _STANDARD_TEMPLATES.get(site)
    if template is not None:
        return template.replace("{v}", str(value))

    # Unknown site
    logger.debug("Unknown extlink site: %s (value=%s)", site, value)
    return None


# ---------------------------------------------------------------------------
# Site labels
# ---------------------------------------------------------------------------

_SITE_LABELS: dict[str, str] = {
    # Stores / shops
    "steam":            "Steam",
    "steam_curator":    "Steam Curator",
    "dlsite":           "DLsite",
    "dlsiteen":         "DLsite (EN)",
    "dmm":              "DMM",
    "getchu":           "Getchu",
    "getchudl":         "Getchu DL",
    "digiket":          "DigiKet",
    "gyutto":           "Gyutto",
    "playasia":         "Play-Asia",
    "jastusa":          "JAST USA",
    "mg":               "MangaGamer",
    "denpa":            "Denpasoft",
    "fakku":            "FAKKU",
    "nutaku":           "Nutaku",
    "kagura":           "Kagura Games",
    "gog":              "GOG",
    "itch":             "itch.io",
    "itch_dev":         "itch.io (Dev)",
    "booth":            "BOOTH",
    "booth_pub":        "BOOTH (Publisher)",
    "melonjp":          "Melonbooks",
    "toranoana":        "Toranoana",
    "jlist":            "J-List",
    "johren":           "Johren",
    "animateg":         "Animate Games",
    "freegame":         "Freegame Mugen",
    "freem":            "Freem",
    "novelgam":         "NovelGame.jp",
    "gamejolt":         "Game Jolt",
    "googplay":         "Google Play",
    "appstore":         "App Store",
    "nintendo":         "Nintendo eShop",
    "nintendo_jp":      "Nintendo eShop (JP)",
    "nintendo_hk":      "Nintendo eShop (HK)",
    "playstation_jp":   "PlayStation Store (JP)",
    "playstation_na":   "PlayStation Store (NA)",
    "playstation_eu":   "PlayStation Store (EU)",
    "playstation_hk":   "PlayStation Store (HK)",

    # Funding / subscription
    "patreon":          "Patreon",
    "patreonp":         "Patreon (Post)",
    "substar":          "SubscribeStar",
    "fanbox":           "pixivFANBOX",
    "fantia":           "Fantia",
    "cien":             "Ci-en",
    "kofi":             "Ko-fi",
    "boosty":           "Boosty",
    "afdian":           "Afdian",

    # Reference / database sites
    "wikidata":         "Wikidata",
    "wp":               "Wikipedia",
    "renai":            "Ren'Ai Archive",
    "encubed":          "encubed",
    "egs":              "ErogameScape",
    "egs_creator":      "ErogameScape (Creator)",
    "website":          "Official Website",
    "vndb":             "VNDB",
    "erotrail":         "ErogeTrailers",
    "anidb":            "AniDB",
    "bgmtv":            "Bangumi",
    "mobygames":        "MobyGames",
    "mobygames_comp":   "MobyGames (Company)",
    "gamefaqs_comp":    "GameFAQs (Company)",
    "imdb":             "IMDb",
    "discogs":          "Discogs",
    "mbrainz":          "MusicBrainz",
    "vgmdb":            "VGMDb",
    "vgmdb_org":        "VGMDb (Org)",
    "anison":           "Anison",

    # Social media
    "twitter":          "X (Twitter)",
    "bsky":             "Bluesky",
    "facebook":         "Facebook",
    "instagram":        "Instagram",
    "tumblr":           "Tumblr",
    "vk":               "VK",
    "weibo":            "Weibo",
    "bilibili":         "Bilibili",
    "youtube":          "YouTube",
    "scloud":           "SoundCloud",

    # Art / creative platforms
    "pixiv":            "pixiv",
    "nijie":            "Nijie",
    "deviantar":        "DeviantArt",
}


def get_site_label(site: str) -> str:
    """Return a human-readable label for a site identifier.

    Falls back to ``site.replace("_", " ").title()`` for unknown sites.
    """
    return _SITE_LABELS.get(site, site.replace("_", " ").title())


# ---------------------------------------------------------------------------
# Site category sets
# ---------------------------------------------------------------------------

SHOP_SITES: set[str] = {
    "steam",
    "dlsite",
    "dlsiteen",
    "dmm",
    "getchu",
    "getchudl",
    "digiket",
    "gyutto",
    "playasia",
    "jastusa",
    "mg",
    "denpa",
    "fakku",
    "nutaku",
    "kagura",
    "gog",
    "itch",
    "itch_dev",
    "booth",
    "booth_pub",
    "melonjp",
    "toranoana",
    "jlist",
    "johren",
    "animateg",
    "novelgam",
    "gamejolt",
    "googplay",
    "appstore",
    "nintendo",
    "nintendo_jp",
    "nintendo_hk",
    "playstation_jp",
    "playstation_na",
    "playstation_eu",
    "playstation_hk",
    # Funding / subscription
    "patreon",
    "patreonp",
    "substar",
    "fanbox",
    "fantia",
    "cien",
    "kofi",
    "boosty",
    "afdian",
}

LINK_SITES: set[str] = {
    "wikidata",
    "wp",
    "renai",
    "egs",
    "website",
    "freem",
    "freegame",
}

# Sites deprecated by VNDB — still in data dumps but no longer functional.
# These are filtered out from display.
DEPRECATED_SITES: set[str] = {
    "encubed",     # novelnews.net is dead
    "erotrail",    # erogetrailers.com down since early 2022
    "dlsiteen",    # DLsite EN merged into main DLsite storefront
}

# Shops that only sell translated/localized versions — not useful for reading
# Japanese originals, which is the site's purpose.
TRANSLATION_ONLY_SITES: set[str] = {
    "jastusa",     # JAST USA — English localizations only
    "mg",          # MangaGamer — English localizations only
    "denpa",       # Denpasoft — MangaGamer's 18+ English label
    "fakku",       # FAKKU — English versions only
    "nutaku",      # Nutaku — English/localized platform
    "kagura",      # Kagura Games — English localization publisher
}

# Sort priority for links (lower = first). Sites not listed default to 50.
LINK_SORT_ORDER: dict[str, int] = {
    "website":          0,
    "enwiki":           1,
    "jawiki":           2,
    "egs":              3,
    "renai":            5,
    "wp":               6,
    "freem":            7,
    "mobygames_game":  10,
    "igdb_game":       11,
    "howlongtobeat":   12,
    "pcgamingwiki":    13,
    "gamefaqs_game":   14,
    "anidb_anime":     20,
    "ann_anime":       21,
    "acdb_source":     22,
    "lutris":          30,
    "wine":            31,
    "freegame":        40,
}

# Sort priority for shops (lower = first). Sites not listed default to 50.
SHOP_SORT_ORDER: dict[str, int] = {
    "steam":            0,
    "dlsite":           1,
    "dmm":              2,
    "getchu":           3,
    "getchudl":         4,
    "booth":            5,
    "booth_pub":        6,
    "melonjp":          7,
    "toranoana":        8,
    "animateg":         9,
    "digiket":         10,
    "gyutto":          11,
    "googplay":        15,
    "appstore":        16,
    "nintendo_jp":     17,
    "nintendo":        18,
    "nintendo_hk":     19,
    "playstation_jp":  20,
    "playstation_na":  21,
    "playstation_eu":  22,
    "playstation_hk":  23,
    "itch":            25,
    "itch_dev":        26,
    "gog":             27,
    "gamejolt":        28,
    "novelgam":        29,
    "jlist":           30,
    "playasia":        31,
}


# ---------------------------------------------------------------------------
# Wikidata link map
# ---------------------------------------------------------------------------

WIKIDATA_LINK_MAP: dict[str, tuple[str, str]] = {
    "enwiki":          ("Wikipedia (en)",   "https://en.wikipedia.org/wiki/{v}"),
    "jawiki":          ("Wikipedia (ja)",   "https://ja.wikipedia.org/wiki/{v}"),
    "mobygames_game":  ("MobyGames",        "https://www.mobygames.com/game/{v}/"),
    "gamefaqs_game":   ("GameFAQs",         "https://gamefaqs.gamespot.com/-/{v}-"),
    "howlongtobeat":   ("HowLongToBeat",    "http://howlongtobeat.com/game.php?id={v}"),
    "igdb_game":       ("IGDB",             "https://www.igdb.com/games/{v}"),
    "pcgamingwiki":    ("PCGamingWiki",     "https://www.pcgamingwiki.com/wiki/{v}"),
    "steam":           ("Steam",            "https://store.steampowered.com/app/{v}/"),
    "gog":             ("GOG",              "https://www.gog.com/en/game/{v}"),
    "lutris":          ("Lutris",           "https://lutris.net/games/{v}/"),
    "wine":            ("Wine AppDB",       "https://appdb.winehq.org/appview.php?iAppId={v}"),
    "anidb_anime":     ("AniDB",            "https://anidb.net/anime/{v}"),
    "ann_anime":       ("ANN",              "https://www.animenewsnetwork.com/encyclopedia/anime.php?id={v}"),
    "acdb_source":     ("ACDB",             "https://www.animecharactersdatabase.com/source.php?id={v}"),
}


def build_wikidata_links(wikidata_row: Optional[dict[str, Optional[str]]]) -> list[dict[str, str]]:
    """Build resolved external links from a wikidata entries row.

    *wikidata_row* is a dict whose keys are column names (e.g. ``"enwiki"``,
    ``"steam"``) and whose values are PostgreSQL array literals.

    For each column present in :data:`WIKIDATA_LINK_MAP`, every array element
    produces a ``{"site": …, "url": …, "label": …}`` dict.

    Returns a list of all resolved links.
    """
    if not wikidata_row:
        return []

    results: list[dict[str, str]] = []
    for column, (label, url_template) in WIKIDATA_LINK_MAP.items():
        raw_value = wikidata_row.get(column)
        values = parse_pg_array(raw_value)
        for v in values:
            url = url_template.replace("{v}", v)
            results.append({
                "site": column,
                "url": url,
                "label": label,
            })

    return results
