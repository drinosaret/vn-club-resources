"""What the aggregator reads.

Changing this list is a code change on purpose: every entry is an outbound request the
site makes on its own schedule, and the list is the place to see all of them at once.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import quote

# Terms that mark an article as being about the medium, for outlets that cover all games.
VN_TERMS = [
    "ビジュアルノベル", "ギャルゲ", "エロゲ", "美少女ゲーム", "ノベルゲーム", "アダルトゲーム",
    "18禁", "乙女ゲーム", "BLゲーム", "恋愛アドベンチャー",
]
OTHER_GENRES = [
    "アクション", "FPS", "TPS", "格闘", "シューティング", "レース", "RPG", "MMORPG",
    "ストラテジー", "シミュレーション", "スポーツ", "パズル",
    "リズムゲーム", "リズムゲー", "音ゲー",
]

# Terms that mark an English-language post as being about the medium, for accounts and
# outlets that cover games at large.
VN_TERMS_EN = [
    "visual novel", "eroge", "galge", "otome", "bishoujo", "bishojo", "nukige",
    "novel game", "doujin game", "dating sim", "kinetic novel", "sound novel",
    "adult game", "romance adventure", "escape game", "story game", " vn ", "vns ",
]
# The same in Japanese, for the boards and the community feeds.
VN_TERMS_JA = [
    "エロゲ", "ノベルゲー", "ノベルゲーム",
    "ビジュアルノベル", "ギャルゲ",
    "美少女ゲーム", "乙女ゲー",
    "アドベンチャーゲーム", "サウンドノベル",
    "紙芝居", "同人ゲー", "抜きゲー", "萌えゲー",
    "ADV", "18禁ゲーム", "R18ゲーム",
]

# A light novel can take this medium as its setting, so a review of one carries the same
# words as a review of a work. What it also carries is the shape of the genre it is in.
FICTION_ABOUT_TERMS = ["転生", "異世界", "ラノベ", "読書感想"]

# What marks a creator's post as being about a stream rather than their work.
CREATOR_EXCLUDE = [
    "VTuber", "配信中", "配信します", "同時視聴",
    "スパチャ", "メンバーシップ",
]

# Terms that mark an English-language post as being about reading the original works
# rather than translations, which the feed does not follow.
JP_READING_TERMS = [
    "japanese", "untranslated", "eroge", "nukige", "in jp", "raw", "n1", "n2", "jlpt",
    "yomitan", "textractor", "texthooker", "learning", "vocab", "kanji", "anki",
]
TRANSLATION_TERMS = ["translation patch", "fan tl", "official tl", "localization", "localisation"]
# What marks an English article as being about a localisation rather than the work itself.
LOCALISATION_TERMS = TRANSLATION_TERMS + [
    "in the west", "in english", "english release", "english version", "english patch",
    "localiz", "localis", "license", "translated", "translation status",
    "tl release", "coming west", "english scenario", "published in english",
    "for english release",
]


# Post tags that file an article under a translation, a release in another language, or a
# work of another origin, on an outlet that tags each post by its kind.
TL_CATEGORIES = [
    "Official TL", "TL Announcement", "TL Release", "Translation", "Fan TL", "Patch",
    "EVN", "OELVN", "Kickstarter",
]
# The same outlet's positive tag for a review of a Japanese title; its reviews of works
# from elsewhere carry the matching tag for their own origin instead.
JP_REVIEW_CATEGORIES = ["JVN Review"]
LOCALISATION_CATEGORIES = ["Translation", "Localization", "Localisation"]
# Post tags naming the origin of a work the feed does not follow. Each is matched as a
# substring of a whole tag value, which none of these terms shares with a Japanese one.
NON_JP_ORIGIN_CATEGORIES = [
    "Chinese VN", "Chinese", "Korean VN", "Korean", "Western VN", "OELVN", "English VN",
    "Taiwanese",
]


# The language a source writes in. Rows carry it so a reader can keep to one side; a
# source that is neither (the catalogue, the stores) is shown under both.
JA = "ja"
EN = "en"


@dataclass(frozen=True)
class RssFeed:
    name: str
    url: str
    include: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    # Feeds whose article images are adult art; the site shows them behind a blur.
    nsfw_images: bool = False
    lang: str = JA
    # The row source, which decides the section the feed lands in.
    source: str = "rss"
    # Some hosts answer a plain library client with a refusal and expect a named one.
    headers: dict[str, str] | None = None
    # Entries filed under one of these categories are dropped, each term matched as a
    # case-insensitive substring of every category the entry names.
    exclude_categories: list[str] = field(default_factory=list)
    # When set, only entries filed under one of these categories are kept, matched the
    # same way. A feed that tags every post by kind can be read as an allowlist.
    include_categories: list[str] = field(default_factory=list)
    # Only entries whose id matches are kept, for feeds that mix kinds of entry.
    key_pattern: str | None = None
    # Only entries whose title matches are kept; one feed can then serve two sections.
    title_pattern: str | None = None
    # Entries whose title matches are dropped, for a feed that carries record-keeping
    # alongside the threads a reader would follow.
    title_exclude_pattern: str | None = None
    # The same for the entry's text, where the opening line is what places a post.
    summary_exclude_pattern: str | None = None
    # A feed about more than this medium, whose entries are read for relevance before
    # they file. A hashtag, search or single-subject feed is already selected and is not.
    broad: bool = False
    # A feed that relays many outlets names the outlet on each entry; use it as the label.
    label_from_entry: bool = False
    max_items: int = 10


# A relay names an outlet in whichever spelling its entry carries; one plate per outlet.
OUTLET_ALIASES = {
    "gamespark.jp": "Game*Spark",
    "inside": "インサイド",
    "ファミ通.com": "ファミ通",
}


def canonical_outlet(name: str) -> str:
    return OUTLET_ALIASES.get(name.strip().lower(), name)


# Search feeds return a relevance-sorted history unless the query pins a time window.
def _google_news(query: str) -> str:
    return f"https://news.google.com/rss/search?q={quote(query + ' when:7d')}&hl=ja&gl=JP&ceid=JP:ja"


# Boards in this family refuse a browser or library client and answer only a
# client-protocol name; the name is the protocol identifier, not a disguise.
BOARD_HEADERS = {"User-Agent": "Monazilla/1.00 (vnclub-news; +https://vnclub.org)"}
# The forum's feeds refuse browser strings from datacenter addresses and ask for a
# descriptive client name instead.
REDDIT_HEADERS = {"User-Agent": "vnclub-news/1.0 (+https://vnclub.org/news/)"}
# A few outlets answer only a browser client name and refuse every other string.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0.0.0 Safari/537.36"
    )
}


# What a relayed headline must say to count, and what marks it as about something else.
SEARCH_TERMS = VN_TERMS + ["ADV", "アドベンチャー", "恋愛ゲーム", "ノベル"]
SEARCH_EXCLUDE = OTHER_GENRES + ["翻訳", "英語版", "クラウドファンディング"]

# Feed sources that are community voices rather than press, and feeds that are reviews;
# each group runs on its own job.
COMMUNITY_SOURCES = ("note", "hatena", "forum", "reddit")
REVIEW_SOURCES = ("review",)

RSS_FEEDS: list[RssFeed] = [
    RssFeed("4Gamer", "https://www.4gamer.net/rss/index.xml", VN_TERMS, OTHER_GENRES),
    RssFeed("Automaton", "https://automaton-media.com/feed/", VN_TERMS, OTHER_GENRES),
    RssFeed(
        "Game Watch",
        "https://game.watch.impress.co.jp/data/rss/1.0/gmw/feed.rdf",
        VN_TERMS,
        OTHER_GENRES + ["ホラー"],
    ),
    RssFeed("iNSIDE", "https://www.inside-games.jp/rss/index.rdf", VN_TERMS, OTHER_GENRES),
    RssFeed(
        "Denfaminicogamer",
        "https://news.denfaminicogamer.jp/feed",
        VN_TERMS,
        OTHER_GENRES + ["ホラー"],
    ),
    RssFeed("Game*Spark", "https://www.gamespark.jp/rss20/index.rdf", VN_TERMS, OTHER_GENRES),
    RssFeed("ITmedia", "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", VN_TERMS, OTHER_GENRES),
    RssFeed("ねとらぼ", "https://rss.itmedia.co.jp/rss/2.0/netlab.xml", VN_TERMS, OTHER_GENRES),
    RssFeed("Moepedia", "https://moepedia.net/feed/"),
    RssFeed("Ima-ero", "https://www.ima-ero.com/feed/", nsfw_images=True),
    # The tagged feeds rather than the site feed, which also carries comics.
    RssFeed("BugBug", "https://www.bugbug.news/tag/post_tag-227/feed/", nsfw_images=True),
    RssFeed("BugBug", "https://www.bugbug.news/tag/campaign/feed/", nsfw_images=True),
    RssFeed("BugBug", "https://www.bugbug.news/tag/post_tag-229/feed/", nsfw_images=True),
    RssFeed("萌えゲー.net", "https://moe-gameaward.com/media/feed/", nsfw_images=True),
    RssFeed("Otomate", "https://www.otomate-p.jp/feed/"),
    RssFeed("MAGES.", "https://mages.co.jp/feed"),
    # Brands' own news feeds.
    RssFeed("Nitroplus", "https://www.nitroplus.co.jp/index.xml"),
    RssFeed("August", "https://august-soft.com/news/feed/"),
    RssFeed("Madosoft", "https://madosoft.net/news/feed/"),
    RssFeed("Alicesoft", "https://www.alicesoft.com/atom.xml", nsfw_images=True),
    RssFeed("Key", "https://key.visualarts.gr.jp/feed"),
    RssFeed("VisualArts", "https://visual-arts.jp/news/feed/"),
    RssFeed("TYPE-MOON", "https://typemoon.com/atom.xml"),
    RssFeed("Hulotte", "https://hulotte.jp/pc/feed"),
    RssFeed("Frontwing", "http://frontwing.jp/news/feed/"),
    RssFeed("ninetail", "https://ninetail.info/blog2/feed/", nsfw_images=True),
    RssFeed("変人窟", "https://henjinkutsu.com/feed/", VN_TERMS),
    RssFeed("TEAM Entertainment", "https://www.team-e.co.jp/feed/"),
    RssFeed("VNDB", "https://vndb.org/feeds/announcements.atom", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN),
    RssFeed("この青空に、エロゲを求めて", "https://bluesky-erg.com/feed/", nsfw_images=True, source="review"),
    RssFeed("エロゲエム", "https://erogame.mhx.jp/feed", nsfw_images=True, source="review"),
    RssFeed("猫のお戯れ", "https://nekokingdom.hatenablog.com/feed", source="review"),
    # English review sites. The first posts more than reviews under one address.
    RssFeed("VNDBReview", "https://vndbreview.blogspot.com/feeds/posts/default?alt=rss", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, source="review", title_pattern=r"(?i)^VN of the Month"),
    RssFeed("Kawaii Janakya Dame nano!", "https://breadmasterlee.com/category/visual-novel/feed/", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, source="review"),
    # The same author as the channel of the same name; one plate, two kinds of review.
    RssFeed("Pandamaare", "https://vengilikes.wordpress.com/feed/", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, source="review"),
    RssFeed("Rough Edge", "https://ontlogy.wordpress.com/feed/", ["visual novel", "eroge", "nukige", "galge", "doujin"], LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, nsfw_images=True, lang=EN, source="review"),
    # English press about the works themselves; localisation stories are left out.
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=visual+novel&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("Gematsu", "https://www.gematsu.com/tag/visual-novel/feed", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN),
    # One feed, two sections: its reviews are filed as reviews, the rest as headlines.
    RssFeed("Fuwanovel", "https://fuwanovel.moe/feed/", exclude=LOCALISATION_TERMS + ["Review:"], exclude_categories=TL_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN),
    RssFeed("Fuwanovel reviews", "https://fuwanovel.moe/feed/", exclude=LOCALISATION_TERMS, exclude_categories=NON_JP_ORIGIN_CATEGORIES, include_categories=JP_REVIEW_CATEGORIES, lang=EN, source="review", title_pattern=r"^Review:"),
    RssFeed("NookGaming", "https://www.nookgaming.com/tag/eroge/feed/", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, source="review"),
    RssFeed("Noisy Pixel", "https://noisypixel.net/tag/visual-novel/feed/", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, headers=BROWSER_HEADERS, lang=EN, source="review", title_pattern=r"(?i)\breview\b"),
    # The same feed's news, with the outlet's own tag for its reviews left to the entry above.
    RssFeed("Noisy Pixel", "https://noisypixel.net/tag/visual-novel/feed/", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES + ["Reviews"], headers=BROWSER_HEADERS, lang=EN),
    # The feed carries the whole archive; only the newest few are ever news.
    RssFeed("MoeGamer", "https://moegamer.net/feed/", ["visual novel", "eroge", "galge", "otome", "adventure game", "bishoujo", "nukige"], LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, source="review", max_items=5),
    # The outlet's search feeds, one per corner of the subject; the same label on each
    # keeps them one plate to a reader, and a piece reached twice files once by address.
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=otome&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=eroge&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=doujin&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=bishojo&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("AUTOMATON WEST", "https://automaton-media.com/en/?s=adult+game&feed=rss2", exclude=LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN, broad=True),
    RssFeed("Siliconera", "https://www.siliconera.com/?s=otome+game&feed=rss2", ["visual novel", "otome", "eroge", "galge", "bishoujo"], LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN),
    RssFeed("Siliconera", "https://www.siliconera.com/?s=visual+novel&feed=rss2", ["visual novel", "otome", "eroge", "galge", "bishoujo"], LOCALISATION_TERMS, exclude_categories=LOCALISATION_CATEGORIES + NON_JP_ORIGIN_CATEGORIES, lang=EN),
    RssFeed("かーずSP", "https://www.karzusp.net/feed", VN_TERMS),
    # Retro and the store's own corporate releases.
    RssFeed("D4 Enterprise", "https://www.d4e.co.jp/feed"),
    RssFeed("RetroPC NEWS", "https://retropcnews.com/feed", VN_TERMS + ["アドベンチャー", "PC-98", "PC98"]),
    RssFeed("PR TIMES (エイシス)", "https://prtimes.jp/companyrdf.php?company_id=42966"),
    # Search feeds: whatever any outlet wrote this week, each entry naming its outlet. The
    # search matches the query anywhere in an article, so the headline itself must name
    # the medium for the entry to count.
    RssFeed("Google News", _google_news("美少女ゲーム"), SEARCH_TERMS, SEARCH_EXCLUDE, label_from_entry=True),
    RssFeed("Google News", _google_news("ビジュアルノベル"), SEARCH_TERMS, SEARCH_EXCLUDE, label_from_entry=True),
    RssFeed("Google News", _google_news("エロゲ"), SEARCH_TERMS, SEARCH_EXCLUDE, label_from_entry=True),
    RssFeed("Google News", _google_news("ノベルゲーム"), SEARCH_TERMS, SEARCH_EXCLUDE, label_from_entry=True),
    # Community writing. The hashtag feeds overlap, and the store dedupes by link.
    RssFeed("note", "https://note.com/hashtag/%E3%82%A8%E3%83%AD%E3%82%B2%E6%84%9F%E6%83%B3/rss", source="review"),
    RssFeed("note", "https://note.com/hashtag/%E3%82%A8%E3%83%AD%E3%82%B2/rss", source="note"),
    RssFeed("note", "https://note.com/hashtag/%E7%BE%8E%E5%B0%91%E5%A5%B3%E3%82%B2%E3%83%BC%E3%83%A0/rss", source="note"),
    RssFeed("note", "https://note.com/hashtag/%E3%82%AE%E3%83%A3%E3%83%AB%E3%82%B2%E3%83%BC/rss", source="note"),
    RssFeed(
        "はてなブックマーク",
        "https://b.hatena.ne.jp/q/%E3%82%A8%E3%83%AD%E3%82%B2?mode=rss&sort=recent",
        source="hatena",
    ),
    RssFeed(
        "はてなブックマーク",
        "https://b.hatena.ne.jp/hotentry/game.rss",
        VN_TERMS,
        source="hatena",
        broad=True,
    ),
    # New threads only: a post number of one is the thread's opening post. The feed names
    # no board, so a thread aimed at one member rather than at readers is told apart by
    # its wording, which errs toward dropping a real thread now and then.
    RssFeed(
        "VNDB discussions",
        "https://vndb.org/feeds/posts.atom",
        lang=EN,
        source="forum",
        key_pattern=r"\.1$",
        title_exclude_pattern=r"(?i)^(regarding [a-z]{1,2}\d+|about\b|where (to|can i) (get|buy|find|download)|how (to|do i) (get|buy|install|run|play)|crash|doesn't (work|start|run)|won't (work|start|run)|error\b)",
        summary_exclude_pattern=r"(?i)^\s*(hi|hey|hello|yo)?[,!. ]*\s*(i saw (that )?you|you (edited|added|removed|changed)|do you (have|know|own)|can you|could you|thanks for)",
    ),
    RssFeed(
        "r/visualnovels",
        "https://www.reddit.com/r/visualnovels/new/.rss?limit=25",
        JP_READING_TERMS,
        TRANSLATION_TERMS,
        lang=EN,
        source="reddit",
        headers=REDDIT_HEADERS,
    ),
    RssFeed(
        "r/vns",
        "https://www.reddit.com/r/vns/new/.rss?limit=25",
        exclude=TRANSLATION_TERMS,
        lang=EN,
        source="reddit",
        headers=REDDIT_HEADERS,
    ),
    RssFeed(
        "r/otomegames",
        "https://www.reddit.com/r/otomegames/new/.rss?limit=25",
        exclude=TRANSLATION_TERMS,
        lang=EN,
        source="reddit",
        headers=REDDIT_HEADERS,
        max_items=8,
    ),
    # The weekly reading thread, by its fixed title.
    RssFeed(
        "r/visualnovels weekly",
        "https://www.reddit.com/r/visualnovels/search.rss?q=%22What+are+you+reading%22&restrict_sr=on&sort=new&t=week",
        ["what are you reading"],
        lang=EN,
        source="reddit",
        headers=REDDIT_HEADERS,
    ),
    RssFeed(
        "r/LearnJapanese",
        "https://www.reddit.com/r/LearnJapanese/new/.rss?limit=25",
        ["visual novel", "eroge", " vn", "galge", "textractor", "texthooker"],
        TRANSLATION_TERMS,
        lang=EN,
        source="reddit",
        headers=REDDIT_HEADERS,
        broad=True,
    ),
]


@dataclass(frozen=True)
class YouTubeChannel:
    name: str
    channel_id: str
    lang: str = JA
    # Brand channels post trailers; a channel of reviews files with the reviews.
    source: str = "youtube"
    # A channel that also covers the wider scene, whose uploads are read for relevance
    # before they file. A brand channel and a channel only about this medium are not.
    broad: bool = False


YOUTUBE_CHANNELS: list[YouTubeChannel] = [
    YouTubeChannel("VisualArts / Key", "UCp1Pg6NVz7c3uVfpphEn6Og"),
    YouTubeChannel("Yuzusoft", "UCOzWD4b_-q77XTaSl89OukA"),
    YouTubeChannel("Nitroplus", "UCnolIOY2ot18AjsB3waa0dQ"),
    YouTubeChannel("Hooksoft", "UCSzkgp26xJ5tC3hkvh93q7A"),
    YouTubeChannel("Purple Software", "UC9FAmfNO4owXiC0OtVniKIg"),
    YouTubeChannel("Otomate", "UC4m5A81p-zvwKIry4yuLmcw"),
    YouTubeChannel("Navel", "UC-fIJ_iz5Y4wyjbcle_dASA"),
    YouTubeChannel("Frontwing", "UCCaZwRx_HS61ZiNUrBdmDoA"),
    YouTubeChannel("Circus", "UCiBzCxAZClXt7WYRRW9vQtg"),
    YouTubeChannel("Madosoft", "UCMJhLgUQQl0ZQL23VRlnANw"),
    YouTubeChannel("Laplacian", "UCJfztRTXdvhBDjfA8Zv1CEQ"),
    YouTubeChannel("age", "UCL9LCe9XTq8Iytcbg2SsHgg"),
    YouTubeChannel("Entergram", "UC5L29DMpV7CgtsU6mxV6cGw"),
    YouTubeChannel("Nitroplus", "UC0l_e8EKm2nvmro47DTiKKA"),
    YouTubeChannel("Palette", "UCZh0Zle4EOte4enVI57-csg"),
    YouTubeChannel("Aquaplus", "UCv8zUCRTIhfeuTtXKIgyRCg"),
    YouTubeChannel("Cabbage Soft", "UC4xzLeGojK-zTYQ8xjQFoSQ"),
    YouTubeChannel("SMEE", "UCh4SWjVKnaC_3QyXHCtg3Dw"),
    YouTubeChannel("August", "UCVj6bacaTQ6r6Dsv0frD_sA"),
    YouTubeChannel("Alicesoft", "UC3X_mFxL6m-dakMyqFe8FXA"),
    YouTubeChannel("Liar-soft", "UCUmQZgn-wkkAomGTYR0H8ag"),
    YouTubeChannel("Minato soft", "UC-eXk3BjXzlimRl8XfOtZXw"),
    YouTubeChannel("CUFFS", "UCTl08-5uJ4U2V1tOQrwuVLg"),
    YouTubeChannel("Eushully", "UCIKH8PYAVevQplmq3BWYPGQ"),
    YouTubeChannel("TYPE-MOON", "UCbieVUDzE9e857HubtgWYjA"),
    YouTubeChannel("Akabeisoft2", "UCkrEkPf0Kn7hUg49vqDku9Q"),
    YouTubeChannel("Akabeisoft3", "UC-nhyMMGNXQQsXrdtDx3mSg"),
    YouTubeChannel("Hulotte", "UCw7RMp6rLWm9ArPOsY3J1QA"),
    YouTubeChannel("Qruppo", "UCNfQtdBZjp-2tHdKyY6p2Qg"),
    YouTubeChannel("CRYSTALiA", "UC46Q5g8HLabF-jHUtEFDc9g"),
    YouTubeChannel("Silky's Plus", "UC_2cIKKySHg4IAi7wTpyhJA"),
    YouTubeChannel("Will Plus", "UCiviDdhC6eyxz2rYWXhYiqg"),
    YouTubeChannel("Purple Software", "UCQYEr3sF1dT1cumrEGjoiAQ"),
    YouTubeChannel("Circus", "UCg7ZSOqUpIYDNTD8OPSUsWQ"),
    YouTubeChannel("CLOWN", "UC20E8WvNq_BFxPC5IBeSL7A"),
    YouTubeChannel("Nitro Arts", "UCagm81TXjn-_FKnKDwbJv_g"),
    YouTubeChannel("Amusecraft", "UCbQSBZW6kMz_FYYJnNNeVgg"),
    # Monthly roundups of the month's eroge openings.
    YouTubeChannel("抹茶グリーン", "UCeD1YvElZpEzJVj9Fl_4vyw"),
    # English channels that review the works rather than announce them.
    YouTubeChannel("Meirin", "UCqXZHGpPW58jKhBzZ3Ymv0w", lang=EN, source="review"),
    YouTubeChannel("superange128", "UCPeO4kU0K2HHSwED9pT-XRg", lang=EN, source="review"),
    YouTubeChannel("Radiant Wave", "UCg2SNnQ4vlURlRl6YfHTyPQ", lang=EN, source="review"),
    YouTubeChannel("VNture", "UCZzKoXW4_PdvdHdN-bcA5og", lang=EN, source="review"),
    YouTubeChannel("Amelie Doree", "UCShccf0NLU7E3USx82Vu2jQ", lang=EN, source="review"),
    YouTubeChannel("The August Hail", "UCgo1RgtW6Q5MQ7dtmd_HUzg", lang=EN, source="review"),
    YouTubeChannel("Bapsago", "UCbIaUYmG-CLxvwUQLgGR_eA", lang=EN, source="review"),
    YouTubeChannel("Pandamaare", "UCkCKUzslqCucCBbfxOuaGfA", lang=EN, source="review"),
    YouTubeChannel("NeNeiSan", "UCQFrnjPWv0K14eQgp9CyOwQ", lang=EN, source="review"),
    # Industry vlogs rather than reviews; the sections map has no home for a channel of
    # news, so it files with the reviews it sits closest to. Its subject is the scene at
    # large, so each upload is read for relevance before it files.
    YouTubeChannel("Overworked Salaryman", "UCUm0S28Z2GKE4qWhbpl1qRA", lang=EN, source="review", broad=True),
    YouTubeChannel("Keyverse", "UCpfAyUBZmCFrZwfD2yD3BZg", lang=EN, source="review"),
    YouTubeChannel("Hyakki", "UCU34aRfUSx0xbeWPAKI-y8A", lang=EN, source="review"),
    YouTubeChannel("BruceGoneLoose", "UCpB21scDTYvwAxklzPihXOA", lang=EN, source="review"),
    YouTubeChannel("Evolved", "UCtJsULTaN8AtnZWCTVb9bRg", lang=EN, source="review"),
    YouTubeChannel("MP", "UClr3LvkB0Rqhxo5MK1n_gXA", lang=EN, source="review"),
    YouTubeChannel("Reddoliche2", "UCdzL8ezldJlQnJBPAn993ng", lang=EN, source="review"),
    YouTubeChannel("Resting Peach Face", "UCl2ODx5xy27IIhswGqM5QBA", lang=EN, source="review"),
]


@dataclass(frozen=True)
class BlueskyAccount:
    handle: str
    name: str
    include: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    lang: str = JA
    source: str = "bluesky"
    # Accounts that mix announcements with daily chatter: only posts carrying a link are
    # kept, since the announcements always point somewhere and the chatter never does.
    links_only: bool = False


BLUESKY_ACCOUNTS: list[BlueskyAccount] = [
    BlueskyAccount("4gamer.net", "4Gamer", VN_TERMS, OTHER_GENRES),
    BlueskyAccount("automaton-media.com", "Automaton", VN_TERMS, OTHER_GENRES),
    BlueskyAccount("denfaminicogame.bsky.social", "Denfaminicogamer", VN_TERMS, OTHER_GENRES),
    BlueskyAccount("nitroplus.co.jp", "Nitroplus"),
    BlueskyAccount("famitsu.com", "Famitsu", VN_TERMS, OTHER_GENRES),
    BlueskyAccount("aquaplus-jp.bsky.social", "Aquaplus"),
    BlueskyAccount("erogehou.bsky.social", "エロゲ放", links_only=True),
    BlueskyAccount("visualnovelnews.bsky.social", "Visual Novel News", exclude=LOCALISATION_TERMS, lang=EN, links_only=True),
    BlueskyAccount("automatonwest.bsky.social", "AUTOMATON WEST", VN_TERMS_EN, LOCALISATION_TERMS, lang=EN, links_only=True),
    BlueskyAccount("karoshimyriad.bsky.social", "KaroshiMyriad", VN_TERMS_EN, LOCALISATION_TERMS, lang=EN),
    # A press byline account.
    BlueskyAccount("bk2128.bsky.social", "Kite Stenbuck", VN_TERMS_EN, LOCALISATION_TERMS, lang=EN, links_only=True),
    # A bot announcing every new doujin work; only the ones that are games of this kind.
    BlueskyAccount("dlsite.doujin.biz", "DLsite 同人", ["ノベル", "ADV", "アドベンチャー"]),
]


@dataclass(frozen=True)
class BlueskySearch:
    """A post search on the network. Hits are community voices, so they file as such."""

    query: str
    name: str
    lang: str = JA
    exclude: list[str] = field(default_factory=list)
    # A hit shorter than this is a reaction, not a post worth a row.
    min_chars: int = 40
    # Storefront and affiliate links mark a promotion rather than a reader's post.
    exclude_hosts: tuple[str, ...] = ("dlsite.com", "dlaf.jp", "dmm.co.jp", "fanza", "amazon.co.jp", "amzn.to")
    max_items: int = 10
    source: str = "bsky_search"


BLUESKY_SEARCHES: list[BlueskySearch] = [
    BlueskySearch("エロゲ 感想", "Bluesky 感想", exclude=FICTION_ABOUT_TERMS),
    BlueskySearch("ノベルゲーム 感想", "Bluesky 感想", exclude=FICTION_ABOUT_TERMS),
    BlueskySearch("ギャルゲー 感想", "Bluesky 感想", exclude=FICTION_ABOUT_TERMS),
    BlueskySearch("untranslated visual novel", "Bluesky VN", lang=EN, exclude=LOCALISATION_TERMS),
    BlueskySearch("eroge review", "Bluesky eroge reviews", lang=EN, exclude=LOCALISATION_TERMS),
]


@dataclass(frozen=True)
class XAccount:
    handle: str
    exclude: list[str] = field(default_factory=list)
    include: list[str] = field(default_factory=list)
    # Accounts whose attached pictures are adult art use no image at all.
    exclude_images: bool = False
    # Accounts whose pictures are worth keeping but belong behind the site's blur.
    nsfw_images: bool = False
    # Whether a post without a picture may take the social image of the page it links to.
    # Off for accounts whose links go to adult storefronts.
    link_images: bool = True
    lang: str = JA
    source: str = "twitter"
    links_only: bool = False


X_ACCOUNTS: list[XAccount] = [
    XAccount(
        "ErogeAreAlive",
        exclude=["[Official TL]", "[Fan TL]", "english", "tl", "translation", "translate"],
        lang=EN,
    ),
    # An English review site's own account; its pictures are the art it reviews.
    XAccount("NookSite", exclude=LOCALISATION_TERMS, include=VN_TERMS_EN, nsfw_images=True, lang=EN, source="review", links_only=True),
    # Brands' own accounts: key visuals, trial announcements, release-day posts.
    XAccount("yuzusoft"),
    XAccount("whirlpool_soft"),
    XAccount("AUGUST_SOFT"),
    XAccount("aquaplus_jp"),
    XAccount("qruppo"),
    XAccount("entergram"),
    XAccount("moeaward", exclude_images=True),
    XAccount("cybernhmksk", include=["fanza.co.jp", "dlaf.jp"], exclude_images=True, link_images=False),
    XAccount("Moepedia_net", exclude_images=True),
    XAccount(
        "DLsite_info",
        include=["美少女ゲーム", "ノベル", "ADV", "PCゲーム"],
        exclude_images=True,
        link_images=False,
    ),
    XAccount(
        "getchucom",
        include=["美少女ゲーム", "PCゲーム", "発売", "予約"],
        exclude_images=True,
        link_images=False,
    ),
    XAccount("sofurin_jp"),
    XAccount("lantis_staff", include=VN_TERMS + ["ゲーム", "主題歌"]),
    XAccount("key_official"),
    XAccount("visualantena"),
    XAccount("nitroplus_staff"),
    XAccount("TMitterOfficial"),
    XAccount("alice_soft", nsfw_images=True),
    XAccount("eushully_info", nsfw_images=True),
    XAccount("purple_NewWork"),
    XAccount("AKABEiSOFT2_ab2"),
    XAccount("circus_info"),
    XAccount("C_CLOWN_info"),
    XAccount("project_navel"),
    XAccount("liar_railsoft"),
    XAccount("minatosoft"),
    XAccount("smee_official"),
    XAccount("HOOKSOFT"),
    XAccount("ASaProject_2016"),
    XAccount("sprite_fairys"),
    XAccount("Sphere_web"),
    XAccount("cube_staff"),
    XAccount("web_marmalade"),
    XAccount("fw_official"),
    XAccount("grisaia_fw"),
    XAccount("waffle1999", nsfw_images=True),
    XAccount("BISHOP_JP", nsfw_images=True),
    XAccount("TaimaninKoho", nsfw_images=True),
    XAccount("info_palette"),
    XAccount("SkyFish_san"),
    XAccount("clockupofficial", nsfw_images=True),
    XAccount("silkysplus"),
    XAccount("blackcyc_x", nsfw_images=True),
    XAccount("twit_Gungnir"),
    XAccount("escude1998", nsfw_images=True),
    XAccount("CandySoft_tw"),
    XAccount("laplacian_info"),
    XAccount("hulotte_jp"),
    XAccount("will_ensemble"),
    XAccount("madostaff"),
    XAccount("CabbitOfficial"),
    XAccount("toneworks"),
    XAccount("CRYSTALiA_AC"),
    XAccount("kaede_9tail", nsfw_images=True),
    XAccount("Empress_STAFF", nsfw_images=True),
    XAccount("Guilty_WillPlus", nsfw_images=True),
    XAccount("ALcot_official"),
    XAccount("clochette_soft"),
    XAccount("Windmill_Oasis"),
    XAccount("Astronauts_soft"),
    XAccount("Amuse_sub", nsfw_images=True),
    XAccount("propeller_staff"),
]


def _creator(handle: str, exclude_images: bool = False, include: list[str] | None = None) -> XAccount:
    return XAccount(
        handle, exclude_images=exclude_images, include=include or [], source="creator"
    )


# A timeline whose subject is usually something else files only where it names this medium.
_ON_TOPIC_ONLY = VN_TERMS_JA + VN_TERMS_EN


# Writers, artists and singers the scene follows. Their posts are the community side of
# the feed, not headlines, and are filed apart so they never crowd the press out.
CREATOR_ACCOUNTS: list[XAccount] = [
    # Writers
    _creator("SCA_DI"),
    _creator("F_Maruto_staff"),
    _creator("nsimayu"),
    _creator("asta_konno", include=_ON_TOPIC_ONLY),
    _creator("Toshi_Ikebukuro"),
    _creator("tom_fuyuakane"),
    _creator("kionachi"),
    _creator("sora_hajime", include=_ON_TOPIC_ONLY),
    _creator("kazuha_uduki"),
    _creator("ryodist"),
    # Artists
    _creator("misaki_cradle"),
    _creator("bekkankou"),
    _creator("aoi_nishimata"),
    _creator("tsubasu_izumi"),
    _creator("kobuichi"),
    _creator("kilacco"),
    _creator("eretto_", include=_ON_TOPIC_ONLY),
    _creator("itoww"),
    _creator("amaduyu"),
    _creator("kimishima_ao"),
    _creator("kantoku_5th"),
    _creator("metawo_ueda"),
    _creator("ameto_y"),
    _creator("aya_ha"),
    _creator("arikawa_sat"),
    _creator("inuan"),
    _creator("ankoro_san"),
    # Singers
    _creator("KOTOKO_Dwarf", include=_ON_TOPIC_ONLY),
    _creator("Ritaco25"),
    _creator("chanekino"),
    _creator("shimotsuki_h"),
]


@dataclass(frozen=True)
class Board:
    """A thread list on a text board. New threads are the news; posts are not read."""

    host: str
    board: str
    name: str
    headers: dict[str, str] | None = None
    lang: str = JA
    # A board with one thread per work: every thread on it is about a work, so a thread
    # there is filed without being read for relevance. The rest carry general chatter.
    per_work: bool = False


BOARDS: list[Board] = [
    Board("phoebe.bbspink.com", "hgame", "エロゲー板", BOARD_HEADERS),
    Board("phoebe.bbspink.com", "hgame2", "エロゲー作品別板", BOARD_HEADERS, per_work=True),
    Board("mercury.bbspink.com", "erog", "エロゲネタ板", BOARD_HEADERS),
    Board("mercury.bbspink.com", "leaf", "葉鍵板", BOARD_HEADERS),
    Board("mevius.5ch.io", "gal", "ギャルゲー板"),
]

# Image board generals on the one board where the scene gathers; matched by subject.
FOURCHAN_BOARD = "jp"
FOURCHAN_SUBJECTS = ["エロゲ", "untranslated vn", "daily japanese thread", "djt"]

MOEAWARD_NEWS_URL = "https://www.moe-gameaward.com/news/newslist.html"
# The review listing, newest first. The site asks crawlers for this much spacing.
VNDB_REVIEWS_URL = "https://vndb.org/w?o=d&s=id&p=1"
VNDB_CRAWL_DELAY = 10.0
JITEN_UPDATE_LOG_URL = "https://api.jiten.moe/api/media-deck/media-update-log?offset=0"
